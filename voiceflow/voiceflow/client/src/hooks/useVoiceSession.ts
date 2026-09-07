import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioQueue } from '../audio/AudioQueue';
import { useMicController } from '../audio/useMic';
import type {
  ClientMessage,
  ServerMessage,
  SessionState,
  SystemInfo,
  Turn,
  StressTestResult,
} from '../lib/types';

const WS_URL = (import.meta as any).env?.VITE_WS_URL ?? 'ws://localhost:8787/ws';

export type VisualizerState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'processing'
  | 'error';

function toVisualizerState(s: SessionState): VisualizerState {
  switch (s) {
    case 'IDLE':
      return 'idle';
    case 'LISTENING':
      return 'listening';
    case 'THINKING':
      return 'thinking';
    case 'TOOL_RUNNING':
      return 'processing';
    case 'SPEAKING':
      return 'speaking';
    case 'INTERRUPTING':
    case 'CANCELLING':
      return 'interrupted';
    case 'PROCESSING_NEW_TURN':
      return 'processing';
    case 'ERROR':
      return 'error';
  }
}

export function useVoiceSession() {
  const [connected, setConnected] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('IDLE');
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const [turnOrder, setTurnOrder] = useState<string[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [playbackLevel, setPlaybackLevel] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [stressResult, setStressResult] = useState<StressTestResult | null>(null);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<AudioQueue>(new AudioQueue());
  const mic = useMicController();
  const speechOnsetAtRef = useRef<number | null>(null);
  const audioCancelAtRef = useRef<number | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => setLastError('WebSocket connection error');

    ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data);
      switch (msg.type) {
        case 'state':
          setSessionState(msg.state);
          setActiveTurnId(msg.turnId);
          break;
        case 'turn_created':
          setTurns((prev) => ({ ...prev, [msg.turn.id]: msg.turn }));
          setTurnOrder((prev) => (prev.includes(msg.turn.id) ? prev : [...prev, msg.turn.id]));
          break;
        case 'turn_updated':
          setTurns((prev) => ({ ...prev, [msg.turn.id]: msg.turn }));
          break;
        case 'assistant_text':
          setTurns((prev) => {
            const t = prev[msg.turnId];
            if (!t) return prev;
            return { ...prev, [msg.turnId]: { ...t, assistantText: msg.text } };
          });
          break;
        case 'tool_status':
          setTurns((prev) => {
            const t = prev[msg.turnId];
            if (!t) return prev;
            const toolCalls = t.toolCalls.some((tc) => tc.id === msg.toolCall.id)
              ? t.toolCalls.map((tc) => (tc.id === msg.toolCall.id ? msg.toolCall : tc))
              : [...t.toolCalls, msg.toolCall];
            return { ...prev, [msg.turnId]: { ...t, toolCalls } };
          });
          break;
        case 'audio_chunk': {
          const q = audioQueueRef.current;
          // (Re)arm the queue for a fresh turn on its first chunk.
          if (msg.seq === 0 || msg.seq === 1) {
            q.start(msg.turnId, msg.mimeType);
          }
          if (msg.base64) q.pushChunk(msg.turnId, msg.base64, false);
          if (msg.final) q.pushChunk(msg.turnId, '', true);
          break;
        }
        case 'audio_cancel': {
          audioCancelAtRef.current = performance.now();
          audioQueueRef.current.cancel(msg.turnId);
          if (speechOnsetAtRef.current !== null) {
            send({
              type: 'client_metric',
              turnId: msg.turnId,
              name: 'audioStopLatency',
              valueMs: performance.now() - speechOnsetAtRef.current,
            });
          }
          break;
        }
        case 'system_info':
          setSystemInfo(msg.info);
          break;
        case 'stress_test_result':
          setStressResult(msg.result);
          break;
        case 'error':
          setLastError(msg.message);
          break;
      }
    };
  }, [send]);

  // Wire audio queue playback level -> visualizer
  useEffect(() => {
    const q = audioQueueRef.current;
    return q.on((e) => {
      if (e.type === 'level') setPlaybackLevel(e.value);
    });
  }, []);

  // Wire mic level -> visualizer
  useEffect(() => {
    setMicLevel(mic.micLevel);
  }, [mic.micLevel]);

  useEffect(() => {
    setInterimText(mic.interimText);
  }, [mic.interimText]);

  const startSession = useCallback(async () => {
    connect();
    audioQueueRef.current.ensureAudioGraph();
    try {
      await mic.start();
    } catch (err) {
      setLastError(
        'Microphone permission was denied. Grant mic access to use voice input (text fallback is available in Stress Test mode).',
      );
    }
    setNeedsAudioUnlock(false);
  }, [connect, mic]);

  const endSession = useCallback(() => {
    mic.stop();
    audioQueueRef.current.cancel();
    wsRef.current?.close();
  }, [mic]);

  // Speech onset -> immediate interrupt signal (independent of STT latency)
  useEffect(() => {
    return mic.onSpeechOnset(() => {
      speechOnsetAtRef.current = performance.now();
      // Only meaningful as an interruption if the assistant is mid-turn.
      if (['SPEAKING', 'THINKING', 'TOOL_RUNNING'].includes(sessionStateRef.current)) {
        send({ type: 'interrupt', clientTimestamp: Date.now() });
      }
    });
  }, [mic, send]);

  // Keep a ref mirror of state for the onset handler above (avoids stale closures).
  const sessionStateRef = useRef<SessionState>('IDLE');
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    return mic.onFinalText((text) => {
      if (!text) return;
      send({ type: 'user_utterance', text, clientTimestamp: Date.now() });
    });
  }, [mic, send]);

  const sendTextUtterance = useCallback(
    (text: string) => {
      send({ type: 'user_utterance', text, clientTimestamp: Date.now() });
    },
    [send],
  );

  const manualInterrupt = useCallback(() => {
    speechOnsetAtRef.current = performance.now();
    send({ type: 'interrupt', clientTimestamp: Date.now() });
  }, [send]);

  const runStressTest = useCallback(
    (cfg: { toolDelayMs: number; interruptAfterMs: number; firstUtterance: string; secondUtterance: string }) => {
      setStressResult(null);
      connect();
      send({ type: 'run_stress_test', ...cfg });
    },
    [connect, send],
  );

  const orderedTurns = turnOrder.map((id) => turns[id]).filter(Boolean) as Turn[];

  return {
    connected,
    sessionState,
    visualizerState: toVisualizerState(sessionState),
    turns: orderedTurns,
    activeTurnId,
    systemInfo,
    micLevel,
    playbackLevel,
    interimText,
    lastError,
    stressResult,
    needsAudioUnlock,
    micSupported: mic.supported,
    startSession,
    endSession,
    sendTextUtterance,
    manualInterrupt,
    runStressTest,
    connect,
  };
}
