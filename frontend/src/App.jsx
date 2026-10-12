import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';
import { ENABLE_VISUAL_TRANSITIONS, runVisualTransition } from './motion/visualTransitions';

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
 * Keep in-dashboard page changes on the existing compositor fallback.
 * Login and logout both use the full-page clip-wipe curtain, whose root
 * marker suppresses this fallback until the destination route is revealed.
 */
function VisualTransitionFallback() {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  // Capture the existing logout control before its handler navigates away.
  // Replay the same click only once the shared full-page curtain is opaque.
  useEffect(() => {
    if (!ENABLE_VISUAL_TRANSITIONS || location.pathname !== '/dashboard') return undefined;

    const root = document.documentElement;
    const logoutLabel = /(?:log\s*out|logout|sign\s*out|signout|تسجيل\s*الخروج|خروج|إنهاء\s*الجلسة|انهاء\s*الجلسة)/i;

    const handleLogoutCapture = (event) => {
      if (root.dataset.eocLogoutReplay === '1') return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const control = target.closest('button, a, [role="button"], [role="menuitem"], [data-action]');
      if (!control) return;

      const label = [
        control.innerText,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.getAttribute('data-tooltip'),
        control.getAttribute('data-action'),
        control.getAttribute('data-testid'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      if (!logoutLabel.test(label)) return;
      if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return;

      // Block repeated logout attempts while the curtain owns the transition.
      if (root.dataset.eocViewTransition) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      runVisualTransition(() => {
        if (!control.isConnected) return;
        root.dataset.eocLogoutReplay = '1';
        try {
          control.click();
        } finally {
          delete root.dataset.eocLogoutReplay;
        }
      }, { mode: 'exit' });
    };

    document.addEventListener('click', handleLogoutCapture, true);
    return () => document.removeEventListener('click', handleLogoutCapture, true);
  }, [location.pathname]);

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

        // The login clip-wipe owns route changes; this observer is tab-only.
        if (document.documentElement.dataset.eocViewTransition) return;
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
