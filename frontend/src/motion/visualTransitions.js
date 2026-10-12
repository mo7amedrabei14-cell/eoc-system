import { flushSync } from 'react-dom';

// One-line rollback switch: set false to disable all transitions from this pass.
export const ENABLE_VISUAL_TRANSITIONS = true;

let transitionSequence = 0;

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

function scheduleFallback(root, token) {
  if (root.dataset.eocViewTransition !== token) return;
  delete root.dataset.eocViewTransition;

  const notify = () => {
    // A newer transition may have started before this fallback frame.
    if (root.dataset.eocViewTransition) return;
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('eoc:route-transition-fallback'));
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(notify);
  } else {
    Promise.resolve().then(notify);
  }
}

/**
 * Run an existing route/state update inside the native View Transition API.
 * The update runs exactly once; a rejected/cancelled visual transition signals
 * a single CSS fallback rather than attempting the navigation a second time.
 */
export function runVisualTransition(update, { enabled = true } = {}) {
  if (typeof update !== 'function') return undefined;

  if (
    !ENABLE_VISUAL_TRANSITIONS
    || !enabled
    || typeof document === 'undefined'
    || typeof document.startViewTransition !== 'function'
    || prefersReducedMotion()
  ) {
    update();
    return undefined;
  }

  const root = document.documentElement;
  const token = String(++transitionSequence);
  root.dataset.eocViewTransition = token;
  let updateStarted = false;

  const clearMarker = () => {
    if (root.dataset.eocViewTransition === token) {
      delete root.dataset.eocViewTransition;
    }
  };

  try {
    const transition = document.startViewTransition(() => {
      updateStarted = true;
      flushSync(() => update());
    });
    transition.finished.then(clearMarker, () => scheduleFallback(root, token));
    return transition;
  } catch (error) {
    if (!updateStarted) {
      clearMarker();
      update();
      return undefined;
    }
    scheduleFallback(root, token);
    throw error;
  }
}
