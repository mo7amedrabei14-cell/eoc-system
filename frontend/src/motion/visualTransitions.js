import { flushSync } from 'react-dom';

// One-line rollback switch: set false to disable all transitions from this pass.
export const ENABLE_VISUAL_TRANSITIONS = true;

let transitionSequence = 0;

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const nextFrame = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const getWipeDirection = () => {
  const loginRoot = document.querySelector('.lx[dir="rtl"], .lx[dir="ltr"]');
  const direction = loginRoot?.getAttribute('dir')
    || document.documentElement.getAttribute('dir')
    || 'ltr';
  return direction === 'rtl' ? 'rtl' : 'ltr';
};

/**
 * Change routes under one full-viewport ERC-red clip wipe.
 * The curtain covers the complete current page, the original update runs once
 * while covered, then the curtain wipes away to reveal the next page. A root
 * marker prevents the dashboard fallback from adding a second entrance motion.
 */
export function runVisualTransition(update, { enabled = true } = {}) {
  if (typeof update !== 'function') return undefined;
  if (typeof document === 'undefined') {
    update();
    return undefined;
  }

  if (!ENABLE_VISUAL_TRANSITIONS || !enabled || !document.body) {
    update();
    return undefined;
  }

  const root = document.documentElement;
  const token = String(++transitionSequence);
  root.dataset.eocViewTransition = token;

  const clearMarker = () => {
    if (root.dataset.eocViewTransition === token) {
      delete root.dataset.eocViewTransition;
    }
  };

  const finishMarkerAfterPaint = async () => {
    await nextFrame();
    await nextFrame();
    clearMarker();
  };

  const direction = getWipeDirection();
  const startClip = direction === 'rtl' ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)';
  const revealClip = direction === 'rtl' ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
  const canAnimate = typeof Element !== 'undefined'
    && typeof Element.prototype.animate === 'function';

  // Keep reduced-motion and unsupported-browser behavior immediate, and mark
  // the route swap so the app-level fallback cannot add a competing animation.
  if (prefersReducedMotion() || !canAnimate) {
    try {
      flushSync(() => update());
    } catch (error) {
      clearMarker();
      throw error;
    }
    return { finished: finishMarkerAfterPaint() };
  }

  const curtain = document.createElement('div');
  curtain.className = 'eoc-page-clip-wipe';
  curtain.setAttribute('aria-hidden', 'true');
  curtain.style.setProperty('--eoc-wipe-start', startClip);
  curtain.style.setProperty('--eoc-wipe-end', revealClip);
  curtain.style.clipPath = startClip;
  document.body.appendChild(curtain);

  let updateStarted = false;
  const finished = (async () => {
    try {
      await curtain.animate(
        [{ clipPath: startClip }, { clipPath: 'inset(0)' }],
        { duration: 440, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' },
      ).finished;

      updateStarted = true;
      flushSync(() => update());

      // Give React the next page a paint beneath the opaque curtain before
      // revealing it. No second page/card animation is started.
      await nextFrame();
      await nextFrame();

      await curtain.animate(
        [{ clipPath: 'inset(0)' }, { clipPath: revealClip }],
        { duration: 720, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' },
      ).finished;
    } catch (error) {
      // If the cover animation is unavailable or cancelled, preserve the
      // original navigation exactly once rather than leaving login stuck.
      if (!updateStarted) {
        updateStarted = true;
        flushSync(() => update());
      } else if (error?.name !== 'AbortError') {
        throw error;
      }
    } finally {
      curtain.remove();
      clearMarker();
    }
  })();

  return { finished };
}
