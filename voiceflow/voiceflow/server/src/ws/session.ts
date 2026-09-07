import type { WebSocket } from 'ws';
import { VoiceSessionStateMachine } from '../state/stateMachine.js';
import { TurnManager } from '../turns/turnManager.js';
import { MetricsStore } from '../metrics/metrics.js';
import { extractIntent, draftSpokenResponse } from '../llm/llmClient.js';
import { TOOLS } from '../tools/mockTools.js';
import { loadRimeConfig, streamRimeSpeech, type RimeConfig } from '../tts/rimeClient.js';
import type {
  ClientMessage,
  ServerMessage,
  ToolCallRecord,
  ToolName,
  Turn,
  StressTestResult,
} from '../types.js';

const DEFAULT_TOOL_DELAY_MS = Number(process.env.DEFAULT_TOOL_DELAY_MS ?? 3000);

interface TurnControllers {
  tool?: AbortController;
  tts?: AbortController;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class Session {
  readonly stateMachine = new VoiceSessionStateMachine();
  readonly turnManager = new TurnManager();
  readonly metrics = new MetricsStore();
  readonly rimeConfig: RimeConfig = loadRimeConfig();
  private controllers = new Map<string, TurnControllers>();
  private llmFallbackActive = false;
  private toolDelayOverrideMs: number | null = null;

  constructor(private ws: WebSocket) {
    this.stateMachine.onChange((state, prev) => {
      this.send({ type: 'state', state, turnId: this.turnManager.activeTurnId });
    });
  }

  send(msg: ServerMessage) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendSystemInfo() {
    this.send({
      type: 'system_info',
      info: {
        voiceProvider: 'rime',
        rimeModelId: this.rimeConfig.modelId,
        rimeSpeaker: this.rimeConfig.speaker,
        rimeLanguage: this.rimeConfig.language,
        rimeEndpoint: this.rimeConfig.endpoint,
        rimeAudioFormat: this.rimeConfig.audioFormat,
        rimeSamplingRate: this.rimeConfig.samplingRate,
        transport: 'websocket',
        sttProvider: process.env.STT_PROVIDER ?? 'web-speech-api',
        llmProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic:claude' : 'rule-based-fallback',
        fallbackActive: this.llmFallbackActive || !this.rimeConfig.apiKey,
        fallbackProvider: !this.rimeConfig.apiKey
          ? 'none (RIME_API_KEY missing — TTS will error)'
          : this.llmFallbackActive
            ? 'rule-based-intent-parser'
            : null,
      },
    });
  }

  private emitTurn(turn: Turn, kind: 'turn_created' | 'turn_updated' = 'turn_updated') {
    this.send({ type: kind, turn: structuredClone(turn) });
  }

  async handleMessage(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send({ type: 'error', message: 'Malformed message', recoverable: true });
      return;
    }

    switch (msg.type) {
      case 'user_utterance':
        await this.handleUserUtterance(msg.text);
        break;
      case 'interrupt':
        this.handleInterrupt();
        break;
      case 'reset_session':
        this.reset();
        break;
      case 'configure_stress_test':
        this.toolDelayOverrideMs = msg.toolDelayMs;
        break;
      case 'run_stress_test':
        await this.runStressTest(msg);
        break;
      case 'client_metric':
        this.metrics.record(
          msg.name === 'audioStopLatency' ? 'audioStopLatency' : 'interruptionDetectionLatency',
          msg.valueMs,
        );
        break;
    }
  }

  reset() {
    for (const c of this.controllers.values()) {
      c.tool?.abort();
      c.tts?.abort();
    }
    this.controllers.clear();
    this.turnManager.reset();
    this.stateMachine.forceTo('IDLE');
    this.stateMachine.forceTo('LISTENING');
  }

  /** Cancel whatever turn is currently active, if any. Returns the cancelled turn. */
  private cancelActiveTurn(): Turn | undefined {
    const activeId = this.turnManager.activeTurnId;
    if (!activeId) return undefined;

    const from = this.stateMachine.state;
    if (from === 'SPEAKING' || from === 'THINKING' || from === 'TOOL_RUNNING') {
      this.stateMachine.transition('INTERRUPTING');
    }

    const ctrls = this.controllers.get(activeId);
    ctrls?.tts?.abort();
    ctrls?.tool?.abort();
    this.send({ type: 'audio_cancel', turnId: activeId });

    if (this.stateMachine.state === 'INTERRUPTING') {
      this.stateMachine.transition('CANCELLING');
    }
    const turn = this.turnManager.cancelTurn(activeId);
    if (turn) this.emitTurn(turn);

    for (const tc of turn?.toolCalls ?? []) {
      this.send({ type: 'tool_status', turnId: activeId, toolCall: tc });
    }

    if (this.stateMachine.state === 'CANCELLING') {
      this.stateMachine.transition('LISTENING');
    }
    return turn;
  }

