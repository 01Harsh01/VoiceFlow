import { CheckCircle2, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import type { Turn } from '../lib/types';

const STATUS_META: Record<Turn['status'], { label: string; icon: React.ReactNode; className: string }> = {
  completed: { label: 'Completed', icon: <CheckCircle2 size={14} />, className: 'text-emerald-400' },
  processing: { label: 'Processing', icon: <Loader2 size={14} className="animate-spin" />, className: 'text-amber-400' },
  active: { label: 'Speaking', icon: <Loader2 size={14} className="animate-spin" />, className: 'text-accent-400' },
  cancelled: { label: 'Cancelled', icon: <XCircle size={14} />, className: 'text-orange-400' },
  stale: { label: 'Stale', icon: <AlertTriangle size={14} />, className: 'text-red-400' },
};

export function Transcript({ turns, interimText }: { turns: Turn[]; interimText: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-300">Conversation</h2>
        <span className="font-mono text-[11px] text-slate-500">{turns.length} turns</span>
      </div>
      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <p className="text-sm text-slate-500">
            Say something like “Find flights from Delhi to Mumbai tomorrow,” then interrupt with
            “Wait, make it Friday.”
          </p>
        )}
        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}
        {interimText && (
          <div className="rounded-lg border border-dashed border-base-600 px-3 py-2 text-sm text-slate-500">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              you (live)
            </span>
            <p className="italic">{interimText}…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TurnBlock({ turn }: { turn: Turn }) {
  const status = STATUS_META[turn.status];
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
            you · {turn.id}
          </span>
          <p
            className={`text-sm text-slate-200 ${
              turn.status === 'cancelled' || turn.status === 'stale' ? 'line-through opacity-50' : ''
            }`}
          >
            "{turn.userText}"
          </p>
        </div>
      </div>

      {turn.assistantText && (
        <div className="flex items-start gap-2 rounded-lg border border-base-700 bg-base-850/60 px-3 py-2">
          <span className={`mt-0.5 shrink-0 ${status.className}`} title={status.label}>
            {status.icon}
          </span>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              assistant
            </span>
            <p
              className={`text-sm text-slate-200 ${
                turn.status === 'cancelled' || turn.status === 'stale' ? 'line-through opacity-50' : ''
              }`}
            >
              {turn.assistantText}
            </p>
            <span className={`text-[11px] font-medium ${status.className}`}>{status.label}</span>
          </div>
        </div>
      )}

      {turn.toolCalls.length > 0 && (
        <div className="ml-1 flex flex-wrap gap-2">
          {turn.toolCalls.map((tc) => (
            <span
              key={tc.id}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                tc.status === 'fulfilled'
                  ? 'border-emerald-800 text-emerald-400'
                  : tc.status === 'invalidated'
                    ? 'border-red-900 text-red-400 line-through'
                    : 'border-amber-900 text-amber-400'
              }`}
            >
              {tc.tool} · {tc.status}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
