import { describe, it, expect } from 'vitest';
import { VoiceSessionStateMachine, InvalidTransitionError } from '../src/state/stateMachine.js';

describe('VoiceSessionStateMachine', () => {
  it('starts IDLE', () => {
    const sm = new VoiceSessionStateMachine();
    expect(sm.state).toBe('IDLE');
  });

  it('allows the full happy-path turn cycle', () => {
    const sm = new VoiceSessionStateMachine();
    sm.transition('LISTENING');
    sm.transition('THINKING');
    sm.transition('TOOL_RUNNING');
    sm.transition('SPEAKING');
    sm.transition('LISTENING');
    expect(sm.state).toBe('LISTENING');
  });

  it('allows the interruption cycle from SPEAKING', () => {
    const sm = new VoiceSessionStateMachine();
    sm.transition('LISTENING');
    sm.transition('THINKING');
    sm.transition('SPEAKING');
    sm.transition('INTERRUPTING');
    sm.transition('CANCELLING');
    sm.transition('PROCESSING_NEW_TURN');
    sm.transition('THINKING');
    sm.transition('SPEAKING');
    expect(sm.state).toBe('SPEAKING');
  });

  it('rejects an invalid transition (IDLE -> SPEAKING)', () => {
    const sm = new VoiceSessionStateMachine();
    expect(() => sm.transition('SPEAKING')).toThrow(InvalidTransitionError);
  });

  it('rejects skipping INTERRUPTING when cancelling from SPEAKING', () => {
    const sm = new VoiceSessionStateMachine();
    sm.transition('LISTENING');
    sm.transition('THINKING');
    sm.transition('SPEAKING');
    expect(() => sm.transition('CANCELLING')).toThrow(InvalidTransitionError);
  });

  it('notifies listeners on every transition', () => {
    const sm = new VoiceSessionStateMachine();
    const seen: string[] = [];
    sm.onChange((next) => seen.push(next));
    sm.transition('LISTENING');
    sm.transition('THINKING');
    expect(seen).toEqual(['LISTENING', 'THINKING']);
  });
});
