/**
 * Rime TTS client — server-side only. The API key never leaves this
 * process. Uses Rime's documented streaming HTTP endpoint:
 *
 *   POST https://users.rime.ai/v1/rime-tts
 *   Authorization: Bearer <RIME_API_KEY>
 *   Accept: <requested audio mime type>
 *   Content-Type: application/json
 *   body: { text, modelId, speaker, lang, samplingRate, speedAlpha }
 *
 * Reference: docs.rime.ai/api-reference (fetched at implementation time).
 * Rime also exposes a persistent WebSocket (`wss://users-ws.rime.ai/ws3`)
 * with an explicit `clear` operation + context IDs designed specifically
 * for barge-in — see README "Known limitations" for why this project uses
 * the simpler HTTP-streaming + AbortController model instead for v1, and
 * how to upgrade to `/ws3` for even lower interruption latency.
 *
 * Cancellation model used here: we hand the fetch an AbortSignal tied to
 * the turn. On interruption, the orchestrator aborts the signal, the
 * in-flight HTTP stream is torn down immediately, and no further chunks
 * are read from the response body — so stale audio is never even
 * generated-and-discarded, it's not pulled from the network at all.
 */

export interface RimeConfig {
  apiKey: string;
  endpoint: string;
  modelId: string;
  speaker: string;
  language: string;
  audioFormat: string; // Accept header value, e.g. "audio/mpeg"
  samplingRate: number;
}

export function loadRimeConfig(): RimeConfig {
  return {
    apiKey: process.env.RIME_API_KEY ?? '',
    endpoint: process.env.RIME_ENDPOINT ?? 'https://users.rime.ai/v1/rime-tts',
    modelId: process.env.RIME_MODEL_ID ?? 'coda',
    speaker: process.env.RIME_SPEAKER ?? 'astra',
    language: process.env.RIME_LANGUAGE ?? 'en',
    audioFormat: process.env.RIME_AUDIO_FORMAT ?? 'audio/mpeg',
    samplingRate: Number(process.env.RIME_SAMPLING_RATE ?? 24000),
  };
}

export interface RimeStreamHandlers {
  onChunk: (chunk: Buffer, seq: number) => void | boolean; // return false to stop early
  onFirstByte?: () => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Streams synthesized speech for `text`, invoking `onChunk` for every
 * network chunk as it arrives (true streaming — not "wait for whole file
 * then play"). Returns once the stream ends, is aborted, or errors.
 */
export async function streamRimeSpeech(
  config: RimeConfig,
  text: string,
  signal: AbortSignal,
  handlers: RimeStreamHandlers,
): Promise<{ ok: boolean; bytesStreamed: number; chunks: number }> {
  if (!config.apiKey) {
    throw new Error(
      'RIME_API_KEY is not set. VoiceFlow requires a real Rime key for the judged spoken-output path — see .env.example.',
    );
  }

  let bytesStreamed = 0;
  let chunks = 0;
  let firstByteFired = false;

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: config.audioFormat,
      },
      body: JSON.stringify({
        text,
        modelId: config.modelId,
        speaker: config.speaker,
        lang: config.language,
        samplingRate: config.samplingRate,
        speedAlpha: 1.0,
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`Rime TTS request failed: ${res.status} ${res.statusText} ${body}`);
    }

    const reader = res.body.getReader();
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => {});
        return { ok: false, bytesStreamed, chunks };
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        if (!firstByteFired) {
          firstByteFired = true;
          handlers.onFirstByte?.();
        }
        bytesStreamed += value.byteLength;
        chunks += 1;
        const shouldContinue = handlers.onChunk(Buffer.from(value), chunks);
        if (shouldContinue === false || signal.aborted) {
          await reader.cancel().catch(() => {});
          return { ok: false, bytesStreamed, chunks };
        }
      }
    }
    handlers.onDone?.();
    return { ok: true, bytesStreamed, chunks };
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      return { ok: false, bytesStreamed, chunks };
    }
    handlers.onError?.(err);
    throw err;
  }
}
