import { flushSync } from 'react-dom';

// One-line rollback switch: set false to disable all transitions from this pass.
export const ENABLE_VISUAL_TRANSITIONS = true;

let transitionSequence = 0;

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

/**
 * Run the existing UI update inside the browser's View Transition snapshot.
 * The callback itself keeps the original state/navigation work intact; no route
 * keys, delayed mounts, or extra React page instances are introduced.
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
  let updateCompleted = false;

  const clearMarker = () => {
    if (root.dataset.eocViewTransition === token) {
      delete root.dataset.eocViewTransition;
    }
  };

  try {
    const transition = document.startViewTransition(() => {
      updateStarted = true;
      flushSync(() => update());
      updateCompleted = true;
    });
    transition.finished.then(clearMarker, clearMarker);
    return transition;
  } catch (error) {
    // A rejected start before the callback can safely use the normal CSS fallback.
    if (!updateStarted) {
      clearMarker();
      update();
      return undefined;
    }

    // If the route update completed but the browser rejected the visual snapshot,
    // tell App.jsx to run its one-layer CSS fallback. Never replay the update.
    if (updateCompleted) {
      root.dataset.eocViewTransitionFallback = token;
      clearMarker();
      return undefined;
    }

    clearMarker();
    throw error;
  }
}
