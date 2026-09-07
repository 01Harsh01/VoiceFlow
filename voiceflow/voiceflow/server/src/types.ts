/**
 * VoiceFlow — core types.
 *
 * These types define the contract between the browser and the server, and
 * are the backbone of the interruption/recovery mechanism:
 *
 *  - Every unit of work (LLM call, tool call, TTS stream) is tagged with a
 *    `turnId`.
 *  - Before any async result is applied (rendered, spoken, or used to
 *    update state), the orchestrator checks it against `activeTurnId`.
 *  - If they don't match, the result is stale and is discarded — never
 *    applied, never spoken.
 *
 * This file is intentionally duplicated (not symlinked) into client/src/lib
 * so the two packages can be built/deployed independently. Keep them in
 * sync if you change the protocol.
 */

/** The centralized session state machine. No scattered booleans. */
export type SessionState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'TOOL_RUNNING'
  | 'SPEAKING'
  | 'INTERRUPTING'
  | 'CANCELLING'
  | 'PROCESSING_NEW_TURN'
  | 'ERROR';

export type TurnStatus =
  | 'active' // currently the thing the system is working on / speaking
  | 'completed' // finished normally, spoken in full
  | 'cancelled' // explicitly invalidated by an interruption
  | 'stale' // superseded before it could be applied
  | 'processing'; // in flight (LLM/tool/TTS)

export type ToolName = 'searchFlights' | 'searchProducts' | 'getWeather';

export interface ToolCallRecord {
  id: string;
  turnId: string;
  tool: ToolName;
  args: Record<string, unknown>;
  status: 'pending' | 'fulfilled' | 'invalidated';
  startedAt: number;
  finishedAt?: number;
  delayMs: number;
  result?: unknown;
}

export interface Turn {
  id: string; // e.g. "turn-001"
  seq: number;
  userText: string;
  assistantText?: string;
  status: TurnStatus;
  createdAt: number;
  interruptedBy?: string; // turnId of the turn that cancelled this one
  toolCalls: ToolCallRecord[];
  /** Slot/constraint state accumulated across the conversation up to this turn */
  slots: Record<string, unknown>;
  timings: Partial<{
    turnStartedAt: number;
    sttFinalAt: number;
    llmStartedAt: number;
    llmFinishedAt: number;
    toolStartedAt: number;
    toolFinishedAt: number;
    ttsStartedAt: number;
    ttsFirstByteAt: number;
    ttsFinishedAt: number;
    interruptDetectedAt: number;
    audioStoppedAt: number;
    invalidatedAt: number;
    turnEndedAt: number;
  }>;
}

/** ---------- Client -> Server messages ---------- */

export type ClientMessage =
  | { type: 'user_utterance'; text: string; clientTimestamp: number }
  | { type: 'interrupt'; clientTimestamp: number; reason?: string }
  | { type: 'reset_session' }
  | {
      type: 'configure_stress_test';
      toolDelayMs: number;
      interruptAfterMs: number;
    }
  | {
      type: 'run_stress_test';
      toolDelayMs: number;
      interruptAfterMs: number;
      firstUtterance: string;
      secondUtterance: string;
    }
  | {
      // Client-measured timing, e.g. how long it actually took the
      // browser's audio pipeline to go silent after `audio_cancel`.
      type: 'client_metric';
      turnId: string;
      name: 'audioStopLatency' | 'interruptionDetectionLatency';
      valueMs: number;
    };

/** ---------- Server -> Client messages ---------- */

export type ServerMessage =
  | { type: 'state'; state: SessionState; turnId: string | null }
  | { type: 'turn_created'; turn: Turn }
  | { type: 'turn_updated'; turn: Turn }
  | { type: 'transcript_partial'; turnId: string; text: string }
  | {
      type: 'tool_status';
      turnId: string;
      toolCall: ToolCallRecord;
    }
  | {
      type: 'assistant_text';
      turnId: string;
      text: string;
    }
  | {
      // base64 audio chunk from Rime, tagged with the turn it belongs to.
      type: 'audio_chunk';
      turnId: string;
      seq: number;
      mimeType: string;
      base64: string;
      final: boolean;
    }
  | { type: 'audio_cancel'; turnId: string }
  | { type: 'metrics'; turnId: string; timings: Turn['timings'] }
  | { type: 'system_info'; info: SystemInfo }
  | { type: 'stress_test_result'; result: StressTestResult }
  | { type: 'error'; message: string; recoverable: boolean };

export interface SystemInfo {
  voiceProvider: 'rime';
  rimeModelId: string;
  rimeSpeaker: string;
  rimeLanguage: string;
  rimeEndpoint: string;
  rimeAudioFormat: string;
  rimeSamplingRate: number;
  transport: 'websocket';
  sttProvider: string;
  llmProvider: string;
  fallbackActive: boolean;
  fallbackProvider: string | null;
}

export interface StressTestResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
  timings: {
    label: string;
    ms: number;
  }[];
  oldTurnId: string;
  newTurnId: string;
}
