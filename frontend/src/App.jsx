import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';
import { ENABLE_VISUAL_TRANSITIONS, getPageTransitionDirection } from './motion/visualTransitions';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
installWorkingAuto();

const DASHBOARD_SURFACE = '#main-scroll-container > div.p-4';

/**
 * One owner for dashboard page motion.
 * A CSS class drives the complete entrance; it never competes with a second
 * Framer Motion transform animation on the same surface.
 */
const pageTransitionHandlers = new WeakMap();

function readActiveNavigationIndex() {
  // Read the existing navigation state only. The sidebar DOM and behavior are untouched.
  const items = Array.from(document.querySelectorAll('.nav-shell .nav-item'));
  const activeItem = document.querySelector('.nav-shell .nav-item.is-active');
  return activeItem ? items.indexOf(activeItem) : -1;
}

function triggerPageTransition(surface, direction = 1) {
  if (!surface) return;
  const previousHandler = pageTransitionHandlers.get(surface);
  if (previousHandler) surface.removeEventListener('animationend', previousHandler);

  // Positive direction enters from below (scrolling down); negative enters from above.
  surface.style.setProperty('--eoc-page-enter-y', direction < 0 ? '-28px' : '28px');
  surface.classList.remove('eoc-page-transitioning');
  // Restart the single CSS animation at the actual navigation boundary.
  void surface.offsetWidth;
  surface.classList.add('eoc-page-transitioning');

  const finish = (event) => {
    // animationend bubbles from page descendants; only the surface animation owns cleanup.
    if (event.target !== surface || event.animationName !== 'eoc-page-scroll-arrive') return;
    surface.classList.remove('eoc-page-transitioning');
    surface.style.removeProperty('--eoc-page-enter-y');
    surface.removeEventListener('animationend', finish);
    pageTransitionHandlers.delete(surface);
  };
  pageTransitionHandlers.set(surface, finish);
  surface.addEventListener('animationend', finish);
}

/**
 * Keep route fallback and in-dashboard page changes on the same single
 * compositor animation. Native View Transitions own route snapshots when
 * available; the fallback is skipped while that API is active.
 */
function VisualTransitionFallback() {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  useLayoutEffect(() => {
    const changed = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (!ENABLE_VISUAL_TRANSITIONS || !changed || location.pathname !== '/dashboard') return undefined;

    if (document.documentElement.dataset.eocViewTransition) return undefined;
    triggerPageTransition(document.querySelector(DASHBOARD_SURFACE));
    return undefined;
  }, [location.pathname]);

  useEffect(() => {
    if (!ENABLE_VISUAL_TRANSITIONS || location.pathname !== '/dashboard') return undefined;

    const pageTitle = document.querySelector('#main-scroll-container > header h1');
    if (!pageTitle) return undefined;

    // The heading text can change after the route snapshot or when language changes.
    // Only a real active-sidebar-index change is a dashboard navigation event.
    let activeNavigationIndex = readActiveNavigationIndex();
    let titleFrame = 0;

    const observer = new MutationObserver(() => {
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
      titleFrame = window.requestAnimationFrame(() => {
        titleFrame = 0;
        const nextNavigationIndex = readActiveNavigationIndex();
        const direction = getPageTransitionDirection(activeNavigationIndex, nextNavigationIndex);
        activeNavigationIndex = nextNavigationIndex;

        // Ignore initial mount / unavailable indices / title-only changes. Also leave
        // the route morph entirely to the native View Transition when it is active.
        if (direction === 0 || document.documentElement.dataset.eocViewTransition) return;
        triggerPageTransition(document.querySelector(DASHBOARD_SURFACE), direction);
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
