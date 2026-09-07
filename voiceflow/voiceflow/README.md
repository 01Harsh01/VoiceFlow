# VoiceFlow

**"Talk. Interrupt. Change your mind."**

Built for the **Rime Hackathon / DataForge Rime Challenge**.

VoiceFlow is not a chatbot with text-to-speech bolted on. It is an attempt at one specific,
hard voice-engineering problem: **interruption and recovery** — letting a user talk over the
assistant, change their mind mid-response, and guaranteeing the system never speaks a stale
answer or acts on a stale tool result afterward.

---

## 1. Product overview

VoiceFlow is a hands-free voice task assistant. You speak a request ("Find flights from Delhi
to Mumbai tomorrow"), it starts working and speaking back through **Rime**, and — this is the
whole point — you can interrupt it mid-sentence ("Wait, make it Friday instead") and it will:

1. Stop the Rime audio immediately (not fade it out — stop it).
2. Cancel the in-flight response and any in-flight tool call for the old request.
3. Carry forward everything that's still relevant (e.g. "Delhi → Mumbai" stays; only the date
   changes) into a new turn.
4. Answer the new, corrected request — and only the new request.

## 2. Target user

Anyone doing a task hands-free or eyes-busy — driving, cooking, working through a checklist —
who wants to *think out loud* the way people actually talk: with false starts, corrections, and
"actually, wait." Most voice assistants punish that by either ignoring the interruption or
losing context when you interrupt. VoiceFlow is built around the assumption that changing your
mind mid-sentence is the normal case, not an edge case.

## 3. Why voice is necessary

Text chat has no concept of "while you were typing that, I changed my mind" — you just edit the
message. Voice is different: the assistant is *actively speaking* when you change your mind, so
there is real, in-flight work (an audio stream, a tool call, an LLM completion) that has to be
torn down correctly, not just a text buffer to overwrite. That's a systems problem, not a UX
problem, and it only exists because voice is live and continuous.

## 4. The hard voice problem being solved

> **Barge-in interruption with correct cancellation and reconciliation of in-flight
> speech/tool/model work, such that a stale result can never reach the user as audio.**

Concretely, three things have to be true simultaneously:

- The **audio** that's already playing must stop within tens/low-hundreds of milliseconds.
- Any **async work** (a slow tool call, an LLM completion) started for the old turn must never
  be allowed to produce the spoken answer, even if it finishes *after* the interruption.
- The **new** request must be able to build on state from the old one (slots like "from Delhi",
  "to Mumbai") without waiting for the old turn to fully unwind.

## 5. Technical architecture

```
Browser (React/Vite/TS)                    Server (Node/TS)
┌─────────────────────────┐   WebSocket   ┌───────────────────────────┐
│ Mic (getUserMedia)       │──────────────▶│ Session orchestrator      │
│  - amplitude VAD (fast)  │  user_utterance│  - VoiceSessionStateMachine│
│  - Web Speech API (text) │  interrupt     │  - TurnManager (fencing)  │
│                          │◀──────────────│  - LLM intent extraction  │
│ AudioQueue (MediaSource) │ audio_chunk,   │    (Anthropic / fallback) │
│  - streams Rime audio    │ audio_cancel,  │  - Mock async tools       │
│  - hard-stops on cancel  │ turn_updated,  │  - Rime TTS streaming     │
│                          │ system_info,   │  - Metrics store          │
│ Visualizer / Transcript /│ stress_test_   │                           │
│ SystemPanel / Metrics    │ result         │                           │
└─────────────────────────┘                └───────────────────────────┘
```

- **Frontend**: React + Vite + TypeScript + Tailwind + Framer Motion + Lucide.
- **Realtime transport**: a single WebSocket per session (`/ws`). (LiveKit was evaluated; for a
  single-user hackathon build a plain WebSocket kept the turn-fencing logic auditable in one
  place. See "Known limitations" for the LiveKit upgrade path.)
- **Backend**: Node.js + TypeScript + Express, `ws` for the WebSocket server.
- **STT**: browser-native Web Speech API (see §11).
- **LLM**: Anthropic Claude for intent/slot extraction, with a disclosed deterministic
  rule-based fallback (see §11).
- **TTS**: Rime, streamed over HTTP from the server and relayed to the browser as base64 audio
  chunks tagged with a turn ID.

## 6. State machine

Centralized in `server/src/state/stateMachine.ts` — no scattered `isSpeaking`/`isThinking`
booleans anywhere in the codebase. States:

```
IDLE → LISTENING → THINKING → TOOL_RUNNING → SPEAKING → LISTENING
                       ↑                         │
                       │                         ▼
              PROCESSING_NEW_TURN ← CANCELLING ← INTERRUPTING
```

