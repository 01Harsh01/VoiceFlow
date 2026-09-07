import { describe, it, expect } from 'vitest';
import { searchFlights } from '../src/tools/mockTools.js';

describe('mock tools — cancellation', () => {
  it('resolves normally without a signal', async () => {
    const result = await searchFlights({ from: 'Delhi', to: 'Mumbai', date: 'tomorrow' }, 20);
    expect(result.tool).toBe('searchFlights');
    expect((result.data as any).options.length).toBeGreaterThan(0);
  });

  it('rejects with AbortError when aborted before the delay elapses', async () => {
    const controller = new AbortController();
    const promise = searchFlights({ from: 'Delhi', to: 'Mumbai' }, 2000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not reject if abort fires after resolution', async () => {
    const controller = new AbortController();
    const result = await searchFlights({ from: 'Delhi', to: 'Mumbai' }, 10, controller.signal);
    controller.abort();
    expect(result.tool).toBe('searchFlights');
  });
});
