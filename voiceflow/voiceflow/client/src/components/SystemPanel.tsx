import type { SessionState, SystemInfo, Turn } from '../lib/types';

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-base-800 py-2 last:border-none">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="flex items-center gap-1.5 font-mono text-xs text-slate-200">{children}</span>
    </div>
  );
}

export function SystemPanel({
  connected,
  state,
  systemInfo,
  turns,
  activeTurnId,
}: {
  connected: boolean;
  state: SessionState;
  systemInfo: SystemInfo | null;
  turns: Turn[];
  activeTurnId: string | null;
}) {
  const currentTurn = turns.find((t) => t.id === activeTurnId) ?? turns[turns.length - 1];
  const previousTurn = turns.length > 1 ? turns[turns.length - 2] : undefined;
  const runningTools = currentTurn?.toolCalls ?? [];

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-300">System State</h2>
      <div className="space-y-0">
        <Row label="VOICE PROVIDER">
          <Dot color="#5b8cff" /> Rime
        </Row>
        <Row label="SESSION">
          <Dot color={connected ? '#4ade80' : '#ef4444'} /> {connected ? 'Connected' : 'Disconnected'}
        </Row>
        <Row label="CURRENT STATE">
          <Dot color={stateColor(state)} /> {state}
        </Row>
        <Row label="CURRENT TURN">{currentTurn ? `#${currentTurn.seq}` : '—'}</Row>
        <Row label="PREVIOUS TURN">
          {previousTurn ? `${previousTurn.id} · ${previousTurn.status}` : '—'}
        </Row>
        <Row label="AUDIO">{state === 'SPEAKING' ? 'Streaming' : 'Idle'}</Row>
        <Row label="INTERRUPTION">
          <Dot color={['SPEAKING', 'THINKING', 'TOOL_RUNNING'].includes(state) ? '#4ade80' : '#3c4453'} />
          {['SPEAKING', 'THINKING', 'TOOL_RUNNING'].includes(state) ? 'Ready' : 'N/A'}
        </Row>
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Tool status
      </h3>
      <div className="space-y-1.5">
        {runningTools.length === 0 && <p className="text-xs text-slate-600">No tool calls this turn.</p>}
        {runningTools.map((tc) => (
          <div
            key={tc.id}
            className="flex items-center justify-between rounded-md border border-base-800 px-2.5 py-1.5"
          >
            <span className="font-mono text-[11px] text-slate-300">{tc.tool}</span>
            <span
              className={`font-mono text-[11px] ${
                tc.status === 'fulfilled'
                  ? 'text-emerald-400'
                  : tc.status === 'invalidated'
                    ? 'text-red-400'
                    : 'text-amber-400'
              }`}
            >
              {tc.status === 'fulfilled' ? '✓ Reconciled' : tc.status === 'invalidated' ? '✕ Invalidated' : '⟳ Pending'}
            </span>
          </div>
        ))}
      </div>

      {systemInfo && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Rime configuration
          </h3>
          <div className="space-y-1.5 rounded-lg border border-base-800 bg-base-900/60 p-3 font-mono text-[11px] text-slate-400">
            <div className="flex justify-between">
              <span>model</span>
              <span className="text-slate-200">{systemInfo.rimeModelId}</span>
            </div>
            <div className="flex justify-between">
              <span>speaker</span>
              <span className="text-slate-200">{systemInfo.rimeSpeaker}</span>
            </div>
            <div className="flex justify-between">
              <span>lang</span>
              <span className="text-slate-200">{systemInfo.rimeLanguage}</span>
            </div>
            <div className="flex justify-between">
              <span>format</span>
              <span className="text-slate-200">{systemInfo.rimeAudioFormat}</span>
            </div>
            <div className="flex justify-between">
              <span>transport</span>
              <span className="text-slate-200">{systemInfo.transport}</span>
            </div>
            <div className="flex justify-between">
              <span>stt</span>
              <span className="text-slate-200">{systemInfo.sttProvider}</span>
            </div>
            <div className="flex justify-between">
              <span>llm</span>
              <span className="text-slate-200">{systemInfo.llmProvider}</span>
            </div>
            {systemInfo.fallbackActive && (
              <div className="mt-1 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1 text-amber-400">
                Fallback active: {systemInfo.fallbackProvider}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function stateColor(state: SessionState): string {
  switch (state) {
    case 'LISTENING':
      return '#4ade80';
    case 'THINKING':
    case 'TOOL_RUNNING':
    case 'PROCESSING_NEW_TURN':
      return '#facc15';
    case 'SPEAKING':
      return '#5b8cff';
    case 'INTERRUPTING':
    case 'CANCELLING':
      return '#f97316';
    case 'ERROR':
      return '#ef4444';
    default:
      return '#3c4453';
  }
}
