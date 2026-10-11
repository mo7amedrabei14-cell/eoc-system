import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { animate, AnimatePresence, MotionConfig, motion, useAnimate, useReducedMotion } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';
import './motion/premiumPageTransitions.css';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
//    أي fetch في النظام (تحميل بيانات أو ضغطة زر) يُظهرها حتى ينتهي.
installWorkingAuto();

function DashboardPageMotion() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const activePageRef = useRef(null);
  const pageAnimationRef = useRef(null);

  useEffect(() => {
    if (location.pathname !== '/dashboard') return undefined;

    const readActivePage = () => document.querySelector('.nav-item.is-active');

    const animateCurrentPage = () => {
      const surface = document.querySelector('#main-scroll-container > div.p-4');
      if (!surface || reduceMotion) return;

      // Stop any in-flight page transition before starting the next one.
      pageAnimationRef.current?.stop();
      pageAnimationRef.current = animate(
        surface,
        {
          opacity: [0.32, 1],
          x: [30, 0],
          y: [12, 0],
          scale: [0.986, 1],
        },
        {
          duration: 0.62,
          ease: [0.22, 1, 0.36, 1],
        },
      );
    };

    // Record the currently selected page, but do not replay an entry animation
    // on mount. This avoids stacking a second intro on top of the route curtain.
    activePageRef.current = readActivePage();
    const observers = [];
    document.querySelectorAll('.nav-item').forEach((item) => {
      const observer = new MutationObserver(() => {
        const nextPage = readActivePage();
        if (nextPage && nextPage !== activePageRef.current) {
          activePageRef.current = nextPage;
          animateCurrentPage();
        }
      });
      observer.observe(item, { attributes: true, attributeFilter: ['class'] });
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
      pageAnimationRef.current?.stop();
      pageAnimationRef.current = null;
    };
  }, [location.pathname, reduceMotion]);

  return null;
}

/**
 * An original curtain-style transition inspired by Motion UI's page-transition
 * and curtains concepts. It uses the already-installed Motion runtime, not a
 * paid Motion+ component or an additional dependency.
 */
function PageRouteCurtain() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [scope, animateCurtain] = useAnimate();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return undefined;
    previousPathRef.current = location.pathname;
    if (reduceMotion || !scope.current) return undefined;

    const controls = animateCurtain(
      scope.current,
      {
        clipPath: [
          'inset(0 50% 0 50%)',
          'inset(0 0% 0 0%)',
          'inset(0 0% 0 0%)',
          'inset(0 0 0 100%)',
        ],
        opacity: [0, 1, 1, 0],
      },
      {
        duration: 0.9,
        times: [0, 0.28, 0.7, 1],
        ease: [0.22, 1, 0.36, 1],
      },
    );

    return () => controls.stop();
  }, [location.pathname, reduceMotion, animateCurtain, scope]);

  return (
    <div
      ref={scope}
      className="eoc-route-curtain"
      aria-hidden="true"
    >
      <span className="eoc-route-curtain__beam" />
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    // wait prevents Login and Dashboard from being mounted on top of each other
    // during their hand-off. The curtain supplies the visible transition.
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={location.pathname}
        className="eoc-route-transition"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <WorkingToast />
        <CustomTooltipLayer />
        <DashboardPageMotion />
        <AnimatedRoutes />
        <PageRouteCurtain />
      </MotionConfig>
    </BrowserRouter>
  );
}

export default App;
