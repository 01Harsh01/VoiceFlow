/**
 * Duplicated from server/src/types.ts by design (see that file's header
 * comment) so client and server can be built/deployed independently.
 * Keep in sync if you change the protocol.
 */

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

export type TurnStatus = 'active' | 'completed' | 'cancelled' | 'stale' | 'processing';

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
  id: string;
  seq: number;
  userText: string;
  assistantText?: string;
  status: TurnStatus;
  createdAt: number;
  interruptedBy?: string;
  toolCalls: ToolCallRecord[];
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

export type ClientMessage =
  | { type: 'user_utterance'; text: string; clientTimestamp: number }
  | { type: 'interrupt'; clientTimestamp: number; reason?: string }
  | { type: 'reset_session' }
  | { type: 'configure_stress_test'; toolDelayMs: number; interruptAfterMs: number }
  | {
      type: 'run_stress_test';
      toolDelayMs: number;
      interruptAfterMs: number;
      firstUtterance: string;
      secondUtterance: string;
    }
  | {
      type: 'client_metric';
      turnId: string;
      name: 'audioStopLatency' | 'interruptionDetectionLatency';
      valueMs: number;
    };

export type ServerMessage =
  | { type: 'state'; state: SessionState; turnId: string | null }
  | { type: 'turn_created'; turn: Turn }
  | { type: 'turn_updated'; turn: Turn }
  | { type: 'transcript_partial'; turnId: string; text: string }
  | { type: 'tool_status'; turnId: string; toolCall: ToolCallRecord }
  | { type: 'assistant_text'; turnId: string; text: string }
  | {
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
  checks: { name: string; passed: boolean; detail: string }[];
  timings: { label: string; ms: number }[];
  oldTurnId: string;
  newTurnId: string;
}
