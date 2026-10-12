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
const ROUTE_SURFACE_SELECTORS = {
  '/': '.lx',
  '/dashboard': '.app-shell',
};
const ROUTE_FALLBACK_CLASS = 'eoc-route-fallback-enter';
const routeFallbackHandlers = new WeakMap();

function triggerRouteFallback(surface) {
  if (!surface) return;

  const previousHandler = routeFallbackHandlers.get(surface);
  if (previousHandler) surface.removeEventListener('animationend', previousHandler);

  surface.classList.remove(ROUTE_FALLBACK_CLASS);
  // Re-start only this route shell's entrance when the native snapshot is unavailable.
  void surface.offsetWidth;
  surface.classList.add(ROUTE_FALLBACK_CLASS);

  const finish = (event) => {
    if (event.target !== surface || event.animationName !== 'eoc-route-fallback-arrive') return;
    surface.classList.remove(ROUTE_FALLBACK_CLASS);
    surface.removeEventListener('animationend', finish);
    routeFallbackHandlers.delete(surface);
  };
  routeFallbackHandlers.set(surface, finish);
  surface.addEventListener('animationend', finish);
}

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
  const latestPathRef = useRef(location.pathname);
  latestPathRef.current = location.pathname;

  // A native transition may be skipped after the route commit (for example,
  // during rapid login/logout). Recover through the same CSS path exactly once.
  useEffect(() => {
    const onRouteTransitionFallback = (event) => {
      const root = document.documentElement;
      const token = event?.detail?.token;
      if (!token || root.dataset.eocViewTransitionFallback !== token) return;

      delete root.dataset.eocViewTransitionFallback;
      const selector = ROUTE_SURFACE_SELECTORS[latestPathRef.current];
      if (selector) triggerRouteFallback(document.querySelector(selector));
    };

    window.addEventListener('eoc:route-transition-fallback', onRouteTransitionFallback);
    return () => window.removeEventListener('eoc:route-transition-fallback', onRouteTransitionFallback);
  }, []);

  useLayoutEffect(() => {
    const changed = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (!ENABLE_VISUAL_TRANSITIONS || !changed) return undefined;

    const surfaceSelector = ROUTE_SURFACE_SELECTORS[location.pathname];
    if (!surfaceSelector) return undefined;
    const root = document.documentElement;

    // A failed native snapshot after navigation has already committed must fall
    // back visually, without repeating the navigation/state callback.
    if (root.dataset.eocViewTransitionFallback) {
      delete root.dataset.eocViewTransitionFallback;
      triggerRouteFallback(document.querySelector(surfaceSelector));
      return undefined;
    }

    const nativeTransitionToken = root.dataset.eocViewTransition;
    if (nativeTransitionToken) {
      // runVisualTransition can report a native rejection after this layout effect
      // ran inside flushSync. Wait one frame, then fall back only if that exact
      // transition marked itself as rejected; successful snapshots never double-play.
      const frame = window.requestAnimationFrame(() => {
        if (root.dataset.eocViewTransitionFallback !== nativeTransitionToken) return;
        delete root.dataset.eocViewTransitionFallback;
        triggerRouteFallback(document.querySelector(surfaceSelector));
      });
      return () => window.cancelAnimationFrame(frame);
    }

    // Unsupported native View Transitions use the same single-shell visual path
    // for both login and logout.
    triggerRouteFallback(document.querySelector(surfaceSelector));
    return undefined;
  }, [location.pathname]);

  useEffect(() => {
    if (!ENABLE_VISUAL_TRANSITIONS || location.pathname !== '/dashboard') return undefined;

    const pageTitle = document.querySelector('#main-scroll-container > header h1');
    if (!pageTitle) return undefined;

    // Watch only the title and nav classes—not the full dashboard tree. A motion
    // begins only after the active nav item actually changes, regardless of which
    // React node commits first during a rapid tab click.
    const navShell = document.querySelector('.nav-shell');
    let activeNavigationIndex = readActiveNavigationIndex();
    let titleFrame = 0;

    const observer = new MutationObserver(() => {
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
      titleFrame = window.requestAnimationFrame(() => {
        titleFrame = 0;
        const nextNavigationIndex = readActiveNavigationIndex();
        const direction = getPageTransitionDirection(activeNavigationIndex, nextNavigationIndex);
        activeNavigationIndex = nextNavigationIndex;

        // Route snapshot owns login/logout motion; title-only mutations must not replay it.
        if (direction === 0 || document.documentElement.dataset.eocViewTransition) return;
        triggerPageTransition(document.querySelector(DASHBOARD_SURFACE), direction);
      });
    });
    observer.observe(pageTitle, { childList: true, subtree: true, characterData: true });
    if (navShell) {
      observer.observe(navShell, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
      });
    }

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
