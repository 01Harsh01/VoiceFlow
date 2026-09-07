import { motion } from 'framer-motion';
import { Mic, FlaskConical } from 'lucide-react';

export function Hero({
  onStart,
  onRunTest,
  rimeActive,
}: {
  onStart: () => void;
  onRunTest: () => void;
  rimeActive: boolean;
}) {
  return (
    <section className="mx-auto flex min-h-[85vh] max-w-4xl flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-6 flex items-center gap-2 rounded-full border border-base-700 bg-base-900/60 px-3 py-1.5 font-mono text-xs text-slate-400"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${rimeActive ? 'bg-emerald-400 animate-pulseSlow' : 'bg-slate-600'}`}
        />
        ● Rime Voice Active
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="text-balance text-4xl font-bold tracking-tight text-slate-50 sm:text-6xl"
      >
        Talk. Interrupt.
        <br />
        Change your mind.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="mt-5 max-w-xl text-balance text-base text-slate-400 sm:text-lg"
      >
        A voice assistant built for real conversations, where changing your mind doesn't break the
        conversation.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="mt-9 flex flex-wrap items-center justify-center gap-3"
      >
        <button
          onClick={onStart}
          className="focus-ring flex items-center gap-2 rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-400 active:scale-[0.98]"
        >
          <Mic size={16} /> Start Voice Session
        </button>
        <button
          onClick={onRunTest}
          className="focus-ring flex items-center gap-2 rounded-full border border-base-600 bg-base-900/60 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-base-500 hover:bg-base-800 active:scale-[0.98]"
        >
          <FlaskConical size={16} /> Run Interruption Test
        </button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mt-10 max-w-lg text-xs text-slate-600"
      >
        Built for the Rime Hackathon — DataForge Rime Challenge. The hard problem here isn't
        speech-to-text-to-LLM-to-speech; it's what happens the instant you interrupt.
      </motion.p>
    </section>
  );
}
