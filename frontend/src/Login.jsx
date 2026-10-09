import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { BASE } from './apiBase';
// 🩺 حارس السيرفر: لو السيرفر واقع، صفحة الدخول نفسها تقول الحقيقة بدل رسالة
// "تعذر الاتصال" العامة — والتلميذ يشوف تعليمات الرستر و Ctrl+Shift+R فوراً.
import { useServerHealth, ServerDownOverlay, ServerRecoveryBanner } from './serverHealth';
import { checkServerHealth } from './serverHealthCore';
// 🔇 شاشة الدخول ليها مؤشرها الخاص (سبينر الزر) — حبة العمل العامة مكتومة هنا تماماً
import { setWorkingSuppressed } from './workingToast';
// 🎛️ توكنات الحركة الموحّدة للنظام (نوابض + easing فخم)
import { SPRING, SPRING_SOFT, EASE_OUT } from './motion/tokens';
// 🎬 نظام البصريات «الجمرة السينمائية» — ملف منفصل ببادئة lx- حتى لا يمس لوحة التحكم
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
const ShieldIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const CheckIcon = () => (
  <svg width="0.8125rem" height="0.8125rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
);
const ChevronsIcon = () => (
  <svg width="0.8125rem" height="0.8125rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 6l6 6-6 6M5 6l6 6-6 6" />
  </svg>
);

/* محيط حلقة تقدّم الهلال (SVG) — r = 46 في نظام إحداثيات 100×100 */
const HALO_C = 2 * Math.PI * 46;

/* ─────────────────────────────────────────────────────────────
   ساعة تشغيل مباشرة داخل الرباط العلوي (بدون Backend)
   ───────────────────────────────────────────────────────────── */
function OpsClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  /* ⚡ P0: كانت الساعة دالة `useOpsClock()` تُستدعى داخل **Login نفسه** ⇒ تحديث
     كل ثانية يُعيد بناء شجرة كاملة (~1100 سطر JSX) ⇒ مهمة رئيسية طويلة
     50–65ms كل ثانية حتى وهو ساكن (مُقاس: مهمة 50ms واحدة في 1.5 ثانية سكون،
     ومهمة 62–81ms لكل تغيّر حالة). الآن الحالة محلّ هذا المكوّن الصغير وحده ⇒
     إعادة البناء محصورة فيه. نفس النص ونفس التوقيت ونفس السلوك الظاهري. */
  return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

/* ─────────────────────────────────────────────────────────────
   عدّاد تصاعدي للقياسات — بصري خالص (ease تكعيبي + احترام reduced-motion)
   ───────────────────────────────────────────────────────────── */
function useCountUp(target, active, duration = 1400) {
  const [val, setVal] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!active || reduce) return undefined;
    let raf;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration, reduce]);
  // مع تقليل الحركة: القيمة النهائية تُعرض مباشرة بلا حركة (بلا setState داخل effect)
  return reduce ? target : val;
}

/* قياس جاهزية واحد (رقم متصاعد + شريط + ومضة اكتمال) */
function Gauge({ g, active }) {
  const v = useCountUp(g.val, active);
  return (
    <div className="min-w-0 flex flex-col items-center gap-2.5">
      <span className="lx-gauge-num" style={{ color: g.color }}>
        {v}<small>%</small>
      </span>
      <div className="lx-gauge-bar w-full">
        <div
          className={`lx-gauge-fill ${active ? 'is-full' : ''}`}
          style={{
            width: active ? `${g.val}%` : '0%',
            background: `linear-gradient(90deg, ${g.color}, var(--accent-glow))`,
            boxShadow: `0 0 12px ${g.color}`,
          }}
        />
      </div>
      <span className="text-[max(0.625rem,9px)] font-bold text-[var(--muted)] truncate max-w-full">{g.label}</span>
    </div>
  );
}

