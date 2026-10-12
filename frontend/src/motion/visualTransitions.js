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

const createTransitionLayer = (className) => {
  const layer = document.createElement('span');
  layer.className = className;
  layer.setAttribute('aria-hidden', 'true');
  return layer;
};

/**
 * A full-viewport, elliptical light aperture for successful login navigation.
 * The route changes behind the opaque field, then a second aperture reveals
 * the dashboard. All motion is decorative; the navigation callback runs once.
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
  const leadingX = isRtl ? '100%' : '0%';
  const trailingX = isRtl ? '0%' : '100%';
  // Logout runs the same choreography from the opposite edge.
  const entryX = mode === 'exit' ? trailingX : leadingX;
  const exitX = mode === 'exit' ? leadingX : trailingX;
  const collapsedEntry = 'ellipse(0% 136% at ' + entryX + ' 50%)';
  const expandedEntry = 'ellipse(168% 192% at ' + entryX + ' 50%)';
  const expandedExit = 'ellipse(168% 192% at ' + exitX + ' 50%)';
  const collapsedExit = 'ellipse(0% 136% at ' + exitX + ' 50%)';
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
  curtain.dataset.direction = direction;
  curtain.style.setProperty('--eoc-wipe-entry-x', entryX);
  curtain.style.setProperty('--eoc-wipe-exit-x', exitX);
  curtain.style.clipPath = collapsedEntry;

  const field = createTransitionLayer('eoc-page-clip-wipe__field');
  const orbit = createTransitionLayer('eoc-page-clip-wipe__orbit');
  const edge = createTransitionLayer('eoc-page-clip-wipe__edge');
  curtain.append(field, orbit, edge);
  document.body.appendChild(curtain);

  const edgeTravel = entryX === '0%'
    ? ['translate3d(-56vw, 0, 0)', 'translate3d(56vw, 0, 0)']
    : ['translate3d(56vw, 0, 0)', 'translate3d(-56vw, 0, 0)'];

  let updateStarted = false;
  const finished = (async () => {
    try {
      const coverMotion = curtain.animate(
        [{ clipPath: collapsedEntry }, { clipPath: expandedEntry }],
        { duration: 560, easing: 'cubic-bezier(.72, 0, .16, 1)', fill: 'forwards' },
      );
      const edgeCoverMotion = edge.animate(
        [
          { transform: edgeTravel[0], opacity: 0 },
          { transform: edgeTravel[1], opacity: 0.92, offset: 0.76 },
          { transform: edgeTravel[1], opacity: 0 },
        ],
        { duration: 560, easing: 'cubic-bezier(.52, 0, .2, 1)', fill: 'both' },
      );
      orbit.animate(
        [
          { transform: 'translate3d(-50%, -50%, 0) scale(.82)', opacity: 0.12 },
          { transform: 'translate3d(-50%, -50%, 0) scale(1)', opacity: 0.42 },
        ],
        { duration: 560, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' },
      );

      await coverMotion.finished;
      await edgeCoverMotion.finished;

      updateStarted = true;
      flushSync(() => update());

      // Paint the next route under the aperture before the reveal begins.
      await nextFrame();
      await nextFrame();

      const revealMotion = curtain.animate(
        [{ clipPath: expandedExit }, { clipPath: collapsedExit }],
        { duration: 820, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' },
      );
      const edgeRevealMotion = edge.animate(
        [
          { transform: edgeTravel[0], opacity: 0 },
          { transform: edgeTravel[1], opacity: 0.72, offset: 0.34 },
          { transform: edgeTravel[1], opacity: 0 },
        ],
        { duration: 820, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' },
      );
      orbit.animate(
        [
          { transform: 'translate3d(-50%, -50%, 0) scale(1)', opacity: 0.42 },
          { transform: 'translate3d(-50%, -50%, 0) scale(1.08)', opacity: 0 },
        ],
        { duration: 820, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' },
      );

      await revealMotion.finished;
      await edgeRevealMotion.finished;
    } catch (error) {
      // Never leave the login covered if a transition is interrupted.
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
