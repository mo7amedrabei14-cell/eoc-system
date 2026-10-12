import { flushSync } from 'react-dom';

// One-line rollback switch: set false to disable all transitions from this pass.
export const ENABLE_VISUAL_TRANSITIONS = true;

let transitionSequence = 0;

/**
 * Dashboard motion is a response to a real sidebar selection, not to a heading
 * text mutation, initial mount, language change, or an unavailable nav snapshot.
 */
export function getPageTransitionDirection(previousIndex, nextIndex) {
  if (
    !Number.isInteger(previousIndex)
    || !Number.isInteger(nextIndex)
    || previousIndex < 0
    || nextIndex < 0
    || previousIndex === nextIndex
  ) return 0;

  return nextIndex > previousIndex ? 1 : -1;
}

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
  // A newer native transition supersedes any queued CSS fallback from an older one.
  delete root.dataset.eocViewTransitionFallback;
  root.dataset.eocViewTransition = token;
  let updateStarted = false;
  let updateCompleted = false;

  const clearMarker = () => {
    if (root.dataset.eocViewTransition === token) {
      delete root.dataset.eocViewTransition;
    }
  };

  const signalRouteFallback = () => {
    if (root.dataset.eocViewTransition !== token) return;
    root.dataset.eocViewTransitionFallback = token;
    clearMarker();

    // Let React finish the current commit first. App.jsx consumes the token either
    // during its route layout effect or from this event; a consumed token cannot
    // play the fallback twice.
    const notify = () => {
      if (root.dataset.eocViewTransitionFallback !== token) return;
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('eoc:route-transition-fallback', { detail: { token } }));
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(notify);
    } else {
      setTimeout(notify, 0);
    }
  };

  try {
    const transition = document.startViewTransition(() => {
      updateStarted = true;
      flushSync(() => update());
      updateCompleted = true;
    });
    transition.finished.then(
      clearMarker,
      // A native transition can be skipped during rapid route changes. If this
      // transition still owns the marker, use CSS instead of silently losing motion.
      signalRouteFallback,
    );
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
      signalRouteFallback();
      return undefined;
    }

    clearMarker();
    throw error;
  }
}