The transition table is explicit (`TRANSITIONS` map); an illegal transition throws
`InvalidTransitionError` rather than silently corrupting state. This is unit-tested in
`server/test/stateMachine.test.ts`.

## 7. Interruption handling

Two independent signals feed the interrupt path, on purpose:

1. **Speech-onset detection** (`client/src/audio/useMic.ts`): a raw amplitude (RMS) threshold on
   the microphone stream via `AnalyserNode`, sustained for ~90ms. This fires in tens of
   milliseconds and immediately sends an `interrupt` message — it does **not** wait for speech
   recognition to produce text, because STT latency (hundreds of ms) would defeat the point of a
   fast interruption.
2. **Final transcript text** (Web Speech API): arrives later and becomes the new turn's
   `user_utterance`.

On the server, `Session.handleInterrupt()`:

1. Transitions `SPEAKING/THINKING/TOOL_RUNNING → INTERRUPTING`.
2. Aborts the active turn's `AbortController`s (one for the tool call, one for the Rime HTTP
   stream) — this tears down the in-flight `fetch` to Rime immediately.
3. Sends `audio_cancel` to the client, which calls `AudioQueue.cancel()` — this pauses the
   `<audio>` element and tears down the `MediaSource` **synchronously**, not a fade or a mute.
4. Marks the turn `cancelled` in the `TurnManager` and invalidates any pending tool calls.
5. Transitions `INTERRUPTING → CANCELLING → LISTENING`.

The next `user_utterance` starts a brand-new turn, seeded with `TurnManager.latestSlots()` from
the cancelled turn — this is how "make it Friday instead" merges into the existing
Delhi→Mumbai search instead of starting over.

## 8. Turn ID / stale-result protection

Every turn gets a monotonically increasing ID (`turn-001`, `turn-002`, ...). The single rule
that makes the whole system correct:

> Before any asynchronous result (LLM completion, tool result, TTS chunk) is **applied**, the
> code checks `turnManager.isActive(turnId)`. If false, the result is discarded — no partial
> application.

This is enforced at three independent layers, deliberately redundant:

- **Server, after the LLM call**: `if (!turnManager.isActive(turn.id)) return;`
- **Server, after the tool call**: `turnManager.resolveToolCall(record, result)` returns `false`
  (and marks the record `invalidated`) if the turn is no longer active — even if the tool
  finished *after* the cancellation.
- **Client, on every audio chunk**: `AudioQueue.pushChunk` drops any chunk whose `turnId` doesn't
  match the turn currently armed for playback (defends against WebSocket message reordering).

`server/test/turnManager.test.ts` includes a test that reproduces exactly this race: a tool call
is registered, the turn is cancelled, a *new* turn is created, and only then does the original
tool call resolve — the test asserts the stale result is rejected and the new turn remains
active.

## 9. Rime integration

Rime is the primary spoken-output provider for the judged flow. Server-side only
(`server/src/tts/rimeClient.ts`), streamed via `fetch` + `ReadableStream`, with an
`AbortController` tied to the turn so cancellation tears down the network request itself (no
"stop reading a completed buffer" trick).

```
POST {RIME_ENDPOINT}
Authorization: Bearer {RIME_API_KEY}
Accept: {RIME_AUDIO_FORMAT}
Content-Type: application/json

{ "text": "...", "modelId": "...", "speaker": "...", "lang": "...", "samplingRate": ... }
```

## 10. Exact model ID / 11. Speaker / 12. Language / 13. Endpoint / 14. Audio format / 15. Transport

All of these are **configuration, not hardcoded values** — see `.env.example` and
`server/src/tts/rimeClient.ts::loadRimeConfig()`. Defaults as of implementation time:

| Setting | Default | Notes |
|---|---|---|
| Model ID | `coda` | Rime's flagship conversational model at submission time. `arcana` (most expressive) and `mistv2` (fastest/legacy) are also valid — see Rime's model catalog. |
| Speaker | `astra` | A flagship Coda/Arcana voice. Full live catalog: `GET https://users.rime.ai/data/voices/all-v2.json`. |
| Language | `en` | |
| Endpoint | `https://users.rime.ai/v1/rime-tts` | HTTP streaming endpoint. |
| Audio format | `audio/mpeg` | The `AudioQueue` also supports `audio/webm;codecs=opus` and `audio/wav` — see §18. |
| Transport | WebSocket (`/ws`) | Client ⇄ server. Rime itself is called over plain HTTPS from the server. |

