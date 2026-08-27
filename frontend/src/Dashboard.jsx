import * as XLSX from 'xlsx';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// ==========================================
// تصميم أيقونة الفرع على الخريطة
// ==========================================
const branchIcon = new L.DivIcon({
  className: 'custom-leaflet-icon',
  html: `<div style="background-color: #c70000; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 20px #c70000;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// 💡 دالة تحويل الوقت لـ 12 ساعة (ص/م) في ملفات الإكسيل
const format12H = (timeStr) => {
  if (!timeStr) return '';
  let [h, m] = timeStr.split(':');
  if (!h || !m) return timeStr;
  h = parseInt(h, 10);
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('missions');
  const [userData, setUserData] = useState(null);
  const [branchesList, setBranchesList] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({ active_missions: '-', ready_teams: '-', emergency_level: '-', under_review: '-', approved: '-', completed: '-', drafts: '-' });

// 💡 تعريف الصلاحيات (فصل ربيع كمالك بصلاحيات مطلقة)
  const userRole = userData?.role?.toUpperCase() || 'VOLUNTEER';
  const isOwner = userData?.is_global_admin === true || userRole === 'OWNER' || userRole === 'المالك';
  const isSupervisor = ['MANAGER', 'SUPERVISOR', 'ADMIN'].includes(userRole) || userRole === 'مشرف';
  const isJoker = userRole === 'JOKER' || userRole === 'جوكر';
  const isVolunteer = !isOwner && !isSupervisor && !isJoker;

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    const token = localStorage.getItem('access_token');
    
    if (userStr) {
      setUserData(JSON.parse(userStr));
    } else {
      navigate('/'); 
    }

    const fetchData = async () => {
      try {
        const branchesRes = await fetch('https://eoc-system.vercel.app/api/branches/locations', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (branchesRes.status === 401) { localStorage.clear(); window.location.href = '/'; return; }
        
        if (branchesRes.ok) {
          const branchesData = await branchesRes.json();
          const uniqueData = branchesData.filter((branch, index, self) =>
            index === self.findIndex((t) => t.name.trim() === branch.name.trim())
          );

          const normalizedBranches = uniqueData.map(b => ({
            id: b.id || 0, name: b.name || 'غير محدد', lat: parseFloat(b.lat || 0), lng: parseFloat(b.lng || 0), address: b.address || 'بدون عنوان',
            cars: b.cars || 0, tents: b.tents || 0, mattresses: b.mattresses || 0, fire_extinguishers: b.fire_extinguishers || 0,
            plastic_mats: b.plastic_mats || 0, pillows: b.pillows || 0, bed_sheets: b.bed_sheets || 0, blood_banks: b.blood_banks || 0,
            hospitals: b.hospitals || 0, ambulances: b.ambulances || 0, water_tanks: b.water_tanks || 0, plastic_buckets: b.plastic_buckets || 0,
            plastic_jerrycans: b.plastic_jerrycans || 0, blankets: b.blankets || 0, motorola_radios: b.motorola_radios || 0, huawei_radios: b.huawei_radios || 0,
            first_aid_kits: b.first_aid_kits || 0, stretchers: b.stretchers || 0, helmets: b.helmets || 0, ice_boxes: b.ice_boxes || 0,
            vests: b.vests || 0, caps: b.caps || 0, disinfection_machines: b.disinfection_machines || 0, manual_sprayers: b.manual_sprayers || 0,
            plastic_goggles: b.plastic_goggles || 0, plastic_boots: b.plastic_boots || 0, psych_support_teams: b.psych_support_teams || 0, psych_support_vols: b.psych_support_vols || 0,
            health_awareness_teams: b.health_awareness_teams || 0, health_awareness_vols: b.health_awareness_vols || 0, first_aid_trainers_hq: b.first_aid_trainers_hq || 0,
            first_aid_trainers_branch: b.first_aid_trainers_branch || 0, first_aid_teams: b.first_aid_teams || 0, first_aid_vols: b.first_aid_vols || 0,
            wash_vols: b.wash_vols || 0, emergency_teams: b.emergency_teams || 0, emergency_vols: b.emergency_vols || 0
          }));
          setBranchesList(normalizedBranches);
        }
        
        // 💡 سحب إحصائيات الداش بورد
        const statsRes = await fetch('https://eoc-system.vercel.app/api/dashboard/stats', { headers: { 'Authorization': `Bearer ${token}` } });
        if (statsRes.ok) setDashboardStats(await statsRes.json());
        
      } catch (error) { console.error("فشل في جلب البيانات:", error); }

    };
    if (token) fetchData();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'home': return <HomeView branches={branchesList} />;
      case 'missions': return <MissionsView branches={branchesList} isVolunteer={isVolunteer} isJoker={isJoker} isSupervisor={isSupervisor} isOwner={isOwner} />;
      case 'local_news': return <LocalNewsView branches={branchesList} isOwner={isOwner} isSupervisor={isSupervisor} isJoker={isJoker} isVolunteer={isVolunteer} />;
      case 'branches_inventory': return <BranchesAndInventoryView branches={branchesList} />;
      case 'audit': return <AuditLogsView />;
      default: return <HomeView stats={dashboardStats} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-[#c70000] selection:text-white flex overflow-hidden" dir="rtl">
      <aside className="w-72 bg-[#0c0c0c] border-l border-white/5 flex flex-col justify-between hidden md:flex sticky top-0 h-screen z-50">
        <div>
          <div className="p-8 border-b border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-full h-1/2 bg-[#c70000]/10 blur-2xl"></div>
            <div className="w-16 h-16 bg-[#111] rounded-2xl flex items-center justify-center mb-4 border border-white/10 shadow-[0_0_20px_rgba(199,0,0,0.15)] relative z-10">
              <svg className="w-10 h-10 text-[#c70000]" viewBox="0 0 100 100" fill="currentColor"><path d="M50 10 A40 40 0 1 0 90 50 A30 30 0 1 1 50 20 Z" /></svg>
            </div>
            <h2 className="text-lg font-bold text-white tracking-wide relative z-10">{userData?.full_name || 'المالك'}</h2>
            <p className="text-xs text-[#c70000] font-semibold mt-2 bg-[#c70000]/10 border border-[#c70000]/20 px-3 py-1 rounded-full uppercase tracking-widest relative z-10">{userData?.role || 'OWNER'}</p>
          </div>
          <nav className="p-4 space-y-2 mt-4">
            {!isVolunteer && <NavItem icon={<HomeIcon />} label="مؤشرات الغرفة (الداشبورد)" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />}
            <NavItem icon={<AlertIcon />} label="سجل المهام اليومية" isActive={activeTab === 'missions'} onClick={() => setActiveTab('missions')} />
            {/* 🆕 تاب الأخبار المحلية الجديد */}
            <NavItem icon={<NewsIcon />} label="سجل الأخبار المحلية" isActive={activeTab === 'local_news'} onClick={() => setActiveTab('local_news')} />
            {(isOwner || isSupervisor) && <NavItem icon={<MapIcon />} label="الفروع والمخزون الاستراتيجي" isActive={activeTab === 'branches_inventory'} onClick={() => setActiveTab('branches_inventory')} />}
            {isOwner && <NavItem icon={<ShieldIcon />} label="سجل النظام (للمالك فقط)" isActive={activeTab === 'audit'} onClick={() => setActiveTab('audit')} />}
          </nav>
        </div>
        <div className="p-4 border-t border-white/5">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 text-gray-400 hover:text-[#ff4d4d] hover:bg-[#ff4d4d]/10 p-4 rounded-xl transition-all duration-300 group">
            <LogoutIcon />
            <span className="font-semibold tracking-wide">إنهاء الجلسة الآمنة</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(199,0,0,0.03),transparent_50%)]">
        <header className="px-10 py-6 border-b border-white/5 flex justify-between items-center bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-40">
          <div>
            <h1 className="text-2xl font-extrabold tracking-wide">
              {activeTab === 'home' && 'موجز عمليات اليوم'}
              {activeTab === 'missions' && 'إدارة المهام الميدانية'}
              {activeTab === 'branches_inventory' && 'الانتشار الجغرافي والمخزون'}
              {activeTab === 'audit' && 'سجل النظام والعمليات (مراقب)'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">غرفة العمليات المركزية (EOC)</p>
          </div>
        </header>
        <div className="p-10">
          {renderContent()}
        </div>
      </main>
      
    </div>
  );
}

// ==========================================
// 1. شاشة الداش بورد (موجز العمليات التفاعلي)
// ==========================================
function HomeView({ branches = [] }) {
  const [missions, setMissions] = useState([]);
  const [news, setNews] = useState([]);
  const [selectedBranchName, setSelectedBranchName] = useState(null); // 💡 حالة اختيار الفرع من الخريطة

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    Promise.all([
      fetch('https://eoc-system.vercel.app/api/missions', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch('https://eoc-system.vercel.app/api/local-news', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : [])
    ]).then(([missionsData, newsData]) => {
      setMissions(missionsData);
      setNews(newsData);
    });
  }, []);

  // 💡 السحر هنا: توحيد (المركز العام) و (القاهرة) بناءً على طلبك
  const filterMissionBranch = selectedBranchName; 
  const filterNewsGov = (selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'القاهرة' : selectedBranchName;

  // 1. فلترة المهام (بتسمع المركز العام والقاهرة كحاجة واحدة)
  const filteredMissions = selectedBranchName
    ? missions.filter(m => {
        const mBranch = m.branch?.trim();
        return mBranch === filterMissionBranch || (filterMissionBranch === 'المركز العام' && mBranch === 'القاهرة') || (filterMissionBranch === 'القاهرة' && mBranch === 'المركز العام');
      })
    : missions;

  // 2. فلترة الأخبار (بتاخد القاهرة دايماً لو داس على المركز العام)
  const filteredNews = selectedBranchName
    ? news.filter(n => n.governorate === filterNewsGov)
    : news;

  const activeDaily = filteredMissions.filter(m => m.mission_classification !== 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const activeOpen = filteredMissions.filter(m => m.mission_classification === 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const totalNews = filteredNews.length;
  const activeNews = filteredNews.filter(n => n.is_field_response).length;

  return (
    <div className="space-y-8 pb-10 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-10 bg-[#c70000] rounded-full"></div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-wide">المركز الرئيسي للعمليات</h2>
            <p className="text-gray-400 text-sm mt-1">
               {selectedBranchName
                 ? `المؤشرات الحية لفرع/محافظة: ${(selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'المركز العام (القاهرة)' : selectedBranchName}`
                 : 'الرؤية الشاملة للوضع الميداني (على مستوى الجمهورية)'}
            </p>
          </div>
        </div>
        
        {/* زرار يظهر لما تدوس على فرع عشان يرجعك للجمهورية كلها */}
        {selectedBranchName && (
          <button onClick={() => setSelectedBranchName(null)} className="bg-[#111] hover:bg-[#c70000] text-gray-400 hover:text-white border border-white/10 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(199,0,0,0.3)] flex items-center gap-2">
            عرض الجمهورية بالكامل <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        )}
      </div>

      {/* كروت الإحصائيات الفخمة */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-8 rounded-3xl shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#c70000]/10 rounded-full blur-3xl group-hover:bg-[#c70000]/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <h3 className="text-gray-400 font-bold text-lg">المهام اليومية (نشطة)</h3>
            <div className="p-3 bg-[#c70000]/20 rounded-xl text-[#c70000]"><AlertIcon /></div>
          </div>
          <p className="text-6xl font-black text-white relative z-10">{activeDaily}</p>
        </div>

        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-8 rounded-3xl shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <h3 className="text-gray-400 font-bold text-lg">المهام المفتوحة (مستمرة)</h3>
            <div className="p-3 bg-blue-500/20 rounded-xl text-blue-500"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
          </div>
          <p className="text-6xl font-black text-white relative z-10">{activeOpen}</p>
        </div>

        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-8 rounded-3xl shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10">
            <h3 className="text-gray-400 font-bold text-lg">الأخبار والأحداث المرصودة</h3>
            <div className="p-3 bg-purple-500/20 rounded-xl text-purple-400"><NewsIcon /></div>
          </div>
          <div className="flex items-end gap-3 relative z-10">
             <p className="text-6xl font-black text-white">{totalNews}</p>
             <span className="text-sm font-bold text-purple-400 mb-2">({activeNews} استجابة ميدانية)</span>
          </div>
        </div>
      </div>

      {/* 💡 خريطة التمركزات التفاعلية (الفلتر الميداني) */}
      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-6 shadow-lg animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <MapIcon /> خريطة الانتشار التفاعلية (انقر على الفرع لعرض مؤشراته بالأعلى)
        </h3>
        <div className="h-[450px] w-full rounded-2xl overflow-hidden border border-white/10 relative z-0">
          <MapContainer center={[26.8206, 30.8025]} zoom={6} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            {branches.map(branch => branch.lat && branch.lng ? (
                <Marker key={`dash-marker-${branch.id}`} position={[branch.lat, branch.lng]} icon={branchIcon} eventHandlers={{ click: () => setSelectedBranchName(branch.name) }}>
                  <Popup><strong className="text-gray-800 font-bold text-sm text-center block mb-1">{branch.name === 'القاهرة' ? 'المركز العام (القاهرة)' : branch.name}</strong><span className="text-xs text-blue-600 block text-center mt-1 font-bold">انقر لفلترة الداشبورد</span></Popup>
                </Marker>
              ) : null
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

function BranchesAndInventoryView({ branches }) {
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const displayedBranches = selectedBranchId ? branches.filter(b => b.id === selectedBranchId) : branches;
  const totalFirstAid = displayedBranches.reduce((sum, b) => sum + (b.first_aid_kits || 0), 0);
  const totalRadios = displayedBranches.reduce((sum, b) => sum + (b.motorola_radios || 0) + (b.huawei_radios || 0), 0);
  const totalTentsBlankets = displayedBranches.reduce((sum, b) => sum + (b.tents || 0) + (b.blankets || 0), 0);
  const totalCars = displayedBranches.reduce((sum, b) => sum + (b.cars || 0) + (b.ambulances || 0), 0);
  const handleSelectBranch = (id) => { if (selectedBranchId === id) { setSelectedBranchId(null); } else { setSelectedBranchId(id); } };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex justify-between items-end border-b border-white/5 pb-4">
        <h2 className="text-xl font-bold text-[#c70000]">
          {selectedBranchId && displayedBranches.length > 0 ? `بيانات تمركز: ${displayedBranches[0]?.name === 'القاهرة' ? 'المركز العام' : displayedBranches[0]?.name}` : 'البيانات الكلية (على مستوى الجمهورية)'}
        </h2>
        {selectedBranchId && (
          <button onClick={() => setSelectedBranchId(null)} className="bg-[#111] hover:bg-[#c70000] text-gray-400 hover:text-white border border-white/10 px-4 py-2 rounded-lg text-sm transition-colors shadow-lg flex items-center gap-2">
            إلغاء التحديد <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 h-[400px]">
        <div className="w-full lg:w-1/4 bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden flex flex-col shadow-lg">
          <div className="p-4 border-b border-white/5 bg-[#111]"><h3 className="text-md font-bold text-center">قائمة التمركزات</h3></div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-right text-sm">
              <tbody className="divide-y divide-white/5">
                {branches.map(branch => (
                  <tr key={`list-${branch.id}`} onClick={() => handleSelectBranch(branch.id)} className={`transition-colors cursor-pointer ${selectedBranchId === branch.id ? 'bg-[#c70000]/20 border-r-4 border-[#c70000]' : 'hover:bg-white/5 border-r-4 border-transparent'}`}>
                    <td className={`p-4 font-bold ${selectedBranchId === branch.id ? 'text-[#c70000]' : 'text-white'}`}>{branch.name === 'القاهرة' ? 'المركز العام' : branch.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="w-full lg:w-3/4 bg-[#0c0c0c] border border-white/5 rounded-3xl relative overflow-hidden shadow-lg z-0">
           <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              {branches.map(branch => branch.lat && branch.lng ? (
                  <Marker key={`marker-${branch.id}`} position={[branch.lat, branch.lng]} icon={branchIcon} eventHandlers={{ click: () => handleSelectBranch(branch.id) }}>
                    <Popup><strong className="text-gray-800">{branch.name === 'القاهرة' ? 'المركز العام' : branch.name}</strong></Popup>
                  </Marker>
                ) : null
              )}
            </MapContainer>
        </div>
      </div>

      <div className="space-y-4 mt-4">
        <h3 className="text-lg font-bold text-white border-b border-white/5 pb-2">الأرصدة اللوجستية والفنية</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InventoryCard title="إجمالي شنط الإسعاف" value={totalFirstAid.toLocaleString()} unit="شنطة مجهزة" color="text-red-500" />
          <InventoryCard title="أجهزة اتصال لاسلكي" value={totalRadios.toLocaleString()} unit="جهاز نشط" color="text-blue-500" />
          <InventoryCard title="مخزون الإيواء" value={totalTentsBlankets.toLocaleString()} unit="خيمة وبطانية" color="text-yellow-500" />
          <InventoryCard title="أسطول السيارات (شامل الإسعاف)" value={totalCars.toLocaleString()} unit="سيارة جاهزة" color="text-green-500" />
        </div>
        <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden flex flex-col shadow-lg max-h-[600px] mt-4">
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-center text-xs whitespace-nowrap">
              <thead className="bg-[#1a1a1a] text-gray-400 sticky top-0 z-10 shadow-md">
                <tr>
                  <th className="p-4 font-semibold border-l border-white/5 sticky right-0 bg-[#1a1a1a] z-20">الفرع / التمركز</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-[#c70000]">سيارات</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-[#c70000]">إسعاف</th>
                  <th className="p-4 font-semibold border-l border-white/5">خيم</th>
                  <th className="p-4 font-semibold border-l border-white/5">بطاطين</th>
                  <th className="p-4 font-semibold border-l border-white/5">مراتب</th>
                  <th className="p-4 font-semibold border-l border-white/5">ملايات</th>
                  <th className="p-4 font-semibold border-l border-white/5">مخدات</th>
                  <th className="p-4 font-semibold border-l border-white/5">حصر</th>
                  <th className="p-4 font-semibold border-l border-white/5">تنك مياه</th>
                  <th className="p-4 font-semibold border-l border-white/5">بستلة</th>
                  <th className="p-4 font-semibold border-l border-white/5">جركن</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-blue-400">شنط إسعاف</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-blue-400">نقالات</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-blue-400">مستشفى ميداني</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-blue-400">بنك دم</th>
                  <th className="p-4 font-semibold border-l border-white/5">لاسلكي تترا</th>
                  <th className="p-4 font-semibold border-l border-white/5">لاسلكي هواوي</th>
                  <th className="p-4 font-semibold border-l border-white/5">طفايات</th>
                  <th className="p-4 font-semibold border-l border-white/5">مكن تطهير</th>
                  <th className="p-4 font-semibold border-l border-white/5">بخاخات</th>
                  <th className="p-4 font-semibold border-l border-white/5">خوذ</th>
                  <th className="p-4 font-semibold border-l border-white/5">فيستات</th>
                  <th className="p-4 font-semibold border-l border-white/5">كابات</th>
                  <th className="p-4 font-semibold border-l border-white/5">نظارات</th>
                  <th className="p-4 font-semibold border-l border-white/5">بوت</th>
                  <th className="p-4 font-semibold border-l border-white/5">آيس بوكس</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-yellow-500">فرق إسعافات</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-yellow-500">متطوعين إسعافات</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-yellow-500">فرق طوارئ</th>
                  <th className="p-4 font-semibold border-l border-white/5 bg-[#111] text-yellow-500">متطوعين طوارئ</th>
                  <th className="p-4 font-semibold border-l border-white/5">فرق دعم نفسي</th>
                  <th className="p-4 font-semibold border-l border-white/5">متطوعين دعم نفسي</th>
                  <th className="p-4 font-semibold border-l border-white/5">فرق توعية</th>
                  <th className="p-4 font-semibold border-l border-white/5">متطوعين توعية</th>
                  <th className="p-4 font-semibold border-l border-white/5">مدربين (مركز عام)</th>
                  <th className="p-4 font-semibold border-l border-white/5">مدربين (فرع)</th>
                  <th className="p-4 font-semibold">إصحاح بيئي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {displayedBranches.map((item) => (
                  <tr key={`inv-row-${item.id}`} className="hover:bg-white/5 transition-colors group">
                    <td className="p-4 font-bold text-white group-hover:text-[#c70000] sticky right-0 bg-[#0c0c0c] group-hover:bg-[#1a1a1a] border-l border-white/5 z-10">{item.name === 'القاهرة' ? 'المركز العام' : item.name}</td>
                    <td className="p-4 text-gray-300 font-bold bg-[#111]/50 border-l border-white/5">{item.cars}</td>
                    <td className="p-4 text-gray-300 font-bold bg-[#111]/50 border-l border-white/5">{item.ambulances}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.tents}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.blankets}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.mattresses}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.bed_sheets}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.pillows}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.plastic_mats}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.water_tanks}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.plastic_buckets}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.plastic_jerrycans}</td>
                    <td className="p-4 text-blue-400 font-bold bg-[#111]/50 border-l border-white/5">{item.first_aid_kits}</td>
                    <td className="p-4 text-gray-300 bg-[#111]/50 border-l border-white/5">{item.stretchers}</td>
                    <td className="p-4 text-gray-300 bg-[#111]/50 border-l border-white/5">{item.hospitals > 0 ? '✔️' : '-'}</td>
                    <td className="p-4 text-gray-300 bg-[#111]/50 border-l border-white/5">{item.blood_banks > 0 ? '✔️' : '-'}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.motorola_radios}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.huawei_radios}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.fire_extinguishers}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.disinfection_machines}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.manual_sprayers}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.helmets}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.vests}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.caps}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.plastic_goggles}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.plastic_boots}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.ice_boxes}</td>
                    <td className="p-4 text-yellow-500 font-bold bg-[#111]/50 border-l border-white/5">{item.first_aid_teams}</td>
                    <td className="p-4 text-yellow-500 font-bold bg-[#111]/50 border-l border-white/5">{item.first_aid_vols}</td>
                    <td className="p-4 text-yellow-500 font-bold bg-[#111]/50 border-l border-white/5">{item.emergency_teams}</td>
                    <td className="p-4 text-yellow-500 font-bold bg-[#111]/50 border-l border-white/5">{item.emergency_vols}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.psych_support_teams}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.psych_support_vols}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.health_awareness_teams}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.health_awareness_vols}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.first_aid_trainers_hq}</td>
                    <td className="p-4 text-gray-400 border-l border-white/5">{item.first_aid_trainers_branch}</td>
                    <td className="p-4 text-gray-400">{item.wash_vols}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. شاشة سجل المهام واستمارة التسجيل
// ==========================================
// ==========================================
// 3. شاشة سجل المهام واستمارة التسجيل
// ==========================================
function MissionsView({ branches, isVolunteer, isJoker, isSupervisor, isOwner }) {
  const [customAlert, setCustomAlert] = useState(null);
const [isModalOpen, setIsModalOpen] = useState(false);
  const [missionToDelete, setMissionToDelete] = useState(null);
  const [currentMissionData, setCurrentMissionData] = useState(null);
  
const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnText, setReturnText] = useState('');
  const [returnError, setReturnError] = useState('');
  const [mainRouteTitle, setMainRouteTitle] = useState('خط السير الأساسي');
  const [routes, setRoutes] = useState([{ id: 1 }]); 
  const [customItineraries, setCustomItineraries] = useState([]);
  const [vehicles, setVehicles] = useState([{ id: 1 }]);
  const [participants, setParticipants] = useState([{ id: 1 }]);
  const [beneficiaries, setBeneficiaries] = useState([{ id: 1 }]);
  const [missionName, setMissionName] = useState('');

  const [missionsList, setMissionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRegionTab, setActiveRegionTab] = useState('all');

  const regionMap = {
    'المركز العام': 'hq', 'الاسماعيلية': 'canal', 'بور سعيد': 'canal', 'السويس': 'canal', 'شمال سيناء': 'canal', 'جنوب سيناء': 'canal', 'الشرقية': 'canal', 'دمياط': 'canal',
    'الاسكندرية': 'delta', 'البحيرة': 'delta', 'الغربية': 'delta', 'كفر الشيخ': 'delta', 'المنوفية': 'delta', 'الدقهلية': 'delta', 'القليوبية': 'delta',
    'الجيزة': 'saeed', 'الفيوم': 'saeed', 'بني سويف': 'saeed', 'المنيا': 'saeed', 'اسيوط': 'saeed', 'سوهاج': 'saeed', 'قنا': 'saeed', 'الاقصر': 'saeed', 'اسوان': 'saeed', 'الوادي الجديد': 'saeed', 'البحر الاحمر': 'saeed'
  };

  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [missionViewType, setMissionViewType] = useState('all_types'); // 'daily', 'open', 'all_types'
  const [missionClass, setMissionClass] = useState('عادية');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'active', 'completed'

  const fetchMissions = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system.vercel.app/api/missions', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.status === 401) { localStorage.clear(); window.location.href = '/'; return; }
      if (res.ok) setMissionsList(await res.json());
    } catch (error) { console.error("Error:", error); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchMissions(); }, []);

  const addRoute = () => setRoutes([...routes, { id: Date.now() }]);
  const removeRoute = (id) => setRoutes(routes.filter(r => r.id !== id));

  const addCustomItinerary = () => setCustomItineraries([...customItineraries, { id: Date.now(), title: '', routes: [{ id: Date.now() }] }]);
  const removeCustomItinerary = (id) => setCustomItineraries(customItineraries.filter(c => c.id !== id));
  const addRouteToCustom = (customId) => setCustomItineraries(customItineraries.map(c => c.id === customId ? { ...c, routes: [...c.routes, { id: Date.now() }] } : c));
  const removeRouteFromCustom = (customId, routeId) => setCustomItineraries(customItineraries.map(c => c.id === customId ? { ...c, routes: c.routes.filter(r => r.id !== routeId) } : c));
  const updateCustomTitle = (customId, newTitle) => setCustomItineraries(customItineraries.map(c => c.id === customId ? { ...c, title: newTitle } : c));

  const addVehicle = () => setVehicles([...vehicles, { id: Date.now() }]);
  const addParticipant = () => setParticipants([...participants, { id: Date.now() }]);
  const addBeneficiary = () => setBeneficiaries([...beneficiaries, { id: Date.now() }]);
  const removeVehicle = (id) => setVehicles(vehicles.filter(v => v.id !== id));
  const removeParticipant = (id) => setParticipants(participants.filter(p => p.id !== id));
  const removeBeneficiary = (id) => setBeneficiaries(beneficiaries.filter(b => b.id !== id));

  const handleCreateNew = () => {
    setCurrentMissionData(null);
    setMissionName('');
    setMainRouteTitle('خط السير الأساسي');
    setMissionClass('عادية');
    setRoutes([{ id: Date.now() }]);
    setCustomItineraries([]);
    setVehicles([{ id: Date.now() }]);
    setParticipants([{ id: Date.now() }]);
    setBeneficiaries([{ id: Date.now() }]);
    setIsModalOpen(true);
  };

  const handleViewMission = async (missionId) => {
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch(`https://eoc-system.vercel.app/api/missions/${missionId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCurrentMissionData(data);
        setMissionName(data.mission_name || '');
        setMissionClass(data.mission_classification || 'عادية');
        
        if (data.routes && data.routes.length > 0) {
          if (data.mission_classification === 'مفتوحة') {
             const grouped = data.routes.reduce((acc, curr) => {
               if (!acc[curr.group_title]) acc[curr.group_title] = [];
               acc[curr.group_title].push({ id: Date.now() + Math.random(), ...curr });
               return acc;
             }, {});
             const titles = Object.keys(grouped);
             setCustomItineraries(titles.map((title, i) => ({ id: i, title: title, routes: grouped[title] })));
             setRoutes([]); 
          } else {
             const mainR = data.routes.filter(r => r.group_title === 'خط السير الأساسي');
             const customR = data.routes.filter(r => r.group_title !== 'خط السير الأساسي');
             setRoutes(mainR.length ? mainR.map((r, i) => ({ id: i, ...r })) : []);
             
             if (customR.length > 0) {
               const grouped = customR.reduce((acc, curr) => {
                 if (!acc[curr.group_title]) acc[curr.group_title] = [];
                 acc[curr.group_title].push({ id: Date.now() + Math.random(), ...curr });
                 return acc;
               }, {});
               setCustomItineraries(Object.keys(grouped).map((title, i) => ({ id: i, title: title, routes: grouped[title] })));
             } else { setCustomItineraries([]); }
          }
        } else { setRoutes([{ id: Date.now() }]); setCustomItineraries([]); }

        setVehicles((data.vehicles && data.vehicles.length > 0) ? data.vehicles.map((v, i) => ({ id: i, ...v })) : [{ id: Date.now() }]);
        setParticipants((data.participants && data.participants.length > 0) ? data.participants.map((p, i) => ({ id: i, ...p })) : [{ id: Date.now() }]);
        setBeneficiaries((data.beneficiaries && data.beneficiaries.length > 0) ? data.beneficiaries.map((b, i) => ({ id: i, ...b })) : [{ id: Date.now() }]);
        setIsModalOpen(true);
      }
    } catch (error) { console.error("Error fetching details:", error); }
  };

  const getStaff = (role) => {
    if (!currentMissionData || !currentMissionData.eoc_staff) return '';
    const staff = currentMissionData.eoc_staff.find(s => s.role_name === role);
    return staff ? staff.staff_name : '';
  };

  const confirmDeleteMission = async () => {
    if (!missionToDelete) return;
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch(`https://eoc-system.vercel.app/api/missions/${missionToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { setMissionToDelete(null); fetchMissions(); } 
    } catch (error) { alert("خطأ في الاتصال بالسيرفر!"); }
  };

  const handleExportTableExcel = () => {
    if (missionsList.length === 0) return alert("لا توجد مهام لتصديرها.");
    const missionsSheet = missionsList.map(m => ({
      "كود المهمة": m.mission_code,
      "تصنيف المهمة": m.mission_classification || "عادية",
      "تاريخ الإنشاء (السيرفر)": m.created_at,
      "تاريخ المهمة (الفعلي)": m.exit_date !== '-' && m.exit_date ? m.exit_date : "غير مسجل",
      "اسم المهمة": m.mission_name,
      "عدد المتطوعين": m.vol_count || 0,
      "عدد الغير متطوعين": m.non_vol_count || 0,
      "إجمالي المشاركين": m.total_participants || 0,
      "كود الفريق": m.team_codes || "-",
      "مسئول المهمة": m.responsible_person,
      "اسم السائق": m.drivers || "لا يوجد",
      "رقم السيارة": m.plates || "لا يوجد",
      "حالة المهمة": m.status,
      "الفرع": m.branch
    }));

    const beneficiariesSheet = [];
    missionsList.forEach(m => {
      if (m.beneficiaries && m.beneficiaries.length > 0) {
        m.beneficiaries.forEach(b => {
          beneficiariesSheet.push({
            "كود المهمة": m.mission_code,
            "تصنيف المستفيدين": b.category_name,
            "الرقم (المباشر)": b.direct_count,
            "المستفيدين غير المباشر": b.indirect_count,
            "اسم الاستمارة": m.mission_name,
            "التاريخ": m.created_at
          });
        });
      }
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(missionsSheet);
    XLSX.utils.book_append_sheet(wb, ws1, "المهام الشاملة");
    if(beneficiariesSheet.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(beneficiariesSheet);
      XLSX.utils.book_append_sheet(wb, ws2, "إحصائيات المستفيدين");
    }
    XLSX.writeFile(wb, `السجل_الشامل_${filterDate}.xlsx`);
  };

  const handleExportSingleExcel = () => {
    const escapeCSV = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
    let csvContent = "";
    csvContent += "البيانات الأساسية\nاسم المهمة,تصنيف المهمة,التمركز,نوع المهمة,مكان المهمة,مسؤول المهمة,تاريخ الإنشاء,مصدر البلاغ\n";
    csvContent += `${escapeCSV(document.getElementById('f_mission_name')?.value)},${escapeCSV(document.getElementById('f_mission_class')?.value)},${escapeCSV(document.getElementById('f_branch_id')?.options[document.getElementById('f_branch_id').selectedIndex]?.text)},${escapeCSV(document.getElementById('f_mission_type')?.value)},${escapeCSV(document.getElementById('f_mission_location')?.value)},${escapeCSV(document.getElementById('f_responsible_person')?.value)},${escapeCSV(document.getElementById('f_creation_date')?.value)},${escapeCSV(document.getElementById('f_data_source')?.value)}\n\n`;
    csvContent += "التواريخ والتوقيتات\nتاريخ المهمة,تاريخ الخروج,تاريخ الوصول,تاريخ العودة,تاريخ الانتهاء,ساعة البدء,ساعة التحرك,ساعة الوصول,ساعة الانتهاء\n";
    csvContent += `${escapeCSV(document.getElementById('f_exit_date')?.value)},${escapeCSV(document.getElementById('f_departure_date')?.value)},${escapeCSV(document.getElementById('f_arrival_date')?.value)},${escapeCSV(document.getElementById('f_return_date')?.value)},${escapeCSV(document.getElementById('f_completion_date')?.value)},${escapeCSV(document.getElementById('f_start_time')?.value)},${escapeCSV(document.getElementById('f_departure_time')?.value)},${escapeCSV(document.getElementById('f_arrival_time')?.value)},${escapeCSV(document.getElementById('f_completion_time')?.value)}\n\n`;
    csvContent += "خطوط السير المجمعة\nالمجموعة,إلى (الوجهة),ساعة التحرك,ساعة الوصول\n";
    routes.forEach((_, i) => {
      const to = document.getElementById(`r_to_main_${i}`)?.value;
      if (to) csvContent += `خط السير الأساسي,${escapeCSV(to)},${escapeCSV(document.getElementById(`r_dep_main_${i}`)?.value)},${escapeCSV(document.getElementById(`r_arr_main_${i}`)?.value)}\n`;
    });
    customItineraries.forEach((ci, ciIndex) => {
      ci.routes.forEach((_, rIndex) => {
        const to = document.getElementById(`r_to_cust_${ciIndex}_${rIndex}`)?.value;
        if (to) csvContent += `${escapeCSV(ci.title)},${escapeCSV(to)},${escapeCSV(document.getElementById(`r_dep_cust_${ciIndex}_${rIndex}`)?.value)},${escapeCSV(document.getElementById(`r_arr_cust_${ciIndex}_${rIndex}`)?.value)}\n`;
      });
    });
    csvContent += "\nالسيارات والسائقين\nاسم السائق,رقم السيارة\n";
    vehicles.forEach((_, i) => {
      const driver = document.getElementById(`v_driver_${i}`)?.value;
      const plate = document.getElementById(`v_plate_${i}`)?.value;
      if (driver || plate) csvContent += `${escapeCSV(driver)},${escapeCSV(plate)}\n`;
    });
    csvContent += "\nالقوة البشرية والمشاركين (مفصل)\nنوع المشارك,الاسم,الفريق,كود الفريق,رقم العضوية/الصفة,المرحلة,نظام التواجد,الفرع,مجموعة التحرك المتبعة (خط السير)\n";
    participants.forEach((_, i) => {
      const name = document.getElementById(`p_name_${i}`)?.value;
      if (name) {
        const typeSel = document.getElementById(`p_type_${i}`);
        const branchSel = document.getElementById(`p_branch_${i}`);
        const itinSel = document.getElementById(`p_itin_${i}`);
        const phase = document.getElementById(`p_phase_${i}`)?.value || 'اليوم الأول';
        const stay = document.getElementById(`p_stay_${i}`)?.value || 'ذهاب وعودة';
        csvContent += `${escapeCSV(typeSel?.options[typeSel.selectedIndex]?.text)},${escapeCSV(name)},${escapeCSV(document.getElementById(`p_team_${i}`)?.value)},${escapeCSV(document.getElementById(`p_tcode_${i}`)?.value)},${escapeCSV(document.getElementById(`p_role_${i}`)?.value)},${escapeCSV(phase)},${escapeCSV(stay)},${escapeCSV(branchSel?.options[branchSel.selectedIndex]?.text)},${escapeCSV(itinSel?.options[itinSel.selectedIndex]?.text || 'خط السير الأساسي')}\n`;
      }
    });
    csvContent += "\nإحصائيات المستفيدين\nالتصنيف,مباشر,غير مباشر\n";
    beneficiaries.forEach((_, i) => {
      const cat = document.getElementById(`b_cat_${i}`)?.value;
      if (cat) csvContent += `${escapeCSV(cat)},${escapeCSV(document.getElementById(`b_count_${i}`)?.value)},${escapeCSV(document.getElementById(`b_indirect_${i}`)?.value)}\n`;
    });
    csvContent += "\nسجل التحديثات والملاحظات\n";
    csvContent += `سجل الميدان,${escapeCSV(document.getElementById('f_notes')?.value)}\n`;
    csvContent += `ملاحظات داخلية,${escapeCSV(document.getElementById('f_internal_notes')?.value)}\n`;
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", document.getElementById('f_mission_name')?.value ? `استمارة_${document.getElementById('f_mission_name').value.replace(/ /g, '_')}.csv` : 'استمارة_تفصيلية.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleSubmit = async (submitStatus) => {
     try {
       // ==========================================
       // 🚨 رادار غرفة العمليات: منع تكرار المشاركين
       // ==========================================
       // ==========================================
       // 🚨 رادار غرفة العمليات: ذكي (يدعم المهام المفتوحة وتعدد التحركات)
       // ==========================================
       const activeParticipants = {}; 
       let hasDuplicateError = false;

       participants.forEach((_, i) => {
         const pName = document.getElementById(`p_name_${i}`)?.value;
         if (!pName) return;

         const pRole = document.getElementById(`p_role_${i}`)?.value?.trim() || ''; 
         const pBranch = document.getElementById(`p_branch_${i}`)?.value || '19';
         const pStatus = document.getElementById(`p_status_${i}`)?.value || 'بالمهمة';
         const pItin = document.getElementById(`p_itin_${i}`)?.options[document.getElementById(`p_itin_${i}`).selectedIndex]?.text || 'خط السير الأساسي';

         const uniqueKey = pRole !== '' ? `${pRole}-${pBranch}` : `${pName}-${pBranch}`;

         // الرادار بيتدخل فقط لو المتطوع حالته الحالية "بالمهمة"
         // مينفعش يكون نفس الشخص "بالمهمة" مرتين في نفس اللحظة!
         if (pStatus === 'بالمهمة') {
           if (activeParticipants[uniqueKey]) {
             setCustomAlert(`خطأ إداري: المشارك "${pName}" (رقم العضوية: ${pRole || 'بدون'}) مكرر ومسجل كـ "بالمهمة" أكثر من مرة!\n\nلا يمكن أن يكون المتطوع متواجد في تحركين نشطين في نفس الوقت.\nيجب تسجيل عودته أولاً من التحرك السابق (عاد للقاعدة) قبل إضافة تحرك جديد له.`);
             hasDuplicateError = true;
           } else {
             activeParticipants[uniqueKey] = true;
           }
         }
       });
       if (hasDuplicateError) return;

       // ==========================================
       // استكمال تجميع البيانات وحفظها
       // ==========================================
       const allRoutes = [];
       if (missionClass !== 'مفتوحة') {
           routes.forEach((_, i) => {
               const to = document.getElementById(`r_to_main_${i}`)?.value;
               if (to) allRoutes.push({ group_title: 'خط السير الأساسي', route_to: to, departure_time: document.getElementById(`r_dep_main_${i}`)?.value || null, arrival_time: document.getElementById(`r_arr_main_${i}`)?.value || null });
           });
       }
       customItineraries.forEach((ci, ciIndex) => {
         ci.routes.forEach((_, rIndex) => {
           const to = document.getElementById(`r_to_cust_${ciIndex}_${rIndex}`)?.value;
           if (to) allRoutes.push({ group_title: ci.title || 'خط سير مخصص', route_to: to, departure_time: document.getElementById(`r_dep_cust_${ciIndex}_${rIndex}`)?.value || null, arrival_time: document.getElementById(`r_arr_cust_${ciIndex}_${rIndex}`)?.value || null });
         });
       });

       const fieldStatus = document.getElementById('f_mission_field_status')?.value || 'نشطة الآن';
       let generalNotes = document.getElementById('f_notes')?.value || '';
       let finalNotes = `[حالة الميدان: ${fieldStatus}]\n` + generalNotes;

       let sysNotes = document.getElementById('f_internal_notes')?.value || '';
       if (['Under Review', 'Approved', 'Completed'].includes(submitStatus)) {
           sysNotes = '';
       }

       const missionData = {
         mission_code: document.getElementById('f_mission_code')?.value || null,
         created_at: document.getElementById('f_creation_date')?.value || null,
         mission_name: document.getElementById('f_mission_name')?.value || 'مهمة بدون اسم',
         mission_classification: document.getElementById('f_mission_class')?.value || 'عادية', 
         branch_id: parseInt(document.getElementById('f_branch_id')?.value || 19),
         mission_type: document.getElementById('f_mission_type')?.value || '',
         mission_location: document.getElementById('f_mission_location')?.value || '',
         responsible_person: document.getElementById('f_responsible_person')?.value || '',
         data_source: document.getElementById('f_data_source')?.value || '',
         status: submitStatus,
         exit_date: document.getElementById('f_exit_date')?.value || null,
         departure_date: document.getElementById('f_departure_date')?.value || null,
         arrival_date: document.getElementById('f_arrival_date')?.value || null,
         return_date: document.getElementById('f_return_date')?.value || null,
         completion_date: document.getElementById('f_completion_date')?.value || null,
         start_time: document.getElementById('f_start_time')?.value || null,
         departure_time: document.getElementById('f_departure_time')?.value || null,
         arrival_time: document.getElementById('f_arrival_time')?.value || null,
         completion_time: document.getElementById('f_completion_time')?.value || null,
         injured_count: 0, indirect_beneficiaries_total: 0,
         notes: finalNotes,
         internal_notes: sysNotes,
         routes: allRoutes,
         vehicles: vehicles.map((_, i) => ({ driver_name: document.getElementById(`v_driver_${i}`)?.value || '', vehicle_number: document.getElementById(`v_plate_${i}`)?.value || '' })).filter(v => v.driver_name !== '' || v.vehicle_number !== ''),
         participants: participants.map((_, i) => ({
           participant_type: document.getElementById(`p_type_${i}`)?.value || 'volunteer',
           full_name: document.getElementById(`p_name_${i}`)?.value || '',
           team_name: document.getElementById(`p_team_${i}`)?.value || '',
           team_code: document.getElementById(`p_tcode_${i}`)?.value || '', 
           participation_role: document.getElementById(`p_role_${i}`)?.value || '',
           branch_id: parseInt(document.getElementById(`p_branch_${i}`)?.value || 19),
           assigned_itinerary: document.getElementById(`p_itin_${i}`)?.options[document.getElementById(`p_itin_${i}`).selectedIndex]?.text || 'خط السير الأساسي',
           return_status: submitStatus === 'Completed' ? 'تم انتهاء مهمتة' : (document.getElementById(`p_status_${i}`)?.value || 'مازال بالمهمة'),
           phase_name: document.getElementById(`p_phase_${i}`)?.value || 'اليوم الأول',
           stay_type: document.getElementById(`p_stay_${i}`)?.value || 'ذهاب وعودة'
         })).filter(p => p.full_name !== ''),
         beneficiaries: beneficiaries.map((_, i) => ({ category_name: document.getElementById(`b_cat_${i}`)?.value || '', direct_count: parseInt(document.getElementById(`b_count_${i}`)?.value || 0), indirect_count: parseInt(document.getElementById(`b_indirect_${i}`)?.value || 0) })).filter(b => b.category_name !== ''),
         eoc_staff: [ { role_name: 'مسؤول المتابعة', staff_name: document.getElementById('eoc_leader')?.value || '' }, { role_name: 'المشرف', staff_name: document.getElementById('eoc_supervisor')?.value || '' }, { role_name: 'المشرف المراجع', staff_name: document.getElementById('eoc_reviewer')?.value || '' }, { role_name: 'الجوكر', staff_name: document.getElementById('eoc_joker')?.value || '' }, { role_name: 'معبئ الاستمارة', staff_name: document.getElementById('eoc_filler')?.value || '' }, { role_name: 'مستكمل الاستمارة', staff_name: document.getElementById('eoc_completer')?.value || '' }, { role_name: 'مراجع الاستمارة', staff_name: document.getElementById('eoc_final_reviewer')?.value || '' } ].filter(s => s.staff_name !== '')
       };

       const token = localStorage.getItem('access_token');
       
       const isUpdate = currentMissionData !== null;
       const url = isUpdate ? `https://eoc-system.vercel.app/api/missions/${currentMissionData.mission_id}` : 'https://eoc-system.vercel.app/api/missions';
       const method = isUpdate ? 'PUT' : 'POST';

       const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(missionData) });
       if (res.ok) { setIsModalOpen(false); fetchMissions(); } 
       else { 
           const errorData = await res.json(); 
           setCustomAlert(`🚫 تنبيه رقابي من السيرفر:\n\n${errorData.detail}`); 
       }
     } catch (error) { setCustomAlert("خطأ في الاتصال بالسيرفر!"); }
  };

  const StatusBadge = ({ status }) => {
    const statuses = {
      'Draft': { text: 'مسودة', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
      'Active': { text: 'نشطة', color: 'text-green-500 bg-green-500/10 border-green-500/20' },
      'Under Review': { text: 'قيد المراجعة', color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' },
      'Approved': { text: 'معتمدة (بانتظار الانتهاء)', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
      'Completed': { text: 'مكتملة', color: 'text-teal-500 bg-teal-500/10 border-teal-500/20' },
      'Returned': { text: 'إرجاع للمتطوع', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20' },
      'Cancelled': { text: 'ملغاة', color: 'text-red-500 bg-red-500/10 border-red-500/20' },
    };
    const s = statuses[status] || statuses['Draft'];
    return <span className={`px-2 py-1 rounded text-xs font-bold border ${s.color}`}>{s.text}</span>;
  };

  let baseMissions = missionsList;
  if (missionViewType === 'open') baseMissions = baseMissions.filter(m => m.mission_classification === 'مفتوحة');
  else if (missionViewType === 'daily') baseMissions = baseMissions.filter(m => m.mission_classification !== 'مفتوحة');

  if (filterDate) {
     baseMissions = baseMissions.filter(m => {
        const missionDate = m.exit_date !== '-' && m.exit_date ? m.exit_date : m.created_at.split(' ')[0];
        const isOpenActive = m.mission_classification === 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status);
        if (isOpenActive) return true;
        return missionDate === filterDate;
     });
  }

  if (statusFilter === 'active') baseMissions = baseMissions.filter(m => !['Completed', 'Cancelled'].includes(m.status));
  else if (statusFilter === 'completed') baseMissions = baseMissions.filter(m => ['Completed', 'Cancelled'].includes(m.status));

  // 💡 إحصائيات الأقاليم بتتأثر بالفلاتر (التاريخ، النشط، النوع) عشان تشوف الأرقام الحقيقية!
  const regionStats = {
    total: baseMissions.length,
    hq: baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === 'hq').length,
    canal: baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === 'canal').length,
    delta: baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === 'delta').length,
    saeed: baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === 'saeed').length,
  };

  const filteredMissions = activeRegionTab !== 'all' ? baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === activeRegionTab) : baseMissions;

  const getCreationDate = () => {
    if (currentMissionData && currentMissionData.created_at) { return String(currentMissionData.created_at).split(' ')[0]; }
    return filterDate || getLocalDate();
  };

  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[calc(100vh-180px)]">
      {missionToDelete && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[110] p-4">
          <div className="bg-[#0c0c0c] border border-[#c70000]/30 rounded-3xl w-full max-w-md p-8 flex flex-col items-center shadow-[0_0_40px_rgba(199,0,0,0.2)] animate-fade-in-up text-center">
            <div className="w-20 h-20 bg-[#c70000]/10 rounded-full flex items-center justify-center mb-5 border border-[#c70000]/20 text-[#c70000]"><TrashIcon className="w-10 h-10" /></div>
            <h3 className="text-xl font-bold text-white mb-2">تأكيد الحذف</h3>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">هل أنت متأكد من حذف هذه المهمة نهائياً؟</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setMissionToDelete(null)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-300 hover:bg-white/5 border border-white/10 transition-colors">إلغاء</button>
              <button onClick={confirmDeleteMission} className="flex-1 bg-[#c70000] hover:bg-[#a50000] text-white px-4 py-3 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">نعم، احذف</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-bold text-white">سجل متابعة المهام</h3>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-[#1a1a1a] p-1 rounded-xl border border-white/10 shadow-inner">
              <button onClick={() => setMissionViewType('all_types')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${missionViewType === 'all_types' ? 'bg-gray-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>كل المهام</button>
              <button onClick={() => { setMissionViewType('daily'); setFilterDate(getLocalDate()); }} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${missionViewType === 'daily' ? 'bg-[#c70000] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>المهام العادية</button>
              <button onClick={() => { setMissionViewType('open'); setFilterDate(''); }} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${missionViewType === 'open' ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'text-gray-400 hover:text-white'}`}>المهام المفتوحة</button>
            </div>

            <div className="hidden md:block w-px h-6 bg-white/10 mx-1"></div>

            {/* 💡 فلتر الحالة + فلتر الإقليم مع بعض! */}
            <div className="flex items-center gap-1 bg-[#1a1a1a] p-1 rounded-xl border border-white/10 shadow-inner">
              <button onClick={() => setStatusFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${statusFilter === 'all' ? 'bg-gray-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>الكل</button>
              <button onClick={() => setStatusFilter('active')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${statusFilter === 'active' ? 'bg-green-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>نشطة</button>
              <button onClick={() => setStatusFilter('completed')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${statusFilter === 'completed' ? 'bg-teal-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>مكتملة</button>
              
              <div className="w-px h-6 bg-white/10 mx-1"></div>
              
              {!isVolunteer && (
                <select value={activeRegionTab} onChange={(e) => setActiveRegionTab(e.target.value)} className="bg-transparent text-sm text-white font-bold outline-none cursor-pointer pl-2">
                  <option value="all" className="bg-[#111]">كل الأقاليم</option>
                  <option value="hq" className="bg-[#111]">المركز العام</option>
                  <option value="canal" className="bg-[#111]">إقليم القنال</option>
                  <option value="delta" className="bg-[#111]">إقليم الدلتا</option>
                  <option value="saeed" className="bg-[#111]">إقليم الصعيد</option>
                </select>
              )}
            </div>

            <div className="hidden md:block w-px h-6 bg-white/10 mx-1"></div>

            <div className="flex items-center gap-2">
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)] shadow-inner" />
              {filterDate && <button onClick={() => setFilterDate('')} className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors">إلغاء التاريخ</button>}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-4 md:mt-0">
          {isOwner && <button onClick={handleExportTableExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"><ExcelIcon /> تصدير السجل الشامل</button>}
          <button onClick={handleCreateNew} className="bg-[#c70000] hover:bg-[#a50000] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">+ إنشاء مهمة</button>
        </div>
      </div>

      {/* 💡 داشبورد مصغر للأقاليم في سجل المهام (بيسمع كل الفلاتر) */}
      {!isVolunteer && (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-[#0a0a0a] border-b border-white/5 shrink-0">
        <StatCard title="إجمالي المهام المفلترة" value={regionStats.total} color="text-white" borderHighlight />
        <StatCard title="المركز العام" value={regionStats.hq} color="text-[#c70000]" />
        <StatCard title="إقليم القنال" value={regionStats.canal} color="text-blue-400" />
        <StatCard title="إقليم الدلتا" value={regionStats.delta} color="text-green-400" />
        <StatCard title="إقليم الصعيد" value={regionStats.saeed} color="text-yellow-400" />
      </div>
      )}

      <div className="flex-1 overflow-auto custom-scrollbar relative">
        <table className="w-full text-right whitespace-nowrap">
          <thead className="sticky top-0 z-20 bg-[#1a1a1a]">
            <tr className="text-gray-400 text-sm">
              <th className="p-4 font-semibold border-l border-white/5">تاريخ الإنشاء</th>
              <th className="p-4 font-semibold border-l border-white/5 text-[#c70000]">تاريخ المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5 text-blue-400">تصنيف المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5 text-green-400">فترة المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">كود المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">التمركز (الفرع)</th>
              <th className="p-4 font-semibold border-l border-white/5">اسم المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">السيارات والسائقين</th>
              <th className="p-4 font-semibold border-l border-white/5">نوع المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">مكان المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">مسؤول المهمة</th>
              <th className="p-4 font-semibold border-l border-white/5">مصدر البلاغ</th>
              <th className="p-4 font-semibold border-l border-white/5">تاريخ التحرك</th>
              <th className="p-4 font-semibold border-l border-white/5">تاريخ الانتهاء</th>
              <th className="p-4 font-semibold border-l border-white/5">الحالة</th>
              <th className="p-4 font-semibold sticky top-0 left-0 z-30 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (<tr><td colSpan="16" className="p-8 text-center text-gray-500 font-bold">جاري السحب...</td></tr>) : 
            filteredMissions.length > 0 ? filteredMissions.map(m => (
              <tr key={`mission-${m.mission_id}`} className="hover:bg-white/5 transition-colors">
                <td className="p-4 text-gray-400 font-mono border-l border-white/5">{m.created_at}</td>
                <td className="p-4 text-white font-bold font-mono border-l border-white/5 bg-[#c70000]/10">{m.exit_date !== '-' && m.exit_date ? m.exit_date : 'غير مسجل'}</td>
                <td className="p-4 font-bold border-l border-white/5"><span className={`px-3 py-1 rounded-lg text-xs ${m.mission_classification === 'مفتوحة' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>{m.mission_classification || 'عادية'}</span></td>
                <td className="p-4 text-gray-300 border-l border-white/5 font-mono text-xs whitespace-nowrap text-center">
                  <div className="flex items-center justify-center gap-2 bg-[#111] px-2 py-1.5 rounded-lg border border-white/5">
                    <span className="text-green-400">من: {m.exit_date !== '-' && m.exit_date ? m.exit_date : m.created_at.split(' ')[0]}</span>
                    <span className="text-gray-600">|</span>
                    <span className={['Completed', 'Cancelled'].includes(m.status) ? "text-gray-400" : "text-blue-400 animate-pulse"}>إلى: {['Completed', 'Cancelled'].includes(m.status) ? (m.completion_date !== '-' && m.completion_date ? m.completion_date : 'غير مسجل') : '(حتى الآن...)'}</span>
                  </div>
                </td>
                <td className="p-4 font-mono text-gray-300 border-l border-white/5">{m.mission_code}</td>
                <td className="p-4 font-bold text-white border-l border-white/5">{m.branch}</td>
                <td className="p-4 text-gray-200 font-bold border-l border-white/5">{m.mission_name}</td>
                <td className="p-4 text-green-400 border-l border-white/5">{m.vehicles_info}</td>
                <td className="p-4 text-gray-300 border-l border-white/5">{m.mission_type}</td>
                <td className="p-4 text-gray-300 border-l border-white/5">{m.mission_location}</td>
                <td className="p-4 text-gray-400 border-l border-white/5">{m.responsible_person}</td>
                <td className="p-4 text-gray-400 border-l border-white/5">{m.data_source}</td>
                <td className="p-4 text-gray-400 border-l border-white/5">{m.departure_date}</td>
                <td className="p-4 text-gray-400 border-l border-white/5">{m.completion_date}</td>
                <td className="p-4 border-l border-white/5 text-center"><StatusBadge status={m.status} /></td>
                <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                  <div className="flex justify-center gap-2">
                    <button onClick={() => handleViewMission(m.mission_id)} className="p-2 bg-[#1a1a1a] hover:bg-[#c70000] text-gray-400 rounded-lg"><EyeIcon /></button>
                    {!isVolunteer && <button onClick={() => setMissionToDelete(m.mission_id)} className="p-2 bg-[#1a1a1a] hover:bg-red-600 text-gray-400 rounded-lg"><TrashIcon /></button>}
                  </div>
                </td>
              </tr>
            )) : (<tr><td colSpan="16" className="p-8 text-center text-gray-500">لا توجد مهام مطابقة</td></tr>)}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div key={currentMissionData ? `edit-${currentMissionData.mission_id}` : 'new'} className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-white/10 rounded-3xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col shadow-2xl animate-fade-in-up">
            
            <div className="p-5 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center shrink-0 rounded-t-3xl">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold text-gray-300 flex items-center gap-2"><span className="bg-[#c70000] w-2 h-6 rounded-sm"></span>توثيق مهمة ميدانية</h2>
                {currentMissionData && <StatusBadge status={currentMissionData.status} />}
              </div>
              <button onClick={() => setIsModalOpen(false)} className="bg-[#111] hover:bg-[#c70000] text-gray-400 hover:text-white p-2 rounded-xl border border-white/5"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              
              <div className="bg-[#0c0c0c] border border-white/5 rounded-2xl p-6 shadow-lg flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1 w-full">
                  <label className="block text-[#c70000] text-sm font-bold mb-2">اسم الاستمارة (عنوان رئيسي)</label>
                  <input id="f_mission_name" type="text" defaultValue={missionName} onChange={(e) => setMissionName(e.target.value)} placeholder="مثال: تأمين مول..." className="w-full bg-transparent border-b-2 border-white/10 focus:border-[#c70000] text-white text-2xl font-bold pb-2 outline-none" />
                </div>
                <div className="w-full md:w-48"><FormGroup label="كود الاستمارة"><StyledInput id="f_mission_code" disabled={!isOwner} defaultValue={currentMissionData?.mission_code || ''} placeholder="#MSN-AUTO" className={`text-center font-mono ${!isOwner ? 'text-gray-500 bg-[#0a0a0a] opacity-50 cursor-not-allowed' : 'text-white bg-[#111] border border-white/10'}`} title={!isOwner ? 'لا يمكن تعديله (للمالك فقط)' : ''} /></FormGroup></div>
              </div>

              <SectionCard title="البيانات الأساسية للمهمة" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <FormGroup label="تصنيف المهمة">
                    <StyledSelect id="f_mission_class" value={missionClass} onChange={(e) => setMissionClass(e.target.value)}>
                      <option value="عادية">مهمة عادية</option>
                      <option value="مفتوحة">مهمة مفتوحة</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="التمركز / الفرع"><StyledSelect id="f_branch_id" defaultValue={currentMissionData?.branch_id || '19'}><option value="19">المركز العام</option>{branches.map(b => b.name !== 'القاهرة' && b.name !== 'المركز العام' && <option key={b.id} value={b.id}>{b.name}</option>)}</StyledSelect></FormGroup>
                  <FormGroup label="نوع المهمة"><StyledInput id="f_mission_type" defaultValue={currentMissionData?.mission_type || ''} /></FormGroup>
                  <FormGroup label="مكان المهمة"><StyledInput id="f_mission_location" defaultValue={currentMissionData?.mission_location || ''} /></FormGroup>
                  <FormGroup label="حالة العملية الميدانية">
                    <StyledSelect id="f_mission_field_status" defaultValue={currentMissionData?.notes?.includes('[حالة الميدان: مكتملة]') ? 'مكتملة' : 'نشطة'}>
                      <option value="نشطة">نشطة (لم تنتهي بعد)</option>
                      <option value="مكتملة">مكتملة (تم الانتهاء)</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="مسؤول المهمة"><StyledInput id="f_responsible_person" defaultValue={currentMissionData?.responsible_person || ''} /></FormGroup>
                  <FormGroup label="تاريخ الإنشاء (يسجل آلياً)">
                    <StyledInput 
                      id="f_creation_date" 
                      type="date" 
                      max="2030-12-31"
                      defaultValue={getCreationDate()} 
                      disabled={!isOwner}
                      className={!isOwner ? 'opacity-50 cursor-not-allowed text-gray-500 bg-[#0a0a0a]' : 'text-white border border-white/10'}
                      title={!isOwner ? 'لا يمكن تعديله (للمالك فقط)' : ''}
                    />
                  </FormGroup>
                  <FormGroup label="مصدر البلاغ"><StyledSelect id="f_data_source" defaultValue={currentMissionData?.data_source || 'واتساب'}><option>واتساب</option><option>هاتفياً</option></StyledSelect></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="التواريخ والتوقيتات" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  <FormGroup label="تاريخ المهمة"><StyledInput id="f_exit_date" type="date" defaultValue={currentMissionData?.exit_date || ''} /></FormGroup>
                  <FormGroup label="تاريخ الخروج"><StyledInput id="f_departure_date" type="date" defaultValue={currentMissionData?.departure_date || ''} /></FormGroup>
                  <FormGroup label="تاريخ الوصول للمكان"><StyledInput id="f_arrival_date" type="date" defaultValue={currentMissionData?.arrival_date || ''} /></FormGroup>
                  <FormGroup label="تاريخ العودة"><StyledInput id="f_return_date" type="date" defaultValue={currentMissionData?.return_date || ''} /></FormGroup>
                  <FormGroup label="تاريخ الانتهاء"><StyledInput id="f_completion_date" type="date" defaultValue={currentMissionData?.completion_date || ''} /></FormGroup>
                  <FormGroup label="ساعة البدء"><StyledInput id="f_start_time" type="time" defaultValue={currentMissionData?.start_time || ''} /></FormGroup>
                  <FormGroup label="ساعة التحرك"><StyledInput id="f_departure_time" type="time" defaultValue={currentMissionData?.departure_time || ''} /></FormGroup>
                  <FormGroup label="ساعة الوصول"><StyledInput id="f_arrival_time" type="time" defaultValue={currentMissionData?.arrival_time || ''} /></FormGroup>
                  <FormGroup label="ساعة الانتهاء"><StyledInput id="f_completion_time" type="time" defaultValue={currentMissionData?.completion_time || ''} /></FormGroup>
                </div>
              </SectionCard>

              {missionClass !== 'مفتوحة' && (
                <SectionCard title="تفاصيل خط السير الأساسي" icon={<MapIcon />} actionBtn={<button onClick={addRoute} className="text-xs text-[#c70000] hover:text-white font-bold bg-[#c70000]/10 px-3 py-1.5 rounded-lg">+ إضافة مسار</button>}>
                  <div className="w-full flex flex-col items-center">
                    <div className="mb-4 -mt-2">
                      {routes.length > 0 ? (<button onClick={() => setRoutes([])} className="bg-[#111] hover:bg-[#c70000] text-gray-400 px-8 py-1.5 rounded-full text-xs font-bold border border-[#c70000]/30">لا يوجد خط سير</button>) : (<button onClick={() => setRoutes([{ id: Date.now() }])} className="bg-[#111] hover:bg-green-600 text-gray-400 px-8 py-1.5 rounded-full text-xs font-bold border border-green-600/30">+ تفعيل خط السير</button>)}
                    </div>
                    <div className="w-full">
                      {routes.map((route, index) => (
                        <div key={route.id} className="flex flex-col md:flex-row w-full border border-white/10 rounded-lg overflow-hidden mb-2 bg-[#1a1a1a]">
                          <div className="flex-1 flex border-l border-white/10"><input id={`r_to_main_${index}`} type="text" defaultValue={route.route_to || ''} placeholder="إلى (الوجهة)..." className="w-full bg-transparent outline-none text-white text-sm px-4 py-2" /></div>
                          <div className="w-full md:w-auto flex border-l border-white/10"><div className="bg-[#111] text-gray-400 text-xs px-3 flex items-center justify-center border-l border-white/10">ساعة التحرك:</div><input id={`r_dep_main_${index}`} type="time" defaultValue={route.departure_time || ''} className="bg-transparent text-white px-2 w-28 text-center" /></div>
                          <div className="w-full md:w-auto flex"><div className="bg-[#111] text-gray-400 text-xs px-3 flex items-center justify-center border-l border-white/10">ساعة الوصول:</div><input id={`r_arr_main_${index}`} type="time" defaultValue={route.arrival_time || ''} className="bg-transparent text-white px-2 w-28 text-center" />{routes.length > 1 && (<button onClick={() => removeRoute(route.id)} className="px-3 text-gray-500 hover:text-red-500 bg-[#111] border-r border-white/5"><TrashIcon /></button>)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              <SectionCard title={missionClass === 'مفتوحة' ? "أيام المهمة / مسارات التحرك" : "خطوط سير مخصصة (لفرق أو أفراد محددين)"} icon={<MapIcon />} actionBtn={<button onClick={addCustomItinerary} className="text-xs text-[#c70000] hover:text-white font-bold bg-[#c70000]/10 px-3 py-1.5 rounded-lg">{missionClass === 'مفتوحة' ? "+ إضافة يوم / مسار جديد" : "+ إضافة خط سير مخصص"}</button>}>
                <div className="space-y-4">
                  {customItineraries.length === 0 && <p className="text-center text-gray-600 text-sm">{missionClass === 'مفتوحة' ? "يرجى إضافة أيام المهمة أو المسارات..." : "لا يوجد خطوط سير مخصصة."}</p>}
                  {customItineraries.map((ci, ciIndex) => (
                    <div key={ci.id} className="bg-[#111] border border-white/5 p-4 rounded-xl">
                      <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
                        <input id={`r_title_${ci.id}`} type="text" defaultValue={ci.title} onChange={(e) => updateCustomTitle(ci.id, e.target.value)} placeholder={missionClass === 'مفتوحة' ? "اكتب اسم اليوم (مثال: تحركات اليوم الأول)..." : "اكتب اسم خط السير المخصص هنا..."} className="bg-transparent text-[#c70000] font-bold outline-none w-full md:w-1/2" />
                        <div className="flex gap-2">
                          <button onClick={() => addRouteToCustom(ci.id)} className="text-xs text-green-500 hover:bg-white/5 px-2 py-1 rounded">+ مسار</button>
                          <button onClick={() => removeCustomItinerary(ci.id)} className="text-xs text-red-500 hover:bg-white/5 px-2 py-1 rounded">حذف المخصص</button>
                        </div>
                      </div>
                      {ci.routes.map((cr, rIndex) => (
                        <div key={cr.id} className="flex flex-col md:flex-row w-full border border-white/10 rounded-lg overflow-hidden mb-2 bg-[#1a1a1a]">
                          <div className="flex-1 flex border-l border-white/10"><input id={`r_to_cust_${ciIndex}_${rIndex}`} type="text" defaultValue={cr.route_to || ''} placeholder="الوجهة..." className="w-full bg-transparent text-white px-4 py-2" /></div>
                          <div className="w-full md:w-auto flex border-l border-white/10"><input id={`r_dep_cust_${ciIndex}_${rIndex}`} type="time" defaultValue={cr.departure_time || ''} className="bg-transparent text-white px-2 w-28 text-center" /></div>
                          <div className="w-full md:w-auto flex"><input id={`r_arr_cust_${ciIndex}_${rIndex}`} type="time" defaultValue={cr.arrival_time || ''} className="bg-transparent text-white px-2 w-28 text-center" />{ci.routes.length > 1 && <button onClick={() => removeRouteFromCustom(ci.id, cr.id)} className="px-3 text-gray-500"><TrashIcon /></button>}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="السيارات والسائقين (أسطول المهمة)" icon={<CarIcon />} actionBtn={<button onClick={addVehicle} className="text-xs text-[#c70000] hover:text-white font-bold bg-[#c70000]/10 px-3 py-1.5 rounded-lg">+ إضافة سيارة</button>}>
                <div className="w-full flex flex-col items-center">
                  <div className="mb-4 -mt-2">
                    {vehicles.length > 0 ? (<button onClick={() => setVehicles([])} className="bg-[#111] hover:bg-[#c70000] text-gray-400 px-8 py-1.5 rounded-full text-xs font-bold border border-[#c70000]/30">لا يوجد سيارات</button>) : (<button onClick={() => setVehicles([{ id: Date.now() }])} className="bg-[#111] hover:bg-green-600 text-gray-400 px-8 py-1.5 rounded-full text-xs font-bold border border-green-600/30">+ تفعيل أسطول السيارات</button>)}
                  </div>
                  <div className="w-full">
                    {vehicles.map((v, index) => (<VehicleRow key={`veh-${v.id}`} index={index} onRemove={() => removeVehicle(v.id)} data={v} />))}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="القوة البشرية والمشاركين" icon={<UsersIcon />} actionBtn={<button onClick={addParticipant} className="text-xs text-[#c70000] hover:text-white font-bold bg-[#c70000]/10 px-3 py-1.5 rounded-lg">+ إضافة مشارك</button>}>
                <div className="overflow-x-auto bg-[#111] rounded-xl border border-white/5">
                  <table className="w-full text-right text-sm min-w-[950px]">
                    <thead className="bg-[#1a1a1a] text-gray-400 border-b border-white/5"><tr><th className="p-3">م</th><th className="p-3">النوع</th><th className="p-3">الاسم</th><th className="p-3 text-blue-400 w-32">الفريق / الكود</th><th className="p-3">رقم العضوية / الصفة</th>{missionClass === 'مفتوحة' && <><th className="p-3 text-purple-400 w-24">المرحلة</th><th className="p-3 text-orange-400 w-28">التواجد</th></>}<th className="p-3">الفرع</th><th className="p-3 text-green-400">المسار</th><th className="p-3 text-yellow-500 w-32">الحالة</th><th className="p-3 text-center">حذف</th></tr></thead>
                    <tbody className="divide-y divide-white/5">
                      {participants.map((p, index) => (
                        <tr key={p.id} className="hover:bg-white/5">
                          <td className="p-2 text-center text-gray-600 font-bold">{index + 1}</td>
                          <td className="p-2">
                            <select id={`p_type_${index}`} value={p.participant_type || 'volunteer'} onChange={(e) => { const newP = [...participants]; newP[index].participant_type = e.target.value; setParticipants(newP); }} className="bg-transparent text-white outline-none">
                              <option value="volunteer" className="bg-[#111]">متطوع</option>
                              <option value="non_volunteer" className="bg-[#111]">غير متطوع</option>
                            </select>
                          </td>
                          <td className="p-2"><input id={`p_name_${index}`} type="text" defaultValue={p.full_name || ''} placeholder="الاسم..." className="bg-transparent outline-none text-white w-full" /></td>
                          
                          <td className="p-2 flex gap-1">
                            <input id={`p_team_${index}`} type="text" defaultValue={p.team_name || ''} placeholder="الفريق" className="w-1/2 bg-transparent outline-none text-blue-300 border-b border-transparent focus:border-[#c70000] px-1" />
                            <input id={`p_tcode_${index}`} type="text" defaultValue={p.team_code || ''} placeholder="الكود" className="w-1/2 bg-transparent outline-none text-blue-400 font-mono text-xs border-b border-transparent focus:border-[#c70000] px-1" />
                          </td>
                          
                          <td className="p-2">
                            <input id={`p_role_${index}`} type="text" defaultValue={p.participation_role || ''} placeholder={(p.participant_type || 'volunteer') === 'volunteer' ? 'رقم العضوية...' : 'الصفة...'} className="bg-transparent outline-none text-white w-full" />
                          </td>
                          {missionClass === 'مفتوحة' && (
                            <>
                              <td className="p-2">
                                <input id={`p_phase_${index}`} type="text" defaultValue={p.phase_name || 'اليوم الأول'} placeholder="اليوم 1..." className="bg-transparent outline-none text-purple-300 font-bold text-center w-full border-b border-transparent focus:border-purple-500 transition-colors" />
                              </td>
                              <td className="p-2">
                                <select id={`p_stay_${index}`} defaultValue={p.stay_type || 'ذهاب وعودة'} className="bg-[#1a1a1a] text-orange-400 border border-white/5 px-1 py-1 outline-none w-full rounded text-xs font-bold">
                                  <option value="ذهاب وعودة">🔄 عودة</option>
                                  <option value="مبيت">⛺ مبيت</option>
                                </select>
                              </td>
                            </>
                          )}
                          <td className="p-2">
                            <select 
                              id={`p_branch_${index}`} 
                              defaultValue={p.branch_id || '19'} 
                              disabled={(p.participant_type || 'volunteer') === 'non_volunteer'}
                              className={`bg-transparent outline-none w-full ${(p.participant_type || 'volunteer') === 'non_volunteer' ? 'text-gray-600 cursor-not-allowed' : 'text-white'}`}
                            >
                              <option value="19" className="bg-[#111]">المركز العام</option>
                              {branches.map(b => b.name !== 'القاهرة' && b.name !== 'المركز العام' && <option key={b.id} value={b.id} className="bg-[#111]">{b.name}</option>)}
                            </select>
                          </td>
                          <td className="p-2">
                            <select id={`p_itin_${index}`} defaultValue={p.assigned_itinerary || 'خط السير الأساسي'} className="bg-[#1a1a1a] text-green-400 border border-white/5 px-2 py-1 outline-none w-full rounded max-w-[120px] truncate">
                              {routes.length > 0 && missionClass !== 'مفتوحة' && <option value="خط السير الأساسي">خط السير الأساسي</option>}
                              {customItineraries.map((ci) => {
                                const ciTitle = document.getElementById(`r_title_${ci.id}`)?.value || ci.title || 'مخصص';
                                return <option key={ci.id} value={ciTitle}>{ciTitle}</option>;
                              })}
                              {routes.length === 0 && customItineraries.length === 0 && <option value="بدون خط سير">بدون خط سير</option>}
                            </select>
                          </td>
                          <td className="p-2">
                            <select id={`p_status_${index}`} defaultValue={p.return_status || 'مازال بالمهمة'} disabled={currentMissionData?.status === 'Completed' && isVolunteer} className={`bg-[#1a1a1a] border border-white/5 px-2 py-1 outline-none w-full rounded font-bold ${p.return_status === 'تم انتهاء مهمتة' ? 'text-gray-500' : 'text-yellow-500'} ${(currentMissionData?.status === 'Completed' && isVolunteer) ? 'opacity-50 cursor-not-allowed' : ''}`} onChange={(e) => { e.target.classList.remove('text-yellow-500', 'text-gray-500'); e.target.classList.add(e.target.value === 'تم انتهاء مهمتة' ? 'text-gray-500' : 'text-yellow-500'); }}>
                              <option value="مازال بالمهمة">📍 مازال بالمهمة</option>
                              <option value="تم انتهاء مهمتة">🏠 تم انتهاء مهمتة</option>
                            </select>
                          </td>
                          <td className="p-2 text-center"><button onClick={() => removeParticipant(p.id)} className="text-gray-500 hover:text-red-500"><TrashIcon /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard title="إحصائيات المستفيدين" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>} actionBtn={<button onClick={addBeneficiary} className="text-xs text-[#c70000] hover:text-white font-bold bg-[#c70000]/10 px-3 py-1.5 rounded-lg">+ إضافة تصنيف</button>}>
                <div className="space-y-4">
                  {beneficiaries.map((ben, index) => (
                    <div key={`ben-${ben.id}`} className="flex flex-col md:flex-row gap-4 items-end bg-[#111] p-4 rounded-xl border border-white/5">
                      <div className="flex-1 w-full"><FormGroup label="تصنيف المستفيدين"><StyledInput id={`b_cat_${index}`} defaultValue={ben?.category_name || ''} placeholder="مثال: أطفال، مصابين..." className="bg-[#1a1a1a]" /></FormGroup></div>
                      <div className="flex-1 w-full"><FormGroup label="مستفيدين (مباشر)"><StyledInput id={`b_count_${index}`} defaultValue={ben?.direct_count || ''} type="number" placeholder="0" className="bg-[#1a1a1a]" /></FormGroup></div>
                      <div className="flex-1 w-full"><FormGroup label="مستفيدين (غير مباشر)"><StyledInput id={`b_indirect_${index}`} defaultValue={ben?.indirect_count || ''} type="number" placeholder="0" className="bg-[#1a1a1a]" /></FormGroup></div>
                      {beneficiaries.length > 1 && (<button onClick={() => removeBeneficiary(ben.id)} className="mb-2 p-2 text-gray-600 hover:text-red-500 bg-[#1a1a1a] rounded-lg border border-white/5"><TrashIcon /></button>)}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="فريق إدارة الغرفة (الهيكل الإداري)" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}>
                <div className="space-y-4">
                  <div className="bg-[#111] p-4 rounded-xl border border-[#c70000]/30 shadow-[0_0_15px_rgba(199,0,0,0.05)] w-full">
                    <FormGroup label="مسؤول المتابعة (قائد العملية)"><StyledInput id="eoc_leader" defaultValue={getStaff('مسؤول المتابعة')} placeholder="الاسم ورقم الهاتف..." className="bg-[#1a1a1a] text-lg font-bold" /></FormGroup>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormGroup label="المشرف"><StyledInput id="eoc_supervisor" defaultValue={getStaff('المشرف')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup label="المشرف المراجع"><StyledInput id="eoc_reviewer" defaultValue={getStaff('المشرف المراجع')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup label="الجوكر"><StyledInput id="eoc_joker" defaultValue={getStaff('الجوكر')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup label="معبئ الاستمارة"><StyledInput id="eoc_filler" defaultValue={getStaff('معبئ الاستمارة')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup label="مستكمل الاستمارة"><StyledInput id="eoc_completer" defaultValue={getStaff('مستكمل الاستمارة')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup label="مراجع الاستمارة"><StyledInput id="eoc_final_reviewer" defaultValue={getStaff('مراجع الاستمارة')} placeholder="الاسم..." /></FormGroup>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="الحالة والملاحظات العامة" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* 1. حالة الاستمارة (مغلق) */}
                  <FormGroup label="موقف الاستمارة إدارياً وميدانياً (مغلق)">
                    <textarea 
                      readOnly 
                      value={`موقف الاستمارة إدارياً: ${currentMissionData ? {'Draft': 'مسودة', 'Active': 'نشطة', 'Under Review': 'قيد المراجعة', 'Approved': 'معتمدة وفي انتظار الانتهاء', 'Completed': 'مكتملة (تم انتهاء المهمة)', 'Returned': 'إرجاع للمتطوع (يوجد أخطاء)', 'Cancelled': 'ملغاة'}[currentMissionData.status] || 'جديدة' : 'جديدة'}\nحالة الحدث في الميدان: ${currentMissionData?.status === 'Completed' ? 'مكتملة (تم انتهاء المهمة)' : 'الاستمارة شغالة (ولم تنتهي حتى الآن)'}`}
                      rows="4" 
                      className="w-full bg-[#050505] border border-white/5 text-blue-400 font-bold rounded-xl p-3 text-sm outline-none resize-none cursor-not-allowed" 
                    />
                  </FormGroup>
                  
                  {/* 2. أسباب الرفض (مغلق - وبيتمسح لوحده برمجياً زي ما عملنا) */}
                  <FormGroup label="أسباب الإرجاع والتعديلات (مغلق)">
                    <textarea 
                      id="f_internal_notes" 
                      defaultValue={currentMissionData?.internal_notes || ''} 
                      readOnly 
                      rows="4" 
                      className="w-full bg-[#1a0505] border border-red-500/20 text-red-400 rounded-xl p-3 text-sm outline-none resize-none cursor-not-allowed" 
                      placeholder="لا توجد ملاحظات إرجاع حالياً... (تُحذف تلقائياً عند الاعتماد أو الإغلاق)"
                    ></textarea>
                  </FormGroup>

                  {/* 3. الملاحظات العامة (مفتوحة للجميع) */}
                  <FormGroup label="الملاحظات والتحديثات (متاحة للجميع)">
                    <textarea 
                      id="f_notes" 
                      defaultValue={currentMissionData?.notes?.replace(/\[حالة الميدان: .*?\]\n?/g, '') || ''} 
                      rows="4" 
                      className="w-full bg-[#111] border border-white/5 focus:border-[#c70000]/50 text-white rounded-xl p-3 text-sm outline-none resize-none shadow-inner" 
                      placeholder="اكتب هنا أي ملاحظات إضافية، تحديثات ميدانية متاحة للغرفة..."
                    ></textarea>
                  </FormGroup>
                </div>
              </SectionCard>

            </div>
            
            <div className="p-5 border-t border-white/10 bg-[#0a0a0a] flex flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl">
              {!isVolunteer && <button onClick={handleExportSingleExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"><ExcelIcon /> تصدير الاستمارة</button>}
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إغلاق</button>
              
              {/* 👑 المالك (God Mode): كل الزراير متاحة ومفتوحة دايماً */}
              {isOwner ? (
                <>
                  <button onClick={() => handleSubmit('Draft')} className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold">مسودة</button>
                  <button onClick={() => handleSubmit('Under Review')} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold">إرسال للجوكر</button>
                  <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} className="bg-yellow-600 hover:bg-yellow-500 text-gray-900 px-6 py-2.5 rounded-xl text-sm font-bold">إرجاع للمتطوع</button>
                  <button onClick={() => handleSubmit('Approved')} className="bg-green-600 hover:bg-green-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold">تم مراجعة المهمة</button>
                  <button onClick={() => handleSubmit('Completed')} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">إنهاء وإغلاق المهمة</button>
                  {currentMissionData?.status === 'Completed' && <button onClick={() => handleSubmit('Approved')} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)]">إلغاء الإغلاق (إعادة فتح)</button>}
                </>
              ) : (
                /* 👷 باقي الرتب بتمشي على السايكل الصارمة اللي إنت طلبتها */
                <>
                  {/* 1. استمارة جديدة / مسودة / معادة */}
                  {(!currentMissionData || currentMissionData.status === 'Draft' || currentMissionData.status === 'Returned') && (
                    <>
                      <button onClick={() => handleSubmit('Draft')} className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold">حفظ كمسودة</button>
                      <button onClick={() => handleSubmit('Under Review')} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold">إرسال إلى الجوكر</button>
                    </>
                  )}

                  {/* 2. قيد المراجعة (زرار الإنهاء يظهر للجوكر هنا لو المتطوع كان باعتها كإنهاء) */}
                  {currentMissionData?.status === 'Under Review' && !isVolunteer && (
                    <>
                      <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} className="bg-red-600 hover:bg-red-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold">إرجاع للتعديل</button>
                      <button onClick={() => handleSubmit('Approved')} className="bg-green-600 hover:bg-green-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold">تم مراجعة المهمة (مستمرة)</button>
                      <button onClick={() => handleSubmit('Completed')} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">إنهاء وإغلاق المهمة</button>
                    </>
                  )}

                  {/* 3. معتمدة (شغالة) - المتطوع آخره يبعت التحديثات للجوكر */}
                  {currentMissionData?.status === 'Approved' && (
                    <>
                      {isVolunteer && <button onClick={() => handleSubmit('Under Review')} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold">إرسال التحديثات للجوكر</button>}
                      {!isVolunteer && (
                        <>
                          <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} className="bg-yellow-600 hover:bg-yellow-500 text-gray-900 px-6 py-2.5 rounded-xl text-sm font-bold">إرجاع للمتطوع</button>
                          <button onClick={() => handleSubmit('Completed')} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">إنهاء وإغلاق المهمة</button>
                        </>
                      )}
                    </>
                  )}

                  {/* 4. مكتملة (مقفولة) - المتطوع ميشوفش حاجة، بس الجوكر والمشرف يقدروا يعدلوا أخطاء ويحفظوها تاني كمكتملة */}
                  {currentMissionData?.status === 'Completed' && !isVolunteer && (
                    <>
                      <button onClick={() => handleSubmit('Completed')} className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(20,184,166,0.3)]">حفظ التعديلات (كمكتملة)</button>
                      <button onClick={() => handleSubmit('Approved')} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)]">إلغاء الإغلاق (إعادة فتح)</button>
                    </>
                  )}
                </>
              )}
            </div>
            
            {/* 💡 نافذة (Modal) كتابة سبب الإرجاع */}
            {/* 💡 نافذة (Modal) الإرجاع بتصميم احترافي (بدون Alerts متصفح) */}
            {returnModalOpen && (
              <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-[120] p-4">
                <div className="bg-[#0c0c0c] border border-yellow-600/30 rounded-3xl w-full max-w-md p-8 flex flex-col items-center shadow-[0_0_40px_rgba(202,138,4,0.2)] animate-fade-in-up text-center">
                  <div className="w-20 h-20 bg-yellow-600/10 rounded-full flex items-center justify-center mb-5 border border-yellow-600/20 text-yellow-500"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                  <h3 className="text-xl font-bold text-white mb-2">إرجاع الاستمارة للمتطوع</h3>
                  <p className="text-gray-400 text-sm mb-4 leading-relaxed">برجاء كتابة سبب الإرجاع أو التعديلات المطلوبة بوضوح.</p>
                  
                  {/* 💡 الإشعار الشيك لو داس تأكيد وهو سايب الخانة فاضية */}
                  {returnError && (
                    <div className="w-full bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-bold p-3 rounded-xl mb-4 flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      {returnError}
                    </div>
                  )}
                  
                  <textarea 
                    value={returnText} 
                    onChange={(e) => { setReturnText(e.target.value); setReturnError(''); }} 
                    rows="4" 
                    className={`w-full bg-[#111] border ${returnError ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-yellow-500'} text-white rounded-xl p-3 text-sm outline-none resize-none mb-6 transition-colors`} 
                    placeholder="مثال: يرجى استكمال بيانات السيارات..."
                  ></textarea>
                  
                  <div className="flex gap-4 w-full">
                    <button onClick={() => { setReturnModalOpen(false); setReturnError(''); }} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-300 hover:bg-white/5 border border-white/10 transition-colors">إلغاء</button>
                    <button onClick={() => {
                      if (returnText.trim()) {
                        document.getElementById('f_internal_notes').value = `[مطلوب تعديل]: ${returnText}`;
                        setReturnModalOpen(false);
                        setReturnText('');
                        setReturnError('');
                        handleSubmit('Returned');
                      } else { 
                        // 💡 هنا بنغير قيمة الإشعار بدل الـ Alert المستفز
                        setReturnError('برجاء كتابة سبب الإرجاع بوضوح لتوجيه المتطوع!'); 
                      }
                    }} className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-gray-900 px-4 py-3 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(202,138,4,0.3)] transition-all">تأكيد الإرجاع</button>
                  </div>
                </div>
              </div>
            )}
            </div>
        </div>
      )}
      {/* -- تصميم التنبيه الإداري الفخم -- */}
      {customAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-[#c70000]/50 rounded-2xl p-6 max-w-md w-full shadow-[0_0_40px_rgba(199,0,0,0.3)] animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4 border-b border-white/10 pb-4">
              <svg className="w-7 h-7 text-[#c70000]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <h3 className="text-xl font-bold text-white">تنبيه النظام</h3>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{customAlert}</p>
            <div className="mt-8 flex justify-end">
              <button onClick={() => setCustomAlert(null)} className="bg-[#c70000] hover:bg-red-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-red-500/50">
                علم، جاري التعديل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FormGroup = ({ label, children }) => (<div className="flex flex-col gap-1.5 w-full"><label className="text-gray-400 text-xs font-bold px-1">{label}</label>{children}</div>);
const StyledInput = ({ className="", ...props }) => (<input className={`w-full bg-[#111] border border-white/5 focus:border-[#c70000]/50 text-white rounded-xl p-3 text-sm outline-none ${className}`} {...props} />);
const StyledSelect = ({ children, className="", ...props }) => (<select className={`w-full bg-[#111] border border-white/5 focus:border-[#c70000]/50 text-white rounded-xl p-3 text-sm outline-none ${className}`} {...props}>{children}</select>);
const SectionCard = ({ title, icon, actionBtn, children }) => (<div className="bg-[#0c0c0c] border border-white/5 rounded-2xl p-6 shadow-lg"><div className="flex justify-between items-center mb-6 border-b border-white/5 pb-3"><div className="flex items-center gap-2"><span className="text-[#c70000]">{icon}</span><h4 className="text-white font-bold text-sm tracking-wide">{title}</h4></div>{actionBtn && <div>{actionBtn}</div>}</div>{children}</div>);

const VehicleRow = ({ index, onRemove, data }) => (
  <div className="flex flex-col md:flex-row w-full border border-white/10 rounded-lg overflow-hidden mb-2 bg-[#111]">
    <div className="flex-1 flex border-b md:border-b-0 md:border-l border-white/10"><div className="bg-[#1a1a1a] text-gray-400 text-xs px-3 flex items-center justify-center">اسم السائق:</div><input id={`v_driver_${index}`} type="text" defaultValue={data?.driver_name || ''} className="w-full bg-transparent outline-none text-white text-sm px-4 py-2" /></div>
    <div className="flex-1 flex"><div className="bg-[#1a1a1a] text-gray-400 text-xs px-3 flex items-center justify-center border-l border-white/10">رقم السيارة:</div><input id={`v_plate_${index}`} type="text" defaultValue={data?.vehicle_number || ''} className="w-full bg-transparent outline-none text-white text-sm px-4 py-2" /><button onClick={onRemove} className="px-3 text-gray-500 hover:text-red-500 bg-[#111]"><TrashIcon /></button></div>
  </div>
);

function NavItem({ icon, label, isActive, onClick }) { return ( <button onClick={onClick} className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-300 ${isActive ? 'bg-gradient-to-l from-[#c70000] to-[#990000] text-white shadow-[0_0_20px_rgba(199,0,0,0.3)]' : 'text-gray-400 hover:bg-[#111] hover:text-white'}`}> {icon} <span className="font-bold text-sm tracking-wide">{label}</span> </button> ); }
function InventoryCard({ title, value, unit, color }) { return ( <div className="bg-[#0c0c0c] border border-white/5 p-5 rounded-2xl"><p className="text-gray-400 text-xs font-bold mb-1">{title}</p><p className={`text-3xl font-black ${color}`}>{value}</p><p className="text-[10px] text-gray-500 mt-1">{unit}</p></div> ); }
function StatCard({ title, value, color, icon, borderHighlight }) { return ( <div className={`bg-[#0c0c0c] border ${borderHighlight ? 'border-[#c70000]/50' : 'border-white/5'} p-5 rounded-3xl relative h-32`}>{icon && icon}<p className="text-gray-400 text-xs font-semibold mb-1 relative z-10">{title}</p><p className={`text-3xl font-black ${color} relative z-10`}>{value}</p></div> ); }

const CarIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.909.53l1.415 2.83M15 16h1a1 1 0 001-1v-1.586a1 1 0 00-.293-.707l-1.415-1.415A1 1 0 0014.586 11H13v5z" /></svg>;
const EyeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
const TrashIcon = (props) => <svg {...props} className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const HomeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
const AlertIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
const UsersIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
const MapIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
const LogoutIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>;
const InventoryIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
const CheckIcon = (props) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const PendingIcon = (props) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const ExcelIcon = () => (<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill="#1e1e1e" /><path d="M14 2V8H20L14 2Z" fill="#33c481" /><path d="M8.5 18L10.5 14L8.5 10H10.5L11.5 12.5L12.5 10H14.5L12.5 14L14.5 18H12.5L11.5 15.5L10.5 18H8.5Z" fill="#33c481" /></svg>);

// ==========================================
// 5. شاشة سجل النظام (للمالك فقط)
// ==========================================
// ==========================================
// 5. شاشة سجل النظام (للمالك فقط)
// ==========================================
function AuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('الكل');
  const [entityFilter, setEntityFilter] = useState('all'); // الفلتر الجديد (الكل، مهام، أخبار)

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    fetch('https://eoc-system.vercel.app/api/audit-logs', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => { setLogs(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.full_name?.includes(searchTerm) || log.details?.includes(searchTerm);
    const matchesAction = actionFilter === 'الكل' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    return matchesSearch && matchesAction && matchesEntity;
  });

  const uniqueActions = ['الكل', ...new Set(logs.map(l => l.action))];
  
  const handleExportLogs = async () => {
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system.vercel.app/api/audit-logs/export', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        return alert(`خطأ من السيرفر: ${errorData.detail || 'غير معروف'}`);
      }
      
      const allLogs = await res.json();
      
      // بنفلتر البيانات اللي جاية من السيرفر قبل التصدير بناءً على الفلتر اللي اليوزر مختاره
      const logsToExport = allLogs.filter(log => entityFilter === 'all' || log.entity_type === entityFilter);
      if (logsToExport.length === 0) return alert("لا توجد سجلات لهذا القسم لتصديرها.");
      
      const excelData = logsToExport.map(log => ({
        "التاريخ والوقت": log.created_at,
        "القسم": log.entity_type === 'mission' ? 'المهام الميدانية' : log.entity_type === 'local_news' ? 'الأخبار المحلية' : 'نظام داخلي',
        "اسم المستخدم": log.full_name,
        "نوع الإجراء": log.action,
        "تفاصيل العملية": log.details
      }));

      // اسم الملف بيتغير بذكاء حسب الفلتر
      let fileName = 'الأرشيف_الأمني_الشامل.xlsx';
      if (entityFilter === 'mission') fileName = 'سجل_لوج_المهام_فقط.xlsx';
      if (entityFilter === 'local_news') fileName = 'سجل_لوج_الأخبار_فقط.xlsx';

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, "الأرشيف");
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      alert("حدث خطأ في الاتصال بالسيرفر أثناء تحميل الأرشيف.");
    }
  };

  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[calc(100vh-180px)]">
      <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#c70000]/10 rounded-xl flex items-center justify-center border border-[#c70000]/20 text-[#c70000]"><ShieldIcon /></div>
          <h3 className="text-xl font-bold text-white tracking-wide">سجل الإجراءات الرقابية <span className="text-xs text-[#c70000] bg-[#c70000]/10 border border-[#c70000]/30 px-2 py-1 rounded ml-2">سري للغاية</span></h3>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          
          {/* فلتر القطاع (مهام / أخبار) */}
          <div className="flex items-center gap-1 bg-[#1a1a1a] p-1 rounded-xl border border-white/10 shadow-inner">
            <button onClick={() => setEntityFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'all' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>الكل</button>
            <button onClick={() => setEntityFilter('mission')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'mission' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>المهام</button>
            <button onClick={() => setEntityFilter('local_news')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'local_news' ? 'bg-[#c70000] text-white' : 'text-gray-400 hover:text-white'}`}>الأخبار</button>
          </div>

          <input type="text" placeholder="بحث باسم المستخدم..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-[#1a1a1a] border border-white/10 focus:border-[#c70000]/50 text-white rounded-xl px-4 py-2 text-sm outline-none w-full md:w-48" />
          
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="bg-[#1a1a1a] border border-white/10 focus:border-[#c70000]/50 text-white rounded-xl px-4 py-2 text-sm outline-none cursor-pointer">
            {uniqueActions.map(action => <option key={action} value={action}>{action}</option>)}
          </select>

          <button onClick={handleExportLogs} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shrink-0">
            <ExcelIcon /> تصدير السجل
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar relative">
        <table className="w-full text-right text-sm whitespace-nowrap">
          <thead className="bg-[#1a1a1a] text-gray-400 sticky top-0 z-10 shadow-md">
            <tr>
              <th className="p-4 font-semibold border-l border-white/5 w-48">التاريخ والوقت</th>
              <th className="p-4 font-semibold border-l border-white/5 text-purple-400 w-24 text-center">القسم</th>
              <th className="p-4 font-semibold border-l border-white/5 text-[#c70000] w-48">اسم المستخدم</th>
              <th className="p-4 font-semibold border-l border-white/5 text-blue-400 w-40">نوع الإجراء</th>
              <th className="p-4 font-semibold">تفاصيل العملية (ماذا حدث؟)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (<tr><td colSpan="5" className="p-8 text-center text-gray-500 font-bold animate-pulse">جاري سحب السجلات السرية...</td></tr>) : 
            filteredLogs.length > 0 ? filteredLogs.map((log, idx) => (
              <tr key={idx} className="hover:bg-white/5 transition-colors">
                <td className="p-4 text-gray-400 font-mono border-l border-white/5" dir="ltr">{log.created_at}</td>
                <td className="p-4 border-l border-white/5 text-center">
                  {log.entity_type === 'mission' ? <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/30">المهام</span> : 
                   log.entity_type === 'local_news' ? <span className="bg-[#c70000]/20 text-[#c70000] px-2 py-1 rounded text-xs border border-[#c70000]/30">الأخبار</span> : 
                   <span className="bg-gray-500/20 text-gray-400 px-2 py-1 rounded text-xs border border-gray-500/30">نظام</span>}
                </td>
                <td className="p-4 font-bold text-white border-l border-white/5">{log.full_name}</td>
                <td className="p-4 font-bold border-l border-white/5"><span className="bg-[#111] px-3 py-1 rounded-lg border border-white/10 text-xs">{log.action}</span></td>
                <td className="p-4 text-gray-300 truncate max-w-md whitespace-normal">{log.details}</td>
              </tr>
            )) : (<tr><td colSpan="5" className="p-8 text-center text-gray-500">لا توجد سجلات مطابقة للبحث</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ShieldIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
const NewsIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>;
// ==========================================
// 6. شاشة الأخبار المحلية (نظام التقييم والاستجابة)
// ==========================================
function LocalNewsView({ branches, isOwner, isSupervisor, isJoker, isVolunteer }) {
  const [newsList, setNewsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newsToDelete, setNewsToDelete] = useState(null);
  
  // حالات الفلاتر والتنبيهات
  const [filterDate, setFilterDate] = useState('');
  const [filterGov, setFilterGov] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [customAlert, setCustomAlert] = useState(null);

  const [nd, setNd] = useState({
    news_id: null, incident_date: '', incident_description: '', news_type: '', news_publisher: '', street_name: '', area_name: '', governorate: 'القاهرة',
    is_reported: false, report_time: '',
    is_responded: false, branch_response_text: '', response_time: '',
    is_field_response: false, movement_time: '', field_arrival_time: '', distance_km: '',
    intervention_type: 'طوارئ', intervening_branch: 'المركز العام', mission_form_name: '', participants_count: 0,
    hospital_name: '', injured_count: 0, deaths_count: 0, news_updates: '', news_link: '', data_entry_name: '', notes: ''
  });

  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  useEffect(() => { fetchNews(); }, []);

  const fetchNews = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system.vercel.app/api/local-news', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setNewsList(await res.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  const getMinutesDiff = (start, end) => {
    if (!start || !end) return null;
    let [sh, sm] = start.split(':').map(Number);
    let [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60;
    return diff;
  };

  const formatDuration = (mins) => {
    if (mins === null) return '';
    const d = Math.floor(mins / (24 * 60));
    const h = Math.floor((mins % (24 * 60)) / 60);
    const m = mins % 60;
    return `${d > 0 ? d + ' يوم و ' : ''}${h} ساعة و ${m} دقيقة`;
  };

  const getMonthName = (dateStr) => {
    if (!dateStr) return '';
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return months[new Date(dateStr).getMonth()];
  };

  const responseDiff = getMinutesDiff(nd.report_time, nd.response_time);
  const responsePoints = responseDiff !== null ? (responseDiff <= 6 ? 5 : responseDiff <= 11 ? 3 : 1) : 0;
  
  const moveDiff = getMinutesDiff(nd.report_time, nd.movement_time);
  const movePoints = moveDiff !== null ? (moveDiff <= 11 ? 5 : moveDiff <= 16 ? 3 : 1) : 0;

  const actualTravelMins = getMinutesDiff(nd.movement_time, nd.field_arrival_time);
  const expectedTravelMins = nd.distance_km ? (parseFloat(nd.distance_km) * 0.6) : null;
  let fieldPoints = 0;
  if (actualTravelMins !== null && expectedTravelMins !== null) {
    const timeDiff = actualTravelMins - expectedTravelMins;
    if (timeDiff <= -15) fieldPoints = 7;
    else if (timeDiff <= 0) fieldPoints = 5;
    else if (timeDiff <= 15) fieldPoints = 3;
    else fieldPoints = 1;
  }

  const handleCreateNew = () => {
    setNd({ news_id: null, incident_date: getLocalDate(), incident_description: '', news_type: '', news_publisher: '', street_name: '', area_name: '', governorate: 'القاهرة', is_reported: false, report_time: '', is_responded: false, branch_response_text: '', response_time: '', is_field_response: false, movement_time: '', field_arrival_time: '', distance_km: '', intervention_type: 'طوارئ', intervening_branch: 'المركز العام', mission_form_name: '', participants_count: 0, hospital_name: '', injured_count: 0, deaths_count: 0, news_updates: '', news_link: '', data_entry_name: '', notes: '' });
    setIsModalOpen(true);
  };

  const handleEdit = (n) => { setNd({...n}); setIsModalOpen(true); };

  const confirmDelete = async () => {
    if (!newsToDelete) return;
    const token = localStorage.getItem('access_token');
    await fetch(`https://eoc-system.vercel.app/api/local-news/${newsToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    setNewsToDelete(null); fetchNews();
  };

  const handleSubmit = async () => {
    if (!nd.incident_date) return setCustomAlert("عفواً، يجب إدخال تاريخ الحادث.");
    if (!nd.incident_description) return setCustomAlert("عفواً، برجاء إدخال وصف الحادث لتوثيقه.");
    if (!nd.news_type) return setCustomAlert("عفواً، يجب تحديد نوع الخبر من القائمة.");
    if (!nd.governorate) return setCustomAlert("عفواً، يجب تحديد المحافظة التي وقع بها الحادث.");
    
    if (nd.is_reported && !nd.report_time) {
      return setCustomAlert("لقد أشرت إلى أنه (تم الإبلاغ)!\nبرجاء إدخال توقيت إرسال الخبر لحساب مؤشرات الأداء بشكل صحيح.");
    }
    
    if (nd.is_responded) {
      if (!nd.response_time) return setCustomAlert("لقد أشرت إلى أنه (تم الرد)!\nبرجاء إدخال توقيت الرد لحساب النقاط.");
      if (!nd.branch_response_text) return setCustomAlert("لقد أشرت إلى أنه (تم الرد)!\nبرجاء إدخال نص رد الفرع.");
    }
    
    if (nd.is_field_response) {
      if (!nd.movement_time) return setCustomAlert("عفواً، تم تسجيل (استجابة ميدانية)، يجب إدخال توقيت التحرك.");
      if (!nd.field_arrival_time) return setCustomAlert("عفواً، يجب إدخال توقيت وصول أول متطوع للميدان لحساب سرعة الاستجابة.");
      if (!nd.distance_km) return setCustomAlert("عفواً، لحساب نقاط الاستجابة بدقة، يجب إدخال طول المسافة (كم) بين الحادث والفرع.");
    }

    const payload = {
      ...nd,
      branch_id: 19,
      incident_month: getMonthName(nd.incident_date),
      response_time_points: nd.is_reported && nd.is_responded ? responsePoints : 0,
      response_duration: nd.is_reported && nd.is_responded ? formatDuration(responseDiff) : '',
      movement_points: nd.is_reported && nd.is_field_response ? movePoints : 0,
      report_to_movement_duration: nd.is_reported && nd.is_field_response ? formatDuration(moveDiff) : '',
      field_response_points: nd.is_field_response ? fieldPoints : 0,
      report_to_arrival_duration: nd.is_field_response ? formatDuration(getMinutesDiff(nd.report_time, nd.field_arrival_time)) : ''
    };

    const token = localStorage.getItem('access_token');
    const url = nd.news_id ? `https://eoc-system.vercel.app/api/local-news/${nd.news_id}` : 'https://eoc-system.vercel.app/api/local-news';
    const method = nd.news_id ? 'PUT' : 'POST';

    const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
    if (res.ok) { setIsModalOpen(false); fetchNews(); } else { setCustomAlert("حدث خطأ في الاتصال بالسيرفر! لم يتم حفظ الخبر."); }
  };

  const handleExportExcel = () => {
    if (newsList.length === 0) return setCustomAlert("لا توجد أخبار للتصدير حالياً.");
    const ws = XLSX.utils.json_to_sheet(filteredNews.map(n => ({
      "التاريخ": n.incident_date || '', "الشهر": n.incident_month || '', "وصف الحادث": n.incident_description || '', "نوع الخبر": n.news_type || '', "ناشر الخبر": n.news_publisher || '',
      "اسم الشارع": n.street_name || '', "المنطقة": n.area_name || '', "المحافظة": n.governorate || '',
      "الابلاغ": n.is_reported ? 'نعم' : 'لا', "توقيت ارسال الخبر": format12H(n.report_time), "حالة الرد": n.is_responded ? 'نعم' : 'لا', "رد الفرع": n.branch_response_text || '',
      "توقيت الرد": format12H(n.response_time), "حالة توقيت الرد": n.response_time_points || 0, "زمن الرد": n.response_duration || '',
      "الاستجابة": n.is_field_response ? 'نعم' : 'لا', "توقيت التحرك للاستجابة الميدانية من الفرع": format12H(n.movement_time), "المدة بين الابلاغ و التحرك": n.report_to_movement_duration || '',
      "حالة المدة بين الابلاغ و التحرك": n.movement_points || 0, "توقيت الاستجابة الميدانية (اول متطوع يوصل)": format12H(n.field_arrival_time), "حالة الاستجابة": n.field_response_points || 0,
      "الزمن المتخذ لبدء الاستجابة": n.report_to_arrival_duration || '', "نوع الاستجابة": n.intervention_type || '', "الفرع المتدخل": n.intervening_branch || '',
      "اسم الاستمارة": n.mission_form_name || '', "عدد المشاركين": n.participants_count || 0, "اسم المستشفى": n.hospital_name || '', "عدد المصابين": n.injured_count || 0, "عدد الوفيات": n.deaths_count || 0,
      "تطورات الخبر": n.news_updates || '', "لينك الخبر": n.news_link || '', "اسم مدخل الخبر": n.data_entry_name || '', "ملاحظات": n.notes || '', "طول المسافة بين مكان الحادث و الفرع": n.distance_km || ''
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل الأخبار");
    XLSX.writeFile(wb, `سجل_الأخبار_المحلية.xlsx`);
  };

  const handleExportSingleNewsExcel = () => {
    const ws = XLSX.utils.json_to_sheet([{
      "التاريخ": nd.incident_date || '', "الشهر": nd.incident_month || '', "وصف الحادث": nd.incident_description || '', "نوع الخبر": nd.news_type || '', "ناشر الخبر": nd.news_publisher || '',
      "اسم الشارع": nd.street_name || '', "المنطقة": nd.area_name || '', "المحافظة": nd.governorate || '',
      "الابلاغ": nd.is_reported ? 'نعم' : 'لا', "توقيت ارسال الخبر": format12H(nd.report_time), "حالة الرد": nd.is_responded ? 'نعم' : 'لا', "رد الفرع": nd.branch_response_text || '',
      "توقيت الرد": format12H(nd.response_time), "حالة توقيت الرد": nd.response_time_points || 0, "زمن الرد": nd.response_duration || '',
      "الاستجابة": nd.is_field_response ? 'نعم' : 'لا', "توقيت التحرك للاستجابة الميدانية من الفرع": format12H(nd.movement_time), "المدة بين الابلاغ و التحرك": nd.report_to_movement_duration || '',
      "حالة المدة بين الابلاغ و التحرك": nd.movement_points || 0, "توقيت الاستجابة الميدانية (اول متطوع يوصل)": format12H(nd.field_arrival_time), "حالة الاستجابة": nd.field_response_points || 0,
      "الزمن المتخذ لبدء الاستجابة": nd.report_to_arrival_duration || '', "نوع الاستجابة": nd.intervention_type || '', "الفرع المتدخل": nd.intervening_branch || '',
      "اسم الاستمارة": nd.mission_form_name || '', "عدد المشاركين": nd.participants_count || 0, "اسم المستشفى": nd.hospital_name || '', "عدد المصابين": nd.injured_count || 0, "عدد الوفيات": nd.deaths_count || 0,
      "تطورات الخبر": nd.news_updates || '', "لينك الخبر": nd.news_link || '', "اسم مدخل الخبر": nd.data_entry_name || '', "ملاحظات": nd.notes || '', "طول المسافة بين مكان الحادث و الفرع": nd.distance_km || ''
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تفاصيل الخبر");
    XLSX.writeFile(wb, `خبر_${nd.area_name || 'محلي'}.xlsx`);
  };

  const governorates = [...new Set(branches.map(b => b.name === 'المركز العام' ? 'القاهرة' : b.name))];
  const branchNames = [...new Set(branches.map(b => b.name))];
  const newsTypes = ['حادث تصادم سيارات', 'حادث غرق سفينة', 'حادث تصادم قطارات', 'حادث انقلاب قطار', 'حادث انقلاب سيارة', 'حادث فقدان أشخاص في البحر', 'حادث تصادم سفن', 'انهيار مبنى تجاري', 'حريق مبنى سكني', 'حريق مبنى تجاري', 'حريق مبنى صناعي', 'حادث انفجار', 'انهيار مبنى صناعي', 'انهيار ارضي', 'حريق منطقة زراعية', 'حادث تسرب مواد كيميائية أو غازات سامة', 'سيول', 'فيضانات', 'امطار غزيرة', 'زلزال', 'انهيار مبنى سكني', 'حادث دهس اشخاص', 'حريق مبنى طبي', 'انهيار مبنى طبي', 'حريق مخزن', 'حريق مزرعة', 'حريق سيارة', 'حريق مبنى ديني', 'حريق مبنى تعليمي', 'حادث تدافع', 'حريق مبنى رياضي', 'حريق قطار', 'حادث تصادم سيارة بقطار', 'حادث تسمم', 'حريق مبنى حكومي', 'انهيار مبنى حكومي', 'انهيار مبنى ديني'];

  const filteredNews = newsList.filter(n => {
    const matchDate = filterDate ? n.incident_date === filterDate : true;
    const matchGov = filterGov === 'all' ? true : n.governorate === filterGov;
    const matchType = filterType === 'all' ? true : n.news_type === filterType;
    return matchDate && matchGov && matchType;
  });

  return (
    <div className="space-y-6 pb-10">
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-fade-in-up">
        <StatCard title="إجمالي الحوادث المسجلة" value={filteredNews.length} color="text-white" borderHighlight />
        <StatCard title="تم الإبلاغ عنها" value={filteredNews.filter(n => n.is_reported).length} color="text-purple-400" />
        <StatCard title="بلاغات تم الرد عليها" value={filteredNews.filter(n => n.is_responded).length} color="text-blue-400" />
        <StatCard title="استجابة ميدانية (تحرك)" value={filteredNews.filter(n => n.is_field_response).length} color="text-green-500" />
        <StatCard title="متوسط نقاط الاستجابة" value={filteredNews.length ? Math.round(filteredNews.reduce((a,b)=>a+b.field_response_points,0)/filteredNews.length) : 0} color="text-yellow-500" />
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[650px]">
        <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full lg:w-auto">
            <h3 className="text-xl font-bold text-white whitespace-nowrap">الأخبار المحلية</h3>
            
            <div className="flex flex-wrap items-center gap-2 w-full">
              <select value={filterGov} onChange={(e) => setFilterGov(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none cursor-pointer">
                <option value="all">كل المحافظات</option>
                {governorates.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none cursor-pointer max-w-[200px] truncate">
                <option value="all">كل الحوادث</option>
                {newsTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)]" />
                {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-red-500 hover:text-white bg-red-500/10 px-2 py-2 rounded-lg">الكل</button>}
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            {isOwner && <button onClick={handleExportExcel} className="bg-[#1a1a1a] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525] shrink-0"><ExcelIcon /> تصدير السجل</button>}
            <button onClick={handleCreateNew} className="bg-[#c70000] hover:bg-[#a50000] text-white px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0">+ إضافة خبر</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400">
              <tr>
                <th className="p-4 font-semibold border-l border-white/5">التاريخ</th>
                <th className="p-4 font-semibold border-l border-white/5">المحافظة</th>
                <th className="p-4 font-semibold border-l border-white/5 text-blue-400 max-w-[200px]">وصف الحادث</th>
                <th className="p-4 font-semibold border-l border-white/5 text-yellow-500">نقاط (رد/تحرك/وصول)</th>
                <th className="p-4 font-semibold border-l border-white/5">المتطوعين</th>
                <th className="p-4 font-semibold border-l border-white/5">مدخل الخبر</th>
                <th className="p-4 font-semibold sticky top-0 left-0 z-30 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? <tr><td colSpan="7" className="p-8 text-center text-gray-500">جاري التحميل...</td></tr> : 
               filteredNews.length > 0 ? filteredNews.map(n => (
                <tr key={n.news_id} className="hover:bg-white/5">
                  <td className="p-4 text-white border-l border-white/5">{n.incident_date}</td>
                  <td className="p-4 text-gray-300 border-l border-white/5 font-bold">{n.governorate}</td>
                  <td className="p-4 text-gray-400 border-l border-white/5 truncate max-w-[250px]">{n.incident_description}</td>
                  <td className="p-4 border-l border-white/5">
                    <div className="flex gap-1">
                      <span className="bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded text-xs border border-yellow-500/30" title="نقاط الرد">{n.response_time_points}</span>
                      <span className="bg-orange-500/20 text-orange-500 px-2 py-0.5 rounded text-xs border border-orange-500/30" title="نقاط التحرك">{n.movement_points}</span>
                      <span className="bg-green-500/20 text-green-500 px-2 py-0.5 rounded text-xs border border-green-500/30" title="نقاط الوصول">{n.field_response_points}</span>
                    </div>
                  </td>
                  <td className="p-4 text-gray-400 border-l border-white/5">{n.participants_count}</td>
                  <td className="p-4 text-gray-500 border-l border-white/5 text-xs">{n.data_entry_name}</td>
                  <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleEdit(n)} className="p-2 bg-[#111] hover:bg-blue-600 text-gray-400 hover:text-white rounded-lg"><EyeIcon /></button>
                      {(isOwner || isSupervisor || isJoker) && <button onClick={() => setNewsToDelete(n.news_id)} className="p-2 bg-[#111] hover:bg-red-600 text-gray-400 hover:text-white rounded-lg"><TrashIcon /></button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="7" className="p-8 text-center text-gray-500">لا توجد أخبار مطابقة للفلاتر</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-white/10 rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-2xl animate-fade-in-up">
            <div className="p-5 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><NewsIcon /> {nd.news_id ? 'تعديل الخبر والمؤشرات' : 'إضافة خبر جديد'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-[#111] text-gray-400 hover:bg-red-600 hover:text-white p-2 rounded-xl"><TrashIcon /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              
              <SectionCard title="1. بيانات الخبر الأساسية" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="التاريخ (مطلوب)"><StyledInput type="date" value={nd.incident_date} onChange={e => setNd({...nd, incident_date: e.target.value})} className="border-[#c70000]/30" /></FormGroup>
                  <FormGroup label="الشهر (تلقائي)"><StyledInput disabled value={getMonthName(nd.incident_date)} className="bg-[#0a0a0a] text-gray-500" /></FormGroup>
                  <FormGroup label="نوع الخبر (مطلوب)">
                    <StyledSelect value={nd.news_type} onChange={e => setNd({...nd, news_type: e.target.value})} className="border-[#c70000]/30">
                      <option value="" disabled className="bg-[#111] text-gray-500">اختر نوع الحادث...</option>
                      {newsTypes.map(type => <option key={type} value={type} className="bg-[#111] text-white">{type}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <div className="md:col-span-3"><FormGroup label="وصف الحادث (مطلوب)"><textarea value={nd.incident_description} onChange={e => setNd({...nd, incident_description: e.target.value})} className="w-full bg-[#111] border border-[#c70000]/30 rounded-xl p-3 text-sm outline-none text-white focus:border-[#c70000]" rows="2"></textarea></FormGroup></div>
                  <FormGroup label="ناشر الخبر"><StyledInput value={nd.news_publisher} onChange={e => setNd({...nd, news_publisher: e.target.value})} /></FormGroup>
                  <FormGroup label="المحافظة (مطلوب)">
                    <StyledSelect value={nd.governorate} onChange={e => setNd({...nd, governorate: e.target.value})} className="border-[#c70000]/30">
                      <option value="" disabled>اختر المحافظة...</option>
                      {governorates.map(g => <option key={g} value={g}>{g}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="المنطقة"><StyledInput value={nd.area_name} onChange={e => setNd({...nd, area_name: e.target.value})} /></FormGroup>
                  <FormGroup label="الشارع"><StyledInput value={nd.street_name} onChange={e => setNd({...nd, street_name: e.target.value})} /></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="2. الإبلاغ والرد (تقييم السرعة)" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <FormGroup label="تم الإبلاغ؟">
                    <StyledSelect value={nd.is_reported ? 'نعم' : 'لا'} onChange={e => setNd({...nd, is_reported: e.target.value === 'نعم', is_responded: e.target.value === 'لا' ? false : nd.is_responded, is_field_response: e.target.value === 'لا' ? false : nd.is_field_response})}>
                      <option value="لا">لا</option><option value="نعم">نعم</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="توقيت الإرسال"><StyledInput type="time" disabled={!nd.is_reported} value={nd.report_time} onChange={e => setNd({...nd, report_time: e.target.value})} className={!nd.is_reported ? 'opacity-50' : 'border-[#c70000]/30'}/></FormGroup>
                  
                  <FormGroup label="تم الرد؟">
                    <StyledSelect disabled={!nd.is_reported} value={nd.is_responded ? 'نعم' : 'لا'} onChange={e => setNd({...nd, is_responded: e.target.value === 'نعم'})} className={!nd.is_reported ? 'opacity-50' : ''}>
                      <option value="لا">لا</option><option value="نعم">نعم</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="توقيت الرد"><StyledInput type="time" disabled={!nd.is_responded} value={nd.response_time} onChange={e => setNd({...nd, response_time: e.target.value})} className={!nd.is_responded ? 'opacity-50' : 'border-[#c70000]/30'}/></FormGroup>
                  
                  <div className="md:col-span-2"><FormGroup label="رد الفرع"><StyledInput disabled={!nd.is_responded} value={nd.branch_response_text} onChange={e => setNd({...nd, branch_response_text: e.target.value})} className={!nd.is_responded ? 'opacity-50' : 'border-[#c70000]/30'} /></FormGroup></div>
                  <FormGroup label="زمن الرد (تلقائي)"><div className="bg-[#0a0a0a] text-blue-400 font-bold p-3 rounded-xl border border-white/5 text-sm">{nd.is_responded ? formatDuration(responseDiff) : '-'}</div></FormGroup>
                  <FormGroup label="حالة توقيت الرد (نقاط)"><div className="bg-[#0a0a0a] text-yellow-500 font-bold p-3 rounded-xl border border-white/5 text-sm text-center">{nd.is_responded ? `${responsePoints} نقطة` : '-'}</div></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="3. الاستجابة الميدانية والتحرك" icon={<CarIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <FormGroup label="تمت الاستجابة؟">
                    <StyledSelect disabled={!nd.is_reported} value={nd.is_field_response ? 'نعم' : 'لا'} onChange={e => setNd({...nd, is_field_response: e.target.value === 'نعم'})} className={!nd.is_reported ? 'opacity-50' : ''}>
                      <option value="لا">لا</option><option value="نعم">نعم</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="توقيت التحرك"><StyledInput type="time" disabled={!nd.is_field_response} value={nd.movement_time} onChange={e => setNd({...nd, movement_time: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : 'border-[#c70000]/30'} /></FormGroup>
                  <FormGroup label="المدة (إبلاغ ➔ تحرك)"><div className="bg-[#0a0a0a] text-blue-400 font-bold p-3 rounded-xl border border-white/5 text-sm">{nd.is_field_response ? formatDuration(moveDiff) : '-'}</div></FormGroup>
                  <FormGroup label="نقاط التحرك"><div className="bg-[#0a0a0a] text-orange-500 font-bold p-3 rounded-xl border border-white/5 text-sm text-center">{nd.is_field_response ? `${movePoints} نقطة` : '-'}</div></FormGroup>

                  <FormGroup label="طول المسافة (كم)"><StyledInput type="number" disabled={!nd.is_field_response} value={nd.distance_km} onChange={e => setNd({...nd, distance_km: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : 'border-[#c70000]/30'} placeholder="مثال: 15" /></FormGroup>
                  <FormGroup label="توقيت الوصول (أول متطوع)"><StyledInput type="time" disabled={!nd.is_field_response} value={nd.field_arrival_time} onChange={e => setNd({...nd, field_arrival_time: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : 'border-[#c70000]/30'} /></FormGroup>
                  <FormGroup label="الزمن المتوقع (تلقائي)"><div className="bg-[#0a0a0a] text-gray-500 p-3 rounded-xl border border-white/5 text-sm">{nd.is_field_response && expectedTravelMins !== null ? `${Math.floor(expectedTravelMins)} دقيقة` : '-'}</div></FormGroup>
                  <FormGroup label="نقاط الاستجابة للمسافة"><div className="bg-[#0a0a0a] text-green-500 font-bold p-3 rounded-xl border border-white/5 text-sm text-center">{nd.is_field_response ? `${fieldPoints} نقطة` : '-'}</div></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="4. تفاصيل التدخل الميداني" icon={<UsersIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <FormGroup label="نوع الاستجابة">
                    <StyledSelect disabled={!nd.is_field_response} value={nd.intervention_type} onChange={e => setNd({...nd, intervention_type: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : ''}>
                      {['دعم نفسي', 'طوارئ', 'طوارئ - دعم نفسي', 'طوارئ ( تقييم )', 'مساعدات مالية', 'طوارئ - مساعدات', 'دعم نفسي - مساعدات'].map(t => <option key={t} value={t}>{t}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="الفرع المتدخل">
                    <StyledSelect disabled={!nd.is_field_response} value={nd.intervening_branch} onChange={e => setNd({...nd, intervening_branch: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : ''}>
                      {branchNames.map(b => <option key={b} value={b}>{b}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="اسم استمارة المهمة"><StyledInput disabled={!nd.is_field_response} value={nd.mission_form_name} onChange={e => setNd({...nd, mission_form_name: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : ''} /></FormGroup>
                  <FormGroup label="عدد المشاركين"><StyledInput type="number" disabled={!nd.is_field_response} value={nd.participants_count} onChange={e => setNd({...nd, participants_count: parseInt(e.target.value) || 0})} className={!nd.is_field_response ? 'opacity-50' : ''} /></FormGroup>
                  
                  <FormGroup label="اسم المستشفى"><StyledInput value={nd.hospital_name} onChange={e => setNd({...nd, hospital_name: e.target.value})} /></FormGroup>
                  <FormGroup label="عدد المصابين"><StyledInput type="number" value={nd.injured_count} onChange={e => setNd({...nd, injured_count: parseInt(e.target.value) || 0})} /></FormGroup>
                  <FormGroup label="عدد الوفيات"><StyledInput type="number" value={nd.deaths_count} onChange={e => setNd({...nd, deaths_count: parseInt(e.target.value) || 0})} /></FormGroup>
                  <FormGroup label="مدخل الخبر"><StyledInput value={nd.data_entry_name} onChange={e => setNd({...nd, data_entry_name: e.target.value})} placeholder="الاسم..." /></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="5. الملاحظات والمتابعة" icon={<MapIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup label="تطورات الخبر"><textarea value={nd.news_updates} onChange={e => setNd({...nd, news_updates: e.target.value})} className="w-full bg-[#111] border border-white/5 rounded-xl p-3 text-sm outline-none text-white focus:border-[#c70000]" rows="3"></textarea></FormGroup>
                  <FormGroup label="ملاحظات عامة"><textarea value={nd.notes} onChange={e => setNd({...nd, notes: e.target.value})} className="w-full bg-[#111] border border-white/5 rounded-xl p-3 text-sm outline-none text-white focus:border-[#c70000]" rows="3"></textarea></FormGroup>
                  <div className="md:col-span-2"><FormGroup label="لينك الخبر (URL)"><StyledInput value={nd.news_link} onChange={e => setNd({...nd, news_link: e.target.value})} placeholder="https://..." dir="ltr" className="text-left" /></FormGroup></div>
                </div>
              </SectionCard>

            </div>
            
            <div className="p-5 border-t border-white/10 bg-[#0a0a0a] flex flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl">
              <button onClick={handleExportSingleNewsExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 mr-auto">
                <ExcelIcon /> تصدير الخبر الحالي
              </button>
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إلغاء</button>
              <button onClick={handleSubmit} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">حفظ الخبر وتقييم الأداء</button>
            </div>
          </div>
        </div>
      )}

      {/* -- تصميم التنبيه الإداري الفخم -- */}
      {customAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-[#c70000]/50 rounded-2xl p-6 max-w-md w-full shadow-[0_0_40px_rgba(199,0,0,0.3)] animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4 border-b border-white/10 pb-4">
              <svg className="w-7 h-7 text-[#c70000]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <h3 className="text-xl font-bold text-white">تنبيه النظام</h3>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{customAlert}</p>
            <div className="mt-8 flex justify-end">
              <button onClick={() => setCustomAlert(null)} className="bg-[#c70000] hover:bg-red-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-red-500/50">
                علم، جاري التعديل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}