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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
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
    
    if (userStr && token) {
      try {
        setUserData(JSON.parse(userStr));
      } catch (error) {
        localStorage.clear();
        navigate('/');
        return;
      }
    } else {
      navigate('/'); 
      return;
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
      case 'global_disasters': return <GlobalDisastersView isOwner={isOwner} isSupervisor={isSupervisor} isJoker={isJoker} isVolunteer={isVolunteer} />;
      case 'earthquakes': return <EarthquakesView isOwner={isOwner} isSupervisor={isSupervisor} />;
      case 'branches_inventory': return <BranchesAndInventoryView branches={branchesList} />;
      case 'audit': return <AuditLogsView />;
      default: return <HomeView branches={branchesList} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-[#c70000] selection:text-white flex overflow-hidden" dir="rtl">
      <aside className={`${isSidebarOpen ? 'w-72' : 'w-20'} bg-[#0c0c0c] border-l border-white/5 flex flex-col justify-between hidden md:flex sticky top-0 h-screen z-50 transition-all duration-300`}>
        <div className="overflow-y-auto custom-scrollbar flex-1">
          {isSidebarOpen ? (
            <div className="p-8 border-b border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden transition-all duration-300">
              <div className="absolute top-0 right-0 w-full h-1/2 bg-[#c70000]/10 blur-2xl"></div>
              <div className="relative z-10 mb-5 flex justify-center">
                <div className="relative w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-[0_0_25px_rgba(199,0,0,0.4)] p-2">
                  <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm"><path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" fill="#c70000" /></svg>
                </div>
              </div>
              <h2 className="text-lg font-bold text-white tracking-wide relative z-10">{userData?.full_name || 'المالك'}</h2>
              <p className="text-xs text-[#c70000] font-semibold mt-2 bg-[#c70000]/10 border border-[#c70000]/20 px-3 py-1 rounded-full uppercase tracking-widest relative z-10">{userData?.role || 'OWNER'}</p>
            </div>
          ) : (
            <div className="p-4 border-b border-white/5 flex justify-center transition-all duration-300">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-[0_0_15px_rgba(199,0,0,0.4)] p-1.5" title={userData?.full_name}>
                <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm"><path d="M 70 15 A 40 40 0 1 0 70 85 A 30 30 0 1 1 70 15 Z" fill="#c70000" /></svg>
              </div>
            </div>
          )}

          <nav className="p-4 space-y-2 mt-2">
            {(isOwner || isSupervisor || isJoker) && <NavItem icon={<HomeIcon />} label="مؤشرات الغرفة" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} isOpen={isSidebarOpen} />}
            <NavItem icon={<AlertIcon />} label="سجل المهام الميدانية" isActive={activeTab === 'missions'} onClick={() => setActiveTab('missions')} isOpen={isSidebarOpen} />
            <NavItem icon={<NewsIcon />} label="سجل الأخبار المحلية" isActive={activeTab === 'local_news'} onClick={() => setActiveTab('local_news')} isOpen={isSidebarOpen} />
            <NavItem icon={<GlobalWorldIcon />} label="رصد الكوارث العالمية" isActive={activeTab === 'global_disasters'} onClick={() => setActiveTab('global_disasters')} isOpen={isSidebarOpen} />
            <NavItem icon={<EarthquakeIcon />} label="مركز رصد الزلازل" isActive={activeTab === 'earthquakes'} onClick={() => setActiveTab('earthquakes')} isOpen={isSidebarOpen} />
            {(isOwner || isSupervisor) && <NavItem icon={<MapIcon />} label="الفروع والمخزون" isActive={activeTab === 'branches_inventory'} onClick={() => setActiveTab('branches_inventory')} isOpen={isSidebarOpen} />}
            {isOwner && <NavItem icon={<ShieldIcon />} label="سجل النظام" isActive={activeTab === 'audit'} onClick={() => setActiveTab('audit')} isOpen={isSidebarOpen} />}
          </nav>
        </div>
        <div className="p-4 border-t border-white/5">
          <button onClick={handleLogout} title={!isSidebarOpen ? "خروج" : ""} className={`w-full flex items-center p-4 rounded-xl transition-all duration-300 text-gray-400 hover:text-[#ff4d4d] hover:bg-[#ff4d4d]/10 ${isSidebarOpen ? 'gap-3' : 'justify-center mx-auto'}`}>
            <LogoutIcon />
            {isSidebarOpen && <span className="font-semibold tracking-wide truncate">إنهاء الجلسة الآمنة</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(199,0,0,0.03),transparent_50%)]">
        <header className="px-10 py-6 border-b border-white/5 flex items-center gap-5 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-40">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-gray-400 hover:text-white bg-[#111] p-2.5 rounded-xl border border-white/10 hidden md:block transition-all hover:bg-white/5">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
          </button>
          <div className="flex-1 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-extrabold tracking-wide">
              {activeTab === 'home' && 'موجز عمليات اليوم'}
              {activeTab === 'missions' && 'إدارة المهام الميدانية'}
              {activeTab === 'local_news' && 'سجل الأخبار المحلية'}
              {activeTab === 'global_disasters' && 'رصد الكوارث العالمية'}
              {activeTab === 'earthquakes' && 'مركز رصد الزلازل'}
              {activeTab === 'branches_inventory' && 'الانتشار الجغرافي والمخزون'}
              {activeTab === 'audit' && 'سجل النظام والعمليات (مراقب)'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">غرفة العمليات المركزية (EOC)</p>
            </div>
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
  const [globalDisasters, setGlobalDisasters] = useState([]);
  const [globalEqs, setGlobalEqs] = useState([]); 
  const [egyptEqs, setEgyptEqs] = useState([]); 
  const [selectedBranchName, setSelectedBranchName] = useState(null);

  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [filterDate, setFilterDate] = useState(getLocalDate());

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    Promise.all([
      fetch('https://eoc-system.vercel.app/api/missions', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch('https://eoc-system.vercel.app/api/local-news', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch('https://eoc-system.vercel.app/api/global-disasters', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch('https://eoc-system.vercel.app/api/earthquakes/global', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch('https://eoc-system.vercel.app/api/earthquakes/egypt', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : [])
    ]).then(([missionsData, newsData, globalData, gEqs, eEqs]) => {
      setMissions(missionsData);
      setNews(newsData);
      setGlobalDisasters(globalData);
      setGlobalEqs(gEqs);
      setEgyptEqs(eEqs);
    });
  }, []);

  const filterMissionBranch = selectedBranchName; 
  const filterNewsGov = (selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'القاهرة' : selectedBranchName;

  const filteredMissions = selectedBranchName ? missions.filter(m => { const mBranch = m.branch?.trim(); return mBranch === filterMissionBranch || (filterMissionBranch === 'المركز العام' && mBranch === 'القاهرة') || (filterMissionBranch === 'القاهرة' && mBranch === 'المركز العام'); }) : missions;
  const filteredNews = selectedBranchName ? news.filter(n => n.governorate === filterNewsGov) : news;

  const dailyMissions = filterDate ? filteredMissions.filter(m => {
    const mDate = m.exit_date && m.exit_date !== '-' ? m.exit_date : (m.created_at ? m.created_at.split(' ')[0] : '');
    return mDate === filterDate;
  }) : filteredMissions;
  const dailyNews = filterDate ? filteredNews.filter(n => n.incident_date === filterDate) : filteredNews;
  const dailyDisasters = filterDate ? globalDisasters.filter(d => d.incident_date === filterDate) : globalDisasters;
  const dailyGlobalEqs = filterDate ? globalEqs.filter(e => e.date === filterDate) : globalEqs;
  const dailyEgyptEqs = filterDate ? egyptEqs.filter(e => e.date === filterDate) : egyptEqs;

  const activeDaily = dailyMissions.filter(m => m.mission_classification !== 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const activeOpen = dailyMissions.filter(m => m.mission_classification === 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const totalNews = dailyNews.length;
  const activeNews = dailyNews.filter(n => n.is_field_response).length;
  
  const totalGlobalDisasters = dailyDisasters.length;
  const globalEqsToday = dailyGlobalEqs.length;
  const totalEgyptEqs = dailyEgyptEqs.length;

  return (
    <div className="space-y-8 pb-10 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-10 bg-[#c70000] rounded-full"></div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-wide">المركز الرئيسي للعمليات</h2>
            <p className="text-gray-400 text-sm mt-1">{selectedBranchName ? `المؤشرات الحية لفرع/محافظة: ${(selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'المركز العام (القاهرة)' : selectedBranchName}` : 'الرؤية الشاملة للوضع الميداني والزلزالي (على مستوى الجمهورية)'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1a1a1a] p-1.5 rounded-xl border border-white/10 shadow-inner">
            <span className="text-gray-400 text-xs font-bold pl-2">إحصائيات يوم:</span>
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-transparent text-sm text-white font-bold outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)] px-2" />
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="text-xs text-red-500 hover:text-white bg-red-500/10 hover:bg-red-500/20 px-3 py-1 rounded-lg font-bold transition-colors">
                عرض الكل
              </button>
            )}
          </div>
          {selectedBranchName && (
            <button onClick={() => setSelectedBranchName(null)} className="bg-[#111] hover:bg-[#c70000] text-gray-400 hover:text-white border border-white/10 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(199,0,0,0.3)] flex items-center gap-2">إلغاء التحديد (عرض الجمهورية) <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-6 rounded-3xl shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-gray-400 font-bold text-sm">المهام اليومية (نشطة)</h3><div className="p-2 bg-[#c70000]/20 rounded-xl text-[#c70000]"><AlertIcon/></div></div>
          <p className="text-4xl font-black text-white relative z-10">{activeDaily}</p>
        </div>
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-6 rounded-3xl shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-gray-400 font-bold text-sm">المهام المفتوحة</h3><div className="p-2 bg-blue-500/20 rounded-xl text-blue-500"><AlertIcon/></div></div>
          <p className="text-4xl font-black text-white relative z-10">{activeOpen}</p>
        </div>
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-white/10 p-6 rounded-3xl shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-gray-400 font-bold text-sm">الأخبار المحلية المرصودة</h3><div className="p-2 bg-purple-500/20 rounded-xl text-purple-400"><NewsIcon/></div></div>
          <div className="flex items-end gap-2 relative z-10"><p className="text-4xl font-black text-white">{totalNews}</p><span className="text-xs font-bold text-purple-400 mb-1">({activeNews} استجابة)</span></div>
        </div>
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-[#c70000]/30 p-6 rounded-3xl shadow-[0_0_20px_rgba(199,0,0,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-32 h-32 bg-[#c70000]/10 rounded-full blur-2xl group-hover:bg-[#c70000]/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-[#c70000] font-bold text-sm">الكوارث العالمية</h3><div className="p-2 bg-[#c70000]/20 rounded-xl text-[#c70000]"><GlobalWorldIcon/></div></div>
          <p className="text-4xl font-black text-white relative z-10">{totalGlobalDisasters}</p>
        </div>
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-red-500/30 p-6 rounded-3xl shadow-[0_0_20px_rgba(239,68,68,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-32 h-32 bg-red-500/10 rounded-full blur-2xl group-hover:bg-red-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-red-500 font-bold text-sm">الزلازل العالمية (اليوم)</h3><div className="p-2 bg-red-500/20 rounded-xl text-red-500"><EarthquakeIcon/></div></div>
          <p className="text-4xl font-black text-white relative z-10">{globalEqsToday}</p>
        </div>
        <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-green-500/30 p-6 rounded-3xl shadow-[0_0_20px_rgba(34,197,94,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-32 h-32 bg-green-500/10 rounded-full blur-2xl group-hover:bg-green-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4 relative z-10"><h3 className="text-green-500 font-bold text-sm">زلازل مصر المرصودة</h3><div className="p-2 bg-green-500/20 rounded-xl text-green-500"><EarthquakeIcon/></div></div>
          <p className="text-4xl font-black text-white relative z-10">{totalEgyptEqs}</p>
        </div>
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-6 shadow-lg animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <MapIcon /> خريطة الانتشار التفاعلية الفروع (انقر للفلترة أو إلغاء التحديد)
        </h3>
        <div className="h-[450px] w-full rounded-2xl overflow-hidden border border-white/10 relative z-0">
          <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
            {/* 💡 الخريطة الرئيسية للفروع فقط */}
            {branches.map(branch => branch.lat && branch.lng ? (
                <Marker key={`dash-marker-${branch.id}`} position={[branch.lat, branch.lng]} icon={branchIcon} eventHandlers={{ click: () => setSelectedBranchName(prev => prev === branch.name ? null : branch.name) }}>
                  <Popup><strong className="text-gray-800 font-bold text-sm text-center block mb-1">{branch.name === 'القاهرة' ? 'المركز العام (القاهرة)' : branch.name}</strong><span className="text-xs text-blue-600 block text-center mt-1 font-bold">انقر للفلترة</span></Popup>
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
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
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
function MissionsView({ branches, isVolunteer, isJoker, isSupervisor, isOwner }) {
  const [customAlert, setCustomAlert] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [missionToDelete, setMissionToDelete] = useState(null);
  const [currentMissionData, setCurrentMissionData] = useState(null);
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  
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
  const [missionViewType, setMissionViewType] = useState('all_types'); 
  const [missionClass, setMissionClass] = useState('عادية');
  const [statusFilter, setStatusFilter] = useState('all'); 
  const [searchTerm, setSearchTerm] = useState(''); // 💡 السيرش

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

  let filteredMissions = activeRegionTab !== 'all' ? baseMissions.filter(m => (regionMap[m.branch?.trim()] || 'hq') === activeRegionTab) : baseMissions;

  if (searchTerm.trim() !== '') {
    const term = searchTerm.toLowerCase();
    filteredMissions = filteredMissions.filter(m => 
      (m.mission_name && m.mission_name.toLowerCase().includes(term)) ||
      (m.mission_location && m.mission_location.toLowerCase().includes(term)) ||
      (m.mission_code && m.mission_code.toLowerCase().includes(term)) ||
      (m.mission_type && m.mission_type.toLowerCase().includes(term))
    );
  }

  const getCreationDate = () => {
    if (currentMissionData && currentMissionData.created_at) { return String(currentMissionData.created_at).split(' ')[0]; }
    return filterDate || getLocalDate();
  };

  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col min-h-[700px] flex-1">
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
              {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-red-500 hover:text-white bg-red-500/10 px-3 py-2 rounded-lg font-bold transition-colors">إلغاء التاريخ</button>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 md:mt-0 shrink-0">
          <button onClick={() => setIsTableExpanded(true)} className="bg-[#1a1a1a] hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/30 hover:border-transparent px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap">
            <EyeIcon className="w-5 h-5" /> عرض السجل
          </button>
          {isOwner && <button onClick={handleExportTableExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap"><ExcelIcon /> تصدير</button>}
          <button onClick={handleCreateNew} className="bg-[#c70000] hover:bg-[#a50000] text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-[0_0_15px_rgba(199,0,0,0.3)] whitespace-nowrap">+ إنشاء مهمة</button>
        </div>
      </div>

      {/* 💡 السيرش بار الجديد */}
      <div className="mt-4 bg-[#111] border border-white/10 rounded-2xl p-2 flex items-center gap-3 w-full shadow-inner focus-within:border-[#c70000]/50 transition-colors">
        <svg className="w-5 h-5 text-gray-500 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input 
          type="text" 
          placeholder="بحث سريع باسم المهمة، المكان، الكود، أو نوع المهمة..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-transparent text-white text-sm w-full outline-none font-bold"
        />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="bg-red-500/10 text-red-500 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-red-500/20">مسح</button>}
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

      {/* خلفية سوداء شفافة تظهر ورا الجدول لما يكبر */}
      {isTableExpanded && <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[140]" onClick={() => setIsTableExpanded(false)}></div>}
      
      {/* حاوية الجدول */}
      <div className={isTableExpanded ? "fixed inset-4 z-[150] bg-[#0c0c0c] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up" : "flex-1 flex flex-col overflow-hidden relative"}>
        
        {/* هيدر الجدول (يظهر فقط عند التكبير ويحتوي على زر الـ X) */}
        {isTableExpanded && (
          <div className="p-4 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center shrink-0">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><EyeIcon className="w-5 h-5" /> سجل متابعة المهام الميدانية الشامل</h2>
            <button onClick={() => setIsTableExpanded(false)} className="bg-[#111] hover:bg-red-600 text-gray-400 hover:text-white p-2 rounded-xl transition-colors shadow-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
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

function NavItem({ icon, label, isActive, onClick, isOpen = true }) { return ( <button onClick={onClick} title={!isOpen ? label : ''} className={`flex items-center p-4 rounded-xl transition-all duration-300 ${isActive ? 'bg-gradient-to-l from-[#c70000] to-[#990000] text-white shadow-[0_0_20px_rgba(199,0,0,0.3)]' : 'text-gray-400 hover:bg-[#111] hover:text-white'} ${isOpen ? 'w-full gap-4' : 'w-14 justify-center mx-auto'}`}> <div className="shrink-0">{icon}</div> {isOpen && <span className="font-bold text-sm tracking-wide truncate">{label}</span>} </button> ); } { 
  return ( 
    <button onClick={onClick} title={!isOpen ? label : ''} className={`flex items-center p-4 rounded-xl transition-all duration-300 ${isActive ? 'bg-gradient-to-l from-[#c70000] to-[#990000] text-white shadow-[0_0_20px_rgba(199,0,0,0.3)]' : 'text-gray-400 hover:bg-[#111] hover:text-white'} ${isOpen ? 'w-full gap-4' : 'w-14 justify-center mx-auto'}`}> 
      <div className="shrink-0">{icon}</div> 
      {isOpen && <span className="font-bold text-sm tracking-wide truncate">{label}</span>} 
    </button> 
  ); 
}
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
const ExcelIcon = () => <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
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
        "القسم": log.entity_type === 'mission' ? 'المهام الميدانية' : log.entity_type === 'local_news' ? 'الأخبار المحلية' : log.entity_type === 'global_disaster' ? 'الكوارث العالمية' : 'نظام داخلي',
        "اسم المستخدم": log.full_name,
        "نوع الإجراء": log.action,
        "تفاصيل العملية": log.details
      }));

      // اسم الملف بيتغير بذكاء حسب الفلتر
      let fileName = 'الأرشيف_الأمني_الشامل.xlsx';
      if (entityFilter === 'mission') fileName = 'سجل_لوج_المهام_فقط.xlsx';
      if (entityFilter === 'local_news') fileName = 'سجل_لوج_الأخبار_المحلية.xlsx';
      if (entityFilter === 'global_disaster') fileName = 'سجل_لوج_الكوارث_العالمية.xlsx';
      if (entityFilter === 'earthquake') fileName = 'سجل_لوج_الزلازل.xlsx';

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, "الأرشيف");
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      alert("حدث خطأ في الاتصال بالسيرفر أثناء تحميل الأرشيف.");
    }
  };

  return (
    <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col min-h-[85vh] flex-1">
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
            <button onClick={() => setEntityFilter('local_news')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'local_news' ? 'bg-[#c70000] text-white' : 'text-gray-400 hover:text-white'}`}>الأخبار المحلية</button>
            <button onClick={() => setEntityFilter('global_disaster')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'global_disaster' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}>الكوارث العالمية</button>
            <button onClick={() => setEntityFilter('earthquake')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'earthquake' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>الزلازل</button>
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
                   log.entity_type === 'local_news' ? <span className="bg-[#c70000]/20 text-[#c70000] px-2 py-1 rounded text-xs border border-[#c70000]/30">الأخبار المحلية</span> : 
                   log.entity_type === 'global_disaster' ? <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs border border-orange-500/30">الكوارث العالمية</span> : 
                   log.entity_type === 'earthquake' ? <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs border border-purple-500/30">الزلازل</span> :
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
const GlobalWorldIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const EarthquakeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h4l3-9 5 18 3-9h3" /></svg>;
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
    // 💡 التحقق الصارم من لينك الخبر المحلي
    if (!nd.news_link || nd.news_link.trim() === '') return setCustomAlert("عفواً، رابط الخبر (لينك الخبر) إلزامي ولا يمكن تسجيل الخبر بدونه لتأكيد المصداقية!");
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
                      {/* 💡 زرار فتح الرابط الجديد (بيظهر بس لو فيه لينك متسجل) */}
                      {n.news_link && <a href={n.news_link} target="_blank" rel="noreferrer" className="p-2 bg-[#111] hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg" title="فتح الرابط"><GlobalWorldIcon /></a>}
                      <button onClick={() => handleEdit(n)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg"><EyeIcon /></button>
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
                  <div className="md:col-span-2"><FormGroup label="لينك الخبر (إلزامي)*"><StyledInput value={nd.news_link} onChange={e => setNd({...nd, news_link: e.target.value})} placeholder="https://..." dir="ltr" className="text-left border-blue-500/50 focus:border-blue-500 bg-blue-500/5" required /></FormGroup></div>
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

// ==========================================
// 7. شاشة الكوارث العالمية (Global Disasters)
// ==========================================
// ==========================================
// 7. شاشة الكوارث العالمية (Global Disasters)
// ==========================================
function GlobalDisastersView({ isOwner, isSupervisor, isJoker, isVolunteer }) {
  const [disasters, setDisasters] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [disasterToDelete, setDisasterToDelete] = useState(null);
  const [customAlert, setCustomAlert] = useState(null);
  const [filterDate, setFilterDate] = useState(''); // 💡 حالة فلتر التاريخ

  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  const DISASTER_TYPES = ['انفجار','زلزال','هزة أرضية','بركان','اعصار','حرائق غابات','صعق كهربائي','سيول','عاصفة','فيضان','وباء'];

  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => { if (!dateStr) return ''; const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; return months[new Date(dateStr).getMonth()]; };

  const [gd, setGd] = useState({
    disaster_id: null, incident_date: getLocalDate(), incident_month: '', news_title: '', country: '', disaster_type: '', affected_areas: '', at_risk_areas: '', source_name: '', injured_count: 0, deaths_count: 0, missing_count: 0, national_societies_interventions: '', news_link: '', news_updates: '', data_entry_name: '', notes: ''
  });

  const fetchDisasters = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system.vercel.app/api/global-disasters', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setDisasters(await res.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  useEffect(() => { fetchDisasters(); }, []);

  const handleCreateNew = () => {
    setGd({ disaster_id: null, incident_date: getLocalDate(), incident_month: '', news_title: '', country: '', disaster_type: '', affected_areas: '', at_risk_areas: '', source_name: '', injured_count: 0, deaths_count: 0, missing_count: 0, national_societies_interventions: '', news_link: '', news_updates: '', data_entry_name: '', notes: '' });
    setIsModalOpen(true);
  };

  const handleEdit = (d) => { setGd({...d}); setIsModalOpen(true); };

  const confirmDelete = async () => {
    if (!disasterToDelete) return;
    const token = localStorage.getItem('access_token');
    await fetch(`https://eoc-system.vercel.app/api/global-disasters/${disasterToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    setDisasterToDelete(null); fetchDisasters();
  };

  const handleSubmit = async () => {
    if (!gd.news_link || gd.news_link.trim() === '') return setCustomAlert("عفواً، رابط الخبر (لينك الخبر) إلزامي ولا يمكن تسجيل الكارثة بدونه لتأكيد المصداقية!");
    if (!gd.incident_date) return setCustomAlert("عفواً، يجب إدخال التاريخ.");
    if (!gd.country) return setCustomAlert("عفواً، يجب تحديد الدولة/المكان.");
    if (!gd.disaster_type) return setCustomAlert("عفواً، يجب تحديد نوع الكارثة.");

    const payload = { ...gd, incident_month: getMonthName(gd.incident_date) };
    const token = localStorage.getItem('access_token');
    const url = gd.disaster_id ? `https://eoc-system.vercel.app/api/global-disasters/${gd.disaster_id}` : 'https://eoc-system.vercel.app/api/global-disasters';
    const method = gd.disaster_id ? 'PUT' : 'POST';

    const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
    if (res.ok) { setIsModalOpen(false); fetchDisasters(); } else { setCustomAlert("حدث خطأ في الاتصال بالسيرفر! لم يتم الحفظ."); }
  };

  // 💡 تطبيق الفلتر على الجدول والإحصائيات وتصدير الإكسيل
  const filteredDisasters = filterDate 
    ? disasters.filter(d => d.incident_date === filterDate) 
    : disasters;

  // 💡 التصدير الشامل للجدول بالترتيب المطلوب
  const handleExportExcel = () => {
    if (filteredDisasters.length === 0) return setCustomAlert("لا توجد كوارث للتصدير حالياً.");
    const ws = XLSX.utils.json_to_sheet(filteredDisasters.map(d => ({
      "التاريخ": d.incident_date || '',
      "الشهر": d.incident_month || '',
      "الخبر": d.news_title || '',
      "الدولة": d.country || '',
      "نوع الكارثة": d.disaster_type || '',
      "المناطق المتأثرة من الكارثة": d.affected_areas || '',
      "المناطق المتوقعة الخطر": d.at_risk_areas || '',
      "المصدر": d.source_name || '',
      "عدد المصابين": d.injured_count || 0,
      "عدد الوفيات": d.deaths_count || 0,
      "عدد المفقودين": d.missing_count || 0,
      "تدخلات الجمعيات الوطنية": d.national_societies_interventions || '',
      "لينك الخبر": d.news_link || '',
      "تطورات الخبر": d.news_updates || '',
      "اسم مدخل الخبر": d.data_entry_name || '',
      "ملاحظات": d.notes || ''
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الكوارث العالمية");
    XLSX.writeFile(wb, filterDate ? `سجل_الكوارث_العالمية_${filterDate}.xlsx` : `سجل_الكوارث_العالمية.xlsx`);
  };

  // 💡 تصدير الخبر الفردي بنفس الترتيب
  const handleExportSingleExcel = () => {
    const ws = XLSX.utils.json_to_sheet([{
      "التاريخ": gd.incident_date || '',
      "الشهر": gd.incident_month || '',
      "الخبر": gd.news_title || '',
      "الدولة": gd.country || '',
      "نوع الكارثة": gd.disaster_type || '',
      "المناطق المتأثرة من الكارثة": gd.affected_areas || '',
      "المناطق المتوقعة الخطر": gd.at_risk_areas || '',
      "المصدر": gd.source_name || '',
      "عدد المصابين": gd.injured_count || 0,
      "عدد الوفيات": gd.deaths_count || 0,
      "عدد المفقودين": gd.missing_count || 0,
      "تدخلات الجمعيات الوطنية": gd.national_societies_interventions || '',
      "لينك الخبر": gd.news_link || '',
      "تطورات الخبر": gd.news_updates || '',
      "اسم مدخل الخبر": gd.data_entry_name || '',
      "ملاحظات": gd.notes || ''
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تفاصيل الكارثة");
    XLSX.writeFile(wb, `كارثة_${gd.country || 'عالمية'}.xlsx`);
  };

  // 💡 الإحصائيات تتحدث مع الفلتر
  const uniqueCountries = [...new Set(filteredDisasters.map(d => d.country))].filter(Boolean).length;
  const totalDeaths = filteredDisasters.reduce((sum, d) => sum + (parseInt(d.deaths_count) || 0), 0);
  const totalInjuries = filteredDisasters.reduce((sum, d) => sum + (parseInt(d.injured_count) || 0), 0);

  return (
    <div className="space-y-6 pb-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up">
        <StatCard title="إجمالي الكوارث المرصودة" value={filteredDisasters.length} color="text-white" borderHighlight />
        <StatCard title="الدول/المناطق المتضررة" value={uniqueCountries} color="text-orange-400" />
        <StatCard title="إجمالي الوفيات المرصودة" value={totalDeaths.toLocaleString()} color="text-[#c70000]" />
        <StatCard title="إجمالي المصابين" value={totalInjuries.toLocaleString()} color="text-yellow-500" />
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[650px]">
        <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            <h3 className="text-xl font-bold text-white flex items-center gap-2 whitespace-nowrap"><GlobalWorldIcon /> رصد الكوارث العالمية</h3>
            
            {/* 💡 فلتر التاريخ الجديد في الهيدر */}
            <div className="flex items-center gap-2">
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)]" />
              {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-red-500 hover:text-white bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors">إلغاء التاريخ</button>}
            </div>
          </div>

          <div className="flex gap-3 shrink-0">
            {isOwner && <button onClick={handleExportExcel} className="bg-[#1a1a1a] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525]"><ExcelIcon /> تحميل السجل الشامل للكوارث</button>}
            <button onClick={handleCreateNew} className="bg-[#c70000] hover:bg-[#a50000] text-white px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2">+ رصد كارثة</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400">
              <tr>
                <th className="p-4 font-semibold border-l border-white/5">التاريخ</th>
                <th className="p-4 font-semibold border-l border-white/5 text-orange-400">الدولة / المكان</th>
                <th className="p-4 font-semibold border-l border-white/5 text-[#c70000]">نوع الكارثة</th>
                <th className="p-4 font-semibold border-l border-white/5 max-w-[200px]">الخبر</th>
                <th className="p-4 font-semibold border-l border-white/5 text-center">الوفيات</th>
                <th className="p-4 font-semibold border-l border-white/5 text-center">المصابين</th>
                <th className="p-4 font-semibold sticky top-0 left-0 z-30 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? <tr><td colSpan="7" className="p-8 text-center text-gray-500">جاري تحميل البيانات...</td></tr> : 
               filteredDisasters.length > 0 ? filteredDisasters.map(d => (
                <tr key={d.disaster_id} className="hover:bg-white/5">
                  <td className="p-4 text-white border-l border-white/5">{d.incident_date}</td>
                  <td className="p-4 text-orange-400 border-l border-white/5 font-bold">{d.country}</td>
                  <td className="p-4 text-[#c70000] border-l border-white/5 font-bold bg-[#c70000]/5">{d.disaster_type}</td>
                  <td className="p-4 text-gray-400 border-l border-white/5 truncate max-w-[250px]">{d.news_title}</td>
                  <td className="p-4 text-gray-300 border-l border-white/5 text-center">{d.deaths_count}</td>
                  <td className="p-4 text-gray-300 border-l border-white/5 text-center">{d.injured_count}</td>
                  <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                    <div className="flex justify-center gap-2">
                      {d.news_link && <a href={d.news_link} target="_blank" rel="noreferrer" className="p-2 bg-[#111] hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg" title="فتح الرابط"><GlobalWorldIcon /></a>}
                      <button onClick={() => handleEdit(d)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg"><EyeIcon /></button>
                      {(isOwner || isSupervisor || isJoker) && <button onClick={() => setDisasterToDelete(d.disaster_id)} className="p-2 bg-[#111] hover:bg-red-600 text-gray-400 hover:text-white rounded-lg"><TrashIcon /></button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="7" className="p-8 text-center text-gray-500">لا توجد كوارث مسجلة حالياً بهذا التاريخ</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-[#c70000]/30 rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-[0_0_50px_rgba(199,0,0,0.1)] animate-fade-in-up">
            <div className="p-5 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><GlobalWorldIcon /> {gd.disaster_id ? 'تعديل رصد الكارثة' : 'رصد كارثة عالمية جديدة'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-[#111] text-gray-400 hover:bg-red-600 hover:text-white p-2 rounded-xl"><TrashIcon /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              <SectionCard title="بيانات الكارثة الأساسية" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="التاريخ"><StyledInput type="date" value={gd.incident_date} onChange={e => setGd({...gd, incident_date: e.target.value})} /></FormGroup>
                  <FormGroup label="الدولة (مطلوب)">
                    <StyledSelect value={gd.country} onChange={e => setGd({...gd, country: e.target.value})} className="border-orange-500/50 text-orange-400 font-bold">
                      <option value="" disabled className="text-gray-500">اختر المكان...</option>
                      {COUNTRIES_LIST.map(c => <option key={c} value={c} className="text-white">{c}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="نوع الكارثة (مطلوب)">
                    <StyledSelect value={gd.disaster_type} onChange={e => setGd({...gd, disaster_type: e.target.value})} className="border-[#c70000]/50 text-[#c70000] font-bold">
                      <option value="" disabled className="text-gray-500">اختر النوع...</option>
                      {DISASTER_TYPES.map(t => <option key={t} value={t} className="text-white">{t}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <div className="md:col-span-3"><FormGroup label="الخبر (وصف مختصر)"><StyledInput value={gd.news_title} onChange={e => setGd({...gd, news_title: e.target.value})} /></FormGroup></div>
                  <FormGroup label="المناطق المتأثرة من الكارثة"><StyledInput value={gd.affected_areas} onChange={e => setGd({...gd, affected_areas: e.target.value})} /></FormGroup>
                  <FormGroup label="المناطق المتوقعة الخطر"><StyledInput value={gd.at_risk_areas} onChange={e => setGd({...gd, at_risk_areas: e.target.value})} /></FormGroup>
                  <FormGroup label="المصدر"><StyledInput value={gd.source_name} onChange={e => setGd({...gd, source_name: e.target.value})} /></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="الإصابات والتدخلات" icon={<UsersIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="عدد الوفيات"><StyledInput type="number" value={gd.deaths_count} onChange={e => setGd({...gd, deaths_count: parseInt(e.target.value) || 0})} className="bg-[#c70000]/10 text-red-400" /></FormGroup>
                  <FormGroup label="عدد المصابين"><StyledInput type="number" value={gd.injured_count} onChange={e => setGd({...gd, injured_count: parseInt(e.target.value) || 0})} className="bg-yellow-500/10 text-yellow-400" /></FormGroup>
                  <FormGroup label="عدد المفقودين"><StyledInput type="number" value={gd.missing_count} onChange={e => setGd({...gd, missing_count: parseInt(e.target.value) || 0})} className="bg-gray-500/10 text-gray-300" /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="تدخلات الجمعيات الوطنية"><textarea value={gd.national_societies_interventions} onChange={e => setGd({...gd, national_societies_interventions: e.target.value})} className="w-full bg-[#111] border border-white/5 rounded-xl p-3 text-sm outline-none text-white focus:border-blue-500" rows="2"></textarea></FormGroup></div>
                </div>
              </SectionCard>

              <SectionCard title="التوثيق (إلزامي)" icon={<MapIcon />}>
                <div className="grid grid-cols-1 gap-4">
                  <FormGroup label="لينك الخبر (إلزامي)*">
                    <StyledInput value={gd.news_link} onChange={e => setGd({...gd, news_link: e.target.value})} placeholder="https://..." dir="ltr" className="text-left border-blue-500/50 focus:border-blue-500 bg-blue-500/5" required />
                  </FormGroup>
                  <FormGroup label="تطورات الخبر"><textarea value={gd.news_updates} onChange={e => setGd({...gd, news_updates: e.target.value})} className="w-full bg-[#111] border border-white/5 rounded-xl p-3 text-sm outline-none text-white focus:border-[#c70000]" rows="2"></textarea></FormGroup>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormGroup label="اسم مدخل الخبر"><StyledInput value={gd.data_entry_name} onChange={e => setGd({...gd, data_entry_name: e.target.value})} /></FormGroup>
                    <FormGroup label="ملاحظات"><StyledInput value={gd.notes} onChange={e => setGd({...gd, notes: e.target.value})} /></FormGroup>
                  </div>
                </div>
              </SectionCard>
            </div>
            
            <div className="p-5 border-t border-white/10 bg-[#0a0a0a] flex justify-end gap-3 shrink-0 rounded-b-3xl">
              <button onClick={handleExportSingleExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 mr-auto"><ExcelIcon /> تحميل سجل الكارثة</button>
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إلغاء</button>
              <button onClick={handleSubmit} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">حفظ وتوثيق الكارثة</button>
            </div>
          </div>
        </div>
      )}

      {disasterToDelete && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[110] p-4">
          <div className="bg-[#0c0c0c] border border-[#c70000]/30 rounded-3xl w-full max-w-md p-8 flex flex-col items-center shadow-[0_0_40px_rgba(199,0,0,0.2)] animate-fade-in-up text-center">
            <div className="w-20 h-20 bg-[#c70000]/10 rounded-full flex items-center justify-center mb-5 border border-[#c70000]/20 text-[#c70000]"><TrashIcon className="w-10 h-10" /></div>
            <h3 className="text-xl font-bold text-white mb-2">تأكيد الحذف</h3>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">هل أنت متأكد من حذف هذا الرصد نهائياً؟</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setDisasterToDelete(null)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-300 hover:bg-white/5 border border-white/10 transition-colors">إلغاء</button>
              <button onClick={confirmDelete} className="flex-1 bg-[#c70000] hover:bg-[#a50000] text-white px-4 py-3 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">نعم، احذف</button>
            </div>
          </div>
        </div>
      )}

      {customAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-[#c70000]/50 rounded-2xl p-6 max-w-md w-full shadow-[0_0_40px_rgba(199,0,0,0.3)] animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4 border-b border-white/10 pb-4"><AlertIcon /><h3 className="text-xl font-bold text-white">تنبيه النظام</h3></div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{customAlert}</p>
            <div className="mt-8 flex justify-end"><button onClick={() => setCustomAlert(null)} className="bg-[#c70000] hover:bg-red-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg">علم، جاري التعديل</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 8. شاشة مركز رصد الزلازل (Earthquakes)
// ==========================================
const globalEqIcon = new L.DivIcon({ className: 'custom-leaflet-icon', html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 10px #ef4444;"></div>`, iconSize: [14, 14] });
const egyptEqIcon = new L.DivIcon({ className: 'custom-leaflet-icon', html: `<div style="background-color: #22c55e; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 15px #22c55e;"></div>`, iconSize: [16, 16] });

function EarthquakesView({ isOwner, isSupervisor }) {
  const [activeEqTab, setActiveEqTab] = useState('all'); 
  const [globalEqs, setGlobalEqs] = useState([]);
  const [egyptEqs, setEgyptEqs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customAlert, setCustomAlert] = useState(null);
  
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => { if (!dateStr) return ''; const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; return months[new Date(dateStr).getMonth()]; };

  const [filterDate, setFilterDate] = useState(getLocalDate()); 

  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [isEgyptModalOpen, setIsEgyptModalOpen] = useState(false);

  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  
  const [gForm, setGForm] = useState({ eq_id: null, date: getLocalDate(), time: '', country: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });
  const [eForm, setEForm] = useState({ eq_id: null, date: getLocalDate(), time: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });

  const fetchEarthquakes = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const resG = await fetch('https://eoc-system.vercel.app/api/earthquakes/global', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resG.ok) setGlobalEqs(await resG.json());
      const resE = await fetch('https://eoc-system.vercel.app/api/earthquakes/egypt', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resE.ok) setEgyptEqs(await resE.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  useEffect(() => { fetchEarthquakes(); }, []);

  const filteredGlobalEqs = filterDate ? globalEqs.filter(e => e.date === filterDate) : globalEqs;
  const filteredEgyptEqs = filterDate ? egyptEqs.filter(e => e.date === filterDate) : egyptEqs;

  // 💡 دوال التعديل (فتح الفورم بالبيانات)
  const handleEditGlobal = (eq) => {
    setGForm({
      eq_id: eq.eq_id, date: eq.date || getLocalDate(), time: eq.time || '', country: eq.country || '',
      magnitude: eq.magnitude || '', depth_km: eq.depth_km ? eq.depth_km.replace(' KM', '') : '',
      region: eq.region || '', longitude: eq.longitude || '', latitude: eq.latitude || ''
    });
    setIsGlobalModalOpen(true);
  };

  const handleEditEgypt = (eq) => {
    setEForm({
      eq_id: eq.eq_id, date: eq.date || getLocalDate(), time: eq.time || '', magnitude: eq.magnitude || '',
      depth_km: eq.depth_km ? eq.depth_km.replace(' KM', '') : '', region: eq.region || '',
      longitude: eq.longitude || '', latitude: eq.latitude || ''
    });
    setIsEgyptModalOpen(true);
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const rows = text.split('\n').filter(r => r.trim() !== '');
      const parsedData = [];
      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(';');
        if (cols.length >= 8) {
          const mag = parseFloat(cols[7]);
          if (isNaN(mag)) continue;
          const status = mag >= 5.1 ? 'زلزال' : 'هزة أرضية';
          const regionName = cols[4];
          let countryName = regionName.split(',').pop().trim();
          parsedData.push({
            date: cols[0], month: getMonthName(cols[0]), time: cols[1], country: countryName, magnitude: mag, 
            depth_km: cols[5] + ' KM', region: regionName, status: status, 
            longitude: cols[3] ? parseFloat(cols[3]) : null, latitude: cols[2] ? parseFloat(cols[2]) : null
          });
        }
      }
      if (parsedData.length > 0) {
        setIsLoading(true);
        const token = localStorage.getItem('access_token');
        const res = await fetch('https://eoc-system.vercel.app/api/earthquakes/global/bulk', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(parsedData)
        });
        if (res.ok) { setCustomAlert(`تم استيراد ${parsedData.length} زلزال عالمي بنجاح من الشيت!`); fetchEarthquakes(); } 
        else { setCustomAlert("حدث خطأ أثناء رفع الشيت للسيرفر."); setIsLoading(false); }
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // 💡 التحديث والإضافة
  const handleGlobalSubmit = async () => {
    if (!gForm.date) return setCustomAlert("التاريخ مطلوب");
    if (!gForm.magnitude) return setCustomAlert("القوة بالريختر مطلوبة");
    
    // شيلنا الـ eq_id من الـ payload عشان السيرفر يقبله
    const payload = { 
      date: gForm.date, time: gForm.time, country: gForm.country, 
      magnitude: parseFloat(gForm.magnitude), status: parseFloat(gForm.magnitude) >= 5.1 ? 'زلزال' : 'هزة أرضية', 
      month: getMonthName(gForm.date), depth_km: gForm.depth_km ? `${gForm.depth_km} KM` : 'KM', 
      region: gForm.region, longitude: gForm.longitude !== '' ? parseFloat(gForm.longitude) : null, 
      latitude: gForm.latitude !== '' ? parseFloat(gForm.latitude) : null 
    };

    const token = localStorage.getItem('access_token');
    const url = gForm.eq_id ? `https://eoc-system.vercel.app/api/earthquakes/global/${gForm.eq_id}` : 'https://eoc-system.vercel.app/api/earthquakes/global';
    try {
      const res = await fetch(url, { method: gForm.eq_id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { setIsGlobalModalOpen(false); fetchEarthquakes(); setCustomAlert(gForm.eq_id ? "تم حفظ التعديل بنجاح!" : "تمت الإضافة بنجاح!"); } 
      else { setCustomAlert("⚠️ السيرفر رفض التعديل! لو إنت شغال على اللينك اللايف، اتأكد إنك رفعت ملف main_2.py الجديد على Vercel."); }
    } catch(e) { setCustomAlert("خطأ في الاتصال بالسيرفر"); }
  };

  const handleEgyptSubmit = async () => {
    if (!eForm.date) return setCustomAlert("التاريخ مطلوب");
    if (!eForm.magnitude) return setCustomAlert("القوة بالريختر مطلوبة");
    
    const payload = { 
      date: eForm.date, time: eForm.time, magnitude: parseFloat(eForm.magnitude), 
      depth_km: eForm.depth_km ? `${eForm.depth_km} KM` : 'KM', region: eForm.region, 
      longitude: eForm.longitude !== '' ? parseFloat(eForm.longitude) : null, latitude: eForm.latitude !== '' ? parseFloat(eForm.latitude) : null 
    };

    const token = localStorage.getItem('access_token');
    const url = eForm.eq_id ? `https://eoc-system.vercel.app/api/earthquakes/egypt/${eForm.eq_id}` : 'https://eoc-system.vercel.app/api/earthquakes/egypt';
    try {
      const res = await fetch(url, { method: eForm.eq_id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { setIsEgyptModalOpen(false); fetchEarthquakes(); setCustomAlert(eForm.eq_id ? "تم حفظ التعديل بنجاح!" : "تمت الإضافة بنجاح!"); } 
      else { setCustomAlert("⚠️ السيرفر رفض التعديل! لو إنت شغال على اللينك اللايف، اتأكد إنك رفعت ملف main_2.py الجديد على Vercel."); }
    } catch(e) { setCustomAlert("خطأ في الاتصال بالسيرفر"); }
  };

  const deleteGlobalEq = async (id) => { const token = localStorage.getItem('access_token'); await fetch(`https://eoc-system.vercel.app/api/earthquakes/global/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); fetchEarthquakes(); };
  const deleteEgyptEq = async (id) => { const token = localStorage.getItem('access_token'); await fetch(`https://eoc-system.vercel.app/api/earthquakes/egypt/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); fetchEarthquakes(); };

  const handleExportGlobalEqs = () => {
    if (filteredGlobalEqs.length === 0) return setCustomAlert("لا توجد زلازل عالمية للتصدير حالياً.");
    const ws = XLSX.utils.json_to_sheet(filteredGlobalEqs.map(eq => ({ "التاريخ": eq.date || '', "الشهر": eq.month || '', "الدولة": eq.country || '', "القوة بالريختر": eq.magnitude || '', "التوقيت": eq.time || '', "العمق": eq.depth_km || 'KM', "المنطقة": eq.region || '', "الحالة": eq.status || '', "longitude": eq.longitude || '', "Latitude": eq.latitude || '' })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "الزلازل العالمية"); XLSX.writeFile(wb, filterDate ? `سجل_الزلازل_العالمية_${filterDate}.xlsx` : `سجل_الزلازل_العالمية.xlsx`);
  };

  const handleExportEgyptEqs = () => {
    if (filteredEgyptEqs.length === 0) return setCustomAlert("لا توجد زلازل مصرية للتصدير حالياً.");
    const ws = XLSX.utils.json_to_sheet(filteredEgyptEqs.map(eq => ({ "التاريخ": eq.date || '', "وقت الزلزال": eq.time || '', "العمق": eq.depth_km || 'KM', "القوة بالريختر": eq.magnitude || '', "المنطقة": eq.region || '', "longitude": eq.longitude || '', "Latitude": eq.latitude || '' })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "زلازل مصر"); XLSX.writeFile(wb, filterDate ? `سجل_زلازل_مصر_${filterDate}.xlsx` : `سجل_زلازل_مصر.xlsx`);
  };

  const uniqueCountriesCount = [...new Set(filteredGlobalEqs.map(e => e.country))].filter(Boolean).length;
  const maxMagnitude = Math.max(...filteredGlobalEqs.map(e => parseFloat(e.magnitude) || 0), ...filteredEgyptEqs.map(e => parseFloat(e.magnitude) || 0), 0);

  return (
    <div className="space-y-6 pb-10">
      
      {/* 💡 الهيدر بدون فلاتر */}
      <div className="bg-[#111] border border-white/5 rounded-3xl p-5 shadow-lg animate-fade-in-up">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><EarthquakeIcon/> مركز رصد الزلازل</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up">
        <StatCard title="الزلازل العالمية المرصودة" value={filteredGlobalEqs.length} color="text-red-500" borderHighlight />
        <StatCard title="الدول المرصودة" value={uniqueCountriesCount} color="text-orange-400" />
        <StatCard title="زلازل مصر المرصودة" value={filteredEgyptEqs.length} color="text-green-500" />
        <StatCard title="أقوى هزة / زلزال" value={maxMagnitude > 0 ? `${maxMagnitude} ريختر` : '-'} color="text-yellow-500" />
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-6 shadow-lg relative z-0 h-[500px]">
        {/* 💡 الفلاتر فوق الخريطة */}
        <div className="flex flex-col lg:flex-row justify-between items-center mb-4 gap-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><MapIcon/> خريطة الرصد (<span className="text-red-500">عالمي 🔴</span> / <span className="text-green-500">مصر 🟢</span>)</h3>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2 bg-[#1a1a1a] p-1 rounded-xl border border-white/10 shadow-inner">
              <button onClick={() => setActiveEqTab('global')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'global' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}>عالمي</button>
              <button onClick={() => setActiveEqTab('egypt')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'egypt' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>مصر</button>
              <button onClick={() => setActiveEqTab('all')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>الكل</button>
            </div>
            <div className="flex items-center gap-2 bg-[#1a1a1a] p-1 rounded-xl border border-white/10 shadow-inner">
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-transparent px-3 py-1.5 text-sm text-white outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)]" />
              {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-red-500 hover:text-white bg-red-500/10 px-3 py-1.5 rounded-lg font-bold">إلغاء</button>}
            </div>
          </div>
        </div>

        {/* 💡 زوم أوت للخريطة */}
        <div className="h-[380px] w-full rounded-2xl overflow-hidden border border-white/10 relative">
          <MapContainer center={[20.0, 10.0]} zoom={2} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"/>
            
            {(activeEqTab === 'global' || activeEqTab === 'all') && filteredGlobalEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker key={`g-${eq.eq_id}`} position={[lat, lng]} icon={globalEqIcon}>
                  <Popup><strong className="text-red-600 block text-center mb-1">{eq.magnitude} ريختر ({eq.status})</strong><span className="text-xs text-gray-800 text-center block font-bold">{eq.region}</span><span className="text-[10px] text-gray-500 text-center block mt-1">{eq.date} | {eq.time}</span></Popup>
                </Marker>
              );
            })}
            
            {(activeEqTab === 'egypt' || activeEqTab === 'all') && filteredEgyptEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker key={`e-${eq.eq_id}`} position={[lat, lng]} icon={egyptEqIcon}>
                  <Popup><strong className="text-green-600 block text-center mb-1">{eq.magnitude} ريختر (مصر)</strong><span className="text-xs text-gray-800 text-center block font-bold">{eq.region}</span><span className="text-[10px] text-gray-500 text-center block mt-1">{eq.date} | {eq.time}</span></Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[600px]">
        <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
          <h3 className="text-xl font-bold text-white hidden md:block">سجل بيانات الزلازل</h3>
          
          {/* 💡 حل مشكلة الزراير المقطوعة بـ flex-wrap */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto mt-4 md:mt-0">
            {activeEqTab === 'global' || activeEqTab === 'all' ? (
              <>
                {isOwner && <button onClick={handleExportGlobalEqs} className="bg-[#1a1a1a] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525]"><ExcelIcon/> تصدير العالمي</button>}
                <label className="bg-[#1a1a1a] text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525] cursor-pointer">
                  <ExcelIcon/> استيراد شيت EMSC
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                </label>
                <button onClick={() => { setGForm({ eq_id: null, date: getLocalDate(), time: '', country: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' }); setIsGlobalModalOpen(true); }} className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(239,68,68,0.3)]">+ رصد عالمي</button>
              </>
            ) : null}
            
            {activeEqTab === 'egypt' || activeEqTab === 'all' ? (
              <>
                {isOwner && <button onClick={handleExportEgyptEqs} className="bg-[#1a1a1a] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525]"><ExcelIcon/> تصدير مصر</button>}
                <button onClick={() => { setEForm({ eq_id: null, date: getLocalDate(), time: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' }); setIsEgyptModalOpen(true); }} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(34,197,94,0.3)]">+ رصد زلزال مصر</button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          {(activeEqTab === 'global' || activeEqTab === 'all') ? (
            <div className="mb-8">
              {activeEqTab === 'all' && <h4 className="p-4 text-red-500 font-bold bg-[#111]">الزلازل العالمية</h4>}
              <table className="w-full text-right whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400">
                  <tr>
                    <th className="p-4 font-semibold border-l border-white/5">التاريخ / الوقت</th>
                    <th className="p-4 font-semibold border-l border-white/5">الدولة</th>
                    <th className="p-4 font-semibold border-l border-white/5 text-red-500">القوة (ريختر)</th>
                    <th className="p-4 font-semibold border-l border-white/5">العمق</th>
                    <th className="p-4 font-semibold border-l border-white/5 max-w-[200px]">المنطقة</th>
                    <th className="p-4 font-semibold border-l border-white/5">الإحداثيات</th>
                    <th className="p-4 font-semibold border-l border-white/5 text-center">الحالة</th>
                    <th className="p-4 font-semibold border-l border-white/5 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isLoading ? <tr><td colSpan="8" className="p-8 text-center text-gray-500">جاري التحميل...</td></tr> : 
                   filteredGlobalEqs.length > 0 ? filteredGlobalEqs.map(eq => (
                    <tr key={`tbl-g-${eq.eq_id}`} className="hover:bg-white/5">
                      <td className="p-4 text-white border-l border-white/5 font-mono">{eq.date} <span className="text-gray-500">{eq.time}</span></td>
                      <td className="p-4 text-orange-400 border-l border-white/5 font-bold">{eq.country}</td>
                      <td className="p-4 text-red-500 border-l border-white/5 font-bold">{eq.magnitude}</td>
                      <td className="p-4 text-gray-400 border-l border-white/5 font-mono">{eq.depth_km}</td>
                      <td className="p-4 text-gray-300 border-l border-white/5 truncate max-w-[200px]">{eq.region}</td>
                      <td className="p-4 text-gray-400 border-l border-white/5 font-mono text-xs" dir="ltr">{eq.latitude ? `${eq.latitude}, ${eq.longitude}` : '-'}</td>
                      <td className="p-4 border-l border-white/5 text-center"><span className={`px-2 py-1 rounded text-xs font-bold ${eq.status === 'زلزال' ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>{eq.status}</span></td>
                      <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleEditGlobal(eq)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg"><EyeIcon /></button>
                          {(isOwner || isSupervisor) && <button onClick={() => deleteGlobalEq(eq.eq_id)} className="p-2 bg-[#111] hover:bg-red-600 text-gray-400 hover:text-white rounded-lg"><TrashIcon/></button>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="8" className="p-8 text-center text-gray-500">لا توجد زلازل عالمية</td></tr>}
                </tbody>
              </table>
            </div>
          ) : null}

          {(activeEqTab === 'egypt' || activeEqTab === 'all') ? (
            <div>
              {activeEqTab === 'all' && <h4 className="p-4 text-green-500 font-bold bg-[#111]">زلازل مصر</h4>}
              <table className="w-full text-right whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400">
                  <tr>
                    <th className="p-4 font-semibold border-l border-white/5">التاريخ / الوقت</th>
                    <th className="p-4 font-semibold border-l border-white/5 text-green-500">القوة (ريختر)</th>
                    <th className="p-4 font-semibold border-l border-white/5">العمق</th>
                    <th className="p-4 font-semibold border-l border-white/5 max-w-[200px]">المنطقة (مصر)</th>
                    <th className="p-4 font-semibold border-l border-white/5">الإحداثيات</th>
                    <th className="p-4 font-semibold border-l border-white/5 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isLoading ? <tr><td colSpan="6" className="p-8 text-center text-gray-500">جاري التحميل...</td></tr> : 
                   filteredEgyptEqs.length > 0 ? filteredEgyptEqs.map(eq => (
                    <tr key={`tbl-e-${eq.eq_id}`} className="hover:bg-white/5">
                      <td className="p-4 text-white border-l border-white/5 font-mono">{eq.date} <span className="text-gray-500">{eq.time}</span></td>
                      <td className="p-4 text-green-500 border-l border-white/5 font-bold">{eq.magnitude}</td>
                      <td className="p-4 text-gray-400 border-l border-white/5 font-mono">{eq.depth_km}</td>
                      <td className="p-4 text-gray-300 border-l border-white/5 truncate max-w-[200px]">{eq.region}</td>
                      <td className="p-4 text-gray-400 border-l border-white/5 font-mono text-xs" dir="ltr">{eq.latitude ? `${eq.latitude}, ${eq.longitude}` : '-'}</td>
                      <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleEditEgypt(eq)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg"><EyeIcon /></button>
                          {(isOwner || isSupervisor) && <button onClick={() => deleteEgyptEq(eq.eq_id)} className="p-2 bg-[#111] hover:bg-red-600 text-gray-400 hover:text-white rounded-lg"><TrashIcon/></button>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="6" className="p-8 text-center text-gray-500">لا توجد زلازل مسجلة لمصر</td></tr>}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {isGlobalModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-red-600/30 rounded-3xl w-full max-w-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><EarthquakeIcon/> {gForm.eq_id ? 'تعديل زلزال عالمي' : 'رصد زلزال عالمي (يدوي)'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <FormGroup label="التاريخ"><StyledInput type="date" value={gForm.date} onChange={e => setGForm({...gForm, date: e.target.value})} /></FormGroup>
              <FormGroup label="التوقيت"><StyledInput type="time" value={gForm.time} onChange={e => setGForm({...gForm, time: e.target.value})} /></FormGroup>
              <FormGroup label="الدولة">
                <StyledSelect value={gForm.country} onChange={e => setGForm({...gForm, country: e.target.value})}>
                  <option value="" disabled>اختر الدولة...</option>
                  {COUNTRIES_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                </StyledSelect>
              </FormGroup>
              <FormGroup label="المنطقة"><StyledInput value={gForm.region} onChange={e => setGForm({...gForm, region: e.target.value})} /></FormGroup>
              <FormGroup label="القوة (ريختر) - إلزامي"><StyledInput type="number" step="0.1" value={gForm.magnitude} onChange={e => setGForm({...gForm, magnitude: e.target.value})} className="border-red-500/50" /></FormGroup>
              <FormGroup label="العمق (سيتم إضافة KM آلياً)"><StyledInput type="number" placeholder="مثال: 10" value={gForm.depth_km} onChange={e => setGForm({...gForm, depth_km: e.target.value})} /></FormGroup>
              <FormGroup label="Latitude (دوائر العرض)"><StyledInput type="number" step="any" value={gForm.latitude} onChange={e => setGForm({...gForm, latitude: e.target.value})} /></FormGroup>
              <FormGroup label="Longitude (خطوط الطول)"><StyledInput type="number" step="any" value={gForm.longitude} onChange={e => setGForm({...gForm, longitude: e.target.value})} /></FormGroup>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsGlobalModalOpen(false)} className="px-6 py-2 rounded-xl text-gray-400 bg-[#111]">إلغاء</button>
              <button onClick={handleGlobalSubmit} className="px-6 py-2 rounded-xl text-white bg-red-600 font-bold">حفظ</button>
            </div>
          </div>
        </div>
      )}

      {isEgyptModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-green-600/30 rounded-3xl w-full max-w-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><EarthquakeIcon/> {eForm.eq_id ? 'تعديل زلزال مصر' : 'رصد زلزال محلي (مصر)'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <FormGroup label="التاريخ"><StyledInput type="date" value={eForm.date} onChange={e => setEForm({...eForm, date: e.target.value})} /></FormGroup>
              <FormGroup label="التوقيت"><StyledInput type="time" value={eForm.time} onChange={e => setEForm({...eForm, time: e.target.value})} /></FormGroup>
              <FormGroup label="المنطقة داخل مصر"><StyledInput value={eForm.region} onChange={e => setEForm({...eForm, region: e.target.value})} /></FormGroup>
              <FormGroup label="القوة (ريختر) - إلزامي"><StyledInput type="number" step="0.1" value={eForm.magnitude} onChange={e => setEForm({...eForm, magnitude: e.target.value})} className="border-green-500/50" /></FormGroup>
              <FormGroup label="العمق (سيتم إضافة KM آلياً)"><StyledInput type="number" placeholder="مثال: 10" value={eForm.depth_km} onChange={e => setEForm({...eForm, depth_km: e.target.value})} /></FormGroup>
              <FormGroup label="Latitude (دوائر العرض)"><StyledInput type="number" step="any" value={eForm.latitude} onChange={e => setEForm({...eForm, latitude: e.target.value})} /></FormGroup>
              <FormGroup label="Longitude (خطوط الطول)"><StyledInput type="number" step="any" value={eForm.longitude} onChange={e => setEForm({...eForm, longitude: e.target.value})} /></FormGroup>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsEgyptModalOpen(false)} className="px-6 py-2 rounded-xl text-gray-400 bg-[#111]">إلغاء</button>
              <button onClick={handleEgyptSubmit} className="px-6 py-2 rounded-xl text-white bg-green-600 font-bold">حفظ</button>
            </div>
          </div>
        </div>
      )}

      {customAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-[#c70000]/50 rounded-2xl p-6 max-w-md w-full shadow-[0_0_40px_rgba(199,0,0,0.3)] text-center">
            <h3 className="text-xl font-bold text-white mb-4">تنبيه</h3>
            <p className="text-gray-300 mb-6">{customAlert}</p>
            <button onClick={() => setCustomAlert(null)} className="bg-[#c70000] px-6 py-2 rounded-xl text-white font-bold">حسناً</button>
          </div>
        </div>
      )}
    </div>
  );
}

const SidebarToggleIcon = () => <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>;
const SearchIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;