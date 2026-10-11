import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { BASE } from './apiBase';
// 🩺 حارس السيرفر: لو السيرفر واقع، صفحة الدخول نفسها تقول الحقيقة بدل رسالة
// "تعذر الاتصال" العامة — والتلميذ يشوف تعليمات الرستر و Ctrl+Shift+R فوراً.
import { useServerHealth, ServerDownOverlay, ServerRecoveryBanner } from './serverHealth';
import { checkServerHealth } from './serverHealthCore';
// 🔇 شاشة الدخول ليها مؤشرها الخاص (سبينر الزر) — حبة العمل العامة مكتومة هنا تماماً
import { setWorkingSuppressed } from './workingToast';
import { EASE_EMPHASIZED, EASE_STANDARD, DUR, STAGGER, enterStep } from './motion/tokens';
// 🎬 نظام بصريات الدخول — ملف منفصل ببادئة lx- حتى لا يمس لوحة التحكم
import './login/loginScene.css';


/* ─────────────────────────────────────────────────────────────
   أيقونات داخلية خفيفة (SVG) بنفس لغة النظام
   ───────────────────────────────────────────────────────────── */
const UserIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const LockIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);
const EyeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);
const EyeOffIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 11-4.243-4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);
const AlertIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);
const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/* ── منحنى واحد ومدة واحدة لكل حركة (من motion/tokens) ─────────────────────
   المنحنى M3 emphasized-decelerate، والتتابع 40–60ms بين العناصر. */
const END = EASE_EMPHASIZED;
const EASE_STD = EASE_STANDARD;

const GATE_BOARD = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: DUR.mid, ease: END, staggerChildren: STAGGER.item, delayChildren: STAGGER.lead },
  },
};
const GATE_ITEM = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: enterStep() },
};
const CARD_IN = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.mid, ease: END } },
};
const CARD_CHILD = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: enterStep() },
};
const FORM_COL = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: DUR.mid, ease: END, delayChildren: STAGGER.lead, staggerChildren: STAGGER.item },
  },
};
const FORM_ITEM = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: enterStep() },
};

/* System Reduced Motion: نفس تغييرات الحالة، لكن بلا أي إزاحة أو تتابع. */
const STILL = { duration: 0.01, ease: EASE_STD };
const FADE_GROUP = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { ...STILL, staggerChildren: 0, delayChildren: 0 } },
};
const FADE_ITEM = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: STILL },
};

/* ── الختم هو عقدة واحدة تُنقل بـtransform بين البوابة والبطاقة ─────────────
   لذا يحتاج قياس مستطيلين فقط (موضع البوابة، موضع بطاقة الدخول) ثم يتحرك. */
