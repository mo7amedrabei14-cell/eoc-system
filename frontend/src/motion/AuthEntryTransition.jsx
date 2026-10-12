import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import ERCVectorLogo from '../ERCVectorLogo';
import './authEntryTransition.css';

const AuthEntryTransitionContext = createContext(null);
let authTransitionSequence = 0;

export function AuthEntryTransitionProvider({ children }) {
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState('idle');
  const [statusText, setStatusText] = useState('SECURE ACCESS · EOC');
  const resolveVisualRef = useRef(null);
  const originPathRef = useRef(location.pathname);
  const markerRef = useRef('');

  const clearTransitionMarker = useCallback(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (markerRef.current && root.dataset.eocViewTransition === markerRef.current) {
        delete root.dataset.eocViewTransition;
      }
    }
    markerRef.current = '';
  }, []);

  const beginEntryTransition = useCallback((message) => {
    if (resolveVisualRef.current) {
      resolveVisualRef.current({ cancelled: true });
      resolveVisualRef.current = null;
    }
    clearTransitionMarker();
    originPathRef.current = location.pathname;
    setStatusText(message || 'SECURE ACCESS · EOC');

    // Mark this as an app-owned route transition so the existing generic route
    // fallback does not compete with the logo-led reveal.
    if (typeof document !== 'undefined') {
      const marker = 'auth-entry-' + String(++authTransitionSequence);
      markerRef.current = marker;
      document.documentElement.dataset.eocViewTransition = marker;
    }

    setPhase('running');
    return new Promise((resolve) => {
      resolveVisualRef.current = resolve;
    });
  }, [clearTransitionMarker, location.pathname]);

  const completeVisualTransition = useCallback(() => {
    setPhase((current) => (current === 'running' ? 'holding' : current));
    const resolve = resolveVisualRef.current;
    resolveVisualRef.current = null;
    if (resolve) resolve({ cancelled: false });
  }, []);

  const cancelEntryTransition = useCallback(() => {
    const resolve = resolveVisualRef.current;
    resolveVisualRef.current = null;
    if (resolve) resolve({ cancelled: true });
    setPhase((current) => (current === 'idle' ? 'idle' : 'closing'));
  }, []);

  useEffect(() => {
    if (
      (phase === 'running' || phase === 'holding')
      && location.pathname !== originPathRef.current
    ) {
      const resolve = resolveVisualRef.current;
      resolveVisualRef.current = null;
      if (resolve) resolve({ cancelled: true });
      setPhase('closing');
    }
  }, [location.pathname, phase]);

  useEffect(() => () => {
    clearTransitionMarker();
    if (resolveVisualRef.current) {
      resolveVisualRef.current({ cancelled: true });
      resolveVisualRef.current = null;
    }
  }, [clearTransitionMarker]);

  const contextValue = { beginEntryTransition, cancelEntryTransition };

  return (
    <AuthEntryTransitionContext.Provider value={contextValue}>
      {children}
      {phase !== 'idle' && (
        <motion.div
          className="eoc-auth-transition"
          data-phase={phase}
          role="status"
          aria-live="polite"
          aria-busy="true"
          initial={{ opacity: 0, scale: 1.012 }}
          animate={phase === 'closing'
            ? { opacity: 0, scale: 1.018 }
            : { opacity: 1, scale: 1 }}
          transition={phase === 'closing'
            ? { duration: reducedMotion ? 0.12 : 0.34, ease: [0.16, 1, 0.3, 1] }
            : { duration: reducedMotion ? 0.08 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          onAnimationComplete={() => {
            if (phase === 'closing') {
              clearTransitionMarker();
              setPhase('idle');
            }
          }}
        >
          <div className="eoc-auth-transition__backdrop" aria-hidden="true" />

          <div className="eoc-auth-transition__ring-stage" aria-hidden="true">
            <motion.span
              className="eoc-auth-transition__ring"
              initial={{ opacity: 0, scale: 0.18 }}
              animate={phase === 'running'
                ? { opacity: [0, 0.48, 0], scale: [0.18, 0.68, 2.65] }
                : { opacity: 0, scale: 2.65 }}
              transition={phase === 'running'
                ? {
                    duration: reducedMotion ? 0.12 : 1.26,
                    times: [0, 0.22, 1],
                    ease: [0.16, 1, 0.3, 1],
                  }
                : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>

          <motion.div
            className="eoc-auth-transition__logo"
            initial={{ opacity: 0, scale: 0.24, rotate: -18, y: 16 }}
            animate={phase === 'running'
              ? {
                  opacity: [0, 1, 1],
                  scale: [0.24, 1.055, 1],
                  rotate: [-18, 4, 0],
                  y: [16, -2, 0],
                }
              : phase === 'closing'
                ? { opacity: 0, scale: 1.18, rotate: 8, y: -8 }
                : { opacity: 1, scale: 1, rotate: 0, y: 0 }}
            transition={phase === 'running'
              ? {
                  duration: reducedMotion ? 0.12 : 1.32,
                  times: [0, 0.76, 1],
                  ease: [0.16, 1, 0.3, 1],
                }
              : { duration: reducedMotion ? 0.12 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => {
              if (phase === 'running') completeVisualTransition();
            }}
          >
            <ERCVectorLogo label="Egyptian Red Crescent" />
          </motion.div>

          <div className="eoc-auth-transition__status">
            <span className="eoc-auth-transition__status-label">{statusText}</span>
            <span className="eoc-auth-transition__status-dot" aria-hidden="true" />
            <span className="eoc-auth-transition__progress" aria-hidden="true">
              <span />
            </span>
          </div>
        </motion.div>
      )}
    </AuthEntryTransitionContext.Provider>
  );
}

export function useAuthEntryTransition() {
  const context = useContext(AuthEntryTransitionContext);
  if (!context) {
    throw new Error('useAuthEntryTransition must be used inside AuthEntryTransitionProvider.');
  }
  return context;
}
