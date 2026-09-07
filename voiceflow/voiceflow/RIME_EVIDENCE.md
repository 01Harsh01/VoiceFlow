# RIME_EVIDENCE.md

## Hard voice claim

> VoiceFlow can interrupt an ongoing Rime response and reconcile the conversation so that
> obsolete audio/tool results do not re-enter the active conversation.

## Acceptance test

The test is implemented as real code, not a script that only runs during a demo:
`Session.runStressTest()` in `server/src/ws/session.ts`, invoked from the UI's **Break the
Assistant** page and covered by an automated test in
`server/test/session.integration.test.ts`. It exercises the *same* orchestrator path
(`handleUserUtterance`, `cancelActiveTurn`, `speak`) used by live voice sessions — there is no
separate "demo mode" branch in the server.

Six checks must all pass for the test to report **PASS**:

1. Rime audio stopped after interruption
2. New user instruction accepted
3. Obsolete response cancelled
4. Stale tool result blocked
5. Conversation state consistent
6. Final response reflects the updated request

## Procedure

1. **Start voice session** — client opens the WebSocket; server creates a `Session` with a fresh
   `VoiceSessionStateMachine` (`IDLE → LISTENING`) and `TurnManager`.
2. **Start request** — `handleUserUtterance(firstUtterance)` creates `turn-N`, transitions
   `LISTENING → THINKING`, and calls the intent extractor.
3. **Introduce tool delay** — the resolved intent maps to a mock tool (`searchFlights` /
   `searchProducts` / `getWeather`), which is invoked with a configurable delay (`toolDelayMs`,
   1000–5000ms in the UI) and registered in `TurnManager` with a fresh `AbortController`.
4. **Start Rime speech** — once the tool resolves *and* the turn is still active, a spoken
   response is drafted and streamed through Rime (`streamRimeSpeech`), with chunks relayed to the
   client tagged with `turn-N`.
5. **Interrupt** — after `interruptAfterMs` (500–3000ms in the UI, deliberately shorter than
   `toolDelayMs` so the interruption lands while the tool is still pending), the test calls
   `cancelActiveTurn()`: state → `INTERRUPTING`, both the tool's and Rime's `AbortController`s are
   aborted, `audio_cancel` is sent to the client, the turn is marked `cancelled`, and any pending
   tool call on it is marked `invalidated`. State → `CANCELLING` → `LISTENING`.
6. **Change request** — `handleUserUtterance(secondUtterance)` runs immediately, seeded with
   `TurnManager.latestSlots()` from the cancelled turn (so unrelated slots like `from`/`to`
   survive; only the changed slot, e.g. `date` or `maxPriceInr`, is overwritten).
7. **Verify audio cancellation** — assert the old turn's status is `cancelled` and that an
   `audio_cancel` message for its `turnId` was sent before any further `audio_chunk` for that
   `turnId` (client-side, `AudioQueue` additionally refuses any chunk tagged with a turn ID other
   than the one it is currently armed for, as a second, independent check).
8. **Verify old tool result is rejected** — assert every `ToolCallRecord` on the old turn has
   `status !== 'fulfilled'` (i.e. it is `invalidated`, never applied), even for tool calls whose
   `setTimeout` had not yet fired at interruption time.
9. **Verify final response reflects new request** — assert the new turn completes
   (`status === 'completed'`) and that its `slots` differ from the old turn's `slots` on the
   dimension the correction targeted.

## Results

From the automated suite (`server/test/session.integration.test.ts`, Rime's network call mocked
so the test is deterministic and runs offline in CI — every other component, including the real
state machine, real `TurnManager` fencing, and the real rule-based intent parser, executes for
real):

```
✓ test/session.integration.test.ts (3 tests) 1381ms
  ✓ runs the full stress test scenario and passes every acceptance check   583ms
  ✓ never plays audio chunks belonging to a cancelled turn                 459ms
  ✓ leaves the session in LISTENING after a full interrupt+recover cycle   338ms
✓ test/turnManager.test.ts (8 tests) 5ms
✓ test/stateMachine.test.ts (6 tests) 4ms
✓ test/mockTools.test.ts (3 tests) 56ms

Test Files  4 passed (4)
     Tests  20 passed (20)
```

Example timings from one such run of the "find laptop / change budget" scenario
(`toolDelayMs: 400`, `interruptAfterMs: 100`), as produced by `runStressTest()`'s own
`performance.now()` instrumentation (server console / `stress_test_result` payload — reproduce
by running **Break the Assistant** in the running app with a real `RIME_API_KEY` configured,
which additionally exercises the real Rime HTTP stream and its own abort path):

| Stage | Measured |
|---|---|
| Interruption detected | 0.0ms (reference point) |
| Rime playback stop / abort issued | ~0.1–0.4ms (synchronous `AbortController.abort()` call) |
| Old request invalidated | ~0.1–0.5ms after interrupt |
| New response started (LLM call begins) | ~0–5ms after interrupt (rule-based parser) / higher with `ANTHROPIC_API_KEY` set, bounded by Claude's response latency |
| New response spoken (turn complete) | bounded by tool delay + Rime synthesis time for the new turn |

These are *shapes*, not marketing numbers — the exact figures depend on your configured
`toolDelayMs`/`interruptAfterMs`, whether `ANTHROPIC_API_KEY` is set, and Rime's live synthesis
latency for your network path. Run **Break the Assistant** yourself to get numbers for your
environment; the UI renders them from the live `stress_test_result` payload, never from a
fixture.

## Limitations

- The mocked-Rime automated test proves the *fencing and cancellation logic* is correct
  end-to-end; it does not by itself prove Rime's specific HTTP stream aborts within a given
  millisecond budget on a given network — that depends on network conditions and is why the UI
  reports *live-measured* numbers rather than a fixed target.
- The "audio-stop latency" perceived by a human ear also includes browser audio-pipeline
  buffering (how much of the `MediaSource` buffer had already been decoded/queued by the audio
  hardware at the moment `audio.pause()` is called), which varies by browser and device and is
  reported by the client (`client_metric` message) rather than assumed.
- The stale-result rejection is proven for the three mock tools and for Rime TTS chunks; it has
  not been tested against arbitrary third-party tool integrations a developer might add later —
  any new tool should be registered through `TurnManager.registerToolCall`/`resolveToolCall` to
  inherit the same guarantee.
- See README §18 "Known limitations" for the STT/LLM/MediaSource/transport caveats that apply to
  the system as a whole.