const CREST_BASE = 64; // يطابق --lx-crest-base في loginScene.css

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [showGate, setShowGate] = useState(true);
  // 🔇 كتم الحبة في شاشة الدخول — مؤشر التحميل هنا هو سبينر زر الدخول نفسه
  useEffect(() => {
    setWorkingSuppressed(true);
    return () => setWorkingSuppressed(false);
  }, []);

  const [isMounted, setIsMounted] = useState(false);
  // 🔐 خطوة تحقق إضافية بكود 6 أرقام — تظهر فقط لحساب الأونر بعد نجاح الدخول العادي
  const [loginStage, setLoginStage] = useState('form'); // 'form' | 'verify'
  const [pendingAuthData, setPendingAuthData] = useState(null);
  const [verifyDigits, setVerifyDigits] = useState(['', '', '', '', '', '']);
  const [verifyStage, setVerifyStage] = useState('idle'); // 'idle' | 'checking' | 'success'
  const [verifyError, setVerifyError] = useState(false);
  const otpRefs = useRef([]);
  const OWNER_VERIFICATION_CODE = '301014';
  const usernameRef = useRef(null);
  // 🩺 مراقبة السيرفر الحقيقية (نبضة /api/health كل 20 ثانية)
  const serverHealth = useServerHealth();

  /* ── اللغة والثيم: نفس مفاتيح لوحة التحكم بالضبط ───────────── */
  const [language, setLanguage] = useState(() => localStorage.getItem('dashboard-language') || 'ar');
  const [theme, setTheme] = useState(() => localStorage.getItem('dashboard-theme') || 'dark');

  useEffect(() => {
    localStorage.setItem('dashboard-language', language);
    // 🎯 مزامنة الجذر الحقيقي مع اللغة (ذاتها أسلوب لوحة التحكم)
    document.documentElement.lang = language === 'en' ? 'en' : 'ar';
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
  }, [language]);

  useEffect(() => {
    localStorage.setItem('dashboard-theme', theme);
    // ⭐ الجذر الحقيقي للثيم: <html> هو اللي بيوصل الـ data-theme لقواعد :root[data-theme=...]
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const navigate = useNavigate();

  /* ── بوابة استكشاف الأطلس — محرّك متغيّرات CSS ──
     الموضع الحقيقي يعيش في ref، والرسم يتم بكتابة متغيّرين (`--lx-x`, `--lx-p`)
     على جذر البوابة في إطار واحد. CSS يشتقّ منها كل شيء: المقبض والتعبئة والنسبة.
     React يُحدَّث فقط عند *عبور عتبة* (≤ ٦ مرات لإيماءة كاملة) ⇒ استجابة 1:1 بلا
     إعادة بناء لكل إطار. */
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /* `dragProgress` هو ما يُقرأ فعلاً (aria-valuenow + شارة «مُفعّل»). */
  const [dragProgress, setDragProgress] = useState(0);
  // حالة تقريبية (عتبات فقط) للفئات: نص المرحلة وإظهار النسبة
  const [dragStage, setDragStage] = useState({ tick: 0, goal: false, label: 0, pct: false });
  const trackRef = useRef(null);
  const gateRootRef = useRef(null);
  const springRef = useRef(null);
  const posRef = useRef(0);   // الموضع الحقيقي (px) — مصدر الحقيقة أثناء الإيماءة
  const maxRef = useRef(1);   // أقصى إزاحة، مقيسة من عرض المسار
  const velRef = useRef(0);   // سرعة الإيماءة (px/s) — تُستخدم كـ throw عند الإفلات
  const lastMoveRef = useRef(0);
  const pctRef = useRef(null); // نص النسبة — يُكتب مباشرة بلا إعادة بناء
  const stageRef = useRef({ tick: 0, goal: false, label: 0, pct: false });
  const HANDLE_SIZE = 60;        // قيمة ارتداد px — تُحلَّ بحجم المقبض المرسوم فعليًا
  /* رياضة السحب تعمل بالـpx (trackRect.width) ⇒ نقيس المقبض **مرة واحدة عند
     بداية الإيماءة** ونخزّنه في ref، فلا تُجرى قراءة style لكل إطار أثناء السحب. */
  const handleSizeRef = useRef(HANDLE_SIZE);
  const handleRef = useRef(null);
  const measureHandle = () => {
    const el = handleRef.current;
    if (!el) return;
    const w = parseFloat(getComputedStyle(el).width);
    if (w > 0) handleSizeRef.current = w;
  };
  const isRTL = language === 'ar';
  const reduceMotion = useReducedMotion();

  /* ── هندسة الختم (بصريات خالصة): مستطيل البوابة مقابل مستطيل رأس البطاقة ──
     لا منطق أعمال هنا — قياسان وحركة واحدة، ودورة إعادة القياس عند أي تغيّر
     مقاس (خطأ يظهر، تبديل لغة، دوران الشاشة) حتى لا ينفصل الشعار عن بطاقته. */
  const crestLayerRef = useRef(null);
  const gateSlotRef = useRef(null);
  const cardSlotRef = useRef(null);
  const cardRef = useRef(null);
  const [crestGeo, setCrestGeo] = useState({ x: 0, y: 0, s: 1, dur: 0 });

  const measureCrest = useCallback((animate, mounted) => {
    const layer = crestLayerRef.current;
    const target = mounted ? cardSlotRef.current : gateSlotRef.current;
    if (!layer || !target) return;
    const l = layer.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    if (!t.width) return;
    setCrestGeo({
      x: Math.round((t.left + t.width / 2 - (l.left + l.width / 2)) * 10) / 10,
      y: Math.round((t.top + t.height / 2 - (l.top + l.height / 2)) * 10) / 10,
      s: Math.round((t.width / CREST_BASE) * 1000) / 1000,
      dur: animate && !reduceMotion ? DUR.rise * 1000 : 0,
    });
  }, [reduceMotion]);

  // أول قياس: بلا حركة (الصفحة تُرسم في موضعها النهائي — لا قفزة عند التحميل)
  useEffect(() => {
    const id = requestAnimationFrame(() => measureCrest(false, false));
    return () => cancelAnimationFrame(id);
  }, [measureCrest]);

  // لحظة العبور: الختم ينتقل من البوابة إلى موضعه في بطاقة الدخول (حركة واحدة)
  useEffect(() => {
    measureCrest(true, isMounted);
  }, [isMounted, measureCrest]);

  // إعادة القياس عند أي تغيّر مقاس (بدون حركة) — الشعار يبقى ملتصقًا ببطاقته
  useEffect(() => {
    const ids = [cardRef.current, gateSlotRef.current, cardSlotRef.current, crestLayerRef.current].filter(Boolean);
    if (!ids.length || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureCrest(false, isMounted));
    ids.forEach((el) => ro.observe(el));
    const onWin = () => measureCrest(false, isMounted);
    window.addEventListener('resize', onWin);
    return () => { ro.disconnect(); window.removeEventListener('resize', onWin); };
  }, [isMounted, measureCrest]);

  // Progressive enhancement around the existing successful route change.
  // Unsupported browsers and reduced-motion users retain immediate navigation.
  const navigateWithEntryTransition = useCallback((to) => {
    if (reduceMotion || typeof document.startViewTransition !== 'function') {
      navigate(to);
      return;
    }
    try {
      document.startViewTransition(() => navigate(to));
    } catch {
      navigate(to);
    }
  }, [navigate, reduceMotion]);

  // تنظيف أي rAF نابضي عند التفكيك
  useEffect(
    () => () => {
      if (springRef.current) cancelAnimationFrame(springRef.current);
    },
    [],
  );

  // ── الرسم: متغيّرا CSS على جذر البوابة ⇒ كل الحركة على الـ compositor ──
  // لا يُستدعى setState إلا عند عبور عتبة حقيقية (نص/نسبة).
  const paint = useCallback((x, maxX) => {
    const root = gateRootRef.current;
    if (!root) return;
    const m = maxX || maxRef.current || 1;
    const p = Math.max(0, Math.min(x / m, 1));
    posRef.current = x;
    root.style.setProperty('--lx-x', x.toFixed(2) + 'px');
    root.style.setProperty('--lx-p', p.toFixed(4));
    if (pctRef.current) pctRef.current.textContent = Math.round(p * 100) + '%';
    const next = {
      tick: p >= 0.92 ? 3 : p >= 0.66 ? 2 : p >= 0.33 ? 1 : 0,
      goal: p >= 0.92,
      label: p >= 0.9 ? 2 : p >= 0.55 ? 1 : 0,
      pct: p > 0.004 && p < 1,
    };
    const prev = stageRef.current;
    if (prev.tick !== next.tick || prev.goal !== next.goal || prev.label !== next.label || prev.pct !== next.pct) {
      stageRef.current = next;
      setDragStage(next);
      // تحديث الوصولية والقراءة المنطقية عند العتبات فقط (بلا ٦٠ تحديثًا/ثانية)
      setDragProgress(p);
    }
  }, []);

  const readMax = () => {
    measureHandle();
    const rect = trackRef.current && trackRef.current.getBoundingClientRect();
    return rect ? Math.max(1, rect.width - handleSizeRef.current - 8) : maxRef.current;
  };

  const completeUnlock = () => {
    if (springRef.current) { cancelAnimationFrame(springRef.current); springRef.current = null; }
    const maxX = readMax();
    setIsDragging(false);
    setIsUnlocking(true);
    setDragProgress(1);
    paint(maxX, maxX);
    if (navigator.vibrate) try { navigator.vibrate([10, 30, 20]); } catch { /* وضع الاهتزاز غير مدعوم */ }
    setTimeout(() => setIsMounted(true), 200);   // بطاقة الدخول تبدأ بالظهور
    setTimeout(() => setShowGate(false), 620);   // البوابة تُزال من الـ DOM بعد اكتمال الحركة
  };

  // انتقال قصير لأي حركة غير السحب (لوحة المفاتيح / الإكمال):
  // منحنى واحد نظيف = تسارع فوري + هبوط مضبوط بلا ارتداد وبلا ذيل بطيء.
  const glideTo = (to, maxX) => {
    if (springRef.current) { cancelAnimationFrame(springRef.current); springRef.current = null; }
    const from = posRef.current;
    const dist = Math.abs(to - from);
    if (dist < 0.5) { paint(to, maxX); return; }
    const dur = Math.max(110, Math.min(230, 96 + dist * 0.3));
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min((now - t0) / dur, 1);
      const e = 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t);   // easeOutQuart
      paint(from + (to - from) * e, maxX);
      if (t < 1) springRef.current = requestAnimationFrame(step);
      else springRef.current = null;
    };
    springRef.current = requestAnimationFrame(step);
  };

  const handlePointerDown = (e) => {
    /* 🛡️ التحصين: `setPointerCapture` يرمي `NotFoundError` إذا لم يعد للمؤشر
       id فعّال (نقرة سريعة يسبق فيها pointerup معالج pointerdown، أو قلم/لمس
       متعدّد، أو Safari على iOS). ولأنه كان **أول سطر** في هذا المعالج، فإن
       رميه كان يُجهض باقي الدالة ⇒ `setIsDragging(true)` لا يُنفّذ أبدًا ⇒
       البوابة تصير ميتة ولا يمكن الدخول إطلاقًا.
       الأثر: عند النجاح لا يتغير أي سلوك؛ وعند الفشل تبقى الإيماءة تعمل عبر
       `onPointerMove` الموجود أصلًا — تدهور لطيف بدل بوابة معطّلة. */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* لا التقاط — الالتقاط ليس شرطًا لبدء السحب */
    }
    if (springRef.current) { cancelAnimationFrame(springRef.current); springRef.current = null; }
    measureHandle();          // قياس واحد يسبق السحب — لا قراءة style داخل الحركة
    velRef.current = 0;
    lastMoveRef.current = performance.now();
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const maxX = Math.max(1, trackRect.width - handleSizeRef.current - 8);
    maxRef.current = maxX;
    // 🎯 تتبّع 1:1 — لا تصفية ولا «مغناطيسية»: ما يلمسه الإصبع هو ما يُرسم في
    // نفس الإطار. (اللمسة المغناطيسية القديمة كانت تضيف لاجًا محسوسًا).
    const fromStart = e.clientX - trackRect.left;
    const x = Math.max(0, Math.min(fromStart - handleSizeRef.current / 2, maxX));
    // سرعة الإيماءة (px/s) مع تنعيم بسيط ⇒ تُستخدم كـ «throw» عند الإفلات،
    // فيكمل المقبض حركته بنفس زخم الإصبع بدل أن يتجاهله.
    const now = performance.now();
    const dt = Math.max(now - lastMoveRef.current, 1);
    const inst = ((x - posRef.current) / dt) * 1000;
    velRef.current = velRef.current * 0.65 + inst * 0.35;
    lastMoveRef.current = now;
    paint(x, maxX);
    if (x >= maxX * 0.92) completeUnlock();
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const maxX = readMax();
    const x = posRef.current;
    if (x >= maxX * 0.92) { /* اكتمل داخل move */ return; }
    // ⭐ العودة: *الحل التحليلي الدقيق* لنابض حرج التخميد (ζ = 1).
    //    x(t) = (x₀ + (v₀ + ω·x₀)·t) · e^(−ω·t)
    //    لماذا تحليليًّا وليس تكاملًا رقميًّا؟ لأن تكامل أويلر المباشر ينفجر
    //    عدديًّا حين يكبر الخط الزمني (إطار مسقوط ⇒ dt = 1/30 ⇒ c·dt > 1
    //    فينقلب اتجاه السرعة). الحل التحليلي مستقل تمامًا عن معدّل الإطارات
    //    ومستقر دائمًا، ويعطي زخم الإفلات طبيعيًّا.
    const w = 38;                    // ω: استقرار محسوس خلال ~150ms
    const x0 = Math.max(0, Math.min(x, maxX));
    const v0 = Math.max(-6000, Math.min(velRef.current, 6000));
    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / 1000;
      const pos = (x0 + (v0 + w * x0) * t) * Math.exp(-w * t);
      if (pos <= 0.5) {
        springRef.current = null;
        paint(0, maxX);
        setDragProgress(0);
        return;
      }
      paint(pos, maxX);
      springRef.current = requestAnimationFrame(step);
    };
    springRef.current = requestAnimationFrame(step);
  };

  // 🎯 بعد فتح البوابة، امنح لوحة المفاتيح التركيز فورًا على حقل المستخدم
  // (لا يحتاج المستخدم أن ينقر — الوصول يكون مباشرًا بعد السحب)
  useEffect(() => {
    if (!showGate && usernameRef.current) {
      const t = setTimeout(() => usernameRef.current.focus(), 360);
      return () => clearTimeout(t);
    }
  }, [showGate]);

  // إتاحة كاملة للوحة المفاتيح (تقدم/تراجع حسب الاتجاه + Enter عند الاقتراب من النهاية)
  const handleKnobKey = (e) => {
    if (!trackRef.current || isUnlocking) return;
    /* 🛡️ لو انقطع pointerup (نقرة سريعة يسبق فيها pointerup معالج pointerdown،
       لمس متعدد، أو تبديل نافذة) تبقى البوابة «عالقة في السحب» فيُعطَّل مفتاح
       لوحة المفاتيح بالكامل. مفتاح من لوحة المفاتيح يعني أن الإصبع رُفع ⇒
       نُنهي أي سحب قديم ثم نكمل بنفس المنطق تمامًا (لا تغيير في الدلالات). */
    if (isDragging) setIsDragging(false);
    measureHandle();
    const trackRect = trackRef.current.getBoundingClientRect();
    const maxX = Math.max(1, trackRect.width - handleSizeRef.current - 8);
    // لوحة المفاتيح تتبع نفس الاتجاه: السهم الأيمن للتقدم.
    const isFwd = e.key === 'ArrowRight';
    const isBack = e.key === 'ArrowLeft';
    // العتبة تُقرأ من الموضع الحقيقي (posRef) لا من الحالة التقريبية ⇒ نفس سلوك ما قبل التحويل بالحرف
    if (e.key === 'Enter' && posRef.current / maxX >= 0.8) { completeUnlock(); return; }
    if (!isFwd && !isBack) return;
    e.preventDefault();
    const newX = Math.max(0, Math.min(posRef.current + (isFwd ? maxX * 0.12 : -maxX * 0.12), maxX));
    if (newX >= maxX * 0.92) { if (springRef.current) cancelAnimationFrame(springRef.current); completeUnlock(); return; }
    glideTo(newX, maxX);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      // 🩺 نبضة فورية مع كل محاولة دخول: فشل النبضة = السيرفر واقع فعلاً، فالرسالة
      //    تكون "السيرفر مش شغال" بدل "بيانات الدخول غلط" (اللي كانت بتضلّل الناس).
      const health = await checkServerHealth({ timeoutMs: 8000 });
      if (!health.reachable) {
        setErrorMsg(language === 'ar'
          ? '🚫 السيرفر مش شغال دلوقتي (مش مشكلة في بياناتك) — رستر السيرفر ثم اضغط Ctrl+Shift+R.'
          : '🚫 The server is down right now (not your credentials) — restart it, then press Ctrl+Shift+R.');
        setIsLoading(false);
        return;
      }
      const response = await fetch(`${BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });
      // ✅ قراءة آمنة: لو السيرفر رجّع HTML (504 من بوابة الاستضافة) ما نقعش في خطأ غامض
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        // نفس منطق تحديد الأونر المستخدم بالظبط في لوحة التحكم (Dashboard.jsx)
        const userRole = (data.user?.role || '').toUpperCase();
        const isOwnerAccount = data.user?.is_global_admin === true || userRole === 'OWNER' || userRole === 'المالك';

        if (isOwnerAccount) {
          // 🔐 حساب الأونر: نوقف هنا ونطلب رمز التحقق قبل ما نكمل فعليًا للداشبورد
          setPendingAuthData(data);
          setLoginStage('verify');
          setIsLoading(false);
          return;
        }

        sessionStorage.setItem('access_token', data.access_token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        navigateWithEntryTransition('/dashboard');
      } else if (response.status >= 500) {
        setErrorMsg(language === 'ar'
          ? `🚫 السيرفر رد بخطأ (${response.status}) — جرّب تاني، ولو تكرر رستر السيرفر ثم اضغط Ctrl+Shift+R.`
          : `🚫 Server error (${response.status}) — retry, and if it persists restart the server then press Ctrl+Shift+R.`);
      } else {
        setErrorMsg(language === 'ar' ? 'بيانات الدخول غير صحيحة' : 'Invalid login credentials');
      }
    } catch {
      setErrorMsg(language === 'ar'
        ? 'تعذر الاتصال بالخادم المركزي — تأكد من الشبكة، ولو الشبكة تمام رستر السيرفر واضغط Ctrl+Shift+R.'
        : 'Unable to reach the central server — check your network; if that is fine, restart the server and press Ctrl+Shift+R.');
    } finally {
      setIsLoading(false);
    }
  };

  // 🔐 إتمام دخول الأونر بعد نجاح رمز التحقق
  const finishOwnerLogin = () => {
    if (!pendingAuthData) return;
    sessionStorage.setItem('access_token', pendingAuthData.access_token);
    sessionStorage.setItem('user', JSON.stringify(pendingAuthData.user));
    navigateWithEntryTransition('/dashboard');
  };

  const resetVerification = () => {
    setVerifyDigits(['', '', '', '', '', '']);
    setVerifyStage('idle');
    setVerifyError(false);
    setTimeout(() => { if (otpRefs.current[0]) otpRefs.current[0].focus(); }, 10);
  };

  const checkVerificationCode = (digits) => {
    const code = digits.join('');
    if (code.length < 6) return;
    if (code === OWNER_VERIFICATION_CODE) {
      setVerifyError(false);
      setVerifyStage('checking');
      // ✨ نترك المدار يعمل أولًا، ثم نعرض حالة النجاح قبل الانتقال.
      setTimeout(() => setVerifyStage('success'), 4200);
      setTimeout(() => finishOwnerLogin(), 5200);
    } else {
      setVerifyError(true);
      setTimeout(() => resetVerification(), 550);
    }
  };

  const handleOtpChange = (index, rawValue) => {
    const value = rawValue.replace(/[^0-9]/g, '').slice(-1);
    setVerifyDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      if (value && index < 5 && otpRefs.current[index + 1]) {
        otpRefs.current[index + 1].focus();
      }
      if (next.every((d) => d !== '')) checkVerificationCode(next);
      return next;
    });
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !verifyDigits[index] && index > 0 && otpRefs.current[index - 1]) {
      otpRefs.current[index - 1].focus();
    }
    if (e.key === 'ArrowLeft' && otpRefs.current[index + 1]) otpRefs.current[index + 1].focus();
    if (e.key === 'ArrowRight' && otpRefs.current[index - 1]) otpRefs.current[index - 1].focus();
  };

  const handleOtpPaste = (e) => {
    const pasted = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setVerifyDigits(next);
    const lastIndex = Math.min(pasted.length, 6) - 1;
    if (otpRefs.current[lastIndex]) otpRefs.current[lastIndex].focus();
    if (next.every((d) => d !== '')) checkVerificationCode(next);
  };

  const t = (ar, en) => (language === 'ar' ? ar : en);

  const handleCaps = (e) => {
    if (e.nativeEvent && e.nativeEvent.getModifierState) {
      try { setCapsLock(e.nativeEvent.getModifierState('CapsLock')); } catch { /* متصفح لا يدعم getModifierState */ }
    }
  };

  const backToForm = () => {
    setLoginStage('form');
    setPendingAuthData(null);
    setVerifyDigits(['', '', '', '', '', '']);
    setVerifyStage('idle');
    setVerifyError(false);
  };

  return (
    <div className="lx" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* 🩺 شاشة وقوع السيرفر — تظهر على صفحة الدخول نفسها (أول مكان بيوصل له الشباب) */}
      <ServerDownOverlay health={serverHealth} lang={language} />
      <ServerRecoveryBanner health={serverHealth} lang={language} />

      {/* ═══════════ الخلفية: تدرّج واحد + هالتان تنجرفان ببطء شديد ═══════════
          الحركة على transform فقط (بلا filter: blur وبلا طبقة تتبّع مؤشر) ⇒
          لا إعادة رسم على الخيط الرئيسي. */}
      <div className="lx-scene" aria-hidden="true">
        <span className="lx-aurora" />
      </div>

      {/* ═══════════ الختم: عقدة واحدة تعيش بين البوابة والبطاقة ═══════════
          لا تختفي ولا يُعاد تركيبها بنسخة ثانية — الموضع مكتوب كمتغيّرات CSS
          والحركة transform فقط، فلا وميض عند العبور. */}
      <motion.div
        ref={crestLayerRef}
        className="lx-crest-layer"
        aria-hidden="true"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduceMotion ? { ...STILL } : { duration: DUR.enter, ease: END }}
        style={{
          '--lx-crest-x': `${crestGeo.x}px`,
          '--lx-crest-y': `${crestGeo.y}px`,
          '--lx-crest-s': crestGeo.s,
          '--lx-crest-dur': `${crestGeo.dur}ms`,
        }}
      >
        <span className="lx-crest">
          <img src="/Egyptian_Red_Crescent.png" alt="" draggable="false" />
        </span>
      </motion.div>

      {/* ═══════════ بوابة الاستكشاف: ختم + عنوان + إيماءة واحدة ═══════════ */}
      <AnimatePresence>
        {showGate && (
          <motion.div
            key="lx-gate"
            ref={gateRootRef}
            className="lx-gate"
            dir="ltr"
            initial={{ opacity: 1 }}
            /* الخروج: تلاشٍ قصير فقط. كان `filter: blur(14px)` متحرّكًا
               ⇒ مسح كامل الشاشة وإعادة رسمها بفلتر طوال مدة الخروج. */
            animate={{ opacity: isUnlocking ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { ...STILL } : { duration: DUR.mid, ease: END }}
            style={{ pointerEvents: isUnlocking ? 'none' : 'auto' }}
          >
            <motion.div
              variants={reduceMotion ? FADE_GROUP : GATE_BOARD}
              initial="hidden"
              animate="show"
              className="lx-gate-board"
            >
              {/* مساحة الختم: الرسم نفسه من طبقة الختم أعلاه — هنا تُحفظ المساحة فقط */}
              <motion.div variants={reduceMotion ? FADE_ITEM : GATE_ITEM} className="lx-gate-emblem">
                <span ref={gateSlotRef} className="lx-crest-slot" />
              </motion.div>

              <motion.h2 variants={reduceMotion ? FADE_ITEM : GATE_ITEM} className="lx-gate-title">
                {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
              </motion.h2>
              <motion.p variants={reduceMotion ? FADE_ITEM : GATE_ITEM} className="lx-gate-sub">
                {language === 'ar' ? 'أطلس الاستجابة الإنسانية · مركز عمليات الطوارئ' : 'Humanitarian response atlas · operations center'}
              </motion.p>

              {/* قراءة النسبة المئوية / شارة التفعيل — مقروءة للقارئ الشاشي بلا شغل بصري */}
              <motion.div variants={reduceMotion ? FADE_ITEM : GATE_ITEM} className="lx-readout">
                {dragStage.pct && <span className="lx-pct" ref={pctRef} />}
                {dragProgress === 1 && (
                  <span className="lx-granted"><i />{t('مُفعّل', 'Activated')}</span>
                )}
              </motion.div>

              {/* ── مسار السحب: كبسولة واحدة + مقبض أبيض دائري + تعليمة واحدة ── */}
              <motion.div variants={reduceMotion ? FADE_ITEM : GATE_ITEM} className="lx-gate-slider">
                <div
                  ref={trackRef}
                  className={`lx-track ${isDragging ? 'is-dragging' : ''} ${isUnlocking ? 'is-done' : ''}`}
                >
                  <span className="lx-track-fill-wrap" aria-hidden="true">
                    <span className="lx-track-fill" />
                  </span>

                  <span id="lx-gate-instruction" className="lx-track-label">
                    {t('اسحب للدخول', 'Slide to enter')}
                  </span>

                  {/* مقبض السحب — هدف لمس ≥48px */}
                  <div
                    ref={handleRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onKeyDown={handleKnobKey}
                    role="slider"
                    tabIndex={0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(dragProgress * 100)}
                    aria-label={t('اسحب للدخول إلى مركز عمليات الطوارئ', 'Slide to enter the response coordination desk')}
                    aria-describedby="lx-gate-instruction"
                    className={`lx-handle ${isDragging ? 'is-dragging' : 'is-idle'} ${isUnlocking ? 'is-done' : ''}`}
                  >
                    <span className="lx-handle-ic lx-handle-ic--go" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                    <span className="lx-handle-ic lx-handle-ic--done" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5 9.2 17 19 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════ بطاقة الدخول — سطح واحد في منتصف الشاشة ═══════════
          قبل الفتح تكون غير مرئية وغير قابلة للتركيز (visibility) فلا يصل
          الكيبورد إلى نموذج مخفي، ومع ذلك تُحسب مستطيلاتها لانتقال الختم. */}
      <div className="lx-stage">
        <motion.div
          ref={cardRef}
          className={`lx-card ${isMounted ? 'is-mounted' : ''}`}
          variants={reduceMotion ? FADE_GROUP : CARD_IN}
          initial="hidden"
          animate={isMounted ? 'show' : 'hidden'}
          /* قبل الفتح: خارج الشجرة التفاعلية تمامًا — لا تركيز ولا نقر ولا قراءة */
          inert={isMounted ? undefined : true}
        >
          {/* رأس البطاقة: مساحة الختم فقط (الرسم من طبقة الختم) */}
          <motion.div variants={reduceMotion ? FADE_ITEM : CARD_CHILD} className="lx-card-head">
            <span ref={cardSlotRef} className="lx-crest-slot" aria-hidden="true" />
            <span className="lx-sr-only">{language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}</span>
          </motion.div>

          <div className="lx-card-body">
            {/* ── نموذج الدخول ── */}
            <div
              className={`lx-panel ${loginStage === 'form' ? 'is-active' : ''}`}
              aria-hidden={loginStage !== 'form'}
              inert={loginStage === 'form' ? undefined : true}
            >
              <motion.div
                variants={reduceMotion ? FADE_GROUP : FORM_COL}
                initial="hidden"
                animate={isMounted ? 'show' : 'hidden'}
                className="lx-stack"
              >
                <motion.div variants={reduceMotion ? FADE_ITEM : FORM_ITEM} className="lx-intro">
                  <h1 className="lx-title">{t('مركز عمليات الطوارئ', 'Response Coordination Desk')}</h1>
                  <p className="lx-sub">
                    {t('سجّل الدخول بحسابك للمتابعة', 'Sign in with your account to continue')}
                  </p>
                </motion.div>

                <form onSubmit={handleLogin} className="lx-form" autoComplete="on" noValidate>
                  {/* حقول مجمّعة: صفّان في سطح واحد بفاصل رفيع — لا إطار لكل حقل */}
                  <motion.div variants={reduceMotion ? FADE_ITEM : FORM_ITEM} className="lx-group">
                    <div className="lx-row">
                      <label className="lx-sr-only" htmlFor="lx-username">
                        {t('الرقم التعريفي / المستخدم', 'ID / Username')}
                      </label>
                      <span className="lx-row-ic" aria-hidden="true"><UserIcon /></span>
                      {/* lx-username / lx-password: خطّافا استقرار لأدوات القياس والاختبار */}
                      <input
                        ref={usernameRef}
                        id="lx-username"
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('الرقم التعريفي / المستخدم', 'ID / Username')}
                        autoComplete="username"
                        className="lx-input lx-username"
                      />
                    </div>

                    <span className="lx-row-sep" role="presentation" />

                    <div className="lx-row">
                      <label className="lx-sr-only" htmlFor="lx-password">
                        {t('رمز المرور السري', 'Secret password')}
                      </label>
                      <span className="lx-row-ic" aria-hidden="true"><LockIcon /></span>
                      <input
                        id="lx-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyUp={handleCaps}
                        placeholder={t('رمز المرور السري', 'Password')}
                        autoComplete="current-password"
                        aria-describedby="lx-hint"
                        className="lx-input lx-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
                        className="lx-eye"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </motion.div>

                  {/* سطر محجوز: تنبيه Caps Lock — لا يزحزح أي شيء لأنه موجود دائمًا */}
                  <motion.p variants={reduceMotion ? FADE_ITEM : FORM_ITEM} className="lx-hint" id="lx-hint" aria-live="polite">
                    {capsLock ? (
                      <span className="lx-hint-caps">
                        <i aria-hidden="true" />
                        {t('مفتاح Caps Lock مفعّل', 'Caps Lock is on')}
                      </span>
                    ) : null}
                  </motion.p>

                  {/* الخطأ: صف يُفتح انتقاليًّا (لا يُدفع المحتوى فجأة) */}
                  <div className={`lx-alert ${errorMsg ? 'is-shown' : ''}`} role="alert" aria-live="assertive">
                    <div className="lx-alert-inner">
                      <span className="lx-alert-ic" aria-hidden="true"><AlertIcon /></span>
                      <p className="lx-alert-text">{errorMsg}</p>
                    </div>
                  </div>

                  <motion.button
                    variants={reduceMotion ? FADE_ITEM : FORM_ITEM}
                    whileTap={reduceMotion || isLoading ? undefined : { scale: 0.98 }}
                    transition={{ duration: DUR.fast, ease: EASE_STD }}
                    type="submit"
                    disabled={isLoading}
                    className={`lx-submit ${isLoading ? 'is-loading' : ''}`}
                  >
                    {isLoading && <span className="lx-spinner" aria-hidden="true" />}
                    <span className="lx-submit-label">
                      {isLoading ? t('جاري التحقق…', 'Verifying…') : t('تسجيل الدخول', 'Sign in')}
                    </span>
                  </motion.button>
                </form>
              </motion.div>
            </div>

            {/* ── رمز التحقق (OTP) — نفس السطح، تبادل تلاشٍ بلا تغيّر مقاس ── */}
            <div
              className={`lx-panel ${loginStage === 'verify' ? 'is-active' : ''}`}
              aria-hidden={loginStage !== 'verify'}
              inert={loginStage === 'verify' ? undefined : true}
            >
              <motion.div
                variants={reduceMotion ? FADE_GROUP : FORM_COL}
                initial="hidden"
                animate={isMounted ? 'show' : 'hidden'}
                className="lx-stack lx-stack--center"
              >
                <motion.div variants={reduceMotion ? FADE_ITEM : FORM_ITEM} className="lx-intro">
                  <h1 className="lx-title">{t('رمز التحقق', 'Verification Code')}</h1>
                  <p className="lx-sub">
                    {t('أدخل الرمز المكوّن من 6 أرقام لإكمال الدخول', 'Enter the 6-digit code to complete sign-in')}
                  </p>
                </motion.div>

                <div className={`lx-alert lx-alert--otp ${verifyError ? 'is-shown' : ''}`} role="alert" aria-live="assertive">
                  <div className="lx-alert-inner">
                    <span className="lx-alert-ic" aria-hidden="true"><AlertIcon /></span>
                    <p className="lx-alert-text">{t('رمز غير صحيح — تأكد من الرمز وحاول مرة أخرى', 'Incorrect code — check it and try again')}</p>
                  </div>
                </div>

                <div
                  dir="ltr"
                  className={`lx-otp ${verifyStage === 'checking' ? 'is-checking' : ''} ${verifyStage === 'success' ? 'is-success' : ''}`}
                >
                  {verifyDigits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => (otpRefs.current[i] = el)}
                      type="password"
                      aria-label={language === 'ar' ? `الخانة ${i + 1} من 6` : `Digit ${i + 1} of 6`}
                      inputMode="numeric"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      maxLength={1}
                      value={verifyStage === 'checking' || verifyStage === 'success' ? '' : d}
                      disabled={verifyStage === 'checking'}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      onPaste={i === 0 ? handleOtpPaste : undefined}
                      className="lx-otp-box"
                    />
                  ))}
                  {verifyStage === 'success' && (
                    <span className="lx-otp-ok" aria-label={t('تم التحقق بنجاح', 'Verification successful')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5 9.2 17 19 7" />
                      </svg>
                    </span>
                  )}
                </div>

                <button type="button" onClick={backToForm} className="lx-backlink">
                  {t('العودة لتسجيل الدخول', 'Back to sign in')}
                </button>
              </motion.div>
            </div>
          </div>

          <motion.p variants={reduceMotion ? FADE_ITEM : CARD_CHILD} className="lx-trust">
            {t('دخول مقيّد لمنسوبي الهلال الأحمر المصري', 'Restricted to Egyptian Red Crescent staff')}
          </motion.p>
        </motion.div>
      </div>

      {/* ═══════════ تحكمات ثابتة (اللغة + الثيم): مجموعة واحدة، أهداف 44px ═══════
          في نهاية الترتيب المنطقي كي يبدأ الكيبورد من البوابة نفسها. */}
      <div className="lx-controls">
        <button
          type="button"
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          title={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
          aria-label={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
          className="lx-ctl"
        >
          {language === 'ar' ? 'EN' : 'AR'}
        </button>
        <span className="lx-ctl-sep" role="presentation" />
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={t('تفعيل الوضع الفاتح', 'Enable light mode')}
          className="lx-ctl"
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </div>
  );
}
