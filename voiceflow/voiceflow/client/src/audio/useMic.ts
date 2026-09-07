import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Two distinct signals, deliberately kept separate:
 *
 * 1. Speech-ONSET detection (fast, ~tens of ms): a simple RMS-amplitude
 *    threshold on the raw mic stream via AnalyserNode. This is what
 *    triggers the `interrupt` message the instant the user starts talking
 *    over the assistant — we do NOT wait for STT to produce text before
 *    reacting, because that would add STT's inherent latency (hundreds of
 *    ms) to the interruption path, which defeats the point.
 *
 * 2. Final transcript text (slower): the browser's native SpeechRecognition
 *    (Web Speech API). Once it reports a final result, that text becomes
 *    the new turn's `user_utterance`.
 *
 * This split is a real, load-bearing design decision, not incidental —
 * it's called out in README "Interruption handling".
 */

export interface MicController {
  supported: boolean;
  listening: boolean;
  micLevel: number; // 0..1, real-time
  interimText: string;
  start: () => Promise<void>;
  stop: () => void;
  onSpeechOnset: (fn: () => void) => () => void;
  onFinalText: (fn: (text: string) => void) => () => void;
}

const SPEECH_ONSET_THRESHOLD = 0.06;
const SPEECH_ONSET_SUSTAIN_MS = 90;

export function useMicController(): MicController {
  const [supported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      (typeof (window as any).SpeechRecognition !== 'undefined' ||
        typeof (window as any).webkitSpeechRecognition !== 'undefined'),
  );
  const [listening, setListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [interimText, setInterimText] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const onsetListenersRef = useRef(new Set<() => void>());
  const finalListenersRef = useRef(new Set<(text: string) => void>());
  const aboveThresholdSinceRef = useRef<number | null>(null);
  const onsetFiredRef = useRef(false);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const v of data) {
        const centered = (v - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setMicLevel(rms);

      const now = performance.now();
      if (rms > SPEECH_ONSET_THRESHOLD) {
        if (aboveThresholdSinceRef.current === null) aboveThresholdSinceRef.current = now;
        if (
          !onsetFiredRef.current &&
          now - aboveThresholdSinceRef.current >= SPEECH_ONSET_SUSTAIN_MS
        ) {
          onsetFiredRef.current = true;
          for (const fn of onsetListenersRef.current) fn();
        }
      } else {
        aboveThresholdSinceRef.current = null;
        onsetFiredRef.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    if (!supported || listening) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyserRef.current = analyser;
    rafRef.current = requestAnimationFrame(tick);

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            setInterimText('');
            for (const fn of finalListenersRef.current) fn(text.trim());
          } else {
            interim += text;
          }
        }
        if (interim) setInterimText(interim);
      };
      recognition.onerror = (e: any) => {
        console.warn('[useMicController] SpeechRecognition error', e.error);
      };
      recognition.onend = () => {
        // Auto-restart while the session is still "listening" — the browser
        // API stops itself after periods of silence.
        if (listening) {
          try {
            recognition.start();
          } catch {
            /* already starting */
          }
        }
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        /* noop */
      }
    }

    setListening(true);
  }, [supported, listening, tick]);

  const stop = useCallback(() => {
    setListening(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setMicLevel(0);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const onSpeechOnset = useCallback((fn: () => void) => {
    onsetListenersRef.current.add(fn);
    return () => onsetListenersRef.current.delete(fn);
  }, []);

  const onFinalText = useCallback((fn: (text: string) => void) => {
    finalListenersRef.current.add(fn);
    return () => finalListenersRef.current.delete(fn);
  }, []);

  return { supported, listening, micLevel, interimText, start, stop, onSpeechOnset, onFinalText };
}