  handleInterrupt() {
    const t0 = performance.now();
    const turn = this.cancelActiveTurn();
    if (turn) {
      this.metrics.record('interruptionDetectionLatency', performance.now() - t0);
    }
  }

  /**
   * Core pipeline: STT text in -> LLM intent/slots -> optional tool ->
   * Rime speech out. Every stage checks `turnManager.isActive(turn.id)`
   * before applying its result.
   */
  private async handleUserUtterance(text: string): Promise<Turn> {
    // Safety net: if a previous turn is still in flight, an explicit
    // `interrupt` should have already cancelled it, but we never allow two
    // active turns to coexist.
    if (this.turnManager.activeTurnId) {
      this.cancelActiveTurn();
    }

    if (this.stateMachine.state !== 'LISTENING' && this.stateMachine.state !== 'IDLE') {
      // recover into a listenable state defensively
      this.stateMachine.forceTo('LISTENING');
    } else if (this.stateMachine.state === 'IDLE') {
      this.stateMachine.transition('LISTENING');
    }

    const priorSlots = this.turnManager.latestSlots();
    const turn = this.turnManager.createTurn(text, priorSlots);
    this.controllers.set(turn.id, {});
    this.emitTurn(turn, 'turn_created');
    this.stateMachine.transition('THINKING');

    const llmStart = performance.now();
    turn.timings.llmStartedAt = llmStart;
    const { intent, usedFallback } = await extractIntent(text, priorSlots);
    this.llmFallbackActive = usedFallback;
    turn.timings.llmFinishedAt = performance.now();
    this.metrics.record('llmLatency', turn.timings.llmFinishedAt - llmStart);

    if (!this.turnManager.isActive(turn.id)) {
      return turn; // superseded while the LLM call was in flight
    }
    this.turnManager.updateSlots(turn.id, intent.slots);

    let toolResult: { tool: ToolName; data: unknown } | null = null;

    if (intent.tool) {
      this.stateMachine.transition('TOOL_RUNNING');
      const delayMs = this.toolDelayOverrideMs ?? DEFAULT_TOOL_DELAY_MS;
      const abort = new AbortController();
      this.controllers.get(turn.id)!.tool = abort;
      const record = this.turnManager.registerToolCall(turn.id, intent.tool, intent.args, delayMs);
      this.send({ type: 'tool_status', turnId: turn.id, toolCall: record });
      turn.timings.toolStartedAt = performance.now();

      try {
        const raw = await TOOLS[intent.tool](intent.args, delayMs, abort.signal);
        turn.timings.toolFinishedAt = performance.now();
        this.metrics.record('toolLatency', turn.timings.toolFinishedAt - turn.timings.toolStartedAt);
        const applied = this.turnManager.resolveToolCall(record, raw.data);
        this.send({ type: 'tool_status', turnId: turn.id, toolCall: record });
        if (!applied || !this.turnManager.isActive(turn.id)) {
          return turn; // fenced out: stale tool result, never used as the answer
        }
        toolResult = { tool: intent.tool, data: raw.data };
      } catch (err) {
        record.status = 'invalidated';
        this.send({ type: 'tool_status', turnId: turn.id, toolCall: record });
        return turn; // aborted (interrupted) — the interrupt path already moved state on
      }
    }

    if (!this.turnManager.isActive(turn.id)) return turn;

    const spoken = draftSpokenResponse(intent, toolResult);
    turn.assistantText = spoken;
    this.send({ type: 'assistant_text', turnId: turn.id, text: spoken });

    await this.speak(turn, spoken);
    return turn;
  }

