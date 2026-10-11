import { flushSync } from 'react-dom';

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
    !enabled
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
    transition.finished.then(clearMarker, clearMarker);
    return transition;
  } catch (error) {
    clearMarker();
    // Fall back only when the browser rejected the transition before running
    // the callback. Never run the same navigation/state update twice.
    if (!updateStarted) {
      update();
      return undefined;
    }
    throw error;
  }
}
