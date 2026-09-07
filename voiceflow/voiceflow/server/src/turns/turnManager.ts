import type { Turn, ToolCallRecord, ToolName } from '../types.js';

/**
 * TurnManager is the fencing authority for a session.
 *
 * The rule that makes interruption recovery correct:
 *
 *   Every asynchronous unit of work (LLM completion, tool call, TTS chunk)
 *   captures the turnId it was started for. Before that result is APPLIED
 *   (rendered to the transcript, used to mutate slots, or sent to the
 *   client as audio), the caller must call `isActive(turnId)`. If false,
 *   the result is discarded unconditionally — no partial application, no
 *   "just this one field", nothing.
 *
 * This is enforced centrally here rather than re-implemented ad hoc at each
 * call site, which is what the state-machine README section means by "do
 * not rely on scattered boolean flags".
 */
export class TurnManager {
  private turns = new Map<string, Turn>();
  private order: string[] = [];
  private seqCounter = 0;
  private _activeTurnId: string | null = null;

  get activeTurnId(): string | null {
    return this._activeTurnId;
  }

  getTurn(id: string): Turn | undefined {
    return this.turns.get(id);
  }

  getAllTurns(): Turn[] {
    return this.order.map((id) => this.turns.get(id)!).filter(Boolean);
  }

  /** True iff `turnId` is still the turn the session is currently working on. */
  isActive(turnId: string): boolean {
    return this._activeTurnId === turnId;
  }

  /**
   * Start a brand-new turn. If a previous turn is still active/processing,
   * the caller is responsible for cancelling it first via `cancelTurn` —
   * TurnManager will refuse to silently orphan an active turn to keep the
   * invariant "exactly zero or one active turn" explicit at call sites.
   */
  createTurn(userText: string, inheritedSlots: Record<string, unknown> = {}): Turn {
    this.seqCounter += 1;
    const id = `turn-${String(this.seqCounter).padStart(3, '0')}`;
    const turn: Turn = {
      id,
      seq: this.seqCounter,
      userText,
      status: 'processing',
      createdAt: Date.now(),
      toolCalls: [],
      slots: { ...inheritedSlots },
      timings: { turnStartedAt: performance.now() },
    };
    this.turns.set(id, turn);
    this.order.push(id);
    this._activeTurnId = id;
    return turn;
  }

  /**
   * Cancel the currently active turn (used on interruption). Marks it
   * `cancelled`, invalidates all of its in-flight tool calls, and clears
   * `activeTurnId` so that no further async result for it can be applied
   * even if `cancelTurn` and the new `createTurn` race.
   */
  cancelTurn(turnId: string, cancelledByTurnId?: string): Turn | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return undefined;
    if (turn.status === 'processing' || turn.status === 'active') {
      turn.status = 'cancelled';
      turn.interruptedBy = cancelledByTurnId;
      turn.timings.invalidatedAt = performance.now();
      for (const tc of turn.toolCalls) {
        if (tc.status === 'pending') tc.status = 'invalidated';
      }
    }
    if (this._activeTurnId === turnId) {
      this._activeTurnId = null;
    }
    return turn;
  }

  completeTurn(turnId: string, assistantText: string) {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    if (!this.isActive(turnId)) {
      // Stale-by-the-time-it-finished: mark distinctly so the UI can show
      // "stale" rather than silently pretending it completed normally.
      if (turn.status === 'processing') turn.status = 'stale';
      return;
    }
    turn.assistantText = assistantText;
    turn.status = 'completed';
    turn.timings.turnEndedAt = performance.now();
  }

  markSpeaking(turnId: string) {
    const turn = this.turns.get(turnId);
    if (turn && this.isActive(turnId)) turn.status = 'active';
  }

  registerToolCall(
    turnId: string,
    tool: ToolName,
    args: Record<string, unknown>,
    delayMs: number,
  ): ToolCallRecord {
    const turn = this.turns.get(turnId);
    const record: ToolCallRecord = {
      id: `${turnId}-${tool}-${Math.random().toString(36).slice(2, 8)}`,
      turnId,
      tool,
      args,
      status: 'pending',
      startedAt: performance.now(),
      delayMs,
    };
    if (turn) turn.toolCalls.push(record);
    return record;
  }

  resolveToolCall(record: ToolCallRecord, result: unknown): boolean {
    const turn = this.turns.get(record.turnId);
    if (!turn) return false;
    record.finishedAt = performance.now();
    // Fencing check: if this turn is no longer active, or was explicitly
    // cancelled, the result must never be applied.
    if (!this.isActive(record.turnId) || record.status === 'invalidated') {
      record.status = 'invalidated';
      return false;
    }
    record.status = 'fulfilled';
    record.result = result;
    return true;
  }

  updateSlots(turnId: string, patch: Record<string, unknown>) {
    const turn = this.turns.get(turnId);
    if (turn) turn.slots = { ...turn.slots, ...patch };
  }

  latestSlots(): Record<string, unknown> {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const t = this.turns.get(this.order[i]!);
      if (t) return t.slots;
    }
    return {};
  }

  reset() {
    this.turns.clear();
    this.order = [];
    this.seqCounter = 0;
    this._activeTurnId = null;
  }
}
