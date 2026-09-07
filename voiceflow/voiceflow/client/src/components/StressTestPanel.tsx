import { useEffect, useState } from 'react';
import { ArrowLeft, Zap, CheckCircle2, XCircle } from 'lucide-react';
import type { useVoiceSession } from '../hooks/useVoiceSession';

export function StressTestPanel({
  session,
  onBack,
}: {
  session: ReturnType<typeof useVoiceSession>;
  onBack: () => void;
}) {
  const [toolDelayMs, setToolDelayMs] = useState(3000);
  const [interruptAfterMs, setInterruptAfterMs] = useState(1000);
  const [firstUtterance, setFirstUtterance] = useState('Find me a laptop under ₹80,000');
  const [secondUtterance, setSecondUtterance] = useState('Stop. Make it under ₹60,000');
  const [running, setRunning] = useState(false);

  const run = () => {
    setRunning(true);
    session.runStressTest({ toolDelayMs, interruptAfterMs, firstUtterance, secondUtterance });
  };

  useEffect(() => {
    if (session.stressResult) setRunning(false);
  }, [session.stressResult]);

  const result = session.stressResult;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <button
        onClick={onBack}
        className="focus-ring mb-8 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="text-3xl font-bold text-slate-50">Break the Assistant</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        We intentionally delay a tool response and interrupt the assistant before it finishes, then
        change the request. This runs the exact same orchestrator code as the live voice session —
        no separate "demo mode" logic — so a pass here is a real guarantee, not a scripted animation.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="glass rounded-2xl border border-base-800 p-5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Tool delay: {toolDelayMs}ms
          </label>
          <input
            type="range"
            min={1000}
            max={5000}
            step={100}
            value={toolDelayMs}
            onChange={(e) => setToolDelayMs(Number(e.target.value))}
            className="mt-3 w-full accent-accent-500"
          />
        </div>
        <div className="glass rounded-2xl border border-base-800 p-5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Interruption timing: {interruptAfterMs}ms
          </label>
          <input
            type="range"
            min={500}
            max={3000}
            step={100}
            value={interruptAfterMs}
            onChange={(e) => setInterruptAfterMs(Number(e.target.value))}
            className="mt-3 w-full accent-accent-500"
          />
        </div>
        <div className="glass rounded-2xl border border-base-800 p-5 sm:col-span-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            First request
          </label>
          <input
            value={firstUtterance}
            onChange={(e) => setFirstUtterance(e.target.value)}
            className="focus-ring mt-2 w-full rounded-lg border border-base-700 bg-base-900/80 px-3 py-2 text-sm text-slate-200"
          />
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Interrupting correction
          </label>
          <input
            value={secondUtterance}
            onChange={(e) => setSecondUtterance(e.target.value)}
            className="focus-ring mt-2 w-full rounded-lg border border-base-700 bg-base-900/80 px-3 py-2 text-sm text-slate-200"
          />
        </div>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="focus-ring mt-6 flex items-center gap-2 rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-400 disabled:opacity-50"
      >
        <Zap size={16} /> Run Stress Test
      </button>

      {result && (
        <div className="mt-10 space-y-6">
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
              result.passed
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : 'border-red-800 bg-red-950/30 text-red-300'
            }`}
          >
            {result.passed ? '✓ All acceptance checks passed' : '✕ One or more checks failed'} — old
            turn <span className="font-mono">{result.oldTurnId}</span>, new turn{' '}
            <span className="font-mono">{result.newTurnId}</span>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Acceptance checks</h2>
            <div className="space-y-2">
              {result.checks.map((check) => (
                <div
                  key={check.name}
                  className="flex items-start gap-3 rounded-lg border border-base-800 bg-base-900/50 px-4 py-3"
                >
                  {check.passed ? (
                    <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={18} />
                  ) : (
                    <XCircle className="mt-0.5 shrink-0 text-red-400" size={18} />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-200">{check.name}</p>
                    <p className="text-xs text-slate-500">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Measured timings</h2>
            <div className="overflow-hidden rounded-lg border border-base-800">
              <table className="w-full text-left text-sm">
                <tbody>
                  {result.timings.map((t) => (
                    <tr key={t.label} className="border-b border-base-800 last:border-none">
                      <td className="px-4 py-2 text-slate-400">{t.label}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-200">
                        {t.ms.toFixed(1)}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              Every value above comes from a live run of this exact configuration, measured with{' '}
              <code>performance.now()</code> on the server — nothing here is a fixture.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