The active configuration is surfaced live in the app's **System State** panel and in the
`system_info` WebSocket message, so a judge can see exactly what's configured without reading
source code.

## 16. Setup instructions

Requires Node.js 18+.

```bash
git clone <this-repo>
cd voiceflow
npm install --workspaces

cp .env.example server/.env
# edit server/.env: set RIME_API_KEY at minimum. ANTHROPIC_API_KEY is optional (see §18).

npm run dev:server   # starts the WS/HTTP server on :8787
npm run dev:client   # in a second terminal — starts Vite on :5173
```

Open `http://localhost:5173`, click **Start Voice Session**, grant microphone permission, and
talk. Click **Run Interruption Test** from the landing page (or the workspace's stress-test
route) to run the automated acceptance test described in §20.

Run the automated test suite:

```bash
npm run test --workspace server
```

## 17. Environment variables

See `.env.example` at the repo root (copy to `server/.env`) for the full, commented list:
`RIME_API_KEY`, `RIME_ENDPOINT`, `RIME_MODEL_ID`, `RIME_SPEAKER`, `RIME_LANGUAGE`,
`RIME_AUDIO_FORMAT`, `RIME_SAMPLING_RATE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`STT_PROVIDER`, `DEFAULT_TOOL_DELAY_MS`, `PORT`, `CORS_ORIGIN`. The client reads one variable,
`VITE_WS_URL` (see `client/.env.example`).

No secrets are committed. `.env` is gitignored. The Rime API key is read only in
`server/src/tts/rimeClient.ts` and never sent to, or bundled into, the browser code.

## 18. Known limitations

- **STT is browser-native (Web Speech API)**, not a dedicated cloud STT provider. This was a
  deliberate tradeoff for a hackathon timeline: zero extra API keys, zero extra network hop, and
  it's genuinely real-time. It only works in Chromium-based browsers and requires an internet
  connection (Chrome's implementation calls a Google endpoint under the hood). Swapping in
  Deepgram/AssemblyAI would mean streaming raw mic audio to the server over the same WebSocket
  and running STT there instead — the turn/state-machine logic downstream is unaffected.
- **LLM intent extraction has a rule-based fallback.** If `ANTHROPIC_API_KEY` is unset, VoiceFlow
  uses a deterministic regex-based slot extractor instead of Claude. This is disclosed live in
  the System State panel (`llmProvider: "rule-based-fallback"`) — it is not hidden. It exists so
  the interruption/fencing mechanics (the thing being judged) can be exercised without any LLM
  latency variance or cost, and as a safety net if the LLM call errors mid-turn.
- **Audio streaming depends on MediaSource Extensions support** for the configured MIME type.
  Modern Chromium supports `audio/mpeg` in MSE; Safari/Firefox support varies. If
  `MediaSource.isTypeSupported()` returns false for the configured format, VoiceFlow logs a
  warning and the transcript/state-machine still function correctly, but progressive audio
  playback for that browser/format combination will not. Recommended judging browser: current
  Chrome or Edge.
- **No LiveKit/WebRTC in this build.** The interruption/fencing model is transport-agnostic (it
  lives entirely in `TurnManager`/`VoiceSessionStateMachine`), so migrating the WebSocket
  transport to LiveKit data channels + audio tracks would not require re-architecting the
  fencing logic — it would primarily change `client/src/hooks/useVoiceSession.ts` and
  `server/src/ws/session.ts`'s I/O layer.
- **Rime's dedicated barge-in WebSocket (`wss://users-ws.rime.ai/ws3`)**, which exposes an
  explicit `clear` operation and context IDs designed specifically for interruption, is not used
  in this build. VoiceFlow instead cancels the simpler HTTP-streaming request via
  `AbortController`. This is slightly higher-latency than `/ws3`'s native `clear` op but is
  simpler to reason about and test; it's the clearest documented upgrade path for lower
  interruption latency.
- **Single-session-per-connection.** There's no multi-user session store, auth, or persistence —
  turns live in memory for the lifetime of the WebSocket connection, by design for a judged demo.
- **The rule-based fallback's slot extraction is intentionally simple** (regex over a handful of
  patterns for the three demo tools). It is not a general-purpose NLU system; with
  `ANTHROPIC_API_KEY` set, Claude handles this instead and is considerably more robust to
  phrasing variation.

## 19. Failure behavior

VoiceFlow does not simulate failure with a fake toggle — it fails for real when misconfigured:

- If `RIME_API_KEY` is missing or the Rime request errors, `streamRimeSpeech` throws. The
  session catches this, sends an `error` message to the client (shown as a red banner), marks
  the in-flight turn `cancelled` rather than silently completing it, and force-transitions the
  state machine back through `ERROR → LISTENING` so the session recovers instead of hanging.
