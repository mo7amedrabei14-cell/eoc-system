import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
const [isMounted, setIsMounted] = useState(false);

const [language, setLanguage] = useState(() => {
  return localStorage.getItem('dashboard-language') || 'ar';
});

useEffect(() => {
  localStorage.setItem('dashboard-language', language);
}, [language]);

const [theme, setTheme] = useState(() => {
  return localStorage.getItem('dashboard-theme') || 'dark';
});

useEffect(() => {
  localStorage.setItem('dashboard-theme', theme);
}, [theme]);


  // --- بوابة السحب للدخول (Slide to Unlock) ---
  const [showGate, setShowGate] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragProgress, setDragProgress] = useState(0);
  const trackRef = useRef(null);
  const HANDLE_SIZE = 60;

  // دي الأداة اللي هتنقلنا للصفحة التانية
  const navigate = useNavigate();

  const completeUnlock = (maxX) => {
    setIsDragging(false);
    setDragX(maxX);
    setDragProgress(1);
    setIsUnlocking(true);
    setTimeout(() => setIsMounted(true), 150);   // كارت الدخول يبدأ يظهر
    setTimeout(() => setShowGate(false), 750);   // البوابة تتشال من الـ DOM
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
        localStorage.setItem('user', JSON.stringify(data.user)); // 👈 السطر ده ضفناه عشان نحفظ بياناتك
        navigate('/dashboard');
      } else {
        setErrorMsg(
  language === 'ar' ? 'بيانات الدخول غير صحيحة' : 'Invalid login credentials'
);

      }
    } catch (err) {
      setErrorMsg(
  language === 'ar'
    ? 'تعذر الاتصال بالخادم المركزي'
    : 'Unable to connect to the central server'
);

    } finally {
      setIsLoading(false);
    }
  };

  return (
    // نفس التصميم اللي اتفقنا عليه بالظبط
        <div className={`${theme === 'light' ? 'login-light' : ''} min-h-screen bg-[#050505] flex items-center justify-center p-4 sm:p-8 relative font-sans selection:bg-[#c70000] selection:text-white`} dir={language === 'ar' ? 'rtl' : 'ltr'}>

      <style>{`
        .login-light { background: #f4f6f8 !important; }
        .login-light .login-card { background-color: rgba(255, 255, 255, 0.92) !important; border-color: #d9e1e8 !important; }
        .login-light .login-form-panel { background-image: linear-gradient(135deg, #ffffff 0%, #eef2f5 100%) !important; }
        .login-light .login-form-panel h3 { color: #17202a !important; }
        .login-light .login-form-panel p,
        .login-light .login-form-panel .text-gray-400 { color: #64748b !important; }
        .login-light .login-form-panel [class~="bg-[#1a1a1a]"] { background-color: #f8fafc !important; border-color: #d9e1e8 !important; }
        .login-light .login-form-panel input { color: #17202a !important; }
      `}</style>

      <button
        type="button"
        onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
        title={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
        className="fixed top-5 left-5 z-[100] px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-bold backdrop-blur-md shadow-lg transition-all duration-300 hover:bg-[#c70000] hover:border-[#c70000] hover:scale-105"
      >
        {language === 'ar' ? 'EN' : 'عربي'}
      </button>

      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? (language === 'ar' ? 'تفعيل الوضع الفاتح' : 'Enable light mode') : (language === 'ar' ? 'تفعيل الوضع الداكن' : 'Enable dark mode')}
        aria-label={theme === 'dark' ? (language === 'ar' ? 'تفعيل الوضع الفاتح' : 'Enable light mode') : (language === 'ar' ? 'تفعيل الوضع الداكن' : 'Enable dark mode')}
        className="fixed top-5 right-5 z-[100] w-[76px] h-10 rounded-full p-1 bg-[#171717] border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.25)] transition-all duration-300 hover:scale-105 hover:border-[#c70000]/50"
      >
        <span
          className={`absolute top-1 w-8 h-8 rounded-full flex items-center justify-center bg-[#c70000] text-white shadow-[0_0_15px_rgba(199,0,0,0.45)] transition-all duration-300 ${theme === 'dark' ? 'right-1' : 'right-[38px]'}`}
        >
          {theme === 'dark' ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          )}
        </span>
      </button>

      {showGate && (

        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050505] transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${
            isUnlocking ? 'opacity-0 scale-110 blur-md pointer-events-none' : 'opacity-100 scale-100'
          }`}
        >
          <div className="absolute -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-[#c70000]/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }}></div>
          <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] bg-[#c70000]/5 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s' }}></div>

          <div className="relative z-10 mb-10">
            <div className="absolute inset-0 -m-4 rounded-full bg-[#c70000]/30 blur-2xl animate-pulse" style={{ animationDuration: '3s' }}></div>
            <svg viewBox="0 0 100 100" className="relative w-28 h-28 md:w-32 md:h-32 drop-shadow-[0_0_30px_rgba(199,0,0,0.55)]">
              <path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" fill="#c70000" />
            </svg>
          </div>

          <h2 className="relative z-10 text-white text-xl md:text-2xl font-bold mb-1 tracking-wide">
  {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
</h2>
<p className="relative z-10 text-white/40 text-sm mb-14">
  {language === 'ar' ? 'مركز عمليات الطوارئ' : 'Emergency Operations Center'}
</p>


          <div
            ref={trackRef}
            className="relative z-10 w-[300px] md:w-[340px] h-16 rounded-full bg-white/5 border border-white/10 backdrop-blur-md overflow-hidden"
          >
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#c70000]/10 to-[#c70000]/50"
              style={{ width: `${dragX + HANDLE_SIZE / 2}px`, transition: isDragging ? 'none' : 'width 0.4s cubic-bezier(0.34,1.56,0.64,1)' }}
            ></div>

            <div
              className="absolute inset-0 flex items-center justify-center gap-1.5 text-white/50 text-sm font-semibold tracking-wide select-none pointer-events-none"
              style={{ opacity: 1 - dragProgress }}
            >
              <span>
  {language === 'ar' ? 'اسحب لليمين للوصول الآمن' : 'Swipe right for secure access'}
</span>

              <span className="flex">
                <span className="animate-pulse" style={{ animationDelay: '0s' }}>›</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>›</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>›</span>
              </span>
            </div>

            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                transform: `translateX(${dragX}px)`,
                transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)',
              }}
              className={`absolute top-1 left-1 rounded-full bg-[#c70000] shadow-[0_0_20px_rgba(199,0,0,0.6)] flex items-center justify-center cursor-grab active:cursor-grabbing touch-none ${
                isUnlocking ? 'scale-110' : ''
              }`}
            >
              <svg viewBox="0 0 100 100" className="w-6 h-6">
                <path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" fill="white" />
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-[#c70000]/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }}></div>
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] bg-[#c70000]/5 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s' }}></div>
      </div>

      <div className={`login-card relative z-10 w-full max-w-5xl bg-[#0c0c0c]/80 backdrop-blur-2xl rounded-[2rem] border border-white/5 shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col md:flex-row overflow-hidden transition-all duration-1000 ease-out transform ${isMounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
        
        <div className="md:w-5/12 bg-[#c70000] p-10 md:p-14 flex flex-col justify-between relative overflow-hidden shadow-[inset_-20px_0_40px_rgba(0,0,0,0.2)]">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,white_1px,transparent_1.5px)] bg-[length:24px_24px]"></div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/40"></div>
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-8 shadow-2xl transform transition hover:scale-110 hover:rotate-3 duration-500 p-2">
              <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm">
                {/* هلال أحمر كلاسيكي صافي */}
                <path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" fill="#c70000" />
              </svg>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4 drop-shadow-md">
  {language === 'ar' ? 'الهلال الأحمر المصري' : 'Egyptian Red Crescent'}
