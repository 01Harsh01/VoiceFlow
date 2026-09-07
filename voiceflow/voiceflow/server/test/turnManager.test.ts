import { describe, it, expect } from 'vitest';
import { TurnManager } from '../src/turns/turnManager.js';

describe('TurnManager — turn IDs and fencing', () => {
  it('assigns sequential, unique turn IDs', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('hello');
    const t2 = tm.createTurn('world');
    expect(t1.id).toBe('turn-001');
    expect(t2.id).toBe('turn-002');
    expect(t1.id).not.toBe(t2.id);
  });

  it('only ever has one active turn at a time', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('a');
    expect(tm.isActive(t1.id)).toBe(true);
    const t2 = tm.createTurn('b');
    expect(tm.isActive(t1.id)).toBe(false);
    expect(tm.isActive(t2.id)).toBe(true);
  });

  it('cancelling a turn clears activeTurnId and marks it cancelled', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('a');
    tm.cancelTurn(t1.id);
    expect(tm.activeTurnId).toBeNull();
    expect(tm.getTurn(t1.id)?.status).toBe('cancelled');
  });

  it('rejects a stale async result: a tool result for a cancelled turn is never applied', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('search flights');
    const record = tm.registerToolCall(t1.id, 'searchFlights', {}, 3000);

    // user interrupts before the tool resolves
    tm.cancelTurn(t1.id);
    const t2 = tm.createTurn('search flights on Friday instead');

    // the original tool call finally resolves late
    const applied = tm.resolveToolCall(record, { fake: 'stale result' });

    expect(applied).toBe(false);
    expect(record.status).toBe('invalidated');
    expect(tm.activeTurnId).toBe(t2.id);
  });

  it('applies a tool result normally when its turn is still active', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('search flights');
    const record = tm.registerToolCall(t1.id, 'searchFlights', {}, 10);
    const applied = tm.resolveToolCall(record, { ok: true });
    expect(applied).toBe(true);
    expect(record.status).toBe('fulfilled');
  });

  it('completing a turn that is no longer active marks it stale instead of completed', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('a');
    tm.createTurn('b'); // supersedes t1 without explicit cancellation
    tm.completeTurn(t1.id, 'late answer');
    expect(tm.getTurn(t1.id)?.status).toBe('stale');
  });

  it('merges slot updates across turns (correction scenario)', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('flights from Delhi to Mumbai tomorrow');
    tm.updateSlots(t1.id, { from: 'Delhi', to: 'Mumbai', date: 'tomorrow' });
    tm.cancelTurn(t1.id);

    const t2 = tm.createTurn('make it Friday instead', tm.latestSlots());
    tm.updateSlots(t2.id, { date: 'Friday' });

    const finalSlots = tm.getTurn(t2.id)!.slots;
    expect(finalSlots).toMatchObject({ from: 'Delhi', to: 'Mumbai', date: 'Friday' });
  });

  it('invalidates all pending tool calls on a turn when it is cancelled', () => {
    const tm = new TurnManager();
    const t1 = tm.createTurn('a');
    const r1 = tm.registerToolCall(t1.id, 'searchFlights', {}, 3000);
    const r2 = tm.registerToolCall(t1.id, 'getWeather', {}, 1000);
    tm.cancelTurn(t1.id);
    expect(r1.status).toBe('invalidated');
    expect(r2.status).toBe('invalidated');
  });
});
