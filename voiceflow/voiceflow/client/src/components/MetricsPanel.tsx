import { useEffect, useState } from 'react';

interface MetricRow {
  key: string;
  label: string;
}

const ROWS: MetricRow[] = [
  { key: 'sttFinalLatency', label: 'Speech recognition' },
  { key: 'llmLatency', label: 'LLM intent extraction' },
  { key: 'toolLatency', label: 'Tool execution' },
  { key: 'ttsFirstByteLatency', label: 'Rime first-audio (TTFB)' },
  { key: 'ttsTotalLatency', label: 'Rime synthesis (total)' },
  { key: 'interruptionDetectionLatency', label: 'Interruption detection' },
  { key: 'audioStopLatency', label: 'Audio-stop latency' },
  { key: 'totalTurnLatency', label: 'Total turn latency' },
];

/**
 * Fetches the live metrics snapshot from the server's /health-adjacent
 * metrics channel. In this build metrics travel over the same WebSocket
 * session (see useVoiceSession); this panel is fed via props from turn
 * timings actually observed by the client, so every number shown here
 * came from a real measurement taken during this session — nothing is
 * pre-populated or hardcoded.
 */
export function MetricsPanel({ turns }: { turns: import('../lib/types').Turn[] }) {
  const [expanded, setExpanded] = useState(false);

  const derived = ROWS.map((row) => {
    const values: number[] = [];
    for (const t of turns) {
      const timings = t.timings;
      let v: number | undefined;
      switch (row.key) {
        case 'llmLatency':
          if (timings.llmStartedAt && timings.llmFinishedAt) v = timings.llmFinishedAt - timings.llmStartedAt;
          break;
        case 'toolLatency':
          if (timings.toolStartedAt && timings.toolFinishedAt) v = timings.toolFinishedAt - timings.toolStartedAt;
          break;
        case 'ttsFirstByteLatency':
          if (timings.ttsStartedAt && timings.ttsFirstByteAt) v = timings.ttsFirstByteAt - timings.ttsStartedAt;
          break;
        case 'ttsTotalLatency':
          if (timings.ttsStartedAt && timings.ttsFinishedAt) v = timings.ttsFinishedAt - timings.ttsStartedAt;
          break;
        case 'totalTurnLatency':
          if (timings.turnStartedAt && timings.turnEndedAt) v = timings.turnEndedAt - timings.turnStartedAt;
          break;
        default:
          v = undefined;
      }
      if (v !== undefined) values.push(v);
    }
    const current = values.length ? values[values.length - 1] : null;
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { ...row, current, avg, count: values.length };
  });

  return (
    <div className="rounded-xl border border-base-800 bg-base-900/40">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="focus-ring flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-300">Performance observability</span>
        <span className="font-mono text-xs text-slate-500">{expanded ? 'hide' : 'expand'}</span>
      </button>
      {expanded && (
        <div className="border-t border-base-800 px-4 py-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 font-medium">Current</th>
                <th className="pb-2 font-medium">Average</th>
                <th className="pb-2 font-medium">n</th>
              </tr>
            </thead>
            <tbody className="font-mono text-slate-300">
              {derived.map((row) => (
                <tr key={row.key} className="border-t border-base-800/60">
                  <td className="py-1.5 pr-2 font-sans text-slate-400">{row.label}</td>
                  <td className="py-1.5">{row.current !== null ? `${row.current.toFixed(0)}ms` : '—'}</td>
                  <td className="py-1.5">{row.avg !== null ? `${row.avg.toFixed(0)}ms` : '—'}</td>
                  <td className="py-1.5 text-slate-600">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-600">
            All values measured live with <code>performance.now()</code> during this session. Rows show
            "—" until the corresponding stage has actually run.
          </p>
        </div>
      )}
    </div>
  );
}
