import { flushSync } from 'react-dom';

// One-line rollback switch for the shared full-page transition.
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
  const appDirectionRoot = document.querySelector(
    '#root [dir="rtl"], #root [dir="ltr"], body[dir="rtl], body[dir="ltr"]',
  );
  const direction = loginRoot?.getAttribute('dir')
    || appDirectionRoot?.getAttribute('dir')
    || document.documentElement.getAttribute('dir')
    || document.body?.getAttribute('dir')
    || 'ltr';
  return direction === 'rtl' ? 'rtl' : 'ltr';
};

/**
 * Keep the curtain in the foreground while the destination renders underneath.
 * Update the route immediately, then move the same curtain across the new screen
 * in one uninterrupted sweep. Login and logout use mirrored starting edges.
 */
export function runVisualTransition(update, { enabled = true, mode = 'enter' } = {}) {
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

  const isRtl = getWipeDirection() === 'rtl';
  // Enter from the leading edge; logout enters from the opposite edge.
  const entersFromRight = (mode === 'enter') === isRtl;
  const startX = entersFromRight ? '100vw' : '-100vw';
  const finishX = entersFromRight ? '-100vw' : '100vw';
  const canAnimate = typeof Element !== 'undefined'
    && typeof Element.prototype.animate === 'function';

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
  curtain.dataset.direction = isRtl ? 'rtl' : 'ltr';
  curtain.dataset.mode = mode === 'exit' ? 'exit' : 'enter';
  curtain.style.transform = 'translate3d(' + startX + ', 0, 0)';
  document.body.appendChild(curtain);

  let updateStarted = false;
  const finished = (async () => {
    try {
      // Render the destination immediately behind the foreground curtain.
      // flushSync prevents React from deferring the route change until the wipe ends.
      updateStarted = true;
      flushSync(() => update());

      // One uninterrupted sweep: the app is already active behind the curtain
      // while it crosses the viewport. No cover/reveal pause or second motion.
      const wipeMotion = curtain.animate(
        [
          { transform: 'translate3d(' + startX + ', 0, 0)' },
          { transform: 'translate3d(' + finishX + ', 0, 0)' },
        ],
        {
          duration: 1800,
          easing: 'cubic-bezier(.76, 0, .24, 1)',
          fill: 'forwards',
        },
      );

      await wipeMotion.finished;
    } catch (error) {
      // Never leave the interface covered if animation is interrupted.
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
