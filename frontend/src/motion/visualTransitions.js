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
  const finished = (async () => {
    try {
      // First leg: the same surface glides over the outgoing screen.
      const coverMotion = curtain.animate(
        [
          { transform: 'translate3d(' + startX + ', 0, 0)' },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 620,
          easing: 'cubic-bezier(.55, 0, .15, .72)',
          fill: 'forwards',
        },
      );

      await coverMotion.finished;

      // The actual login/logout handler executes once beneath the opaque layer.
      updateStarted = true;
      update();

      // Continue the exact same surface, in the same direction, without a
      // second curtain, a direction reversal, or a separate highlight animation.
      const revealMotion = curtain.animate(
        [
          { transform: 'translate3d(0, 0, 0)' },
          { transform: 'translate3d(' + finishX + ', 0, 0)' },
        ],
        {
          duration: 620,
          easing: 'cubic-bezier(.2, .066, .55, 1)',
          fill: 'forwards',
        },
      );

      await revealMotion.finished;
    } catch (error) {
      // Never leave the interface covered if animation is interrupted.
      if (!updateStarted) {
        updateStarted = true;
        update();
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
