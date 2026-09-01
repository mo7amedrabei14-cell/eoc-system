import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isMounted, setIsMounted] = useState(false); 
  const [isLoginRevealed, setIsLoginRevealed] = useState(false);
const [dragProgress, setDragProgress] = useState(0);
const [isDragging, setIsDragging] = useState(false);
const [dragStartX, setDragStartX] = useState(0);


  // دي الأداة اللي هتنقلنا للصفحة التانية
  const navigate = useNavigate();

  useEffect(() => { setIsMounted(true); }, []);

  const handleDragStart = (e) => {
  if (isLoginRevealed) return;

  setDragStartX(e.clientX);
  setIsDragging(true);

  if (e.currentTarget.setPointerCapture) {
    e.currentTarget.setPointerCapture(e.pointerId);
  }
};

const handleDragMove = (e) => {
  if (!isDragging || isLoginRevealed) return;

  const distance = Math.max(0, e.clientX - dragStartX);
  const progress = Math.min(distance / 300, 1);

  setDragProgress(progress);

  if (progress >= 0.92) {
    setDragProgress(1);

    setTimeout(() => {
      setIsLoginRevealed(true);
      setIsDragging(false);
      setDragProgress(0);
    }, 280);
  }
};

const handleDragEnd = () => {
  if (!isLoginRevealed) {
    setDragProgress(0);
  }

  setIsDragging(false);
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
        setErrorMsg('بيانات الدخول غير صحيحة');
      }
    } catch (err) {
      setErrorMsg('تعذر الاتصال بالخادم المركزي');
    } finally {
      setIsLoading(false);
    }
  };

  return (


    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 sm:p-8 relative font-sans selection:bg-[#c70000] selection:text-white" dir="rtl">

      {!isLoginRevealed && (
  <div
    className="fixed inset-0 z-[9999] overflow-hidden"
    style={{
      background:
        'radial-gradient(circle at 25% 50%, rgba(90,0,0,0.18), transparent 38%), #030303',
      touchAction: 'none',
      userSelect: 'none'
    }}
    onPointerMove={handleDragMove}
    onPointerUp={handleDragEnd}
    onPointerCancel={handleDragEnd}
    onPointerLeave={handleDragEnd}
  >

    {/* الإضاءة الخلفية */}
    <div
      className="absolute pointer-events-none"
      style={{
        left: '10%',
        top: '50%',
        width: '520px',
        height: '520px',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(199,0,0,0.16) 0%, rgba(199,0,0,0.06) 35%, transparent 70%)',
        filter: 'blur(30px)'
      }}
    />

    {/* حلقات حول الهلال */}
    <div
      className="absolute pointer-events-none"
      style={{
        left: '25%',
        top: '50%',
        width: '430px',
        height: '430px',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: '1px solid rgba(199,0,0,0.10)',
        boxShadow:
          '0 0 80px rgba(199,0,0,0.08)'
      }}
    />

    <div
      className="absolute pointer-events-none"
      style={{
        left: '25%',
        top: '50%',
        width: '330px',
        height: '330px',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: '1px solid rgba(199,0,0,0.13)'
      }}
    />

    <div
      className="absolute pointer-events-none"
      style={{
        left: '25%',
        top: '50%',
        width: '250px',
        height: '250px',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: '1px solid rgba(199,0,0,0.16)'
      }}
    />

    {/* الهلال */}
    <div
      className="absolute"
      onPointerDown={handleDragStart}
      style={{
        left: `calc(25% + ${dragProgress * 300}px)`,
        top: '50%',
        width: '170px',
        height: '170px',
        transform: 'translate(-50%, -50%)',
        cursor: isDragging ? 'grabbing' : 'grab',
        willChange: 'left, transform'
      }}
    >

      {/* Glow */}
      <div
        className="absolute inset-[-35px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(220,0,0,0.32) 0%, rgba(220,0,0,0.12) 35%, transparent 70%)',
          filter: 'blur(16px)',
          transform: `scale(${1 + dragProgress * 0.3})`
        }}
      />

      {/* جسم الهلال */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'linear-gradient(145deg, #ff2525 0%, #d40000 45%, #a90000 100%)',
          boxShadow: `
            0 0 12px rgba(255,0,0,0.85),
            0 0 30px rgba(220,0,0,0.55),
            0 0 70px rgba(180,0,0,0.30)
          `
        }}
      />

      {/* القطع الأسود لعمل شكل الهلال */}
      <div
        className="absolute rounded-full"
        style={{
          width: '145px',
          height: '145px',
          top: '-18px',
          right: '-8px',
          background: '#030303'
        }}
      />

      {/* حافة مضيئة للهلال */}
      <div
        className="absolute inset-[-2px] rounded-full pointer-events-none"
        style={{
          border: '1px solid rgba(255,80,80,0.75)',
          clipPath: 'inset(0 45% 0 0)',
          filter: 'blur(0.5px)'
        }}
      />

    </div>

    {/* Slider */}
    <div
      className="absolute"
      style={{
        left: '8%',
        right: '8%',
        bottom: '18%',
        height: '4px',
        background: 'rgba(255,255,255,0.08)',
        borderRadius: '999px'
      }}
    >

      {/* الخط المضيء */}
      <div
        className="absolute left-0 top-0 h-full rounded-full"
        style={{
          width: `${dragProgress * 100}%`,
          background:
            'linear-gradient(90deg, rgba(180,0,0,0.3), #e00000)',
          boxShadow:
            '0 0 14px rgba(220,0,0,0.7)'
        }}
      />

      {/* نقطة السحب */}
      <div
        className="absolute top-1/2"
        style={{
          left: `${dragProgress * 100}%`,
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: '#fff',
          transform: 'translate(-50%, -50%)',
          boxShadow: `
            0 0 8px rgba(255,255,255,0.95),
            0 0 20px rgba(255,0,0,0.8)
          `
        }}
      />

    </div>

    {/* النص */}
    <div
      className="absolute left-0 right-0 text-center"
      style={{
        bottom: '10%',
        opacity: Math.max(0.3, 1 - dragProgress * 0.7)
      }}
    >
      <div className="text-white text-lg font-medium">
        اسحب الهلال لفتح النظام
      </div>

      <div className="mt-2 text-white/35 text-xs">
        اسحب إلى اليمين للوصول الآمن
      </div>
    </div>

    {/* Vignette */}
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        boxShadow:
          'inset 0 0 180px rgba(0,0,0,0.95)'
      }}
    />

  </div>
)}
      
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-[#c70000]/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }}></div>
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] bg-[#c70000]/5 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s' }}></div>
      </div>

      <div className={`relative z-10 w-full max-w-5xl bg-[#0c0c0c]/80 backdrop-blur-2xl rounded-[2rem] border border-white/5 shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col md:flex-row overflow-hidden transition-all duration-1000 ease-out transform ${isMounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
        
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4 drop-shadow-md">الهلال الأحمر المصري</h2>
            <p className="text-white/80 text-lg font-medium leading-relaxed">نظام إدارة مركز عمليات الطوارئ (EOC) للاستجابة السريعة وإدارة الأزمات.</p>
          </div>
          <div className="relative z-10 mt-12 md:mt-0 flex items-center justify-between">
            <div className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-full border border-white/10 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_#4ade80]"></div>
              <span className="text-white/90 text-sm font-semibold tracking-wider">النظام مشفر ومتصل</span>
            </div>
          </div>
        </div>

        <div className="md:w-7/12 p-10 md:p-16 flex flex-col justify-center bg-gradient-to-br from-[#111] to-[#0a0a0a]">
          <div className="mb-10">
            <h3 className="text-2xl font-bold text-white mb-2">بوابة الوصول الآمن</h3>
            <p className="text-gray-400 text-sm">الرجاء إدخال بيانات الاعتماد الموثقة للمتابعة.</p>
          </div>
          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl border border-[#c70000]/30 bg-[#c70000]/10 text-[#ff4d4d] text-sm animate-pulse flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-6" autoComplete="off">
            <div className="space-y-2 group">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider group-focus-within:text-[#c70000] transition-colors">الرقم التعريفي / المستخدم</label>
              <div className="relative">
                <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-[#c70000] focus:ring-1 focus:ring-[#c70000] transition-all duration-300" placeholder="أدخل البيانات هنا" autoComplete="new-password" />
              </div>
            </div>
            <div className="space-y-2 group">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider group-focus-within:text-[#c70000] transition-colors">رمز المرور السري</label>
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
                {isLoading ? 'جاري التحقق...' : 'تأكيد الدخول'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}