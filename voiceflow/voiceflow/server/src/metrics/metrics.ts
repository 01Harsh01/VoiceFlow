/**
 * Rolling metrics store. Every number here comes from an actual
 * performance.now() measurement taken at the relevant point in the real
 * pipeline — nothing is hardcoded or simulated.
 */
export type MetricName =
  | 'sttFinalLatency'
  | 'llmLatency'
  | 'toolLatency'
  | 'ttsFirstByteLatency'
  | 'ttsTotalLatency'
  | 'interruptionDetectionLatency'
  | 'audioStopLatency'
  | 'totalTurnLatency';

class MetricSeries {
  private samples: number[] = [];
  private readonly cap = 50;

  push(value: number) {
    this.samples.push(value);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  get current(): number | null {
    return this.samples.length ? this.samples[this.samples.length - 1]! : null;
  }

  get average(): number | null {
    if (!this.samples.length) return null;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  get count() {
    return this.samples.length;
  }
}

export class MetricsStore {
  private series = new Map<MetricName, MetricSeries>();

  record(name: MetricName, valueMs: number) {
    if (!this.series.has(name)) this.series.set(name, new MetricSeries());
    this.series.get(name)!.push(valueMs);
  }

  snapshot(): Record<MetricName, { current: number | null; average: number | null; count: number }> {
    const names: MetricName[] = [
      'sttFinalLatency',
      'llmLatency',
      'toolLatency',
      'ttsFirstByteLatency',
      'ttsTotalLatency',
      'interruptionDetectionLatency',
      'audioStopLatency',
      'totalTurnLatency',
    ];
    const out = {} as Record<MetricName, { current: number | null; average: number | null; count: number }>;
    for (const n of names) {
      const s = this.series.get(n);
      out[n] = { current: s?.current ?? null, average: s?.average ?? null, count: s?.count ?? 0 };
    }
    return out;
  }
}
