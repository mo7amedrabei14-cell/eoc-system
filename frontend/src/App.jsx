import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';
import { ENABLE_VISUAL_TRANSITIONS } from './motion/visualTransitions';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
installWorkingAuto();

const DASHBOARD_SURFACE = '#main-scroll-container > div.p-4';

/**
 * One motion owner for route and dashboard view changes.
 * The surface animation is created and cancelled through one Web Animations
 * handle so repeated navigation cannot stack competing entrance animations.
 */
const pageTransitionAnimations = new WeakMap();

function readActiveNavigationIndex() {
  // Read the existing active navigation item only; do not change sidebar behavior.
  const items = Array.from(document.querySelectorAll('.nav-shell .nav-item'));
  const activeItem = document.querySelector('.nav-shell .nav-item.is-active');
  return activeItem ? items.indexOf(activeItem) : -1;
}

/**
 * Single motion owner for route and in-dashboard view changes.
 * Web Animations API runs one compositor animation on the arriving surface;
 * no CSS keyframes or native View Transition snapshots compete with it.
 */
function triggerAutoScrollTransition(surface, direction = 1) {
  if (!surface || typeof surface.animate !== 'function') return;

  const previous = pageTransitionAnimations.get(surface);
  if (previous) previous.cancel();

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const offset = direction < 0 ? -34 : 34;
  const animation = surface.animate(
    [
      { transform: `translate3d(0, ${offset}px, 0)` },
      { transform: 'translate3d(0, 0, 0)' },
    ],
    {
      duration: 460,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'none',
    },
  );

  pageTransitionAnimations.set(surface, animation);
  const clear = () => {
    if (pageTransitionAnimations.get(surface) === animation) {
      pageTransitionAnimations.delete(surface);
    }
  };
  animation.addEventListener('finish', clear, { once: true });
  animation.addEventListener('cancel', clear, { once: true });
}

/**
 * Route changes and sidebar-driven view changes share the same single
 * auto-scroll motion. The existing page title and navigation state are read
 * only to decide when and in which direction to animate.
 */
function VisualTransitionFallback() {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  useLayoutEffect(() => {
    const changed = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (!ENABLE_VISUAL_TRANSITIONS || !changed) return undefined;

    triggerAutoScrollTransition(
      location.pathname === '/dashboard'
        ? document.querySelector(DASHBOARD_SURFACE)
        : (
          document.querySelector('.lx.lx-phase-0 .lx-lamp-darkroom')
          || document.querySelector('.lx-deck .p-7 > .grid')
          || document.querySelector('.lx-stage-shell')
        ),
    );
    return undefined;
  }, [location.pathname]);

  useEffect(() => {
    if (!ENABLE_VISUAL_TRANSITIONS || location.pathname !== '/dashboard') return undefined;

    const pageTitle = document.querySelector('#main-scroll-container > header h1');
    if (!pageTitle) return undefined;

    const readActivePage = () => pageTitle.textContent?.trim() ?? '';
    let activePage = readActivePage();
    let activeNavigationIndex = readActiveNavigationIndex();
    let titleFrame = 0;

    const observer = new MutationObserver(() => {
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
      titleFrame = window.requestAnimationFrame(() => {
        titleFrame = 0;
        const nextPage = readActivePage();
        if (nextPage === activePage) return;
        activePage = nextPage;

        const nextNavigationIndex = readActiveNavigationIndex();
        const direction = activeNavigationIndex >= 0 && nextNavigationIndex >= 0
          && nextNavigationIndex !== activeNavigationIndex
          ? (nextNavigationIndex > activeNavigationIndex ? 1 : -1)
          : 1;
        if (nextNavigationIndex >= 0) activeNavigationIndex = nextNavigationIndex;

        triggerAutoScrollTransition(document.querySelector(DASHBOARD_SURFACE), direction);
      });
    });

    observer.observe(pageTitle, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
    };
  }, [location.pathname]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <WorkingToast />
        <CustomTooltipLayer />
        <VisualTransitionFallback />
        <Routes>
          {/* Keep the original routes and React lifecycle; no keyed route wrappers. */}
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </MotionConfig>
    </BrowserRouter>
  );
}

export default App;
