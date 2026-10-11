import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { animate, MotionConfig, useReducedMotion } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';
import { ENABLE_VISUAL_TRANSITIONS } from './motion/visualTransitions';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
installWorkingAuto();

const DASHBOARD_SURFACE = '#main-scroll-container > div.p-4';

function animateSurface(surface, animationRef) {
  if (!surface) return;
  const computed = window.getComputedStyle(surface);
  const opacity = Number.parseFloat(computed.opacity);
  let startX = 0;
  let startY = 12;
  let startScale = 0.992;

  // If a previous animation is in flight, decompose its current computed matrix
  // so the new animation continues from the visible frame instead of snapping.
  if (computed.transform !== 'none' && typeof DOMMatrixReadOnly !== 'undefined') {
    try {
      const matrix = new DOMMatrixReadOnly(computed.transform);
      startX = matrix.m41;
      startY = matrix.m42;
      startScale = Math.hypot(matrix.m11, matrix.m12) || 1;
    } catch {
      // Keep the subtle default entrance if the transform cannot be decomposed.
    }
  }

  const isAtRest = computed.transform === 'none';
  const startOpacity = isAtRest ? 0.68 : (Number.isFinite(opacity) ? opacity : 0.82);

  // Interrupt at the actual visual frame; animate transform components only.
  animationRef.current?.stop();
  const controls = animate(
    surface,
    {
      opacity: [startOpacity, 1],
      x: [startX, 0],
      y: [startY, 0],
      scale: [startScale, 1],
    },
    { duration: 0.34, ease: [0.2, 0, 0, 1] },
  );
  animationRef.current = controls;

  // Remove transient inline animation styles at rest so the content wrapper
  // does not become a permanent containing block/stacking context.
  controls.then(() => {
    if (animationRef.current !== controls) return;
    surface.style.removeProperty('transform');
    surface.style.removeProperty('opacity');
    animationRef.current = null;
  });
}

/**
 * Progressive fallback for browsers without the View Transitions API, plus
 * Motion-based tab entrances. Only the existing content wrapper is animated;
 * no page key is changed and no page component is held alive for an exit.
 */
function VisualTransitionFallback() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const previousPathRef = useRef(location.pathname);
  const routeAnimationRef = useRef(null);
  const tabAnimationRef = useRef(null);

  useLayoutEffect(() => {
    const changed = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (!ENABLE_VISUAL_TRANSITIONS || !changed || reduceMotion) return undefined;

    // The browser's native transition already owns this route change.
    if (document.documentElement.dataset.eocViewTransition) return undefined;

    const target = location.pathname === '/dashboard'
      ? document.querySelector(DASHBOARD_SURFACE)
      : (
        document.querySelector('.lx.lx-phase-0 .lx-lamp-darkroom')
        || document.querySelector('.lx-deck .p-7 > .grid')
        || document.querySelector('.lx-stage-shell')
      );

    animateSurface(target, routeAnimationRef);
    return () => routeAnimationRef.current?.stop();
  }, [location.pathname, reduceMotion]);

  useEffect(() => {
    if (!ENABLE_VISUAL_TRANSITIONS || location.pathname !== '/dashboard' || reduceMotion) return undefined;

    // Read the existing page title as a signal. The sidebar's DOM/classes are
    // not observed or modified; the title itself never receives animation.
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

        // A route transition or login never causes this tab-only entrance.
        if (document.documentElement.dataset.eocViewTransition) return;
        animateSurface(document.querySelector(DASHBOARD_SURFACE), tabAnimationRef);
      });
    });

    observer.observe(pageTitle, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (titleFrame) window.cancelAnimationFrame(titleFrame);
      tabAnimationRef.current?.stop();
      tabAnimationRef.current = null;
    };
  }, [location.pathname, reduceMotion]);

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
