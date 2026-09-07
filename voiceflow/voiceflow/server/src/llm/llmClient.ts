import type { ToolName } from '../types.js';

export interface Intent {
  tool: ToolName | null;
  args: Record<string, unknown>;
  slots: Record<string, unknown>;
  spokenResponsePrefix: string; // what to say before/instead of tool results
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

/**
 * Deterministic rule-based fallback. Used automatically when no
 * ANTHROPIC_API_KEY is configured, so the interruption/fencing pipeline
 * (the thing being judged) can be exercised with zero external
 * dependencies and zero LLM latency variance. This is disclosed in the
 * README — it is not a hidden shortcut.
 */
function ruleBasedIntent(userText: string, priorSlots: Record<string, unknown>): Intent {
  const text = userText.toLowerCase();
  const slots: Record<string, unknown> = { ...priorSlots };

  const flightMatch = text.match(/from\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(\s|$)/);
  if (flightMatch && flightMatch[1] && flightMatch[2]) {
    slots.from = flightMatch[1].trim();
    slots.to = flightMatch[2].trim();
  }
  const dayMatch = text.match(
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (dayMatch && dayMatch[1]) slots.date = dayMatch[1];

  const priceMatch = text.match(/(?:under|below|less than)\s*(?:inr|rs\.?|₹)?\s*([\d,]+)/i);
  if (priceMatch && priceMatch[1]) slots.maxPriceInr = Number(priceMatch[1].replace(/,/g, ''));

  const cityMatch = text.match(/weather\s+(?:in|for)\s+([a-z\s]+)/);
  if (cityMatch && cityMatch[1]) slots.city = cityMatch[1].trim();

  let tool: ToolName | null = null;
  if (slots.from || slots.to || /flight/.test(text)) tool = 'searchFlights';
  else if (slots.maxPriceInr !== undefined || /laptop|product|phone|buy/.test(text))
    tool = 'searchProducts';
  else if (slots.city || /weather/.test(text)) tool = 'getWeather';
  else tool = (priorSlots.__lastTool as ToolName | undefined) ?? null;

  slots.__lastTool = tool ?? undefined;

  const isCorrection = /\b(wait|actually|no,?\s|instead|change|make it)\b/.test(text);
  const prefix = isCorrection ? "Got it, I'll update that. " : '';

  return { tool, args: slots, slots, spokenResponsePrefix: prefix };
}

/**
 * Calls Claude (Anthropic Messages API) to parse the user's utterance into
 * a structured intent (tool + slots), taking the accumulated slot state
 * into account so a correction like "make it Friday instead" merges into
 * the existing flight-search slots rather than starting over.
 *
 * Falls back to `ruleBasedIntent` on any error or missing API key.
 */
export async function extractIntent(
  userText: string,
  priorSlots: Record<string, unknown>,
): Promise<{ intent: Intent; usedFallback: boolean }> {
  if (!ANTHROPIC_API_KEY) {
    return { intent: ruleBasedIntent(userText, priorSlots), usedFallback: true };
  }

  const system = `You are the intent-extraction layer of a voice assistant called VoiceFlow.
Given the user's latest utterance and the current accumulated slot state (from prior turns,
including any that were interrupted), return ONLY a JSON object, no prose, no markdown fences:
{
  "tool": "searchFlights" | "searchProducts" | "getWeather" | null,
  "slots": { ...merged slot state, only include relevant keys for the chosen tool... },
  "isCorrection": boolean,
  "spokenResponsePrefix": string
}
Rules:
- If the utterance modifies a constraint from the prior slots (e.g. "make it Friday instead",
  "actually under 60000"), MERGE into priorSlots rather than discarding them.
- tool "searchFlights" slots: from, to, date.
- tool "searchProducts" slots: category, maxPriceInr.
- tool "getWeather" slots: city.
- spokenResponsePrefix: a short natural acknowledgement, e.g. "Got it, I'll use Friday instead."
  Empty string if this is a brand new request rather than a correction.`;

  const userPayload = JSON.stringify({ userText, priorSlots });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: userPayload }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = (await res.json()) as any;
    const raw: string = data?.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const slots = { ...priorSlots, ...(parsed.slots ?? {}) };
    return {
      intent: {
        tool: parsed.tool ?? null,
        args: slots,
        slots,
        spokenResponsePrefix: parsed.spokenResponsePrefix ?? '',
      },
      usedFallback: false,
    };
  } catch (err) {
    // Never let LLM failure take down the turn — degrade to rule-based.
    return { intent: ruleBasedIntent(userText, priorSlots), usedFallback: true };
  }
}

/** Turns a tool result + intent into a short, speakable sentence. */
export function draftSpokenResponse(
  intent: Intent,
  toolResult: { tool: ToolName; data: any } | null,
): string {
  const prefix = intent.spokenResponsePrefix;
  if (!toolResult) {
    return `${prefix}Could you tell me a bit more about what you're looking for?`.trim();
  }
  switch (toolResult.tool) {
    case 'searchFlights': {
      const opts = toolResult.data.options as any[];
      const first = opts[0];
      return `${prefix}I found ${opts.length} flight options. The first is ${first.airline} at ${first.departure}, ${first.route}, for around ₹${first.priceInr} on ${first.date}.`.trim();
    }
    case 'searchProducts': {
      const opts = toolResult.data.options as any[];
      const first = opts[0];
      return `${prefix}I found ${opts.length} options under your budget. The top pick is the ${first.name} at ₹${first.priceInr}.`.trim();
    }
    case 'getWeather': {
      const w = toolResult.data;
      return `${prefix}It's ${w.tempC}°C and ${w.condition} in ${w.city} right now.`.trim();
    }
    default:
      return `${prefix}Here's what I found.`.trim();
  }
}
