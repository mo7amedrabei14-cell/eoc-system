import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import ERCVectorLogo from '../ERCVectorLogo';
import './authEntryTransition.css';

const AuthEntryTransitionContext = createContext(null);
const ENTRY_START_DELAY_MS = 1000;
const DASHBOARD_COVER_HOLD_MS = 2000;
const DEFAULT_LOGIN_LOGO = '.lx-login-brand-mark .erc-vector-logo';
let authTransitionSequence = 0;

export function AuthEntryTransitionProvider({ children }) {
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState('idle');
  const [statusText, setStatusText] = useState('SECURE ACCESS · EOC');
  const [originFrame, setOriginFrame] = useState({ x: 0, y: 0, scale: 0.24 });
  const phaseRef = useRef('idle');
  const sourceModeRef = useRef('login');
  const resolveVisualRef = useRef(null);
  const startTimerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const originPathRef = useRef(location.pathname);
  const markerRef = useRef('');

  const clearTransitionMarker = useCallback(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (markerRef.current && root.dataset.eocViewTransition === markerRef.current) {
        delete root.dataset.eocViewTransition;
      }
      delete root.dataset.eocCrestMotion;
    }
    markerRef.current = '';
  }, []);

  const clearTimers = useCallback(() => {
    if (startTimerRef.current !== null) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const setTransitionPhase = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    if (typeof document !== 'undefined') {
      if (nextPhase === 'running') {
        document.documentElement.dataset.eocCrestMotion = sourceModeRef.current;
      } else if (nextPhase === 'idle') {
        delete document.documentElement.dataset.eocCrestMotion;
      }
    }
    setPhase(nextPhase);
  }, []);

  const beginEntryTransition = useCallback((message, {
    sourceSelector = DEFAULT_LOGIN_LOGO,
    sourceMode = 'login',
  } = {}) => {
    // Ignore rapid duplicate activations while one logo-led route transition owns the screen.
    if (phaseRef.current !== 'idle' || startTimerRef.current !== null) {
      return Promise.resolve({ cancelled: true });
    }
    clearTimers();
    if (resolveVisualRef.current) {
      resolveVisualRef.current({ cancelled: true });
      resolveVisualRef.current = null;
    }
    clearTransitionMarker();
    originPathRef.current = location.pathname;
    sourceModeRef.current = sourceMode === 'logout' ? 'logout' : 'login';
    setStatusText(message || 'SECURE ACCESS · EOC');

    // The travel layer starts from the exact screen position of the brand mark
    // already on the page. The SVG source is hidden only when the travel layer
    // appears, so the movement reads as that same logo leaving its original slot.
    let nextFrame = { x: 0, y: 0, scale: 0.24 };
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const source = document.querySelector(sourceSelector);
      const rect = source?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const targetWidth = Math.max(136, Math.min(192, window.innerWidth * 0.15));
        const targetHeight = targetWidth * (281 / 214);
        nextFrame = {
          x: rect.left + rect.width / 2 - window.innerWidth / 2,
          y: rect.top + rect.height / 2 - window.innerHeight / 2,
          scale: Math.max(0.06, Math.min(1, rect.height / targetHeight)),
        };
      }
    }
    setOriginFrame(nextFrame);

    // Suppress the generic route fade immediately; the travel layer owns this
    // transition. The original logo stays visible during the requested one-second wait.
    if (typeof document !== 'undefined') {
      const marker = 'auth-entry-' + String(++authTransitionSequence);
      markerRef.current = marker;
      document.documentElement.dataset.eocViewTransition = marker;
    }

    return new Promise((resolve) => {
      resolveVisualRef.current = resolve;
      if (sourceModeRef.current === 'logout') {
        // Sign-out starts immediately from the sidebar crest; only sign-in keeps the one-second pause.
        setTransitionPhase('running');
        return;
      }
      startTimerRef.current = setTimeout(() => {
        startTimerRef.current = null;
        setTransitionPhase('running');
      }, ENTRY_START_DELAY_MS);
    });
  }, [clearTransitionMarker, clearTimers, location.pathname, setTransitionPhase]);

  const completeVisualTransition = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    setTransitionPhase('holding');
    const resolve = resolveVisualRef.current;
    resolveVisualRef.current = null;
    if (resolve) resolve({ cancelled: false });
  }, [setTransitionPhase]);

  const prepareDashboardReveal = useCallback((message) => {
    setStatusText(message || 'IDENTITY VERIFIED · OPENING OPERATIONS CENTER');
  }, []);

  const cancelEntryTransition = useCallback(() => {
    clearTimers();
    const resolve = resolveVisualRef.current;
    resolveVisualRef.current = null;
    if (resolve) resolve({ cancelled: true });

    if (phaseRef.current === 'idle') {
      clearTransitionMarker();
      setPhase('idle');
      return;
    }
    setTransitionPhase('closing');
  }, [clearTimers, clearTransitionMarker, setTransitionPhase]);

  useEffect(() => {
    if (location.pathname === originPathRef.current) return;

    // Navigation is allowed only after the logo reaches its final pose. Once
    // the destination mounts, keep the logo curtain in front for two seconds
    // so dashboard initialization remains invisible to the user.
    if (phaseRef.current === 'running') {
      const resolve = resolveVisualRef.current;
      resolveVisualRef.current = null;
      if (resolve) resolve({ cancelled: true });
      setTransitionPhase('closing');
      return;
    }

    if (phaseRef.current === 'holding') {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setTransitionPhase('closing');
      }, DASHBOARD_COVER_HOLD_MS);
    }
  }, [location.pathname, phase, setTransitionPhase]);

  useEffect(() => () => {
    clearTimers();
    clearTransitionMarker();
    if (resolveVisualRef.current) {
      resolveVisualRef.current({ cancelled: true });
      resolveVisualRef.current = null;
    }
  }, [clearTimers, clearTransitionMarker]);

  const contextValue = { beginEntryTransition, cancelEntryTransition, prepareDashboardReveal };

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
          initial={{ opacity: 1, scale: 1 }}
          animate={phase === 'closing' ? { opacity: 0, scale: 1.012 } : { opacity: 1, scale: 1 }}
          transition={{ duration: phase === 'closing' ? (reducedMotion ? 0.12 : 0.34) : 0, ease: [0.16, 1, 0.3, 1] }}
          onAnimationComplete={() => {
            if (phaseRef.current === 'closing') {
              setTransitionPhase('idle');
              clearTransitionMarker();
            }
          }}
        >
          <motion.div
            className="eoc-auth-transition__backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === 'closing' ? 0 : 1 }}
            transition={{ duration: reducedMotion ? 0.08 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          />

          <div className="eoc-auth-transition__ring-stage" aria-hidden="true">
            <motion.span
              className="eoc-auth-transition__ring"
              initial={{
                opacity: 0,
                x: originFrame.x,
                y: originFrame.y,
                scale: Math.max(0.05, originFrame.scale * 0.78),
              }}
              animate={phase === 'running'
                ? {
                    opacity: [0, 0.48, 0],
                    x: [originFrame.x, 0, 0],
                    y: [originFrame.y, 0, 0],
                    scale: [Math.max(0.05, originFrame.scale * 0.78), 0.68, 2.65],
                  }
                : { opacity: 0, x: 0, y: 0, scale: 2.65 }}
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
            initial={{
              opacity: 1,
              scale: originFrame.scale,
              x: originFrame.x,
              y: originFrame.y,
              rotate: 0,
            }}
            animate={phase === 'running'
              ? {
                  opacity: [1, 1, 1],
                  scale: [originFrame.scale, 1.035, 1],
                  x: [originFrame.x, 0, 0],
                  y: [originFrame.y, -2, 0],
                  rotate: [0, 2, 0],
                }
              : phase === 'closing'
                ? { opacity: 0, scale: 1.14, x: 0, y: -8, rotate: 8 }
                : { opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
            transition={phase === 'running'
              ? {
                  duration: reducedMotion ? 0.12 : 1.32,
                  times: [0, 0.76, 1],
                  ease: [0.16, 1, 0.3, 1],
                }
              : { duration: reducedMotion ? 0.12 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => {
              if (phaseRef.current === 'running') completeVisualTransition();
            }}
          >
            <ERCVectorLogo label="Egyptian Red Crescent" />
          </motion.div>

          <div className="eoc-auth-transition__status">
            <div className="eoc-auth-transition__status-copy" dir="auto">
              <span className="eoc-auth-transition__status-dot" aria-hidden="true" />
              <span className="eoc-auth-transition__status-label">{statusText}</span>
            </div>
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
