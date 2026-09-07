/**
 * AudioQueue — real progressive playback of Rime's streamed audio using
 * MediaSource Extensions, with genuine, immediate cancellation.
 *
 * Why MediaSource instead of "wait for the full clip then play": Rime
 * streams audio chunk-by-chunk over the WebSocket as it's synthesized.
 * Buffering the whole utterance before playback would throw away the
 * latency win of streaming AND would make "stop mid-sentence" impossible
 * to demonstrate honestly (there'd be nothing playing yet to stop).
 * MediaSource lets the <audio> element start playing from the first
 * chunk while later chunks are still arriving, and lets us kill playback
 * instantly (`audio.pause()` + tearing down the MediaSource) the moment
 * an interruption is detected — this is the actual mechanism behind the
 * "Rime audio stopped after interruption" acceptance check, not a fade-out
 * or a mute() cosmetic trick.
 *
 * A stale chunk can arrive over the WebSocket after the client already
 * moved on (network reordering, or a chunk that left the server a moment
 * before the interrupt was processed). `pushChunk` re-checks the turnId
 * against the currently *armed* turn before appending anything — this is
 * the last line of defense in the fencing chain, on top of the server
 * never applying a stale tool/LLM result in the first place.
 */

export type AudioQueueEvent =
  | { type: 'started'; turnId: string; latencyMs: number }
  | { type: 'stopped'; turnId: string; reason: 'finished' | 'cancelled' | 'error'; latencyMs: number }
  | { type: 'level'; value: number };

type Listener = (e: AudioQueueEvent) => void;

export class AudioQueue {
  private audio: HTMLAudioElement;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private pendingBuffers: ArrayBuffer[] = [];
  private appending = false;
  private currentTurnId: string | null = null;
  private currentMime = 'audio/mpeg';
  private listeners = new Set<Listener>();
  private awaitingFinal = false;
  private cancelStartedAt = 0;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private levelData: Uint8Array | null = null;
  private rafHandle: number | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.autoplay = false;
    this.audio.preload = 'auto';
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: AudioQueueEvent) {
    for (const l of this.listeners) l(e);
  }

  static isSupported(mimeType: string): boolean {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mimeType);
  }

  /** Must be called after a user gesture (e.g. "Start Voice Session" click). */
  ensureAudioGraph() {
    if (this.audioCtx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new Ctx();
    this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    this.levelData = new Uint8Array(this.analyser.frequencyBinCount);
    this.tickLevel();
  }

  private tickLevel = () => {
    if (this.analyser && this.levelData) {
      this.analyser.getByteFrequencyData(this.levelData as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (const v of this.levelData) sum += v;
      const avg = sum / this.levelData.length / 255;
      this.emit({ type: 'level', value: avg });
    }
    this.rafHandle = requestAnimationFrame(this.tickLevel);
  };

  /** Begin a brand-new streamed response for `turnId`. Tears down any prior stream first. */
  start(turnId: string, mimeType: string) {
    this.teardown('cancelled');
    this.currentTurnId = turnId;
    this.currentMime = mimeType;
    this.awaitingFinal = false;

    if (!AudioQueue.isSupported(mimeType)) {
      // Documented limitation — see README "Known limitations". We still
      // let the rest of the app function (transcript + state machine),
      // just without gapless progressive audio for this format/browser.
      console.warn(`[AudioQueue] MediaSource does not support ${mimeType} in this browser.`);
      return;
    }

    const ms = new MediaSource();
    this.mediaSource = ms;
    const url = URL.createObjectURL(ms);
    this.audio.src = url;

    const startedAt = performance.now();
    ms.addEventListener(
      'sourceopen',
      () => {
        try {
          const sb = ms.addSourceBuffer(mimeType);
          this.sourceBuffer = sb;
          sb.addEventListener('updateend', () => this.drainQueue());
          this.audio
            .play()
            .then(() => this.emit({ type: 'started', turnId, latencyMs: performance.now() - startedAt }))
            .catch(() => {
              /* autoplay restrictions — surfaced via UI "tap to enable audio" */
            });
          this.drainQueue();
        } catch (err) {
          console.error('[AudioQueue] addSourceBuffer failed', err);
        }
      },
      { once: true },
    );
  }

  pushChunk(turnId: string, base64: string, final: boolean) {
    if (turnId !== this.currentTurnId) return; // stale-chunk protection
    if (final) {
      this.awaitingFinal = true;
      this.drainQueue();
      return;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    this.pendingBuffers.push(bytes.buffer.slice(0));
    this.drainQueue();
  }

  private drainQueue() {
    const sb = this.sourceBuffer;
    if (!sb || sb.updating) return;
    if (this.pendingBuffers.length > 0) {
      this.appending = true;
      const next = this.pendingBuffers.shift()!;
      try {
        sb.appendBuffer(next);
      } catch (err) {
        console.error('[AudioQueue] appendBuffer failed', err);
      }
      return;
    }
    this.appending = false;
    if (this.awaitingFinal && this.mediaSource?.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch {
        /* already closed */
      }
      const turnId = this.currentTurnId;
      this.audio.onended = () => {
        if (turnId) this.emit({ type: 'stopped', turnId, reason: 'finished', latencyMs: 0 });
      };
    }
  }

  /** Immediately silence playback. This is the function the interrupt path calls. */
  cancel(turnId?: string) {
    if (turnId && turnId !== this.currentTurnId) return;
    this.cancelStartedAt = performance.now();
    const cancelledTurn = this.currentTurnId;
    this.teardown('cancelled');
    if (cancelledTurn) {
      this.emit({
        type: 'stopped',
        turnId: cancelledTurn,
        reason: 'cancelled',
        latencyMs: performance.now() - this.cancelStartedAt,
      });
    }
  }

  private teardown(_reason: 'cancelled' | 'finished' | 'error') {
    try {
      this.audio.pause();
    } catch {
      /* noop */
    }
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      /* noop */
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch {
        /* noop */
      }
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.pendingBuffers = [];
    this.appending = false;
    this.awaitingFinal = false;
    this.currentTurnId = null;
  }

  destroy() {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.teardown('cancelled');
    this.audioCtx?.close().catch(() => {});
  }
}
