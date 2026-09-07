import { motion } from 'framer-motion';
import { Mic, Brain, Volume2, OctagonX, Loader2, AlertTriangle } from 'lucide-react';
import type { VisualizerState } from '../hooks/useVoiceSession';

const STATE_META: Record<
  VisualizerState,
  { label: string; color: string; icon: React.ReactNode; caption: string }
> = {
  idle: { label: 'IDLE', color: '#3c4453', icon: <Mic size={28} />, caption: 'Session not started' },
  listening: {
    label: 'LISTENING',
    color: '#4ade80',
    icon: <Mic size={28} />,
    caption: '🎙 Listening for your voice',
  },
  thinking: {
    label: 'THINKING',
    color: '#facc15',
    icon: <Brain size={28} />,
    caption: 'Understanding your request',
  },
  processing: {
    label: 'PROCESSING',
    color: '#facc15',
    icon: <Loader2 size={28} className="animate-spin" />,
    caption: 'Running tools / reconciling turn',
  },
  speaking: {
    label: 'SPEAKING',
    color: '#5b8cff',
    icon: <Volume2 size={28} />,
    caption: '🔊 Rime is speaking',
  },
  interrupted: {
    label: 'INTERRUPTED',
    color: '#f97316',
    icon: <OctagonX size={28} />,
    caption: '⛔ Cancelling obsolete response',
  },
  error: {
    label: 'ERROR',
    color: '#ef4444',
    icon: <AlertTriangle size={28} />,
    caption: 'Something went wrong — see system panel',
  },
};

export function Visualizer({
  state,
  micLevel,
  playbackLevel,
}: {
  state: VisualizerState;
  micLevel: number;
  playbackLevel: number;
}) {
  const meta = STATE_META[state];
  const level = state === 'speaking' ? playbackLevel : state === 'listening' ? micLevel : 0;
  const rings = [0, 1, 2];

  return (
    <div className="flex flex-col items-center justify-center gap-6 select-none" aria-live="polite">
      <div className="relative h-64 w-64 flex items-center justify-center">
        {rings.map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border"
            style={{ borderColor: meta.color }}
            initial={false}
            animate={{
              width: 140 + i * 40 + level * 120,
              height: 140 + i * 40 + level * 120,
              opacity: state === 'idle' ? 0.15 : 0.35 - i * 0.08,
            }}
            transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          />
        ))}
        <motion.div
          className="relative z-10 flex h-32 w-32 items-center justify-center rounded-full glass shadow-glass"
          style={{ boxShadow: `0 0 60px -10px ${meta.color}66` }}
          animate={{ scale: state === 'idle' ? 1 : 1 + level * 0.15 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div style={{ color: meta.color }}>{meta.icon}</div>
        </motion.div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <span
          className="font-mono text-xs font-semibold tracking-[0.2em]"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="text-sm text-slate-400">{meta.caption}</span>
      </div>

      <WaveformBar level={level} color={meta.color} active={state === 'listening' || state === 'speaking'} />
    </div>
  );
}

function WaveformBar({ level, color, active }: { level: number; color: string; active: boolean }) {
  const bars = Array.from({ length: 24 });
  return (
    <div className="flex h-10 items-end gap-[3px]" role="img" aria-label="Audio level meter">
      {bars.map((_, i) => {
        const base = active ? Math.max(0.08, Math.sin(i * 0.7) * 0.3 + level * (0.6 + Math.random() * 0.6)) : 0.06;
        return (
          <motion.div
            key={i}
            className="w-[3px] rounded-full"
            style={{ backgroundColor: color }}
            animate={{ height: Math.min(40, 4 + base * 40) }}
            transition={{ duration: 0.12 }}
          />
        );
      })}
    </div>
  );
}
