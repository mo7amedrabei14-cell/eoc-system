import { useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { animate, MotionConfig, useReducedMotion } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
installWorkingAuto();

const DASHBOARD_SURFACE = '#main-scroll-container > div.p-4';

function animateSurface(surface, animationRef) {
  if (!surface) return;
  const computed = window.getComputedStyle(surface);
  const currentTransform = computed.transform;
  const isAtRest = currentTransform === 'none';
  const opacity = Number.parseFloat(computed.opacity);
  const startOpacity = isAtRest ? 0.68 : (Number.isFinite(opacity) ? opacity : 0.82);
  const startTransform = isAtRest
    ? 'translate3d(0px, 12px, 0px) scale(0.992)'
    : currentTransform;

  // Interrupt the previous animation from its current visual frame: rapid
  // tab clicks won't stack animations or jump back to a hard-coded start pose.
  animationRef.current?.stop();
  animationRef.current = animate(
    surface,
    {
      opacity: [startOpacity, 1],
      transform: [startTransform, 'translate3d(0px, 0px, 0px) scale(1)'],
    },
    { duration: 0.34, ease: [0.2, 0, 0, 1] },
  );
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
    if (!changed || reduceMotion) return undefined;

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
    if (location.pathname !== '/dashboard' || reduceMotion) return undefined;

    const readActivePage = () => document.querySelector('.nav-item.is-active');
    let activePage = readActivePage();
    const observedItems = Array.from(document.querySelectorAll('.nav-item'));

    const observer = new MutationObserver(() => {
      const nextPage = readActivePage();
      if (!nextPage || nextPage === activePage) return;
      activePage = nextPage;

      // A route transition or login never causes this tab-only entrance.
      if (document.documentElement.dataset.eocViewTransition) return;
      animateSurface(document.querySelector(DASHBOARD_SURFACE), tabAnimationRef);
    });

    observedItems.forEach((item) => {
      observer.observe(item, { attributes: true, attributeFilter: ['class'] });
    });

    return () => {
      observer.disconnect();
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
