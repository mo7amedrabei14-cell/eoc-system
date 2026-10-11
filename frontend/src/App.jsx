import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
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

  useEffect(() => {
    if (location.pathname !== '/dashboard') return undefined;

    let frame = 0;
    let activePage = '';
    const observers = [];
    const timers = new Set();

    // Compare the selected nav element itself, not its label; language changes
    // must never be mistaken for a page change.
    const readActivePage = () => document.querySelector('.nav-item.is-active');

    const animateCurrentPage = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // Animate only the page surface below the fixed header. The sidebar is never touched.
        const surface = document.querySelector('#main-scroll-container > div.p-4');
        if (!surface) return;

        const nodes = Array.from(surface.children).filter((node) => node instanceof HTMLElement);
        if (!nodes.length) return;

        nodes.forEach((node, index) => {
          node.classList.remove('eoc-page-arrive');
          node.style.setProperty('--eoc-page-delay', `${Math.min(index, 4) * 32}ms`);
        });
        // One shared layout read restarts the entry animation without per-node forced layouts.
        void surface.offsetWidth;
        nodes.forEach((node) => node.classList.add('eoc-page-arrive'));

        const timer = window.setTimeout(() => {
          nodes.forEach((node) => {
            node.classList.remove('eoc-page-arrive');
            node.style.removeProperty('--eoc-page-delay');
          });
          timers.delete(timer);
        }, 920);
        timers.add(timer);
      });
    };

    activePage = readActivePage();
    // Observe only nav selection state; clicks, data refreshes, filters and forms don't trigger it.
    document.querySelectorAll('.nav-item').forEach((item) => {
      const observer = new MutationObserver(() => {
        const nextPage = readActivePage();
        if (nextPage && nextPage !== activePage) {
          activePage = nextPage;
          animateCurrentPage();
        }
      });
      observer.observe(item, { attributes: true, attributeFilter: ['class'] });
      observers.push(observer);
    });

    // The first dashboard render also enters gently after authentication.
    animateCurrentPage();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observers.forEach((observer) => observer.disconnect());
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [location.pathname]);

  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence initial={false} mode="sync">
      <motion.div
        key={location.pathname}
        className="eoc-route-transition"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          {/* المسار الأساسي بيودي على صفحة الدخول */}
          <Route path="/" element={<Login />} />

          {/* مسار لوحة التحكم */}
          <Route path="/dashboard" element={<Dashboard />} />

          {/* لو اليوزر كتب أي رابط غلط، يرجعه لصفحة الدخول */}
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
      </MotionConfig>
    </BrowserRouter>
  );
}

export default App;
