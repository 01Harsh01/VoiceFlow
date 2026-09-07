import type { SessionState } from '../types.js';

/**
 * Explicit transition table. Any transition not listed here throws.
 * This is the single source of truth for "what can happen next" — no
 * scattered boolean flags (isSpeaking, isThinking, isCancelling, ...)
 * anywhere else in the codebase.
 */
const TRANSITIONS: Record<SessionState, SessionState[]> = {
  IDLE: ['LISTENING', 'ERROR'],
  LISTENING: ['THINKING', 'IDLE', 'ERROR'],
  THINKING: ['TOOL_RUNNING', 'SPEAKING', 'INTERRUPTING', 'ERROR'],
  TOOL_RUNNING: ['SPEAKING', 'INTERRUPTING', 'ERROR', 'THINKING'],
  SPEAKING: ['INTERRUPTING', 'LISTENING', 'IDLE', 'ERROR'],
  INTERRUPTING: ['CANCELLING', 'ERROR'],
  CANCELLING: ['PROCESSING_NEW_TURN', 'LISTENING', 'ERROR'],
  PROCESSING_NEW_TURN: ['TOOL_RUNNING', 'SPEAKING', 'THINKING', 'INTERRUPTING', 'ERROR'],
  ERROR: ['IDLE', 'LISTENING'],
};

export class InvalidTransitionError extends Error {
  constructor(from: SessionState, to: SessionState) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export type StateListener = (next: SessionState, prev: SessionState) => void;

/**
 * VoiceSessionStateMachine — the single centralized state holder for a
 * session. Every part of the orchestrator reads/writes state through this
 * object; nothing else is allowed to track "are we speaking" independently.
 */
export class VoiceSessionStateMachine {
  private _state: SessionState = 'IDLE';
  private listeners = new Set<StateListener>();
  private history: { state: SessionState; at: number }[] = [{ state: 'IDLE', at: Date.now() }];

  get state(): SessionState {
    return this._state;
  }

  getHistory() {
    return [...this.history];
  }

  canTransition(to: SessionState): boolean {
    return TRANSITIONS[this._state].includes(to);
  }

  transition(to: SessionState): void {
    if (!this.canTransition(to)) {
      throw new InvalidTransitionError(this._state, to);
    }
    const prev = this._state;
    this._state = to;
    this.history.push({ state: to, at: Date.now() });
    if (this.history.length > 200) this.history.shift();
    for (const l of this.listeners) l(to, prev);
  }

  /** Force-transition used only for ERROR recovery paths. */
  forceTo(to: SessionState): void {
    const prev = this._state;
    this._state = to;
    this.history.push({ state: to, at: Date.now() });
    for (const l of this.listeners) l(to, prev);
  }

  onChange(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