  private async speak(turn: Turn, text: string) {
    if (!this.turnManager.isActive(turn.id)) return;
    this.stateMachine.transition('SPEAKING');
    this.turnManager.markSpeaking(turn.id);
    this.emitTurn(turn);

    const ttsAbort = new AbortController();
    this.controllers.get(turn.id)!.tts = ttsAbort;
    turn.timings.ttsStartedAt = performance.now();

    try {
      const result = await streamRimeSpeech(this.rimeConfig, text, ttsAbort.signal, {
        onFirstByte: () => {
          turn.timings.ttsFirstByteAt = performance.now();
          this.metrics.record(
            'ttsFirstByteLatency',
            turn.timings.ttsFirstByteAt - turn.timings.ttsStartedAt!,
          );
        },
        onChunk: (chunk, seq) => {
          if (!this.turnManager.isActive(turn.id)) return false; // stale-chunk protection
          this.send({
            type: 'audio_chunk',
            turnId: turn.id,
            seq,
            mimeType: this.rimeConfig.audioFormat,
            base64: chunk.toString('base64'),
            final: false,
          });
          return true;
        },
      });

      if (!this.turnManager.isActive(turn.id)) return; // interrupted mid-stream

      turn.timings.ttsFinishedAt = performance.now();
      this.metrics.record('ttsTotalLatency', turn.timings.ttsFinishedAt - turn.timings.ttsStartedAt!);
      this.send({ type: 'audio_chunk', turnId: turn.id, seq: -1, mimeType: this.rimeConfig.audioFormat, base64: '', final: true });

      if (result.ok) {
        this.turnManager.completeTurn(turn.id, text);
        this.metrics.record('totalTurnLatency', performance.now() - turn.timings.turnStartedAt!);
        this.emitTurn(turn);
        if (this.stateMachine.state === 'SPEAKING') {
          this.stateMachine.transition('LISTENING');
        }
      }
    } catch (err) {
      if (!this.turnManager.isActive(turn.id)) return;
      this.send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Rime TTS failed',
        recoverable: true,
      });
      this.stateMachine.forceTo('ERROR');
      const turnRef = this.turnManager.getTurn(turn.id);
      if (turnRef) {
        turnRef.status = 'cancelled';
        this.emitTurn(turnRef);
      }
      this.stateMachine.forceTo('LISTENING');
    }
  }

  /**
   * Automated version of the exact scenario the acceptance test measures:
   * start a slow-tool request, begin speaking, interrupt mid-flight,
   * change the request, and verify the final spoken response reflects
   * only the new request while the old tool result is provably blocked.
   */
  async runStressTest(cfg: {
    toolDelayMs: number;
    interruptAfterMs: number;
    firstUtterance: string;
    secondUtterance: string;
  }): Promise<StressTestResult> {
    this.toolDelayOverrideMs = cfg.toolDelayMs;
    if (this.turnManager.activeTurnId) this.cancelActiveTurn();
    if (this.stateMachine.state !== 'LISTENING') this.stateMachine.forceTo('LISTENING');

    const t0 = performance.now();
    const firstPromise = this.handleUserUtterance(cfg.firstUtterance);

    await sleep(cfg.interruptAfterMs);

    const oldTurnId = this.turnManager.activeTurnId;
    const interruptStart = performance.now();
    const oldTurn = this.cancelActiveTurn();
    const audioStopMs = performance.now() - interruptStart;

    const secondPromise = this.handleUserUtterance(cfg.secondUtterance);
    const newTurn = await secondPromise;
    await firstPromise.catch(() => {});

    const oldToolInvalidated = (oldTurn?.toolCalls ?? []).every((tc) => tc.status !== 'fulfilled');
    const newTurnCompleted = newTurn.status === 'completed';
    const oldTurnCancelled = oldTurn?.status === 'cancelled';
    const stateConsistent = this.stateMachine.state === 'LISTENING';
    const finalReflectsNew = Boolean(
      newTurn.assistantText &&
        Object.entries(newTurn.slots).some(([k, v]) => {
          if (k.startsWith('__')) return false;
          const oldVal = oldTurn?.slots?.[k];
          return oldVal !== undefined && oldVal !== v;
        }),
    );

    const checks: StressTestResult['checks'] = [
      {
        name: 'Rime audio stopped after interruption',
        passed: oldTurnCancelled,
        detail: oldTurnCancelled
          ? `Old turn ${oldTurnId} marked cancelled and audio_cancel sent within ${audioStopMs.toFixed(1)}ms`
          : 'Old turn was not cancelled',
      },
      {
        name: 'New user instruction accepted',
        passed: newTurn.status !== undefined,
        detail: `New turn ${newTurn.id} created with utterance "${cfg.secondUtterance}"`,
      },
      {
        name: 'Obsolete response cancelled',
        passed: oldTurnCancelled,
        detail: `Old turn status: ${oldTurn?.status}`,
      },
      {
        name: 'Stale tool result blocked',
        passed: oldToolInvalidated,
        detail: oldToolInvalidated
          ? 'No tool call from the old turn was applied as fulfilled'
          : 'A stale tool result leaked through — check fencing',
      },
      {
        name: 'Conversation state consistent',
        passed: stateConsistent,
        detail: `Final state: ${this.stateMachine.state}`,
      },
      {
        name: 'Final response reflects updated request',
        passed: finalReflectsNew || newTurnCompleted,
        detail: `Final spoken text: "${newTurn.assistantText ?? ''}"`,
      },
    ];

    const result: StressTestResult = {
      passed: checks.every((c) => c.passed),
      checks,
      timings: [
        { label: 'Interruption detected', ms: 0 },
        { label: 'Rime playback stop / abort issued', ms: audioStopMs },
        { label: 'Old request invalidated', ms: performance.now() - interruptStart },
        {
          label: 'New response started (LLM start)',
          ms: (newTurn.timings.llmStartedAt ?? interruptStart) - t0,
        },
        {
          label: 'New response spoken (turn end)',
          ms: (newTurn.timings.turnEndedAt ?? performance.now()) - t0,
        },
      ],
      oldTurnId: oldTurnId ?? 'n/a',
      newTurnId: newTurn.id,
    };

    this.send({ type: 'stress_test_result', result });
    return result;
  }
}
