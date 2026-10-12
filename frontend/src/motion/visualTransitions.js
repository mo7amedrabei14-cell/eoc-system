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
    '#root [dir="rtl"], #root [dir="ltr"], body[dir="rtl"], body[dir="ltr"]',
  );
  const direction = loginRoot?.getAttribute('dir')
    || appDirectionRoot?.getAttribute('dir')
    || document.documentElement.getAttribute('dir')
    || document.body?.getAttribute('dir')
    || 'ltr';
  return direction === 'rtl' ? 'rtl' : 'ltr';
};

/**
 * Move one opaque, full-screen surface through the viewport in a single
 * direction. The existing route/action is executed only when the old screen
 * is completely covered; the same surface then continues off-screen to reveal
 * the destination. Login and logout use mirrored starting edges.
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
      update();
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
  let updateError = null;
  let midpointTimer = null;

  const runUpdateOnce = () => {
    if (updateStarted) return;
    updateStarted = true;
    try {
      // React Router/state updates run normally behind the body-level curtain.
      // Avoid forcing a synchronous React commit from inside the animation.
      update();
    } catch (error) {
      updateError = error;
    }
  };

  const finished = (async () => {
    try {
      // One uninterrupted compositor animation: cover, pass the covered
      // midpoint, and reveal. The tiny midpoint hold gives the background
      // route/state update time to begin without splitting the motion in two.
      const wipeDuration = 1800;
      const midpoint = wipeDuration / 2;
      const wipeMotion = curtain.animate(
        [
          { transform: 'translate3d(' + startX + ', 0, 0)', offset: 0 },
          { transform: 'translate3d(0, 0, 0)', offset: 0.49 },
          { transform: 'translate3d(0, 0, 0)', offset: 0.51 },
          { transform: 'translate3d(' + finishX + ', 0, 0)', offset: 1 },
        ],
        {
          duration: wipeDuration,
          easing: 'linear',
          fill: 'forwards',
        },
      );

      // The callback is not tied to Animation.currentTime (which can be null
      // during startup). The curtain is fully opaque at this point.
      midpointTimer = window.setTimeout(runUpdateOnce, midpoint);

      try {
        await wipeMotion.finished;
      } catch (error) {
        // A cancelled animation must never strand the user on the old route.
        if (error?.name !== 'AbortError') throw error;
      }

      // Safety net for throttled timers or an interrupted animation.
      runUpdateOnce();
      if (updateError) throw updateError;
    } catch (error) {
      runUpdateOnce();
      if (updateError) throw updateError;
      if (error?.name !== 'AbortError') throw error;
    } finally {
      if (midpointTimer !== null) window.clearTimeout(midpointTimer);
      curtain.remove();
      clearMarker();
    }
  })();

  return { finished };
}
