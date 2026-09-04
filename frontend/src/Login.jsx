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

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showGate, setShowGate] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  /* ── اللغة والثيم: نفس مفاتيح لوحة التحكم بالضبط ───────────── */
  const [language, setLanguage] = useState(() => localStorage.getItem('dashboard-language') || 'ar');
  const [theme, setTheme] = useState(() => localStorage.getItem('dashboard-theme') || 'dark');

  useEffect(() => {
    localStorage.setItem('dashboard-language', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('dashboard-theme', theme);
    // ⭐ الجذر الحقيقي للثيم: <html> هو اللي بيوصل الـ data-theme لقواعد :root[data-theme=...]
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const navigate = useNavigate();

  /* ── بوابة السحب للدخول (Slide to Unlock) ─────────────────── */
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragProgress, setDragProgress] = useState(0);
  const trackRef = useRef(null);
  const HANDLE_SIZE = 60;

  const completeUnlock = (maxX) => {
    setIsDragging(false);
    setDragX(maxX);
    setDragProgress(1);
    setIsUnlocking(true);
    setTimeout(() => setIsMounted(true), 160);      // كارت الدخول يبدأ بالدخول
    setTimeout(() => setShowGate(false), 820);       // البوابة تُزال من الـ DOM
  };

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const maxX = trackRect.width - HANDLE_SIZE - 8;
    let newX = e.clientX - trackRect.left - HANDLE_SIZE / 2;
    newX = Math.max(0, Math.min(newX, maxX));
    setDragX(newX);
    setDragProgress(maxX > 0 ? newX / maxX : 0);
    if (maxX > 0 && newX >= maxX * 0.92) completeUnlock(maxX);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (trackRef.current) {
      const trackRect = trackRef.current.getBoundingClientRect();
      const maxX = trackRect.width - HANDLE_SIZE - 8;
      if (dragX < maxX * 0.92) {
        setDragX(0);
        setDragProgress(0);
      }
    }
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

  return (
    <div
      className="relative min-h-screen bg-[var(--bg)] text-[var(--ink)] font-sans overflow-x-hidden selection:bg-[var(--accent)] selection:text-white"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* ═══════════ الخلفية المحيطة (نفس لغة لوحة التحكم) ═══════════ */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* توهّج accent علوي + سفلي */}
        <div className="absolute -top-[18%] -end-[8%] w-[55vw] h-[55vw] bg-[var(--accent-glow)] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '5s' }} />
        <div className="absolute -bottom-[22%] -start-[10%] w-[48vw] h-[48vw] bg-[var(--accent-glow)] rounded-full blur-[110px] animate-pulse" style={{ animationDuration: '7s' }} />
        {/* شبكة نقاط دقيقة (محايدة في الثيمين) */}
        <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(122,132,152,0.16)_1px,transparent_1.4px)] bg-[length:26px_26px] opacity-40" />
        {/* حافة علوية مضيئة */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />
      </div>

      {/* ═══════════ تحكمات ثابتة: اللغة + الثيم (زوايا منطقية متوافقة مع RTL) ═══════════ */}
      <button
        type="button"
        onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
        className="fixed top-4 start-5 z-[60] px-4 py-2 rounded-xl border text-xs font-bold tracking-wider backdrop-blur-md shadow-lg transition-all duration-300 hover:scale-105 hover:border-[var(--accent)] hover:!text-[var(--accent)] border-[var(--border)] bg-[var(--surface)]/70 text-[var(--muted)]"
      >
        {language === 'ar' ? 'EN' : 'عربي'}
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
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--bg)] transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${
            isUnlocking ? 'opacity-0 scale-110 blur-md pointer-events-none' : 'opacity-100 scale-100'
          }`}
          dir={language === 'ar' ? 'rtl' : 'ltr'}
        >
          {/* تألق محيطي خلف الشعار */}
          <div className="pointer-events-none absolute -top-[12%] -start-[10%] w-[46vw] h-[46vw] bg-[var(--accent-glow)] rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4.5s' }} />
          <div className="pointer-events-none absolute -bottom-[16%] -end-[8%] w-[42vw] h-[42vw] bg-[var(--accent-glow)] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6.5s' }} />

          <div className="relative z-10 flex flex-col items-center px-6 py-8">
            {/* شعار الهلال مع هالة تنفّس */}
            <div className="relative mb-8">
              <div className="absolute inset-0 -m-5 rounded-full bg-[var(--accent-glow)] blur-2xl animate-pulse" style={{ animationDuration: '3.5s' }} />
              <div className="relative w-24 h-24 md:w-28 md:h-28 rounded-3xl bg-[var(--surface-2)] border border-[var(--border)] shadow-[var(--shadow-3)] flex items-center justify-center">
                <CrescentIcon className="w-14 h-14 md:w-16 md:h-16 text-[var(--accent)] drop-shadow-[0_0_14px_var(--accent-glow)]" />
              </div>
            </div>

            <h2 className="text-xl md:text-2xl font-bold tracking-wide text-center text-[var(--ink)]">
              {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
            </h2>
            <p className={`text-sm text-center ${theme === 'light' ? 'text-[var(--muted)]' : 'text-[var(--muted)]'} mb-12`}>
              {language === 'ar' ? 'مركز عمليات الطوارئ' : 'Emergency Operations Center'}
            </p>

            {/* مسار السحب */}
            <div
              ref={trackRef}
              className="relative z-10 w-[calc(100vw-3rem)] max-w-[360px] self-center h-16 rounded-full bg-[var(--surface-2)]/70 border border-[var(--border)] backdrop-blur-md shadow-[var(--shadow-1)] overflow-hidden touch-none select-none"
            >
              {/* خط لمعان داخلي */}
              <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

              {/* تعبئة التقدم */}
              <div
                className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-gradient-to-r from-[var(--accent-softer)] via-[var(--accent)] to-[var(--accent)]"
                style={{
                  width: `${dragX}px`,
                  boxShadow: '0 0 22px var(--accent-glow), inset 0 0 8px rgba(255,255,255,0.08)',
                  transition: isDragging ? 'none' : 'width 0.5s cubic-bezier(0.34,1.45,0.64,1)',
                }}
              />

              {/* النص التوجيهي */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[var(--muted)] text-xs sm:text-sm font-semibold tracking-wide"
                style={{ opacity: 1 - dragProgress }}
              >
                <ShieldIcon />
                <span className="whitespace-nowrap">{language === 'ar' ? 'اسحب لفتح الوصول الآمن' : 'Slide to unlock secure access'}</span>
                <ChevronsIcon />
              </div>

              {/* المقبض */}
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(dragProgress * 100)}
                aria-label={language === 'ar' ? 'اسحب لفتح الوصول' : 'Slide to unlock'}
                style={{
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  transform: `translateX(${dragX}px)`,
                  transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.34,1.45,0.64,1)',
                }}
                className={`absolute top-1/2 left-1 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing touch-none select-none ${isDragging ? 'scale-110' : ''} ${isUnlocking ? 'pointer-events-none' : ''}`}
              >
                {/* هالة متتبعة للمقبض */}
                <span className="absolute -inset-2 rounded-full bg-[var(--accent-glow)] blur-md opacity-70" />
                {isUnlocking && <span className="absolute inset-0 rounded-full bg-[var(--ok)] animate-ping opacity-50" />}
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

            <p className={`mt-6 text-[11px] ${theme === 'light' ? 'text-[var(--faint)]' : 'text-[var(--faint)]'} tracking-wide font-mono`}>
              {language === 'ar' ? 'بوابة الدخول المشفّرة · EOC SECURE GATE' : 'ENCRYPTED ACCESS GATE · EOC SECURE GATE'}
            </p>
          </div>
        </div>
      )}

      {/* ═══════════ كارت الدخول (Command Center) ═══════════ */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4 sm:p-8">
        <div
          className={`w-full max-w-[1120px] bg-[var(--surface)]/80 backdrop-blur-2xl rounded-[2rem] border border-[var(--border)] shadow-[var(--shadow-3)] flex flex-col md:flex-row overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isMounted ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
          }`}
        >
          {/* ─── اللوحة اليسرى: هوية قيادة العمليات ─── */}
          <div className="relative w-full md:w-5/12 bg-gradient-to-br from-[#d20d0d] via-[var(--accent)] to-[#5c0000] text-white p-8 md:p-12 overflow-hidden flex flex-col justify-between shadow-[inset_-20px_0_40px_rgba(0,0,0,0.22)]">
            {/* شبكة نقاط هادئة + توهج سفلي */}
            <div className="pointer-events-none absolute inset-0 opacity-10 bg-[radial-gradient(circle,white_1px,transparent_1.5px)] bg-[length:24px_24px]" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/40" />
            {/* هالة زاويّة */}
            <div className="pointer-events-none absolute -top-24 -end-24 w-64 h-64 rounded-full bg-white/10 blur-[80px]" />

            <div className="relative z-10">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-8 shadow-2xl transition-transform duration-500 hover:scale-110 hover:rotate-3">
                <CrescentIcon className="w-11 h-11 text-[var(--accent)]" />
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4 drop-shadow-md">
                {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
              </h2>
              <p className="text-white/80 text-base md:text-lg font-medium leading-relaxed">
                {language === 'ar'
                  ? 'نظام إدارة مركز عمليات الطوارئ (EOC) للاستجابة السريعة وإدارة الأزمات.'
                  : 'Emergency Operations Center (EOC) management system for rapid response and crisis management.'}
              </p>
            </div>

            {/* تليمترية حالة النظام (قارئ حي مدمج، بدون أي استدعاءات Backend) */}
            <div className="relative z-10 mt-10 md:mt-6 space-y-1">
              <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 mb-3">
                {language === 'ar' ? 'حالة المنظومة' : 'SYSTEM STATUS'}
              </p>
              {[
                { label: language === 'ar' ? 'الربط اللحظي بالفرق الميدانية' : 'Field-team live link', value: language === 'ar' ? 'متصل' : 'LIVE' },
                { label: language === 'ar' ? 'تشفير القناة والأمان' : 'Channel encryption', value: language === 'ar' ? 'مشفر' : 'SECURE' },
                { label: language === 'ar' ? 'جاهزية مركز العمليات' : 'Operations readiness', value: language === 'ar' ? 'جاهز' : 'READY' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 backdrop-blur-sm border border-white/10 px-4 py-2.5">
                  <span className="text-white/80 text-xs font-semibold">{row.label}</span>
                  <span className="inline-flex items-center gap-2 text-white/95 text-[11px] font-bold tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse shadow-[0_0_8px_#4ade80]" />
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="relative z-10 mt-8 hidden md:flex items-center justify-between">
              <span className="text-white/50 text-[11px] font-mono tracking-widest">EOC · OPS</span>
              <span className="text-white/50 text-[11px] font-mono tracking-widest">v2.0.0</span>
            </div>
          </div>

          {/* ─── اللوحة اليمنى: نموذج الوصول الآمن ─── */}
          <div
            key={showGate ? 'gate' : 'form'}
            className="flex-1 md:w-7/12 p-8 md:p-12 lg:p-14 bg-[var(--surface)]"
          >
            <div className="stagger flex flex-col gap-5 max-w-md mx-auto md:mx-0 w-full">
              {/* العنوان */}
              <div className="mb-2">
                <span className="eyebrow mb-3">
                  {language === 'ar' ? 'بوابة الدخول' : 'SECURE ACCESS'}
                </span>
                <h3 className="text-2xl md:text-[1.7rem] font-bold text-[var(--ink)] tracking-tight">
                  {language === 'ar' ? 'بوابة الوصول الآمن' : 'Secure Access Portal'}
                </h3>
                <p className="text-[var(--muted)] text-sm mt-1.5">
                  {language === 'ar'
                    ? 'أدخل بيانات الاعتماد الموثقة للمتابعة إلى مركز العمليات.'
                    : 'Enter your verified credentials to continue into the operations center.'}
                </p>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-softer)] px-4 py-3 text-[var(--ink)]" style={{ animation: 'fade-in 0.35s var(--ease-out)' }}>
                  <span className="text-[var(--accent)]"><AlertIcon /></span>
                  <div className="text-sm leading-snug">
                    <p className="font-bold mb-0.5">{language === 'ar' ? 'تعذّر الدخول' : 'Sign-in failed'}</p>
                    <p className="text-[var(--muted)]">{errorMsg}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin} className="group/form flex flex-col gap-5" autoComplete="off">
                {/* اسم المستخدم */}
                <div className="group">
                  <label className="block text-xs font-bold text-[var(--muted)] mb-2 tracking-wide uppercase">
                    {language === 'ar' ? 'الرقم التعريفي / المستخدم' : 'ID / Username'}
                  </label>
                  <div className="relative">
                    <span className="absolute start-4 top-1/2 -translate-y-1/2 text-[var(--faint)] transition-colors duration-300 group-focus-within:text-[var(--accent)]">
                      <UserIcon />
                    </span>
                    <input
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

                {/* كلمة المرور */}
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
                </div>

                {/* زر الدخول */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="relative mt-2 w-full overflow-hidden rounded-2xl bg-[var(--accent)] text-white font-bold py-4 text-sm flex items-center justify-center gap-2 shadow-[0_10px_30px_-8px_var(--accent-glow)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-8px_var(--accent-glow)] active:translate-y-0 active:scale-[0.985] disabled:opacity-80 disabled:pointer-events-none"
                >
                  {/* وميض التحميل */}
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

              {/* سطر الطمأنة */}
              <div className="flex items-center gap-2 text-[var(--faint)] text-xs">
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
  );
}