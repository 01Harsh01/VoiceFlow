import { useState } from 'react';
import { OctagonX, Send, ArrowLeft } from 'lucide-react';
import { Transcript } from './Transcript';
import { Visualizer } from './Visualizer';
import { SystemPanel } from './SystemPanel';
import { MetricsPanel } from './MetricsPanel';
import type { useVoiceSession } from '../hooks/useVoiceSession';

export function VoiceWorkspace({
  session,
  onBack,
}: {
  session: ReturnType<typeof useVoiceSession>;
  onBack: () => void;
}) {
  const [textInput, setTextInput] = useState('');

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    session.sendTextUtterance(textInput.trim());
    setTextInput('');
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="focus-ring flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${session.connected ? 'bg-emerald-400' : 'bg-red-500'}`}
          />
          <span className="font-mono text-xs text-slate-500">
            {session.connected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </header>

      {session.lastError && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {session.lastError}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_320px]">
        <div className="glass order-2 rounded-2xl border border-base-800 p-4 lg:order-1">
          <Transcript turns={session.turns} interimText={session.interimText} />
        </div>

        <div className="glass order-1 flex flex-col items-center justify-center gap-8 rounded-2xl border border-base-800 p-8 lg:order-2">
          <Visualizer
            state={session.visualizerState}
            micLevel={session.micLevel}
            playbackLevel={session.playbackLevel}
          />

          <div className="flex w-full max-w-md flex-col items-center gap-3">
            <button
              onClick={session.manualInterrupt}
              disabled={!['SPEAKING', 'THINKING', 'TOOL_RUNNING'].includes(session.sessionState)}
              className="focus-ring flex items-center gap-2 rounded-full border border-orange-800/60 bg-orange-950/30 px-5 py-2.5 text-sm font-medium text-orange-300 transition hover:bg-orange-950/60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <OctagonX size={16} /> Interrupt now
            </button>

            <form onSubmit={submitText} className="flex w-full items-center gap-2">
              <label htmlFor="text-fallback" className="sr-only">
                Type an instruction instead of speaking
              </label>
              <input
                id="text-fallback"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder='Type instead of speaking, e.g. "Find flights from Delhi to Mumbai tomorrow"'
                className="focus-ring w-full rounded-full border border-base-700 bg-base-900/80 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600"
              />
              <button
                type="submit"
                className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white transition hover:bg-accent-400"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </form>
            {!session.micSupported && (
              <p className="text-center text-[11px] text-slate-600">
                This browser doesn't support live speech recognition — use the text field above
                (the full interruption pipeline still runs; only the mic input is swapped out).
              </p>
            )}
          </div>
        </div>

        <div className="glass order-3 rounded-2xl border border-base-800 p-4">
          <SystemPanel
            connected={session.connected}
            state={session.sessionState}
            systemInfo={session.systemInfo}
            turns={session.turns}
            activeTurnId={session.activeTurnId}
          />
        </div>
      </div>

      <div className="mt-4">
        <MetricsPanel turns={session.turns} />
      </div>
    </div>
  );
}