</h2>
<p className="text-white/80 text-lg font-medium leading-relaxed">
  {language === 'ar'
    ? 'نظام إدارة مركز عمليات الطوارئ (EOC) للاستجابة السريعة وإدارة الأزمات.'
    : 'Emergency Operations Center (EOC) management system for rapid response and crisis management.'}
</p>

          </div>
          <div className="relative z-10 mt-12 md:mt-0 flex items-center justify-between">
            <div className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-full border border-white/10 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_#4ade80]"></div>
              <span className="text-white/90 text-sm font-semibold tracking-wider">
  {language === 'ar' ? 'النظام مشفر ومتصل' : 'System encrypted and connected'}
</span>

            </div>
          </div>
        </div>

        <div className="login-form-panel md:w-7/12 p-10 md:p-16 flex flex-col justify-center bg-gradient-to-br from-[#111] to-[#0a0a0a]">
          <div className="mb-10">
            <h3 className="text-2xl font-bold text-white mb-2">
  {language === 'ar' ? 'بوابة الوصول الآمن' : 'Secure Access Portal'}
</h3>
<p className="text-gray-400 text-sm">
  {language === 'ar'
    ? 'الرجاء إدخال بيانات الاعتماد الموثقة للمتابعة.'
    : 'Please enter your verified credentials to continue.'}
</p>

          </div>
          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl border border-[#c70000]/30 bg-[#c70000]/10 text-[#ff4d4d] text-sm animate-pulse flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-6" autoComplete="off">
            <div className="space-y-2 group">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider group-focus-within:text-[#c70000] transition-colors">
  {language === 'ar' ? 'الرقم التعريفي / المستخدم' : 'ID / Username'}
</label>

              <div className="relative">
                <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-[#c70000] focus:ring-1 focus:ring-[#c70000] transition-all duration-300" placeholder={language === 'ar' ? 'أدخل البيانات هنا' : 'Enter your credentials here'} autoComplete="new-password" />
              </div>
            </div>
            <div className="space-y-2 group">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider group-focus-within:text-[#c70000] transition-colors">
  {language === 'ar' ? 'رمز المرور السري' : 'Secret Password'}
</label>
              </div>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4 pl-12 text-white placeholder-gray-600 focus:outline-none focus:border-[#c70000] focus:ring-1 focus:ring-[#c70000] transition-all duration-300 tracking-widest font-mono" placeholder="••••••••" autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors focus:outline-none">
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoading} className="w-full mt-6 relative overflow-hidden group bg-[#c70000] hover:bg-[#a50000] text-white font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(199,0,0,0.2)] hover:shadow-[0_0_35px_rgba(199,0,0,0.5)] transition-all duration-300 disabled:opacity-50 flex justify-center items-center gap-2 transform hover:-translate-y-1">
              <span className="relative flex items-center gap-2">
                {isLoading
  ? (language === 'ar' ? 'جاري التحقق...' : 'Verifying...')
  : (language === 'ar' ? 'تأكيد الدخول' : 'Sign In')}

              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
