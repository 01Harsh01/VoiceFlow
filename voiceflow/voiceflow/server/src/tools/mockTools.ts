import type { ToolName } from '../types.js';

/**
 * Mock tools used to demonstrate the tool-fencing problem: they are slow
 * on purpose (configurable delay) so that a user can realistically
 * interrupt the assistant before the tool resolves. They are NOT hardcoded
 * fake outputs pretending to be async — they genuinely resolve via
 * `setTimeout` on a real Promise, and respect `AbortSignal` cancellation
 * (the promise still resolves so we can also demonstrate fencing on
 * results that complete *after* being invalidated, which is the harder
 * and more realistic case: cancelling the network request doesn't always
 * cancel the eventual result).
 */

export interface ToolResult {
  tool: ToolName;
  args: Record<string, unknown>;
  data: unknown;
  ranForMs: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

const FLIGHT_ROUTES = ['DEL-BOM', 'BLR-DEL', 'HYD-BOM', 'MAA-DEL'];
const AIRLINES = ['IndiGo', 'Air India', 'Vistara', 'SpiceJet', 'Akasa Air'];

export async function searchFlights(
  args: { from?: string; to?: string; date?: string },
  delayMs: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const start = performance.now();
  await delay(delayMs, signal);
  const toLen = args.to?.length ?? 0;
  const options = Array.from({ length: 3 }).map((_, i) => ({
    airline: AIRLINES[(i + toLen) % AIRLINES.length],
    route: `${(args.from ?? 'DEL').slice(0, 3).toUpperCase()}-${(args.to ?? 'BOM').slice(0, 3).toUpperCase()}`,
    date: args.date ?? 'tomorrow',
    departure: `0${6 + i}:${i === 0 ? '15' : i === 1 ? '40' : '55'}`,
    priceInr: 3200 + i * 850,
  }));
  return { tool: 'searchFlights', args, data: { options }, ranForMs: performance.now() - start };
}

export async function searchProducts(
  args: { category?: string; maxPriceInr?: number },
  delayMs: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const start = performance.now();
  await delay(delayMs, signal);
  const max = args.maxPriceInr ?? 80000;
  const options = [
    { name: 'Acer Aspire 7', priceInr: Math.min(max - 5000, 54999) },
    { name: 'HP Pavilion 15', priceInr: Math.min(max - 2000, 62990) },
    { name: 'Lenovo IdeaPad Slim 5', priceInr: Math.min(max - 8000, 58490) },
  ].filter((o) => o.priceInr > 0);
  return {
    tool: 'searchProducts',
    args,
    data: { options, ceilingInr: max },
    ranForMs: performance.now() - start,
  };
}

export async function getWeather(
  args: { city?: string },
  delayMs: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const start = performance.now();
  await delay(delayMs, signal);
  return {
    tool: 'getWeather',
    args,
    data: { city: args.city ?? 'Delhi', tempC: 27, condition: 'Partly cloudy' },
    ranForMs: performance.now() - start,
  };
}

export const TOOLS: Record<
  ToolName,
  (args: Record<string, unknown>, delayMs: number, signal?: AbortSignal) => Promise<ToolResult>
> = {
  searchFlights: searchFlights as any,
  searchProducts: searchProducts as any,
  getWeather: getWeather as any,
};