/* ── توصيفات حركة البوابة وسطح القيادة (variants للتتابع المرحلي) ── */
const GATE_RISE = {
  /* كانت `filter: blur()` جزءًا من الدخول ⇒ مسح وإعادة رسم سطح شبه كامل الشاشة
     كل إطار. الآن opacity + transform فقط — نفس قاعدة مخارج البوابة أدناه. */
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { ...SPRING_SOFT, staggerChildren: 0.06, delayChildren: 0.10 } },
};
const GATE_ITEM = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: SPRING_SOFT },
};
const DECK_ENTER = {
  hidden: { opacity: 0, y: 38, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { ...SPRING_SOFT, delayChildren: 0.08, staggerChildren: 0.06 } },
};
const DECK_CHILD = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: SPRING_SOFT },
};
const FORM_COL = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { ...SPRING_SOFT, staggerChildren: 0.05, delayChildren: 0.05 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18, ease: EASE_OUT } },
};
const FORM_ITEM = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: SPRING },
};
const TAB_PAGE = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18, ease: EASE_OUT } },
};

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
  // إشارة فتح الأطلس تظهر مرة واحدة عند تحميل الشاشة
  // الافتتاحية تعمل دائمًا عند كل Refresh بدون أي استثناء.
  const [openingCeremony, setOpeningCeremony] = useState(true);
  const usernameRef = useRef(null);
  // 🩺 مراقبة السيرفر الحقيقية (نبضة /api/health كل 20 ثانية)
  const serverHealth = useServerHealth();

  useEffect(() => {
    if (!openingCeremony) return undefined;
    const brand = document.getElementById('lx-crest');
    const brandStamp = () => {
      setOpeningCeremony(false);
    };
    // نُطلق «الطابع» بعد انتهاء الضربة الضوئية ثم نُغلق المراسم
    const t = setTimeout(() => { if (brand) brand.classList.add('is-stamped'); }, 480);
    const t2 = setTimeout(brandStamp, 1900);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [openingCeremony]);

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
     ⚡ المسألة كلها كانت في مكان واحد: كل إطار من السحب كان يمرّر setDragX +
     setDragProgress ⇒ إعادة بناء (reconcile) لكل شجرة صفحة الدخول ٦٠ مرة في
     الثانية، فتتحوّل الإيماءة إلى «مدخل ← انتظار ← حركة».
     الآن: الموضع الحقيقي يعيش في ref، والرسم يتم بكتابة متغيّرين (`--lx-x`,
     `--lx-p`) على جذر البوابة في إطار واحد. CSS يشتقّ منها كل شيء: المقبض،
     التعبئة، الجمرة، النسبة، وحلقة التقدّم. React يُحدَّث فقط عند *عبور عتبة*
     (≤ ٦ مرات لإيماءة كاملة) ⇒ استجابة 1:1 بلا إعادة بناء. */
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /* `dragX` كان حالة React تُقرأ في التصميم القديم (inline translateX على المقبض).
     بعد نقل كل الحركة إلى متغيّرات CSS، لم يبق أي قارئ له — لكن `setDragX` ظلّ
     يُستدعى عند كل عتبة ⇒ إعادة رسم بلا مستهلك. أُزيلت الحالة بالكامل.
     `dragProgress` يبقى: هو ما يُقرأ فعلاً (aria-valuenow + شارة «مُفعّل»). */
  const [dragProgress, setDragProgress] = useState(0);
  // حالة تقريبية (عتبات فقط) للفئات: اشتعال المعيّنات، الهدف، نص المرحلة، إظهار النسبة
  const [dragStage, setDragStage] = useState({ tick: 0, goal: false, label: 0, pct: false });
  const [gaugesOn, setGaugesOn] = useState(false);
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
  /* المقبض أصبح 3.75rem فيتتبّع مقياس الجذر، لكن رياضة السحب تعمل بالـpx
     (trackRect.width). نقيسه **مرة واحدة عند بداية الإيماءة** ونخزّنه في ref،
     فلا تُجرى قراءة style لكل إطار أثناء السحب (ممنوع في §1). */
  const handleSizeRef = useRef(HANDLE_SIZE);
  const handleRef = useRef(null);
  const measureHandle = () => {
    const el = handleRef.current;
    if (!el) return;
    const w = parseFloat(getComputedStyle(el).width);
    if (w > 0) handleSizeRef.current = w;
  };
  const isRTL = language === 'ar';

  // بارالاكس لطيف لختم الأطلس مع حركة المؤشر (يُلغى تلقائيًا مع reduced-motion)
  const reduceMotion = useReducedMotion();
  const parX = useMotionValue(0);
  const parY = useMotionValue(0);
  const parSX = useSpring(parX, { stiffness: 55, damping: 17 });
  const parSY = useSpring(parY, { stiffness: 55, damping: 17 });
  const lxRootRef = useRef(null);
  const lightFrameRef = useRef(0);
  /* 🕯️ ضوء المؤشّر: بقعة ضوء ناعمة تتبع المؤشر على المشهد كله (البوابة والسطح).
     - إطار واحد لكل مجموعة حركات (rAF) ⇒ صفر إعادة رسم React.
     - اللمس ومع reduced-motion: لا تتبّع مستمر (بديل ثابت).
     - الإزاحة مقيّدة (≤ 12px) على الختم وحده ⇒ لا يتحرك التخطيط. */
  const handleGatePointerMove = (e) => {
    if (reduceMotion || e.pointerType === 'touch') return;
    const { clientX, clientY } = e;
    if (lightFrameRef.current) return;
    lightFrameRef.current = requestAnimationFrame(() => {
      lightFrameRef.current = 0;
      const root = lxRootRef.current;
      if (root) {
        root.style.setProperty('--lx-px', ((clientX / window.innerWidth) * 100).toFixed(2) + '%');
        root.style.setProperty('--lx-py', ((clientY / window.innerHeight) * 100).toFixed(2) + '%');
        root.style.setProperty('--lx-pl', '1');
      }
      parX.set((clientX / window.innerWidth - 0.5) * 12);
      parY.set((clientY / window.innerHeight - 0.5) * 8);
    });
  };
  /* على الأجهزة اللمسية: ضوء ثابت في المنتصف بدل تتبّع مستمر */
  const handleScenePointerLeave = () => {
    const root = lxRootRef.current;
    if (root) root.style.setProperty('--lx-pl', '0');
  };

  // تشغيل القياسات (readiness) بعد دخول الكارت
  useEffect(() => {
    const t = setTimeout(() => setGaugesOn(true), 220);
    return () => clearTimeout(t);
  }, []);

  // تنظيف أي rAF نابضي عند التفكيك
  useEffect(
    () => () => {
      if (springRef.current) cancelAnimationFrame(springRef.current);
      if (lightFrameRef.current) cancelAnimationFrame(lightFrameRef.current);
    },
    [],
  );

  // ── الرسم: متغيّرا CSS على جذر البوابة ⇒ كل الحركة على الـ compositor ──
  // لا يُستدعى setState إلا عند عبور عتبة حقيقية (فئة/اشتعال/نص).
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
    setTimeout(() => setIsMounted(true), 160);   // كارت الدخول يبدأ بالدخول
    setTimeout(() => setShowGate(false), 860);    // البوابة تُزال من الـ DOM
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
    //    فينقلب اتجاه السرعة). الحدث كان يظهر كـ«قفزة إلى الصفر». الحل التحليلي
    //    مستقل تمامًا عن معدّل الإطارات ومستقر دائمًا، ويعطي زخم الإفلات طبيعيًّا.
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
        navigate('/dashboard');
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
    navigate('/dashboard');
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

  // تركيبة نصية تتطور مع مراحل السحب
  const slideLabel = dragStage.label >= 2
    ? t('تم — جاري فتح مركز الاستجابة', 'Done — opening the response desk')
    : dragStage.label >= 1
      ? t('واصل السحب لفتح الأطلس…', 'Keep sliding to unfold the atlas…')
      : t('اسحب لاستكشاف أطلس الاستجابة', 'Slide to explore the response atlas');

  return (
    <div
      ref={lxRootRef}
      className="lx relative min-h-[100dvh] bg-[var(--bg)] text-[var(--ink)] font-sans overflow-x-hidden selection:bg-[var(--accent)] selection:text-white"
      dir={isRTL ? 'rtl' : 'ltr'}
      onPointerMove={handleGatePointerMove}
      onPointerLeave={handleScenePointerLeave}
    >
      {/* 🩺 شاشة وقوع السيرفر — تظهر على صفحة الدخول نفسها (أول مكان بيوصل له الشباب) */}
      <ServerDownOverlay health={serverHealth} lang={language} />
      <ServerRecoveryBanner health={serverHealth} lang={language} />

      {/* ═══════════ الخلفية المحيطة — طبقة واحدة (`.lx-scene`) ═══════════
          كانت 9 عناصر (aurora / glow×3 / beam / grid / sweep / vignette / grain)
          بلا أي قاعدة CSS، ومعها inline transform مربوط بـ dragProgress ⇒ تُبنى
          في كل رسم وتُعيد بناء الشجرة مع كل إطار سحب مقابل صفر أثر بصري. */}
      <div className="lx-scene" aria-hidden="true">
        <span className="lx-aurora" aria-hidden="true" />
        <span className="lx-light" aria-hidden="true" />
      </div>

      {/* ═══════════ تحكمات ثابتة: اللغة + الثيم ─────────────── */}
      <motion.button
        type="button"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_SOFT, delay: 0.26 }}
        onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
        title={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
        aria-label={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
        className="lx-pill-btn fixed top-4 start-5 z-[9999]"
      >
        {language === 'ar' ? 'EN' : 'AR'}
      </motion.button>

      <motion.button
        type="button"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_SOFT, delay: 0.32 }}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t('تفعيل الوضع الفاتح', 'Enable light mode')}
        className="lx-switch fixed top-4 end-5 z-[9999]"
      >
        <span className="lx-switch-ic lx-switch-ic--s" aria-hidden="true">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        </span>
        <span className="lx-switch-ic lx-switch-ic--e" aria-hidden="true">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
        </span>
        <span aria-hidden="true" className={`lx-switch-knob ${theme === 'dark' ? 'lx-switch-knob--start' : 'lx-switch-knob--end'}`} />
      </motion.button>

      {/* ═══════════ بوابة استكشاف أطلس الاستجابة ═══════════ */}
      <AnimatePresence>
        {showGate && (
          <motion.div
            key="lx-gate"
            ref={gateRootRef}
            className="lx-gate fixed inset-0 z-50 overflow-hidden"
            dir="ltr"
            initial={{ opacity: 1 }}
            /* الخروج: opacity + scale فقط. كان `filter: blur(14px)` متحرّكًا
               ⇒ مسح كامل الشاشة وإعادة رسمها بفلتر طوال مدة الخروج. */
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.34, ease: EASE_OUT }}
            style={{ pointerEvents: isUnlocking ? 'none' : 'auto' }}
          >
            {/* 🌫️ مشهد البوابة — طبقة واحدة في CSS (`.lx-scene`).
                كان هنا 8 عناصر (aurora / glow×3 / beam / grid / sweep /
                vignette / grain) **بلا أي قاعدة CSS** (مُستبدلة بـ background-image
                في commit سابق) ⇒ DOM ميت يُبنى في كل رسم، مع inline transform
                يربط البارالاكس بـ dragProgress فيُجبر إعادة بناء لكل إطار.
                أُزيل بالكامل — نفس الشكل، صفر عُقد. */}
            <div className="lx-scene" aria-hidden="true">
        <span className="lx-aurora" aria-hidden="true" />
        <span className="lx-light" aria-hidden="true" />
      </div>

            <motion.div
              variants={GATE_RISE}
              initial="hidden"
              animate="show"
              className="lx-gate-board relative z-10 flex h-full flex-col items-center justify-center px-6 w-full max-w-[min(92vw,540px)] mx-auto"
            >
              {/* تظهر إشارة المسار مرة واحدة مع فتح الأطلس */}
              {openingCeremony && (
                <div className="lx-boot" aria-hidden="true">
                  <div className="lx-boot-slash" />
                  <span className="lx-boot-ring" />
                  <span className="lx-boot-spark" style={{ insetInlineStart: '18%', top: '34%', animationDelay: '0.55s' }} />
                  <span className="lx-boot-spark" style={{ insetInlineStart: '72%', top: '28%', animationDelay: '0.7s' }} />
                  <span className="lx-boot-spark" style={{ insetInlineStart: '56%', top: '70%', animationDelay: '0.85s' }} />
                  <span className="lx-boot-spark" style={{ insetInlineStart: '88%', top: '55%', animationDelay: '1s' }} />
                </div>
              )}

              {/* ── ختم الهوية: الهلال هو علامة موجز الاستجابة ── */}
              <motion.div variants={GATE_ITEM} className="lx-gate-emblem relative">
                <motion.div style={{ x: parSX, y: parSY }} className="lx-crest-stack">
                  <span className="lx-crest-glow" aria-hidden="true" />
                  <span className="lx-orbit" aria-hidden="true"><span className="lx-sat lx-sat--a" /></span>
                  <span className="lx-orbit lx-orbit--inner" aria-hidden="true"><span className="lx-sat lx-sat--b" /></span>
                  {/* تُحتفظ بعناصر الحلقة للتوافق؛ عرض التقدم الأساسي على مسار السحب */}
                  <svg className="lx-halo" viewBox="0 0 100 100" aria-hidden="true">
                    <defs>
                      <linearGradient id="lxHaloGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="var(--accent-glow)" />
                        <stop offset="55%" stopColor="var(--lx-accent-hi)" />
                        <stop offset="100%" stopColor="var(--accent)" />
                      </linearGradient>
                    </defs>
                    <circle className="lx-halo-track" cx="50" cy="50" r="46" />
                    <circle
                      className="lx-halo-arc"
                      cx="50" cy="50" r="46"
                      strokeDasharray={HALO_C}
                    />
                  </svg>
                  <div
                    id="lx-crest"
                    className={`lx-crest ${dragStage.goal || isUnlocking ? 'is-done' : ''}`}
                  >
                    <img src="/Egyptian_Red_Crescent.png" alt="ERC Logo" draggable="false" />
                  </div>
                </motion.div>
              </motion.div>

              <motion.h2
                variants={GATE_ITEM}
                className="lx-gate-title mt-9"
                style={language === 'ar' ? undefined : { letterSpacing: '-0.015em' }}
              >
                {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
              </motion.h2>
              <motion.p
                variants={GATE_ITEM}
                className="lx-gate-sub mt-2.5"
                style={language === 'ar' ? { letterSpacing: '.12em', textTransform: 'none' } : undefined}
              >
                {language === 'ar' ? 'أطلس الاستجابة الإنسانية · EOC' : 'HUMANITARIAN RESPONSE ATLAS · EOC'}
              </motion.p>

              {/* قراءة النسبة المئوية / شارة التفعيل */}
              <motion.div variants={GATE_ITEM} className="lx-readout mt-7">
                {dragStage.pct && <span className="lx-pct" ref={pctRef} />}
                {dragProgress === 1 && (
                  <span className="lx-granted lx-morph"><i />{t('مُفعّل', 'ACTIVATED')}</span>
                )}
              </motion.div>

              {/* ── مسار السحب ── */}
              <motion.div variants={GATE_ITEM} className="lx-gate-slider w-full flex justify-center">
                <div
                  ref={trackRef}
                  className={`lx-track ${isDragging ? 'is-dragging' : ''} ${isUnlocking ? 'is-done' : ''}`}
                >
                  <span className="lx-track-shine" aria-hidden="true" />

                  {/* تعبئة الجمرة: مقطع واحد يقصّ الشكل الكبسولي + تعبئة تُقاس بـ
                      `scaleX` من `--lx-p`. كان العرض يُحرّك بـ `width` عبر انتقال
                      ٠.٤٥s ⇒ حركة تخطيط بطيئة. الآن transform فقط: صفر تخطيط،
                      وصفر رسم بعد الإطار الأول. */}
                  <span className="lx-fill-clip" aria-hidden="true">
                    <span className="lx-fill" />
                    <span className="lx-fill-glow" />
                  </span>
                  {/* جمرة سافرة: كتلة ثابتة الحجم تُنقل بـ translate3d (compositor) */}
                  <span className="lx-ember" aria-hidden="true" />

                  {/* معينات المراحل — تشتعل تباعًا (من العتبات فقط، بلا رسم لكل إطار) */}
                  {[0.33, 0.66, 0.92].map((p, i) => (
                    <span
                      key={p}
                      className={`lx-tick ${dragStage.tick > i ? 'is-lit' : ''}`}
                      style={{ insetInlineStart: `${p * 100}%` }}
                      aria-hidden="true"
                    />
                  ))}

                  {/* حلقة الهدف النهائي */}
                  <span className={`lx-goal ${dragStage.goal ? 'is-lit' : ''}`} aria-hidden="true">
                    <CheckIcon />
                  </span>

                  {/* التسمية المتطورة — تلاشيها من `--lx-p` في CSS */}
                  <span className="lx-track-label">
                    <span className="lx-shield-ic" aria-hidden="true"><ShieldIcon /></span>
                    <span key={slideLabel} className="lx-morph whitespace-nowrap">{slideLabel}</span>
                    <span className="lx-chevs" aria-hidden="true">
                      <ChevronsIcon /><ChevronsIcon /><ChevronsIcon />
                    </span>
                  </span>

                  {/* مقبض السحب يحمل ختم الهوية */}
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
                    aria-label={language === 'ar' ? 'اسحب لاستكشاف أطلس الاستجابة' : 'Slide to explore the response atlas'}
                    className={`lx-handle ${isDragging ? 'is-dragging' : 'is-idle'} ${isUnlocking ? 'is-done' : ''}`}
                    /* الموضع من `--lx-x` (CSS) — لا انتقال زمني أثناء السحب:
                       الحركة 1:1 مع الإصبع، والعودة يحرّكها النابض في JS. */
                    style={{ width: '3.75rem', height: '3.75rem' }}
                  >
                    <span className="lx-handle-halo" aria-hidden="true" />
                    {isUnlocking && <span className="lx-ripple lx-ripple--1" aria-hidden="true" />}
                    {isUnlocking && <span className="lx-ripple lx-ripple--2" aria-hidden="true" />}
                    <span className="lx-handle-core">
                      <img src="/Egyptian_Red_Crescent.png" alt="" draggable="false" />
                      <span className="lx-handle-check" aria-hidden="true">
                        <svg viewBox="0 0 100 100"><path d="M 22 55 L 42 75 L 80 32" /></svg>
                      </span>
                    </span>
                  </div>
                </div>
              </motion.div>

              <motion.p
                variants={GATE_ITEM}
                className="lx-gate-foot mt-9"
                style={language === 'ar' ? { letterSpacing: '.1em' } : undefined}
              >
                {language === 'ar' ? 'مركز تنسيق الاستجابة · الهلال الأحمر المصري' : 'RESPONSE COORDINATION · EGYPTIAN RED CRESCENT'}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════ كارت القيادة (Command Deck) ═══════════ */}
      <div className="relative z-10 flex items-center justify-center min-h-[100dvh] p-4 sm:p-8">
        <motion.div
          className="lx-deck"
          variants={DECK_ENTER}
          initial="hidden"
          animate={isMounted ? 'show' : 'hidden'}
        >
          {/* ─── الرباط العلوي: هوية القيادة + الحالة الحية ─── */}
          <motion.div variants={DECK_CHILD} className="lx-ribbon relative shrink-0 px-5 sm:px-8 py-4">
            <span className="lx-ribbon-line" aria-hidden="true" />
            <span className="lx-ribbon-fade" aria-hidden="true" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="lx-logo-tile shrink-0">
                  <img src="/Egyptian_Red_Crescent.png" alt="ERC Logo" draggable="false" />
                </span>
                <div className="min-w-0">
                  <p className="font-extrabold text-sm sm:text-base leading-tight tracking-tight">
                    {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
                  </p>
                  <p className="text-white/75 text-[max(0.6875rem,9.5px)] sm:text-xs font-medium">
                    {language === 'ar' ? 'أطلس الاستجابة · مركز عمليات الطوارئ' : 'Response Atlas · Emergency Operations Center'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3">
                <span className="lx-chip hidden sm:inline-flex">
                  <span className="lx-live-dot" aria-hidden="true" />
                  <span className="text-[max(0.625rem,9px)] sm:text-[max(0.6875rem,9.5px)] font-bold tracking-[0.2em]">LIVE</span>
                </span>
                <span className="lx-chip">
                  <span className="lx-clock"><OpsClock /></span>
                </span>
                <span className="hidden md:inline-flex text-white/60 text-[max(0.625rem,9px)] font-mono tracking-widest">
                  EOC · OPS · v2.0.0
                </span>
              </div>
            </div>
          </motion.div>

          {/* ─── الجسم: كونسول الجاهزية + نموذج الوصول ─── */}
          <div className="flex flex-col">
            {/* شريط الجاهزية الموحّد: رادار مركزي + قياسات صفّية متناظرة */}
            <motion.div variants={DECK_CHILD} className="lx-console relative overflow-hidden px-6 sm:px-8 pt-9 pb-7 flex flex-col items-center gap-7">
              {/* الرادار */}
              <div className="lx-radar shrink-0" aria-hidden="true">
                <div className="lx-radar-sweep" />
                <span className="lx-radar-ring lx-radar-ring--1" />
                <span className="lx-radar-ring lx-radar-ring--2" />
                <span className="lx-radar-blip" style={{ top: '13%', insetInlineEnd: '26%', width: '0.4375rem', height: '0.4375rem', background: 'var(--accent)' }} />
                <span className="lx-radar-blip" style={{ bottom: '21%', insetInlineStart: '23%', width: '0.3125rem', height: '0.3125rem', background: 'var(--ok)', animationDelay: '1.1s' }} />
                <img
  src="/Egyptian_Red_Crescent.png"
  alt="الهلال الأحمر المصري"
  draggable="false"
  className="lx-radar-logo"
  />

              </div>

              {/* القياسات: صف ثلاثي متناظر */}
              <div className="w-full max-w-md grid grid-cols-3 gap-6 sm:gap-8">
                {[
                  { key: 'readiness', label: language === 'ar' ? 'جاهزية العمليات' : 'Ops readiness', val: 100, color: 'var(--accent)' },
                  { key: 'field', label: language === 'ar' ? 'الربط الميداني' : 'Field-team link', val: 100, color: 'var(--ok)' },
                  { key: 'secure', label: language === 'ar' ? 'تشفير القناة' : 'Channel encryption', val: 100, color: 'var(--ok)' },
                ].map((g) => (
                  <Gauge key={g.key} g={g} active={gaugesOn} />
                ))}
              </div>
            </motion.div>

            {/* نموذج الوصول الموحّد */}
            <motion.div variants={DECK_CHILD} className="p-7 sm:p-10">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-8 lg:gap-12">
                {/* عمود المقدمة/الثقة */}
                <div className="w-full max-w-md mx-auto lg:max-w-none lg:mx-0 flex flex-col gap-4 lg:gap-5 lg:pt-1">
                  <div>
                    <span className="lx-eyebrow mb-3">
                      {language === 'ar' ? 'مركز تنسيق الاستجابة' : 'RESPONSE COORDINATION'}
                    </span>
                    <h3 className="text-2xl md:text-[1.7rem] font-bold text-[var(--ink)] tracking-tight mt-3">
                      {language === 'ar' ? 'مركز عمليات الطوارئ' : 'Response Coordination Desk'}
                    </h3>
                    <p className="text-[var(--muted)] text-sm mt-2 leading-relaxed">
                      {language === 'ar'
                        ? 'تحقق من بيانات اعتمادك للدخول إلى مركز عمليات الطوارئ.'
                        : 'Verify your credentials to enter the response coordination desk.'}
                    </p>
                  </div>
                  <div className="hidden lg:flex lx-trust">
                    <b aria-hidden="true">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.5 17 19 7" />
                      </svg>
                    </b>
                    <span>{language === 'ar' ? 'قناة مشفرة · دخول موثّق فقط' : 'TLS ENCRYPTED · AUTHENTICATED ONLY'}</span>
                  </div>
                </div>

                {/* عمود النموذج — انتقال سينمائي بين الدخول ورمز التحقق */}
                <div className="w-full max-w-md mx-auto lg:max-w-none lg:mx-0">
                  <AnimatePresence mode="wait" initial={false}>
                    {loginStage === 'verify' ? (
                      <motion.div
                        key="verify"
                        {...TAB_PAGE}
                        className="flex flex-col items-center gap-6 text-center py-2"
                      >
                        <div>
                          <span className="lx-eyebrow mb-3">
                            {language === 'ar' ? 'طبقة حماية إضافية' : 'ADDITIONAL SECURITY LAYER'}
                          </span>
                          <h3 className="text-2xl md:text-[1.7rem] font-bold text-[var(--ink)] tracking-tight mt-3">
                            {language === 'ar' ? 'رمز التحقق' : 'Verification Code'}
                          </h3>
                          <p className="text-[var(--muted)] text-sm mt-2 leading-relaxed">
                            {language === 'ar'
                              ? 'أدخل رمز التحقق المكوّن من 6 أرقام لإكمال الدخول'
                              : 'Enter the 6-digit verification code to complete sign-in'}
                          </p>
                        </div>

                        {verifyError && (
                          <div className="lx-error w-full text-start" role="alert">
                            <span className="lx-error-ic" aria-hidden="true"><AlertIcon /></span>
                            <div className="text-sm leading-snug">
                              <p className="font-bold mb-0.5">{language === 'ar' ? 'رمز غير صحيح' : 'Incorrect code'}</p>
                              <p className="text-[var(--muted)]">{language === 'ar' ? 'تأكد من الرمز وحاول مرة أخرى' : 'Check the code and try again'}</p>
                            </div>
                          </div>
                        )}

                        <div
                          dir="ltr"
                          className={`otp-orbit-zone ${verifyStage === 'checking' ? 'is-checking' : ''} ${verifyStage === 'success' ? 'is-success' : ''}`}
                        >
                          {verifyDigits.map((d, i) => (
                            <span
                              key={i}
                              className="otp-orbit-item inline-flex"
                              style={{
                                '--angle': `${i * 60 - 150}deg`,                                  '--line-x': `${(i - 2.5) * 3.625}rem`
                              }}
                            >
                              <input
                                ref={(el) => (otpRefs.current[i] = el)}
                                type="password"
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
                                className="otp-box"
                              />
                            </span>
                          ))}
                          {verifyStage === 'success' && (
                            <span className="otp-success-mark" aria-label={language === 'ar' ? 'تم التحقق بنجاح' : 'Verification successful'}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M5 12.5 9.2 17 19 7" />
                              </svg>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setLoginStage('form');
                            setPendingAuthData(null);
                            setVerifyDigits(['', '', '', '', '', '']);
                            setVerifyStage('idle');
                            setVerifyError(false);
                          }}
                          className="lx-backlink"
                        >
                          {language === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to sign in'}
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="form"
                        variants={FORM_COL}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="flex flex-col gap-5"
                      >
                        {errorMsg && (
                          <motion.div variants={FORM_ITEM} className="lx-error" role="alert">
                            <span className="lx-error-ic" aria-hidden="true"><AlertIcon /></span>
                            <div className="text-sm leading-snug">
                              <p className="font-bold mb-0.5">{language === 'ar' ? 'تعذّر الدخول' : 'Sign-in failed'}</p>
                              <p className="text-[var(--muted)]">{errorMsg}</p>
                            </div>
                          </motion.div>
                        )}

                        <form onSubmit={handleLogin} className="flex flex-col gap-5" autoComplete="off">
                          <motion.div variants={FORM_ITEM} className={`lx-field ${username ? 'is-filled' : ''}`}>
                            <span className="lx-field-glow" aria-hidden="true" />
                            <label className="lx-label">
                              <span className="lx-label-dot" aria-hidden="true" />
                              {language === 'ar' ? 'الرقم التعريفي / المستخدم' : 'ID / Username'}
                            </label>
                            <div className="lx-input-wrap">
                              <span className="lx-input-ic" aria-hidden="true"><UserIcon /></span>
                              <input
                                ref={usernameRef}
                                type="text"
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder={language === 'ar' ? 'أدخل اسم المستخدم الخاص بك' : 'Enter your Username'}
                                autoComplete="new-password"
                                className="lx-input"
/>
                            </div>
                          </motion.div>

                          <motion.div variants={FORM_ITEM} className={`lx-field ${password ? 'is-filled' : ''}`}>
                            <span className="lx-field-glow" aria-hidden="true" />
                            <label className="lx-label">
                              <span className="lx-label-dot" aria-hidden="true" />
                              {language === 'ar' ? 'رمز المرور السري' : 'Secret password'}
                            </label>
                            <div className="lx-input-wrap">
                              <span className="lx-input-ic" aria-hidden="true"><LockIcon /></span>
                              <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyUp={handleCaps}
                                placeholder="********"
                                autoComplete="new-password"
                                className="lx-input"
/>
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? (language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (language === 'ar' ? 'إظهار كلمة المرور' : 'Show password')}
                                className="lx-eye"
                              >
                                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                              </button>
                            </div>
                            {capsLock && (
                              <p className="lx-caps">
                                <i aria-hidden="true" />
                                {language === 'ar' ? 'مفتاح Caps Lock مفعّل — راجع حالة الأحرف' : 'Caps Lock is on — check letter case'}
                              </p>
                            )}
                          </motion.div>

                          <motion.button
                            variants={FORM_ITEM}
                            whileTap={isLoading ? undefined : { scale: 0.982 }}
                            type="submit"
                            disabled={isLoading}
                            className={`lx-submit ${isLoading ? 'is-loading' : ''}`}
                          >
                            {isLoading && <span className="lx-spinner" aria-hidden="true" />}
                            {isLoading
                              ? (language === 'ar' ? 'جاري التحقق من الهوية…' : 'Verifying identity…')
                              : (language === 'ar' ? 'تسجيل الدخول' : 'Sign In')}
                          </motion.button>
                        </form>

                        <motion.div variants={FORM_ITEM} className="lx-trust lg:hidden justify-center">
                          <b aria-hidden="true">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.5 17 19 7" />
                            </svg>
                          </b>
                          <span>{language === 'ar' ? 'قناة مشفرة · دخول موثّق فقط' : 'TLS ENCRYPTED · AUTHENTICATED ONLY'}</span>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
