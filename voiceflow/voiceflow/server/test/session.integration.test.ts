import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network-dependent Rime call so this test proves the
// interruption/fencing logic itself, independent of network access or a
// real API key. Every other part of the pipeline (state machine, turn
// manager, mock tools, rule-based intent parsing) runs for real.
vi.mock('../src/tts/rimeClient.js', () => ({
  loadRimeConfig: () => ({
    apiKey: 'test-key',
    endpoint: 'https://users.rime.ai/v1/rime-tts',
    modelId: 'coda',
    speaker: 'astra',
    language: 'en',
    audioFormat: 'audio/mpeg',
    samplingRate: 24000,
  }),
  streamRimeSpeech: vi.fn(
    async (
      _config: unknown,
      _text: string,
      signal: AbortSignal,
      handlers: { onFirstByte?: () => void; onChunk: (c: Buffer, s: number) => void | boolean },
    ) => {
      handlers.onFirstByte?.();
      for (let i = 0; i < 5; i++) {
        if (signal.aborted) return { ok: false, bytesStreamed: 0, chunks: i };
        await new Promise((r) => setTimeout(r, 15));
        const cont = handlers.onChunk(Buffer.from('chunk'), i);
        if (cont === false) return { ok: false, bytesStreamed: 0, chunks: i };
      }
      return { ok: true, bytesStreamed: 100, chunks: 5 };
    },
  ),
}));

const { Session } = await import('../src/ws/session.js');

function fakeWs() {
  const sent: any[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    send: (data: string) => sent.push(JSON.parse(data)),
    _sent: sent,
  } as any;
}

describe('Session — interruption & recovery (Rime call mocked, everything else real)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', ''); // force deterministic rule-based intent parsing
  });

  it('runs the full stress test scenario and passes every acceptance check', async () => {
    const ws = fakeWs();
    const session = new Session(ws);
    session.stateMachine.forceTo('LISTENING');

    const result = await session.runStressTest({
      toolDelayMs: 400,
      interruptAfterMs: 100,
      firstUtterance: 'find flights from Delhi to Mumbai tomorrow',
      secondUtterance: 'wait, make it Friday instead',
    });

    expect(result.passed).toBe(true);
    for (const check of result.checks) {
      expect(check.passed, `${check.name}: ${check.detail}`).toBe(true);
    }

    const oldTurn = session.turnManager.getTurn(result.oldTurnId);
    const newTurn = session.turnManager.getTurn(result.newTurnId);
    expect(oldTurn?.status).toBe('cancelled');
    expect(newTurn?.status).toBe('completed');
    expect(newTurn?.slots.date).toBe('friday');
    expect(newTurn?.slots.from).toBe('delhi'); // inherited from the cancelled turn
    // the old turn's slow tool call must never have been marked fulfilled
    expect(oldTurn?.toolCalls.every((tc) => tc.status !== 'fulfilled')).toBe(true);
  });

  it('never plays audio chunks belonging to a cancelled turn', async () => {
    const ws = fakeWs();
    const session = new Session(ws);
    session.stateMachine.forceTo('LISTENING');

    await session.runStressTest({
      toolDelayMs: 300,
      interruptAfterMs: 80,
      firstUtterance: 'find flights from Delhi to Mumbai tomorrow',
      secondUtterance: 'actually make it Friday',
    });

    const audioMessages = ws._sent.filter((m: any) => m.type === 'audio_chunk');
    const cancelMessages = ws._sent.filter((m: any) => m.type === 'audio_cancel');
    const oldTurnId = session.turnManager
      .getAllTurns()
      .find((t) => t.status === 'cancelled')?.id;

    expect(cancelMessages.some((m: any) => m.turnId === oldTurnId)).toBe(true);
    // No chunk tagged with the cancelled turn should have been sent after
    // the cancel message was issued.
    const cancelIdx = ws._sent.findIndex((m: any) => m.type === 'audio_cancel');
    const laterOldChunks = ws._sent
      .slice(cancelIdx + 1)
      .filter((m: any) => m.type === 'audio_chunk' && m.turnId === oldTurnId);
    expect(laterOldChunks.length).toBe(0);
  });

  it('leaves the session in LISTENING after a full interrupt+recover cycle', async () => {
    const ws = fakeWs();
    const session = new Session(ws);
    session.stateMachine.forceTo('LISTENING');
    await session.runStressTest({
      toolDelayMs: 200,
      interruptAfterMs: 60,
      firstUtterance: 'weather in Mumbai',
      secondUtterance: 'actually weather in Delhi',
    });
    expect(session.stateMachine.state).toBe('LISTENING');
  });
});
