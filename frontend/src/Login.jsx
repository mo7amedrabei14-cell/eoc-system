import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─────────────────────────────────────────────────────────────
   أيقونات داخلية خفيفة (SVG) بنفس لغة النظام
   ───────────────────────────────────────────────────────────── */
const CrescentIcon = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="currentColor">
    <path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" />
  </svg>
);
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
  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);
const ShieldIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const SpinnerIcon = () => (
  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);
const ChevronsIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 6l6 6-6 6M5 6l6 6-6 6" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   ساعة تشغيل مباشرة داخل الرباط العلوي (بدون Backend)
   ───────────────────────────────────────────────────────────── */
function useOpsClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [showGate, setShowGate] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  // 🎉 مراسم الافتتاح — تظهر مع كل Refresh / تحميل جديد خارج الجلسة
  // الافتتاحية تعمل دائمًا عند كل Refresh بدون أي استثناء.
  const [openingCeremony, setOpeningCeremony] = useState(true);
  const usernameRef = useRef(null);

  useEffect(() => {
    if (!openingCeremony) return undefined;
    const brand = document.getElementById('opening-crest');
    const brandStamp = () => {
      setOpeningCeremony(false);
    };
    // نُطلق «الطابع» بعد انتهاء الضربة الضوئية ثم نُغلق المراسم
    const t = setTimeout(() => { if (brand) brand.classList.add('opening-stamped'); }, 480);
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
  const opsNow = useOpsClock();

  /* ── بوابة السحب للدخول (Slide to Unlock) — فيزياء نابضية ── */
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragProgress, setDragProgress] = useState(0);
  const [gaugesOn, setGaugesOn] = useState(false);
  const trackRef = useRef(null);
  const springRef = useRef(null);
  const dragPhaseRef = useRef(0); // وضع مغناطيسي مرن أثناء السحب
  const HANDLE_SIZE = 60;
  const isRTL = language === 'ar';
  // بوابة السحب تبدأ دائمًا من الشمال وتتحرك إلى اليمين، حتى مع اللغة العربية.
  const dirSign = 1;

  // تشغيل القياسات (readiness) بعد دخول الكارت
  useEffect(() => {
    const t = setTimeout(() => setGaugesOn(true), 220);
    return () => clearTimeout(t);
  }, []);

  // تنظيف أي rAF نابضي عند التفكيك
  useEffect(
    () => () => {
      if (springRef.current) cancelAnimationFrame(springRef.current);
    },
    [],
  );

  const completeUnlock = (maxX) => {
    if (springRef.current) cancelAnimationFrame(springRef.current);
    setIsDragging(false);
    setDragX(maxX);
    setDragProgress(1);
    setIsUnlocking(true);
    if (navigator.vibrate) try { navigator.vibrate([10, 30, 20]); } catch (e) {}
    setTimeout(() => setIsMounted(true), 160);   // كارت الدخول يبدأ بالدخول
    setTimeout(() => setShowGate(false), 860);    // البوابة تُزال من الـ DOM
  };

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPhaseRef.current = dragX;
    if (springRef.current) { cancelAnimationFrame(springRef.current); springRef.current = null; }
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const maxX = trackRect.width - HANDLE_SIZE - 8;
    // السحب ثابت من الشمال إلى اليمين في كل اللغات.
    const fromStart = e.clientX - trackRect.left;
    const target = Math.max(0, Math.min(fromStart - HANDLE_SIZE / 2, maxX));
    // لمسة مغناطيسية: الهدف يُتبع بنسبة متليّنة تجعل المقبض "ينجذب" بدل قفزة جامدة
    dragPhaseRef.current += (target - dragPhaseRef.current) * 0.5;
    const newX = Math.max(0, Math.min(dragPhaseRef.current, maxX));
    setDragX(newX);
    setDragProgress(maxX > 0 ? newX / maxX : 0);
    if (maxX > 0 && newX >= maxX * 0.92) completeUnlock(maxX);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const trackRect = trackRef.current && trackRef.current.getBoundingClientRect();
    const maxX = trackRect ? trackRect.width - HANDLE_SIZE - 8 : 1;
    if (dragX >= maxX * 0.92) { /* اكتمل داخل move */ return; }
    // ⭐ عودة نابضية: من حيث توقف الإصبع إلى الصفر مع ارتداد خفيف (damped spring)
    const k = 220, c = 15, m = 1;
    let pos = dragX, vel = 0, last = performance.now();
    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const a = (k * (0 - pos) - c * vel) / m;
      vel += a * dt;
      pos += vel * dt;
      const p = Math.max(0, Math.min(pos, maxX));
      setDragX(p);
      setDragProgress(maxX > 0 ? p / maxX : 0);
      if (Math.abs(pos) < 0.4 && Math.abs(vel) < 0.5) { setDragX(0); setDragProgress(0); return; }
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
    if (!trackRef.current || isDragging || isUnlocking) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const maxX = Math.max(1, trackRect.width - HANDLE_SIZE - 8);
    // لوحة المفاتيح تتبع نفس الاتجاه: السهم الأيمن للتقدم.
    const isFwd = e.key === 'ArrowRight';
    const isBack = e.key === 'ArrowLeft';
    if (e.key === 'Enter' && dragProgress >= 0.8) { completeUnlock(maxX); return; }
    if (!isFwd && !isBack) return;
    e.preventDefault();
    const newX = Math.max(0, Math.min(dragX + (isFwd ? maxX * 0.12 : -maxX * 0.12), maxX));
    setDragX(newX);
    setDragProgress(maxX > 0 ? newX / maxX : 0);
    if (newX >= maxX * 0.92) completeUnlock(maxX);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      const response = await fetch('https://eoc-system-b12f.vercel.app/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/dashboard');
      } else {
        setErrorMsg(language === 'ar' ? 'بيانات الدخول غير صحيحة' : 'Invalid login credentials');
      }
    } catch (err) {
      setErrorMsg(language === 'ar' ? 'تعذر الاتصال بالخادم المركزي' : 'Unable to connect to the central server');
    } finally {
      setIsLoading(false);
    }
  };

  const t = (ar, en) => (language === 'ar' ? ar : en);

  const handleCaps = (e) => {
    if (e.nativeEvent && e.nativeEvent.getModifierState) {
      try { setCapsLock(e.nativeEvent.getModifierState('CapsLock')); } catch (err) {}
    }
  };

  // تركيبة نصية تتطور مع مراحل السحب
  const slideLabel = dragProgress >= 0.9
    ? t('تم — جاري فتح الوصول', 'Done — opening access')
    : dragProgress >= 0.55
      ? t('استمرّر أكثر…', 'Keep sliding…')
      : dragProgress > 0.12
        ? t('اسحب لفتح الوصول الآمن', 'Slide to unlock secure access')
        : t('اسحب لفتح الوصول الآمن', 'Slide to unlock secure access');

  return (
    <div
      className="relative min-h-screen bg-[var(--bg)] text-[var(--ink)] font-sans overflow-x-hidden selection:bg-[var(--accent)] selection:text-white"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* ═══════════ الخلفية المحيطة (نفس لغة لوحة التحكم) ═══════════ */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[18%] -end-[8%] w-[55vw] h-[55vw] bg-[var(--accent-glow)] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '5s' }} />
        <div className="absolute -bottom-[22%] -start-[10%] w-[48vw] h-[48vw] bg-[var(--accent-glow)] rounded-full blur-[110px] animate-pulse" style={{ animationDuration: '7s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(122,132,152,0.16)_1px,transparent_1.4px)] bg-[length:26px_26px] opacity-40" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />
      </div>

      {/* ═══════════ تحكمات ثابتة: اللغة + الثيم ─────────────── */}
      <button
        type="button"
        onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
        title={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
        aria-label={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
        className="fixed top-4 start-5 z-[60] px-4 py-2 rounded-xl border text-xs font-bold tracking-wider backdrop-blur-md shadow-lg transition-all duration-300 hover:scale-105 hover:border-[var(--accent)] hover:!text-[var(--accent)] border-[var(--border)] bg-[var(--surface)]/70 text-[var(--muted)]"
      >
        {language === 'ar' ? 'EN' : 'AR'}
      </button>

      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t('تفعيل الوضع الفاتح', 'Enable light mode')}
        className="fixed top-4 end-5 z-[60] w-[76px] h-10 rounded-full p-1 bg-[var(--surface-2)] border border-[var(--border)] shadow-[var(--shadow-1)] transition-all duration-300 hover:scale-105 hover:border-[var(--accent)]/60"
      >
        <span className="absolute top-1 start-1 w-4 h-4 text-[var(--faint)] pointer-events-none flex items-center justify-center">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        </span>
        <span className="absolute top-1 end-1 w-4 h-4 text-[var(--faint)] pointer-events-none flex items-center justify-center">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
        </span>
        <span
          className={`absolute top-1 ${theme === 'dark' ? 'start-1' : 'start-[38px]'} w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent)] text-white shadow-[var(--shadow-accent)] transition-[inset-inline-start] duration-300 ease-[cubic-bezier(0.34,1.45,0.64,1)]`}
        >
          {theme === 'dark' ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
          )}
        </span>
      </button>

      {/* ═══════════ بوابة السحب للدخول (Slide to Unlock) ═══════════ */}
      {showGate && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--bg)] ${
            isUnlocking ? 'gate-peel pointer-events-none' : ''
          }`}
          dir="ltr"
        >
          {/* تألق محيطي — يشتغل مع تقدّم السحب */}
          <div className="pointer-events-none absolute -top-[12%] -start-[10%] w-[46vw] h-[46vw] bg-[var(--accent-glow)] rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4.5s', transform: `scale(${1 + dragProgress * 0.28})` }} />
          <div className="pointer-events-none absolute -bottom-[16%] -end-[8%] w-[42vw] h-[42vw] bg-[var(--accent-glow)] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6.5s', transform: `scale(${1 + dragProgress * 0.22})` }} />

          <div className="relative z-10 flex flex-col items-center px-6 py-6 w-full max-w-[440px]">
            {/* 🎉 المفاجأة عند الفتح — «مراسم الافتتاح» تعمل مع كل Refresh */}
            {openingCeremony && (
              <div aria-hidden="true" className="opening-ceremony pointer-events-none absolute inset-0 z-[70]">
                <div className="opening-slash" />
                <span className="opening-spark" style={{ insetInlineStart: '18%', insetBlockStart: '34%', animationDelay: '0.55s' }} />
                <span className="opening-spark" style={{ insetInlineStart: '72%', insetBlockStart: '28%', animationDelay: '0.7s' }} />
                <span className="opening-spark" style={{ insetInlineStart: '56%', insetBlockStart: '70%', animationDelay: '0.85s' }} />
                <span className="opening-spark" style={{ insetInlineStart: '88%', insetBlockStart: '55%', animationDelay: '1s' }} />
              </div>
            )}
            {openingCeremony && <div aria-hidden="true" className="opening-crest-ring" />}
            {/* حلقة تقدم حول الشعار (conic) — تمتلئ مع السحب */}
            <div
              className="relative mb-9"
              style={{
                transform: `translate3d(0, ${-dragProgress * 9}px, 0) scale(${1 - dragProgress * 0.03})`,
                transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.34,1.45,0.64,1)',
              }}
            >
              <div
                className="absolute -inset-2.5 rounded-full"
                style={{ background: `conic-gradient(var(--accent) ${dragProgress * 360}deg, var(--surface-3) 0deg)`, opacity: 0.5 + dragProgress * 0.5, transition: dragProgress === 1 ? 'background 0.4s' : 'none' }}
              />
              <div className="absolute -inset-2.5 rounded-full bg-[var(--surface-3)]" style={{ transform: `rotate(${dragProgress * 360}deg) scale(${dragProgress})`, opacity: dragProgress }} />
              <div className="absolute -inset-2.5 rounded-full shadow-[0_0_34px_var(--accent-glow)] blur-xl" style={{ opacity: dragProgress * 0.55 }} />
              <div className="absolute inset-0 -m-6 rounded-full bg-[var(--accent-glow)] blur-2xl animate-pulse" style={{ animationDuration: '3.5s', opacity: 0.5 + dragProgress * 0.4 }}>
                {dragProgress >= 0.92 && <span className="ripple-burst absolute inset-0 rounded-full bg-[var(--ok)]" />}
              </div>

              <div id="opening-crest" className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full bg-[var(--surface-2)] border border-[var(--border)] shadow-[var(--shadow-3)] flex items-center justify-center transition-colors duration-500 ${dragProgress >= 0.92 ? 'border-[var(--ok)]' : ''}`}>
                <CrescentIcon className={`w-14 h-14 md:w-16 md:h-16 drop-shadow-[0_0_14px_var(--accent-glow)] transition-colors duration-500 ${dragProgress >= 0.92 ? 'text-[var(--ok)]' : 'text-[var(--accent)]'}`} />
              </div>
            </div>

            <h2 className="text-xl md:text-2xl font-extrabold tracking-wide text-center text-[var(--ink)]">
              {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
            </h2>
            <p className="text-sm text-center text-[var(--muted)] mb-7">
              {language === 'ar' ? 'مركز عمليات الطوارئ — EOC' : 'Emergency Operations Center — EOC'}
            </p>

            {/* قراءة النسبة المئوية */}
            <div className="h-6 mb-1 flex items-center justify-center">
              {dragProgress > 0 && dragProgress < 1 && (
                <span className="font-mono text-xs font-bold text-[var(--accent)] tabular-nums">
                  {Math.round(dragProgress * 100)}%
                </span>
              )}
              {dragProgress === 1 && (
                <span className="uppercase tracking-[0.28em] text-[11px] font-bold text-[var(--ok)]">✓ {t('مُفعّل', 'ACTIVATED')}</span>
              )}
            </div>

            {/* مسار السحب */}
            <div
              ref={trackRef}
              className="relative z-10 w-full self-center h-14 rounded-full bg-[var(--surface-2)]/70 border border-[var(--border)] backdrop-blur-md shadow-[var(--shadow-1)] overflow-hidden touch-none select-none"
            >
              {/* خط لمعان داخلي */}
              <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

              {/* علامات المراحل (3 نقاط منطقية — تنعكس تلقائيًا في RTL) */}
              {[0.33, 0.66, 0.92].map((p) => (
                <span key={p} className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[var(--border-strong)]/70" style={{ insetInlineStart: `calc(${p * 100}%)`, transform: 'translate(-50%, -50%)', marginInlineStart: p === 0.92 ? '-6px' : '0' }} />
              ))}

              {/* تعبئة التقدم — تنمو من الشمال إلى اليمين */}
              <div
                className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-gradient-to-r from-[var(--accent-softer)] via-[var(--accent)] to-[var(--accent)]"
                style={{
                  left: 4,
                  width: `${dragX}px`,
                  boxShadow: '0 0 22px var(--accent-glow), inset 0 0 8px rgba(255,255,255,0.08)',
                  transition: isDragging ? 'none' : 'width 0.5s cubic-bezier(0.34,1.45,0.64,1)',
                }}
              />

              {/* ذيل ضوئي خلف المقبض — من الشمال إلى اليمين */}
              <div
                className="pointer-events-none absolute top-1/2 z-[5] w-[72px] h-9 rounded-full bg-[var(--accent-glow)] blur-xl"
                style={{
                  left: 4,
                  width: `${dragX}px`,
                  transform: `translate3d(0, -50%, 0)`,
                  opacity: dragProgress * 0.5,
                  transition: isDragging ? 'none' : 'opacity 0.5s cubic-bezier(0.34,1.45,0.64,1)',
                }}
              />

              {/* النص التوجيهي المتطور */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[var(--muted)] text-xs sm:text-sm font-semibold tracking-wide"
                style={{ opacity: 1 - dragProgress }}
              >
                <ShieldIcon />
                <span className="whitespace-nowrap">{slideLabel}</span>
                <ChevronsIcon />
              </div>

              {/* المقبض — يتحرك فيزيائيًا من الشمال إلى اليمين */}
              <div
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
                aria-label={language === 'ar' ? 'اسحب لفتح الوصول' : 'Slide to unlock'}
                style={{
                  left: 4,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  transform: `translateX(${dirSign * dragX}px)`,
                  transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.34,1.45,0.64,1)',
                }}
                className={`absolute top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-full ${isDragging ? 'scale-110' : ''} ${isUnlocking ? 'pointer-events-none' : ''}`}
              >
                {/* هالة متتبعة للمقبض — تنفّس إرشادي عند السكون فقط */}
                <span className={`absolute -inset-2 rounded-full bg-[var(--accent-glow)] blur-md ${!isDragging && !isUnlocking ? 'handle-breathe' : 'opacity-70'}`} />
                {isUnlocking && <span className="absolute inset-0 rounded-full bg-[var(--ok)] animate-ping opacity-50" />}
                {isUnlocking && <span className="ripple-burst absolute inset-6 rounded-full border-2 border-[var(--ok)]" />}
                {/* قلب المقبض */}
                <span className={`relative h-full w-full rounded-full flex items-center justify-center text-white shadow-[var(--shadow-accent)] transition-colors duration-300 ${isUnlocking ? 'bg-[var(--ok)]' : 'bg-[var(--accent)]'}`}>
                  {isUnlocking ? (
                    <svg viewBox="0 0 100 100" className="w-6 h-6 drop-shadow animate-scale-pop">
                      <path d="M 22 55 L 42 75 L 80 32" fill="none" stroke="white" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <CrescentIcon className="w-6 h-6 drop-shadow-sm" />
                  )}
                </span>
              </div>
            </div>

            <p className="mt-7 text-[11px] text-[var(--faint)] tracking-wide font-mono">
              {language === 'ar' ? 'بوابة الدخول المشفّرة · EOC SECURE GATE' : 'ENCRYPTED ACCESS GATE · EOC SECURE GATE'}
            </p>
          </div>
        </div>
      )}

      {/* ═══════════ كارت القيادة (Command Deck) ═══════════ */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4 sm:p-8">
        <div
          className={`w-full max-w-[860px] bg-[var(--surface)]/85 backdrop-blur-2xl rounded-[2rem] border border-[var(--border)] shadow-[var(--shadow-3)] flex flex-col overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isMounted ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
          }`}
        >
          {/* ─── الرباط العلوي: هوية القيادة + الحالة الحية ─── */}
          <div className="relative shrink-0 bg-gradient-to-r from-[#a00606] via-[#c70000] to-[#8d0a0a] text-white px-5 sm:px-8 py-4 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle,white_1px,transparent_1.5px)] bg-[length:20px_20px]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 shrink-0 bg-white rounded-xl flex items-center justify-center shadow-lg">
                  <CrescentIcon className="w-7 h-7 text-[#c70000]" />
                </span>
                <div className="min-w-0">
                  <p className="font-extrabold text-sm sm:text-base leading-tight tracking-tight">
                    {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
                  </p>
                  <p className="text-white/75 text-[11px] sm:text-xs font-medium">
                    {language === 'ar' ? 'مركز عمليات الطوارئ · نظام الإدارة' : 'Emergency Operations Center · Command System'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4">
                <span className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-black/25 backdrop-blur-sm border border-white/15 px-3 py-1.5">
                  <span className="live-blink w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white]" />
                  <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em]">LIVE</span>
                </span>
                <span className="rounded-lg bg-black/25 backdrop-blur-sm border border-white/15 px-3 py-1.5 font-mono text-[11px] sm:text-xs tabular-nums tracking-widest">
                  {opsNow.toLocaleTimeString('en-GB', { hour12: false })}
                </span>
                <span className="hidden md:inline-flex items-center gap-3 text-white/60 text-[10px] font-mono tracking-widest">
                  <span>EOC · OPS</span>
                  <span>v2.0.0</span>
                </span>
              </div>
            </div>
          </div>

          {/* ─── الجسم: الجاهزية (يمينً/شمالًا) + نموذج الوصول ─── */}
          <div className="flex flex-col">
            {/* شريط الجاهزية الموحّد: رادار مركزي + قياسات صفّية متناظرة (جزء من الكارت الواحد) */}
            <div className="relative overflow-hidden px-6 sm:px-8 pt-8 pb-6 flex flex-col items-center gap-6 bg-[var(--surface-2)]/45 border-b border-[var(--border)]/70">
              <div className="pointer-events-none absolute -top-20 start-1/2 -translate-x-1/2 w-80 h-48 rounded-full bg-[var(--accent-glow)] blur-[95px] opacity-35" />

              {/* الرادار (مصغّر ومركزي) */}
              <div className="relative shrink-0 w-24 h-24 rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)]/70 overflow-hidden">
                <div className="radar-sweep absolute inset-0" style={{ background: 'conic-gradient(from 0deg, var(--accent-glow) 0deg, transparent 72deg)' }} />
                <span className="absolute inset-[18%] rounded-full border border-[var(--border)]" />
                <span className="absolute inset-[38%] rounded-full border border-[var(--border)]" />
                <span className="absolute top-[12%] end-[24%] w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                <span className="absolute bottom-[20%] start-[22%] w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" style={{ animationDelay: '1.2s' }} />
                <span className="absolute inset-0 flex items-center justify-center">
                  <CrescentIcon className="w-6 h-6 text-[var(--accent)] opacity-90" />
                </span>
              </div>

              {/* القياسات: صف ثلاثي متناظر */}
              <div className="w-full max-w-md grid grid-cols-3 gap-6 sm:gap-8">
                {[
                  { key: 'readiness', label: language === 'ar' ? 'جاهزية العمليات' : 'Ops readiness', val: 100, color: 'var(--accent)' },
                  { key: 'field', label: language === 'ar' ? 'الربط الميداني' : 'Field-team link', val: 100, color: 'var(--ok)' },
                  { key: 'secure', label: language === 'ar' ? 'تشفير القناة' : 'Channel encryption', val: 100, color: 'var(--ok)' },
                ].map((g) => (
                  <div key={g.key} className="min-w-0 flex flex-col items-center gap-2">
                    <span className="font-mono text-xl font-bold tabular-nums leading-none" style={{ color: g.color }}>{g.val}<span className="text-[10px] text-[var(--muted)]">%</span></span>
                    <div className="h-1 w-full rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <div className="ops-gauge-fill h-full rounded-full" style={{ width: gaugesOn ? `${g.val}%` : '0%', background: `linear-gradient(90deg, ${g.color}, var(--accent-glow))`, boxShadow: `0 0 10px ${g.color}` }} />
                    </div>
                    <span className="text-[10px] font-bold text-[var(--muted)] truncate max-w-full">{g.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* نموذج الوصول الموحّد */}
            <div
              key={showGate ? 'gate' : 'form'}
              className="p-7 sm:p-10 lg:p-10"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-8 lg:gap-12">
                {/* عمود المقدمة/الثقة — نفس المحتوى، يُعاد توزيعه ليستخدم عرض الكارت بالكامل */}
                <div className="w-full max-w-md mx-auto lg:max-w-none lg:mx-0 flex flex-col gap-4 lg:gap-5 lg:pt-1">
                  <div>
                    <span className="eyebrow mb-3">
                      {language === 'ar' ? 'بوابة الدخول' : 'SECURE ACCESS'}
                    </span>
                    <h3 className="text-2xl md:text-[1.7rem] font-bold text-[var(--ink)] tracking-tight">
                      {language === 'ar' ? 'بوابة الوصول الآمن' : 'Secure Access Portal'}
                    </h3>
                    <p className="text-[var(--muted)] text-sm mt-1.5 leading-relaxed">
                      {language === 'ar'
                        ? 'أدخل بيانات الاعتماد الموثقة للمتابعة إلى مركز العمليات.'
                        : 'Enter your verified credentials to continue into the operations center.'}
                    </p>
                  </div>
                  <div className="hidden lg:flex items-center gap-2 text-[var(--faint)] text-xs">
                    <span className="text-[var(--ok)]"><ShieldIcon /></span>
                    <span className="font-mono tracking-wide">
                      {language === 'ar' ? 'قناة مشفرة · دخول موثّق فقط' : 'TLS ENCRYPTED · AUTHENTICATED ONLY'}
                    </span>
                  </div>
                </div>

                {/* عمود النموذج */}
                <div className="w-full max-w-md mx-auto lg:max-w-none lg:mx-0 stagger flex flex-col gap-5">

                {errorMsg && (
                  <div className="error-shake flex items-start gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-softer)] px-4 py-3 text-[var(--ink)]" style={{ animation: 'fade-in 0.35s var(--ease-out)' }}>
                    <span className="text-[var(--accent)]"><AlertIcon /></span>
                    <div className="text-sm leading-snug">
                      <p className="font-bold mb-0.5">{language === 'ar' ? 'تعذّر الدخول' : 'Sign-in failed'}</p>
                      <p className="text-[var(--muted)]">{errorMsg}</p>
                    </div>
                  </div>
                )}

                <form onSubmit={handleLogin} className="group/form flex flex-col gap-5" autoComplete="off">
                  <div className="group">
                    <label className="block text-xs font-bold text-[var(--muted)] mb-2 tracking-wide uppercase">
                      {language === 'ar' ? 'الرقم التعريفي / المستخدم' : 'ID / Username'}
                    </label>
                    <div className="relative">
                      <span className="absolute start-4 top-1/2 -translate-y-1/2 text-[var(--faint)] transition-colors duration-300 group-focus-within:text-[var(--accent)]">
                        <UserIcon />
                      </span>
                      <input
                        ref={usernameRef}
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={language === 'ar' ? 'أدخل رقمك التعريفي' : 'Enter your ID'}
                        autoComplete="new-password"
                        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] py-4 ps-12 pe-4 text-[var(--ink)] placeholder-[var(--faint)] outline-none transition-all duration-300 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)]"
                      />
                    </div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-[var(--muted)] mb-2 tracking-wide uppercase">
                      {language === 'ar' ? 'رمز المرور السري' : 'Secret password'}
                    </label>
                    <div className="relative">
                      <span className="absolute start-4 top-1/2 -translate-y-1/2 text-[var(--faint)] transition-colors duration-300 group-focus-within:text-[var(--accent)]">
                        <LockIcon />
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyUp={handleCaps}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] py-4 ps-12 pe-12 text-[var(--ink)] placeholder-[var(--faint)] outline-none transition-all duration-300 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)] tracking-widest font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? (language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (language === 'ar' ? 'إظهار كلمة المرور' : 'Show password')}
                        className="absolute end-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[var(--faint)] hover:text-[var(--ink)] transition-colors"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    {capsLock && (
                      <p className="mt-1.5 text-[11px] font-semibold text-[var(--warn)] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)] animate-pulse" />
                        {language === 'ar' ? 'مفتاح Caps Lock مفعّل — راجع حالة الأحرف' : 'Caps Lock is on — check letter case'}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="relative mt-2 w-full overflow-hidden rounded-2xl bg-[var(--accent)] text-white font-bold py-4 text-sm flex items-center justify-center gap-2 shadow-[0_10px_30px_-8px_var(--accent-glow)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-8px_var(--accent-glow)] active:translate-y-0 active:scale-[0.985] disabled:opacity-80 disabled:pointer-events-none"
                  >
                    {isLoading && (
                      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                        <span
                          className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                          style={{ animation: 'slide-sheen 1.1s var(--ease-out) infinite' }}
                        />
                      </span>
                    )}
                    {isLoading && <SpinnerIcon />}
                    {isLoading
                      ? (language === 'ar' ? 'جاري التحقق من الهوية…' : 'Verifying identity…')
                      : (language === 'ar' ? 'تأكيد الدخول' : 'Sign In')}
                  </button>
                </form>

                <div className="flex items-center gap-2 text-[var(--faint)] text-xs lg:hidden">
                  <span className="text-[var(--ok)]"><ShieldIcon /></span>
                  <span className="font-mono tracking-wide">
                    {language === 'ar' ? 'قناة مشفرة · دخول موثّق فقط' : 'TLS ENCRYPTED · AUTHENTICATED ONLY'}
                  </span>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}