- **No hidden fallback TTS provider is implemented in this build.** The judged flow must use
  Rime; if Rime is unavailable, VoiceFlow surfaces that plainly (`ACTIVE PROVIDER: Rime`, no
  silent swap to another voice) rather than pretending nothing happened. This is a deliberate
  scope decision, disclosed here rather than hidden.
- LLM failures (Anthropic API errors, malformed JSON) degrade to the rule-based intent parser
  automatically and are surfaced via `fallbackActive`/`fallbackProvider` in the System State
  panel — the turn still completes.

## 20. Acceptance test

Defined precisely in [`RIME_EVIDENCE.md`](./RIME_EVIDENCE.md). Summary: `Session.runStressTest()`
(`server/src/ws/session.ts`) runs the *exact* production orchestrator code — not a mocked demo
path — through: start turn 1 (slow tool) → wait `interruptAfterMs` → interrupt → start turn 2 →
verify six checks (audio stopped, new instruction accepted, obsolete response cancelled, stale
tool result blocked, state consistent, final response reflects the new request) with timings
measured via `performance.now()`. Exposed in the UI as **Break the Assistant**.

## 21. Performance measurements

Tracked live per session in `server/src/metrics/metrics.ts` and rendered in the client's
**Performance observability** panel: STT latency, LLM latency, tool latency, Rime
time-to-first-byte, Rime total synthesis time, interruption detection latency, audio-stop
latency, and total turn latency. Every number is a real `performance.now()` measurement taken at
the corresponding point in the actual pipeline for the actual session — there are no
placeholder/hardcoded figures anywhere in the codebase. Rows show "—" until that stage has run at
least once.

## 22. Reproduction instructions

1. Follow §16 to run both packages locally with a real `RIME_API_KEY`.
2. Click **Start Voice Session**, say "Find flights from Delhi to Mumbai tomorrow."
3. While the assistant is speaking the first option, say "Wait, make it Friday instead."
4. Observe: audio stops immediately, the old turn shows **✕ Cancelled** in the transcript with
   its tool call marked **✕ Invalidated** in the System panel, and the assistant's next spoken
   response is for Friday only.
5. For a scripted, judge-friendly version of the same scenario with pass/fail output and
   measured timings, use **Break the Assistant** instead of live speech.

## 23. Third-party services

- **Rime** (rime.ai) — text-to-speech, primary spoken-output provider.
- **Anthropic** (Claude, via the Messages API) — optional LLM for intent/slot extraction; falls
  back to a local rule-based parser if not configured.
- **Google's Web Speech API** (accessed via the browser's native `SpeechRecognition`, in Chrome)
  — speech-to-text.

No other third-party services are used. No analytics, no ads, no telemetry beyond the in-app
metrics panel (which never leaves the browser/server pair for this session).

## 24. AI assistance disclosure

This project (architecture, source code, tests, and documentation) was built with the assistance
of Claude (Anthropic). The Rime API endpoint, model catalog, and authentication scheme referenced
in this README and in `server/src/tts/rimeClient.ts` were confirmed against Rime's current public
API documentation at implementation time rather than relied upon from training data, given the
explicit instruction in the challenge brief to avoid stale model/voice names.

---

## Project structure

```
voiceflow/
├── server/                  # Node/TS backend
│   ├── src/
│   │   ├── types.ts             # shared protocol types
│   │   ├── state/stateMachine.ts
│   │   ├── turns/turnManager.ts # turn IDs + fencing
│   │   ├── tools/mockTools.ts   # slow async demo tools
│   │   ├── llm/llmClient.ts     # Claude + rule-based fallback
│   │   ├── tts/rimeClient.ts    # real Rime streaming client
│   │   ├── metrics/metrics.ts
│   │   ├── ws/session.ts        # orchestrator + stress test runner
│   │   └── index.ts             # Express + WS server
│   └── test/                    # Vitest: state machine, turn fencing, tools, integration
├── client/                  # React/Vite/TS frontend
│   └── src/
│       ├── audio/AudioQueue.ts  # MediaSource streaming playback + hard cancel
│       ├── audio/useMic.ts      # amplitude VAD + Web Speech API
│       ├── hooks/useVoiceSession.ts
│       ├── components/          # Hero, VoiceWorkspace, Visualizer, Transcript,
│       │                        # SystemPanel, MetricsPanel, StressTestPanel
│       └── lib/types.ts         # protocol types (kept in sync with server)
├── .env.example
├── RIME_EVIDENCE.md
└── README.md
```
