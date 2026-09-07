import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Hero } from './components/Hero';
import { VoiceWorkspace } from './components/VoiceWorkspace';
import { StressTestPanel } from './components/StressTestPanel';
import { useVoiceSession } from './hooks/useVoiceSession';

type View = 'landing' | 'workspace' | 'stress';

export default function App() {
  const [view, setView] = useState<View>('landing');
  const session = useVoiceSession();

  const goWorkspace = async () => {
    setView('workspace');
    await session.startSession();
  };

  const goStress = () => {
    setView('stress');
    session.connect();
  };

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent-500 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <main id="main">
        <AnimatePresence mode="wait">
          {view === 'landing' && (
            <motion.div key="landing" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <Hero onStart={goWorkspace} onRunTest={goStress} rimeActive={session.connected} />
            </motion.div>
          )}
          {view === 'workspace' && (
            <motion.div
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              <VoiceWorkspace
                session={session}
                onBack={() => {
                  session.endSession();
                  setView('landing');
                }}
              />
            </motion.div>
          )}
          {view === 'stress' && (
            <motion.div
              key="stress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              <StressTestPanel session={session} onBack={() => setView('landing')} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
