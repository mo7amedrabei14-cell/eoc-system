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
 * One owner for dashboard page motion.
 * A CSS class drives the complete entrance; it never competes with a second
 * Framer Motion transform animation on the same surface.
 */
const pageTransitionHandlers = new WeakMap();

function triggerPageTransition(surface) {
  if (!surface) return;
  const previousHandler = pageTransitionHandlers.get(surface);
  if (previousHandler) surface.removeEventListener('animationend', previousHandler);

  surface.classList.remove('eoc-page-transitioning');
  // Restart the single CSS animation at the actual navigation boundary.
  void surface.offsetWidth;
  surface.classList.add('eoc-page-transitioning');

  const finish = () => {
    surface.classList.remove('eoc-page-transitioning');
    surface.removeEventListener('animationend', finish);
    pageTransitionHandlers.delete(surface);
  };
  pageTransitionHandlers.set(surface, finish);
  surface.addEventListener('animationend', finish, { once: true });
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
    if (!ENABLE_VISUAL_TRANSITIONS || !changed) return undefined;

    if (document.documentElement.dataset.eocViewTransition) return undefined;
    triggerPageTransition(
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
    let titleFrame = 0;

    const observer = new MutationObserver(() => {
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
      titleFrame = window.requestAnimationFrame(() => {
        titleFrame = 0;
        const nextPage = readActivePage();
        if (nextPage === activePage) return;
        activePage = nextPage;

        // The browser snapshot owns any route transition; this is tab-only.
        if (document.documentElement.dataset.eocViewTransition) return;
        triggerPageTransition(document.querySelector(DASHBOARD_SURFACE));
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
