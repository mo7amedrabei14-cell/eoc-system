import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isMounted, setIsMounted] = useState(false); 
  
  // دي الأداة اللي هتنقلنا للصفحة التانية
  const navigate = useNavigate();

  useEffect(() => { setIsMounted(true); }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      const response = await fetch('https://eoc-system.vercel.app/token', {
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
    // نفس التصميم اللي اتفقنا عليه بالظبط
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 sm:p-8 relative font-sans selection:bg-[#c70000] selection:text-white" dir="rtl">
      
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-[#c70000]/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }}></div>
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] bg-[#c70000]/5 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s' }}></div>
      </div>

      <div className={`relative z-10 w-full max-w-5xl bg-[#0c0c0c]/80 backdrop-blur-2xl rounded-[2rem] border border-white/5 shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col md:flex-row overflow-hidden transition-all duration-1000 ease-out transform ${isMounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
        
        <div className="md:w-5/12 bg-[#c70000] p-10 md:p-14 flex flex-col justify-between relative overflow-hidden shadow-[inset_-20px_0_40px_rgba(0,0,0,0.2)]">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,white_1px,transparent_1.5px)] bg-[length:24px_24px]"></div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/40"></div>
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-8 shadow-2xl transform transition hover:scale-110 hover:rotate-3 duration-500">
              <svg className="w-10 h-10 text-[#c70000]" viewBox="0 0 100 100" fill="currentColor">
                <path d="M50 10 A40 40 0 1 0 90 50 A30 30 0 1 1 50 20 Z" />
              </svg>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4 drop-shadow-md">الهلال الأحمر المصري</h2>
            <p className="text-white/80 text-lg font-medium leading-relaxed">نظام إدارة غرفة العمليات المركزية (EOC) للاستجابة السريعة وإدارة الأزمات.</p>
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