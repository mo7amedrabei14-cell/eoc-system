function LocalNewsView({ isOwner, isSupervisor, isJoker, isVolunteer }) {
  const handleClearAllLocalNews = () => {
    if (!isOwner) return;
    setClearAllCode('');
    setShowClearAllConfirm(true);
};

  const confirmClearAllLocalNews = async () => {
    if (clearAllCode !== "301014") {
        setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
        return;
    }

    setShowClearAllConfirm(false);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("https://eoc-system-b12f.vercel.app/api/local-news/clear-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ confirmation_code: clearAllCode })
      });

      const data = await res.json();

      if (!res.ok) {
        setCustomAlert(data.detail || "فشل تنفيذ عملية المسح.");
        return;
      }

      setCustomAlert(`تم مسح جميع الأخبار المحلية بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      fetchNews();
    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
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

// 💡 حالة وقت آخر فحص
const [lastRunTime, setLastRunTime] = useState('جاري التحقق...');

useEffect(() => {
  const fetchLastRun = async () => {
    try {
      const res = await fetch('https://api.github.com/repos/mo7amedrabei14-cell/eoc-system/actions/workflows/ai_cron.yml/runs?per_page=1');
      if (res.ok) {
        const data = await res.json();
        if (data.workflow_runs && data.workflow_runs.length > 0) {
          const lastRun = data.workflow_runs[0];
          const dateObj = new Date(lastRun.updated_at);
          const now = new Date();
          const isToday = dateObj.getDate() === now.getDate() && dateObj.getMonth() === now.getMonth();
          const formattedTime = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          const dayStr = isToday ? 'اليوم' : dateObj.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
          
          setLastRunTime(`${dayStr}، الساعة ${formattedTime}`);
        } else {
          setLastRunTime('لا توجد بيانات');
        }
      } else {
        setLastRunTime('غير متاح');
      }
    } catch (e) {
      setLastRunTime('غير متاح');
    }
  };
  
  fetchLastRun();
  const interval = setInterval(fetchLastRun, 60000);
  return () => clearInterval(interval);
}, []);


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

          {isOwner && (
  <button
    onClick={handleClearAllLocalNews}
    className="bg-red-950/40 hover:bg-red-700 text-red-400 hover:text-white border border-red-500/40 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0 transition-all"
  >
    🗑️ مسح الكل
  </button>
)}
          
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
            
            <div className="p-4 md:p-5 border-t border-white/10 bg-[#0a0a0a] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={handleExportSingleNewsExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-3 md:py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 md:mr-auto">
                <ExcelIcon /> تصدير الخبر الحالي
              </button>
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إلغاء</button>
              <button onClick={handleSubmit} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">حفظ الخبر وتقييم الأداء</button>
            </div>
          </div>
        </div>
      )}

      {/* -- تصميم التنبيه الإداري الفخم -- */}
      <DangerConfirmModal
  show={showClearAllConfirm}
  title="تأكيد الحذف"
  message="سيتم حذف جميع الأخبار المحلية نهائياً. هذا الإجراء لا يمكن التراجع عنه."
  confirmationCode={clearAllCode}
  onConfirmationCodeChange={setClearAllCode}
  showConfirmationInput={true}
  onCancel={() => {
    setShowClearAllConfirm(false);
    setClearAllCode('');
  }}
  onConfirm={confirmClearAllLocalNews}
/>

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
function GlobalDisastersView({ isOwner, isSupervisor, isJoker, isVolunteer }) {
  // 💡 1. تعريف دوال التاريخ في أول الشاشة عشان الكل يشوفها بدون تكرار
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => { if (!dateStr) return ''; const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; return months[new Date(dateStr).getMonth()]; };

  // 💡 2. الحالات (States) وفلتر التاريخ
  const [disasters, setDisasters] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [disasterToDelete, setDisasterToDelete] = useState(null);
  const [customAlert, setCustomAlert] = useState(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearAllCode, setClearAllCode] = useState('');
  const [filterDate, setFilterDate] = useState(getLocalDate()); // 💡 فتحت بتاريخ اليوم افتراضياً

  // 💡 3. القوائم
  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  const DISASTER_TYPES = ['انفجار','زلزال','هزة أرضية','بركان','اعصار','حرائق غابات','صعق كهربائي','سيول','عاصفة','فيضان','وباء'];

  const [gd, setGd] = useState({
    disaster_id: null, incident_date: getLocalDate(), incident_month: '', news_title: '', country: '', disaster_type: '', affected_areas: '', at_risk_areas: '', source_name: '', injured_count: 0, deaths_count: 0, missing_count: 0, national_societies_interventions: '', news_link: '', news_updates: '', data_entry_name: '', notes: ''
  });

  const fetchDisasters = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/global-disasters', { headers: { 'Authorization': `Bearer ${token}` } });
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
    await fetch(`https://eoc-system-b12f.vercel.app/api/global-disasters/${disasterToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    setDisasterToDelete(null); fetchDisasters();
  };

  const handleSubmit = async () => {
    if (!gd.news_link || gd.news_link.trim() === '') return setCustomAlert("عفواً، رابط الخبر (لينك الخبر) إلزامي ولا يمكن تسجيل الكارثة بدونه لتأكيد المصداقية!");
    if (!gd.incident_date) return setCustomAlert("عفواً، يجب إدخال التاريخ.");
    if (!gd.country) return setCustomAlert("عفواً، يجب تحديد الدولة/المكان.");
    if (!gd.disaster_type) return setCustomAlert("عفواً، يجب تحديد نوع الكارثة.");

    const payload = { ...gd, incident_month: getMonthName(gd.incident_date) };
    const token = localStorage.getItem('access_token');
    const url = gd.disaster_id ? `https://eoc-system-b12f.vercel.app/api/global-disasters/${gd.disaster_id}` : 'https://eoc-system-b12f.vercel.app/api/global-disasters';
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

  const handleClearAllGlobalDisasters = () => {
    if (!isOwner) return;
    setClearAllCode('');
    setShowClearAllConfirm(true);
};

  const confirmClearAllGlobalDisasters = async () => {
    if (clearAllCode !== "301014") {
        setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
        return;
    }

    setShowClearAllConfirm(false);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("https://eoc-system-b12f.vercel.app/api/global-disasters/clear-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ confirmation_code: clearAllCode })
      });

      const data = await res.json();

      if (!res.ok) {
        setCustomAlert(data.detail || "فشل تنفيذ عملية المسح.");
        return;
      }

      setCustomAlert(`تم مسح جميع الكوارث العالمية بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      fetchDisasters();
    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
  };

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

          {isOwner && (
  <button
    onClick={handleClearAllGlobalDisasters}
    className="bg-red-950/40 hover:bg-red-700 text-red-400 hover:text-white border border-red-500/40 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0 transition-all"
  >
    🗑️ مسح الكل
  </button>
)}

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
                      {d.news_link && (
                        <a href={d.news_link} target="_blank" rel="noreferrer" className="p-2 bg-[#111] hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg transition-colors" title="فتح مصدر الخبر">
                          <GlobalWorldIcon />
                        </a>
                      )}
                      <button onClick={() => handleEdit(d)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg transition-colors" title="تعديل">
                        <EyeIcon />
                      </button>
                      {(isOwner || isSupervisor || isJoker) && (
                        <button onClick={() => setDisasterToDelete(d.disaster_id)} className="p-2 bg-[#111] hover:bg-red-600 text-red-500 hover:text-white rounded-lg transition-colors border border-red-500/20" title="حذف">
                          <TrashIcon />
                        </button>
                      )}
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
            
            <div className="p-4 md:p-5 border-t border-white/10 bg-[#0a0a0a] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={handleExportSingleExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-3 md:py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 md:mr-auto"><ExcelIcon /> تحميل سجل الكارثة</button>
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إلغاء</button>
              <button onClick={handleSubmit} className="bg-[#c70000] hover:bg-[#a50000] text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(199,0,0,0.3)]">حفظ وتوثيق الكارثة</button>
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

      <DangerConfirmModal
  show={showClearAllConfirm}
  title="تأكيد الحذف"
  message="سيتم حذف جميع الكوارث العالمية نهائياً. هذا الإجراء لا يمكن التراجع عنه."
  confirmationCode={clearAllCode}
  onConfirmationCodeChange={setClearAllCode}
  showConfirmationInput={true}
  onCancel={() => {
    setShowClearAllConfirm(false);
    setClearAllCode('');
  }}
  onConfirm={confirmClearAllGlobalDisasters}
/>

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


function EarthquakesView({ isOwner, isSupervisor }) {
  const [activeEqTab, setActiveEqTab] = useState('all'); 
  const [globalEqs, setGlobalEqs] = useState([]);
  const [egyptEqs, setEgyptEqs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customAlert, setCustomAlert] = useState(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');
  
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => { if (!dateStr) return ''; const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; return months[new Date(dateStr).getMonth()]; };

  const [filterDate, setFilterDate] = useState(getLocalDate()); 
  const [selectedEqId, setSelectedEqId] = useState(null); // 💡 فلتر الخريطة الجديد

  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [isEgyptModalOpen, setIsEgyptModalOpen] = useState(false);

  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  
  const [gForm, setGForm] = useState({ eq_id: null, date: getLocalDate(), time: '', country: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });
  const [eForm, setEForm] = useState({ eq_id: null, date: getLocalDate(), time: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });

  const fetchEarthquakes = async () => {
    setIsLoading(true);
    const token = localStorage.getItem('access_token');
    try {
      const resG = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/global', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resG.ok) setGlobalEqs(await resG.json());
      const resE = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/egypt', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resE.ok) setEgyptEqs(await resE.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  useEffect(() => { fetchEarthquakes(); }, []);

  const filteredGlobalEqs = filterDate ? globalEqs.filter(e => e.date === filterDate) : globalEqs;
  const filteredEgyptEqs = filterDate ? egyptEqs.filter(e => e.date === filterDate) : egyptEqs;

  // 💡 تطبيق فلتر الخريطة على الجداول بس (عشان النقط متختفيش من الخريطة)
  const tableGlobalEqs = selectedEqId ? filteredGlobalEqs.filter(e => e.eq_id === selectedEqId) : filteredGlobalEqs;
  const tableEgyptEqs = selectedEqId ? filteredEgyptEqs.filter(e => e.eq_id === selectedEqId) : filteredEgyptEqs;

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
        const res = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/global/bulk', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(parsedData)
        });
        if (res.ok) { setCustomAlert(`تم استيراد ${parsedData.length} زلزال عالمي بنجاح من الشيت!`); fetchEarthquakes(); } 
        else { setCustomAlert("حدث خطأ أثناء رفع الشيت للسيرفر."); setIsLoading(false); }
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleClearAllEarthquakes = () => {
    if (!isOwner) return;
    setClearAllCode('');
    setShowClearAllConfirm(true);
};

  const confirmClearAllEarthquakes = async () => {
    if (clearAllCode !== "301014") {
        setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
        return;
    }

    setShowClearAllConfirm(false);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("https://eoc-system-b12f.vercel.app/api/earthquakes/clear-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ confirmation_code: clearAllCode })
      });

      const data = await res.json();

      if (!res.ok) {
        setCustomAlert(data.detail || "فشل تنفيذ عملية المسح.");
        return;
      }

      setCustomAlert(`تم مسح جميع سجلات الزلازل بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      fetchEarthquakes();
    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
  };
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
    const url = gForm.eq_id ? `https://eoc-system-b12f.vercel.app/api/earthquakes/global/${gForm.eq_id}` : 'https://eoc-system-b12f.vercel.app/api/earthquakes/global';
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
    const url = eForm.eq_id ? `https://eoc-system-b12f.vercel.app/api/earthquakes/egypt/${eForm.eq_id}` : 'https://eoc-system-b12f.vercel.app/api/earthquakes/egypt';
    try {
      const res = await fetch(url, { method: eForm.eq_id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { setIsEgyptModalOpen(false); fetchEarthquakes(); setCustomAlert(eForm.eq_id ? "تم حفظ التعديل بنجاح!" : "تمت الإضافة بنجاح!"); } 
      else { setCustomAlert("⚠️ السيرفر رفض التعديل! لو إنت شغال على اللينك اللايف، اتأكد إنك رفعت ملف main_2.py الجديد على Vercel."); }
    } catch(e) { setCustomAlert("خطأ في الاتصال بالسيرفر"); }
  };

  const deleteGlobalEq = async (id) => { const token = localStorage.getItem('access_token'); await fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/global/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); fetchEarthquakes(); };
  const deleteEgyptEq = async (id) => { const token = localStorage.getItem('access_token'); await fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/egypt/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); fetchEarthquakes(); };

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

      {isOwner && (
  <button
    onClick={handleClearAllEarthquakes}
    className="bg-red-950/40 hover:bg-red-700 text-red-400 hover:text-white border border-red-500/40 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
  >
    🗑️ مسح الكل
  </button>
)}

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-4 md:p-6 shadow-lg relative z-0 h-auto md:h-[500px]">
        {/* 💡 الفلاتر فوق الخريطة */}
        <div className="flex flex-col lg:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2"><MapIcon/> خريطة الرصد (<span className="text-red-500">عالمي 🔴</span> / <span className="text-green-500">مصر 🟢</span>)</h3>
            {selectedEqId && (
              <button onClick={() => setSelectedEqId(null)} className="bg-[#111] hover:bg-[#c70000] text-gray-400 hover:text-white border border-white/10 px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-[0_0_10px_rgba(199,0,0,0.3)]">
                إلغاء الفلترة
              </button>
            )}
          </div>
          
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
        <div className="h-[300px] md:h-[380px] w-full rounded-2xl overflow-hidden border border-white/10 relative mt-4 md:mt-0">
          <MapContainer center={[20.0, 10.0]} zoom={2} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"/>
            
            {(activeEqTab === 'global' || activeEqTab === 'all') && tableGlobalEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker keyboard={false} key={`g-${eq.eq_id}`} position={[lat, lng]} icon={globalEqIcon} eventHandlers={{ click: () => { setSelectedEqId(prev => prev === eq.eq_id ? null : eq.eq_id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('earthquakes-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top"><strong className="text-red-600 block text-center mb-1">{eq.magnitude} ريختر ({eq.status})</strong><span className="text-xs text-gray-800 text-center block font-bold">{eq.region}</span><span className="text-[10px] text-gray-500 text-center block mt-1">{eq.date} | {eq.time}</span><span className="text-[10px] text-blue-500 text-center block mt-1 font-bold">انقر لفلترة السجل</span></Tooltip>
                </Marker>
              );
            })}
            
            {(activeEqTab === 'egypt' || activeEqTab === 'all') && tableEgyptEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker keyboard={false} key={`e-${eq.eq_id}`} position={[lat, lng]} icon={egyptEqIcon} eventHandlers={{ click: () => { setSelectedEqId(prev => prev === eq.eq_id ? null : eq.eq_id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('earthquakes-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top"><strong className="text-green-600 block text-center mb-1">{eq.magnitude} ريختر (مصر)</strong><span className="text-xs text-gray-800 text-center block font-bold">{eq.region}</span><span className="text-[10px] text-gray-500 text-center block mt-1">{eq.date} | {eq.time}</span><span className="text-[10px] text-blue-500 text-center block mt-1 font-bold">انقر لفلترة السجل</span></Tooltip>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div id="earthquakes-table-section" className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[600px] scroll-mt-6">
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
                   tableGlobalEqs.length > 0 ? tableGlobalEqs.map(eq => (
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
                   tableEgyptEqs.length > 0 ? tableEgyptEqs.map(eq => (
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
            <div className="flex flex-col-reverse md:flex-row justify-end gap-3 mt-4 [&>button]:w-full md:[&>button]:w-auto">
              <button onClick={() => setIsGlobalModalOpen(false)} className="px-6 py-3 md:py-2 rounded-xl text-gray-400 bg-[#111]">إلغاء</button>
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
            <div className="flex flex-col-reverse md:flex-row justify-end gap-3 mt-4 [&>button]:w-full md:[&>button]:w-auto">
              <button onClick={() => setIsEgyptModalOpen(false)} className="px-6 py-3 md:py-2 rounded-xl text-gray-400 bg-[#111]">إلغاء</button>
              <button onClick={handleEgyptSubmit} className="px-6 py-2 rounded-xl text-white bg-green-600 font-bold">حفظ</button>
            </div>
          </div>
        </div>
      )}

      <DangerConfirmModal
  show={showClearAllConfirm}
  title="تأكيد الحذف"
  message="سيتم حذف جميع سجلات الزلازل المصرية والعالمية نهائياً. هذا الإجراء لا يمكن التراجع عنه."
  confirmationCode={clearAllCode}
  onConfirmationCodeChange={setClearAllCode}
  showConfirmationInput={true}
  onCancel={() => {
    setShowClearAllConfirm(false);
    setClearAllCode('');
  }}
  onConfirm={confirmClearAllEarthquakes}
/>

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

const SearchIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
const ShieldIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
const NewsIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>;
const GlobalWorldIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const EarthquakeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h4l3-9 5 18 3-9h3" /></svg>;
const CarIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.909.53l1.415 2.83M15 16h1a1 1 0 001-1v-1.586a1 1 0 00-.293-.707l-1.415-1.415A1 1 0 0014.586 11H13v5z" /></svg>;
const SidebarToggleIcon = () => <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>;
const globalEqIcon = new L.DivIcon({ className: 'custom-leaflet-icon', html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 10px #ef4444;"></div>`, iconSize: [14, 14] });
const egyptEqIcon = new L.DivIcon({ className: 'custom-leaflet-icon', html: `<div style="background-color: #22c55e; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 15px #22c55e;"></div>`, iconSize: [16, 16] });

// ==========================================
// 💡 أيقونة الرادار الخاصة بالذكاء الاصطناعي على الخريطة
// ==========================================
const aiIncidentIcon = new L.DivIcon({
  className: 'custom-leaflet-icon',
  html: `<div style="background-color: #a855f7; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 20px #a855f7; animation: pulse 2s infinite;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// ==========================================
// 8. شاشة رصد الذكاء الاصطناعي (AI News Monitor - God Mode)
// ==========================================
function AINewsMonitorView({ branches, isOwner }) {
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => { if (!dateStr) return ''; const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; return months[new Date(dateStr).getMonth()]; };

  const [aiNewsList, setAiNewsList] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [customAlert, setCustomAlert] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedAiNewsId, setSelectedAiNewsId] = useState(null); // للفلترة من الخريطة
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');
  const [aiNewsToDelete, setAiNewsToDelete] = useState(null);

  const [form, setForm] = useState({
    id: null, incident_date: getLocalDate(), incident_description: '', news_type: '', news_publisher: '',
    street_name: '', area_name: '', governorate: 'القاهرة', hospital_name: '', injured_count: '',
    deaths_count: '', news_updates: '', news_link: ''
  });

  const [lastRunTime, setLastRunTime] = useState('جاري التحقق...');

  useEffect(() => {
    const fetchLastRun = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/mo7amedrabei14-cell/eoc-system/actions/workflows/ai_cron.yml/runs?per_page=1');
        if (res.ok) {
          const data = await res.json();
          if (data.workflow_runs && data.workflow_runs.length > 0) {
            const lastRun = data.workflow_runs[0];
            const dateObj = new Date(lastRun.updated_at);
            const now = new Date();
            const isToday = dateObj.getDate() === now.getDate() && dateObj.getMonth() === now.getMonth();
            const formattedTime = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
            const dayStr = isToday ? 'اليوم' : dateObj.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
            setLastRunTime(`${dayStr}، الساعة ${formattedTime}`);
          } else { setLastRunTime('لا توجد بيانات'); }
        } else { setLastRunTime('غير متاح'); }
      } catch (e) { setLastRunTime('غير متاح'); }
    };
    fetchLastRun();
    const interval = setInterval(fetchLastRun, 60000); 
    return () => clearInterval(interval);
  }, []);
  
  // 💡 تجربة المستخدم الحية (Live UX): تحديث الأخبار والخريطة تلقائياً في الخلفية
  useEffect(() => {
    const fetchAiNews = async () => {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('https://eoc-system-b12f.vercel.app/api/ai-news', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) setAiNewsList(await res.json());
      } catch (err) {}
    };
    
    // 1. جلب البيانات فوراً أول ما الشاشة تفتح
    fetchAiNews();
    
    // 2. المحرك الحي: فحص صامت كل 15 ثانية لجلب أي كوارث جديدة رصدها الروبوت
    const interval = setInterval(fetchAiNews, 15000); 
    return () => clearInterval(interval);
  }, []);

  const handleEdit = (n) => { setForm({...n}); setIsModalOpen(true); };

  const handleExportAllExcel = () => {
    if (aiNewsList.length === 0) return setCustomAlert("لا يوجد داتا لتصديرها.");
    const ws = XLSX.utils.json_to_sheet(aiNewsList.map(n => ({
      "التاريخ": n.incident_date || '', "الشهر": getMonthName(n.incident_date) || '', "وصف الحادث": n.incident_description || '', "نوع الخبر": n.news_type || '', "ناشر الخبر": n.news_publisher || '',
      "المحافظة": n.governorate || '', "اسم المستشفى": n.hospital_name || '', "عدد المصابين": n.injured_count || 0, "عدد الوفيات": n.deaths_count || 0,
      "تطورات الخبر (التقرير)": n.news_updates || '', "لينك الخبر": n.news_link || ''
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "سجل الرصد الآلي"); XLSX.writeFile(wb, `سجل_الذكاء_الاصطناعي.xlsx`);
  };

  const handleDeleteAiNews = (id) => {
    if (!isOwner) return setCustomAlert("عفواً، المالك فقط يمكنه الحذف.");
    setAiNewsToDelete(id);
  };

  const confirmDeleteAiNews = async () => {
    if (!aiNewsToDelete) return;
    const id = aiNewsToDelete;
    setAiNewsToDelete(null);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/ai-news/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        setCustomAlert("تم الحذف بنجاح!");
        setAiNewsList(prev => prev.filter(item => item.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setCustomAlert(data.detail || "فشل حذف السجل.");
      }
    } catch (err) {
      setCustomAlert("فشل الاتصال بالسيرفر.");
    }
  };

  // 💡 الدالة السحرية للتشغيل اليدوي (تم تأمينها عبر السيرفر)
  const handleManualScanTrigger = async () => {
    if (!isOwner) return setCustomAlert("المالك فقط يمكنه إعطاء أمر التشغيل.");
    
    setIsScanning(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/trigger-ai-radar', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        }
      });

      if (res.ok) {
        setCustomAlert("تم إطلاق وحش الرصد (God Mode)! 🚀\nيتم مسح السوشيال ميديا والأخبار حالياً، راقب الخريطة.");
      } else {
        const errorData = await res.json();
        setCustomAlert(`تنبيه: ${errorData.detail || 'فشل إرسال الأمر للسيرفر.'}`);
      }
    } catch (error) { 
      setCustomAlert("فشل الاتصال بالسيرفر المركزي."); 
    }
    setIsScanning(false);
  };

  // 💡 فلترة الداتا
  const dateFilteredNews = filterDate
  ? aiNewsList.filter(n => n.incident_date === filterDate)
  : aiNewsList;

const availableCountries = [...new Set(
  dateFilteredNews
    .map(n => n.governorate)
    .filter(Boolean)
)].sort((a, b) => a.localeCompare(b, 'ar'));

const filteredNews = selectedCountry === 'all'
  ? dateFilteredNews
  : dateFilteredNews.filter(n => n.governorate === selectedCountry);

const tableNews = selectedAiNewsId
  ? filteredNews.filter(n => n.id === selectedAiNewsId)
  : filteredNews;

const totalAiNews = filteredNews.length;
const totalAiCountries = new Set(
  filteredNews.map(n => n.governorate).filter(Boolean)
).size;

  // 💡 الدالة العبقرية لاستخراج الإحداثيات والصورة من نص التقرير
  const extractAiData = (updatesText) => {
    if (!updatesText) return null;
    let lat = null, lng = null, img = null, severity = null;
    
    // استخراج الإحداثيات
    const coordsMatch = updatesText.match(/📍 \[إحداثيات الموقع\]:\s*([\d.-]+)[,\s]+([\d.-]+)/);
    if (coordsMatch && coordsMatch.length === 3) {
      lat = parseFloat(coordsMatch[1]);
      lng = parseFloat(coordsMatch[2]);
    }
    // استخراج الصورة
    const imgMatch = updatesText.match(/📸 \[صورة الحادثة\]:\s*(https?:\/\/[^\s]+)/);
    if (imgMatch && imgMatch[1]) img = imgMatch[1];
    
    // استخراج الخطورة
    const severityMatch = updatesText.match(/🔥 \[مستوى الخطورة\]:\s*([\d]+)\/10/);
    if (severityMatch && severityMatch[1]) severity = severityMatch[1];

    if (lat && lng && !isNaN(lat) && !isNaN(lng)) return { lat, lng, img, severity };
    return null;
  };

  const handleClearAllAINews = () => {
    if (!isOwner) return;
    setClearAllCode('');
    setShowClearAllConfirm(true);
};

  const confirmClearAllAINews = async () => {
    if (clearAllCode !== "301014") {
        setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
        return;
    }

    setShowClearAllConfirm(false);

    try {
      const token = localStorage.getItem("access_token");

      const res = await fetch(
        "https://eoc-system-b12f.vercel.app/api/ai-news/clear-all",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
    confirmation_code: clearAllCode
})
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setCustomAlert(data.detail || "فشل مسح أخبار الذكاء الاصطناعي.");
        return;
      }

      setCustomAlert(
        `تم مسح جميع أخبار الذكاء الاصطناعي بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`
      );

    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
  };

  return (
    <div className="space-y-6 pb-10">
      
      {/* الهيدر ومؤشرات العمل */}
      <div className="bg-[#111] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)] animate-fade-in-up flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><AIIcon className="text-purple-500 animate-pulse"/> استخبارات الذكاء الاصطناعي (OSINT God-Mode)</h3>
          <p className="text-gray-400 text-sm mt-2">رصد تكتيكي حي وتحليل استراتيجي من السوشيال ميديا والمواقع الإخبارية.</p>
        </div>
        <div className="bg-[#0c0c0c] border border-white/10 rounded-xl p-3 flex items-center gap-4 shadow-inner shrink-0 flex-wrap md:flex-nowrap w-full md:w-auto">
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>
              <span className="text-xs font-bold text-green-400">الروبوت نشط (دوريات المسح تعمل)</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 border-t border-white/5 pt-1">
              <svg className="w-3 h-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-[10px] text-gray-400 font-mono font-bold tracking-wider">آخر فحص: {lastRunTime}</span>
            </div>
          </div>
          {/* 👇 الخط اللي بيفصل والبادج بتاع جيت هاب رجعوا هنا 👇 */}
          <div className="hidden md:block w-px h-8 bg-white/10"></div>
          <img src="https://github.com/mo7amedrabei14-cell/eoc-system/actions/workflows/ai_cron.yml/badge.svg" alt="AI Status Badge" className="h-5 mr-auto md:mr-0" />
        </div>
      </div>

            {/* إحصائيات الرصد */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up">

        {/* عدد الأخبار */}
        <div className="bg-[#0c0c0c] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between">

            <div>
              <p className="text-gray-400 text-sm font-bold">
                إجمالي الأخبار المرصودة
              </p>

              <p className="text-4xl font-black text-white mt-2">
                {filteredNews.length.toLocaleString()}
              </p>
            </div>

            <div className="bg-purple-500/10 text-purple-400 p-3 rounded-xl">
              <svg
                className="w-7 h-7"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v12m2-8h2v8a2 2 0 01-2 2h-2M7 8h6M7 12h6M7 16h4"
                />
              </svg>
            </div>

          </div>
        </div>


        {/* عدد الدول */}
        <div className="bg-[#0c0c0c] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between">

            <div>
              <p className="text-gray-400 text-sm font-bold">
                الدول المرصودة
              </p>

              <p className="text-4xl font-black text-white mt-2">
                {new Set(
                  filteredNews
                    .map(n => n.governorate)
                    .filter(Boolean)
                ).size.toLocaleString()}
              </p>
            </div>

            <div className="bg-purple-500/10 text-purple-400 p-3 rounded-xl">
              <svg
                className="w-7 h-7"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  strokeWidth={1.8}
                />
                <path
                  strokeLinecap="round"
                  strokeWidth={1.8}
                  d="M3 12h18M12 3c2.2 2.5 3.4 5.5 3.4 9s-1.2 6.5-3.4 9c-2.2-2.5-3.4-5.5-3.4-9S9.8 5.5 12 3z"
                />
              </svg>
            </div>

          </div>
        </div>

      </div>


      {/* 💡 خريطة الرصد التكتيكية للذكاء الاصطناعي */}

      <div className="bg-[#0c0c0c] border border-purple-500/30 rounded-3xl p-4 md:p-6 shadow-[0_0_20px_rgba(168,85,247,0.1)] relative z-0 h-auto md:h-[450px] animate-fade-in-up">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><MapIcon/> خريطة الرصد اللحظي للذكاء الاصطناعي</h3>
          {selectedAiNewsId && (
            <button onClick={() => setSelectedAiNewsId(null)} className="bg-[#111] hover:bg-purple-600 text-purple-400 hover:text-white border border-purple-500/30 px-3 py-1 rounded-lg text-xs font-bold transition-all">
              إلغاء الفلترة (عرض كل الأخبار)
            </button>
          )}
        </div>
        <div className="h-[300px] md:h-[350px] w-full rounded-2xl overflow-hidden border border-white/10 relative">
          <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"/>
            
            {filteredNews.map(news => {
              const aiData = extractAiData(news.news_updates);
              if (!aiData) return null; // لو مفيش إحداثيات، مش هيترسم

              return (
                <Marker keyboard={false} key={`ai-map-${news.id}`} position={[aiData.lat, aiData.lng]} icon={aiIncidentIcon} eventHandlers={{ click: () => { setSelectedAiNewsId(prev => prev === news.id ? null : news.id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('ai-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top">
                    <div className="text-center w-48">
                      {aiData.severity && <strong className="text-red-600 block mb-1">🔥 خطورة: {aiData.severity}/10</strong>}
                      <strong className="text-purple-700 block mb-1">{news.news_type}</strong>
                      <span className="text-xs text-gray-800 font-bold line-clamp-2">{news.incident_description}</span>
                      {aiData.img && aiData.img !== 'لا توجد صورة' && <img src={aiData.img} alt="حادث" className="w-full h-20 object-cover mt-2 rounded border border-gray-300" />}
                      <span className="text-[10px] text-blue-600 block mt-2 font-bold">انقر لفلترة الجدول</span>
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div id="ai-table-section" className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[600px] scroll-mt-6">
        <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          <div className="flex items-center gap-2">
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[#1a1a1a] border border-purple-500/30 rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:filter-[invert(1)]" />
            {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-purple-400 hover:text-white bg-purple-500/10 px-2 py-2 rounded-lg">الكل</button>}
          </div>
          <div className="flex flex-wrap gap-3">
            {isOwner && (
              <>
                <button onClick={handleExportAllExcel} className="bg-[#1a1a1a] text-purple-400 border border-purple-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#252525] shrink-0 justify-center"><ExcelIcon /> تصدير السجل</button>
                <button onClick={handleManualScanTrigger} disabled={isScanning} className={`px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0 justify-center transition-all ${isScanning ? 'bg-purple-600/50 text-white cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'}`}>
                  {isScanning ? <><svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> جاري المسح...</> : <><AIIcon className="w-4 h-4"/> إطلاق الرادار</>}
                </button>
              </>
            )}
          </div>
        </div>

        {isOwner && (
  <button
    onClick={handleClearAllAINews}
    className="bg-red-950/40 hover:bg-red-700 text-red-400 hover:text-white border border-red-500/40 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
  >
    🗑️ مسح الكل
  </button>
)}

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400 border-b border-purple-500/30">
              <tr>
                <th className="p-4 font-semibold border-l border-white/5">التاريخ</th>
                <th className="p-4 font-semibold border-l border-white/5 text-purple-400">نوع الخبر</th>
                <th className="p-4 font-semibold border-l border-white/5">المحافظة</th>
                <th className="p-4 font-semibold border-l border-white/5 max-w-[250px]">وصف الحادث</th>
                <th className="p-4 font-semibold border-l border-white/5">الناشر</th>
                <th className="p-4 font-semibold sticky top-0 left-0 z-30 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tableNews.length > 0 ? tableNews.map(n => {
                 const aiData = extractAiData(n.news_updates);
                 return (
                <tr key={n.id} className="hover:bg-white/5">
                  <td className="p-4 text-white border-l border-white/5 font-mono">{n.incident_date}</td>
                  <td className="p-4 text-purple-400 border-l border-white/5 font-bold">
                    {n.news_type}
                    {aiData && aiData.severity && <span className="block mt-1 bg-red-500/20 text-red-500 px-2 py-0.5 rounded text-[10px] w-max">خطورة: {aiData.severity}/10</span>}
                  </td>
                  <td className="p-4 text-gray-300 border-l border-white/5">{n.governorate}</td>
                  <td className="p-4 text-gray-400 border-l border-white/5 w-[500px] min-w-[500px] whitespace-normal leading-7">
                      {n.incident_description || 'لا يوجد وصف'}
                  </td>
                  <td className="p-4 text-gray-500 border-l border-white/5 text-xs">{n.news_publisher}</td>
                  <td className="p-4 sticky left-0 z-10 bg-[#1a1a1a] shadow-[4px_0_15px_rgba(0,0,0,0.5)] border-l border-white/5">
                    <div className="flex justify-center gap-2">
                      {n.news_link && (
                        <a href={n.news_link} target="_blank" rel="noreferrer" className="p-2 bg-[#111] hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg transition-colors" title="فتح مصدر الخبر">
                          <GlobalWorldIcon />
                        </a>
                      )}
                      <button onClick={() => handleEdit(n)} className="p-2 bg-[#111] hover:bg-yellow-600 text-gray-400 hover:text-white rounded-lg transition-colors" title="قراءة التقرير الاستخباراتي">
                        <EyeIcon />
                      </button>
                      {isOwner && (
                        <button onClick={() => handleDeleteAiNews(n.id)} className="p-2 bg-[#111] hover:bg-red-600 text-red-500 hover:text-white rounded-lg transition-colors border border-red-500/20" title="حذف السجل">
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
              }) : <tr><td colSpan="6" className="p-8 text-center text-gray-500 font-bold">لا توجد أخبار مطابقة...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* مودال قراءة التقرير والتعديل */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-[#050505] border border-purple-500/30 rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-[0_0_50px_rgba(168,85,247,0.15)] animate-fade-in-up">
            <div className="p-5 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><AIIcon className="text-purple-500"/> التقرير الاستخباراتي (OSINT)</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-[#111] text-gray-400 hover:text-red-500 p-2 rounded-xl"><TrashIcon /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              
              {/* عرض التقرير التكتيكي والصورة فوق */}
              <div className="bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-purple-500/50 p-6 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.1)] flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                   <h3 className="text-purple-400 font-bold flex items-center gap-2 border-b border-white/10 pb-2"><ShieldIcon/> التقرير الاستراتيجي الميداني</h3>
                   <div className="text-gray-300 text-sm leading-loose whitespace-pre-wrap font-mono">
                     {form.news_updates || 'لا يوجد تقرير متاح لهذا الحدث.'}
                   </div>
                </div>
                {/* استخراج الصورة لعرضها */}
                {extractAiData(form.news_updates)?.img && extractAiData(form.news_updates)?.img !== 'لا توجد صورة' && (
                  <div className="w-full md:w-1/3 shrink-0">
                    <img src={extractAiData(form.news_updates).img} alt="صورة الحدث" className="w-full h-auto rounded-xl border border-white/10 object-cover shadow-lg" />
                  </div>
                )}
              </div>

              <SectionCard title="تفاصيل الرصد" icon={<NewsIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="نوع الخبر"><StyledInput disabled value={form.news_type} className="text-purple-400 font-bold" /></FormGroup>
                  <FormGroup label="المحافظة (الفرع)"><StyledInput disabled value={form.governorate} /></FormGroup>
                  <FormGroup label="ناشر الخبر"><StyledInput disabled value={form.news_publisher} /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="وصف الحادث (الملخص)"><textarea readOnly value={form.incident_description} className="w-full bg-[#111] border border-white/5 rounded-xl p-3 text-sm outline-none text-gray-300" rows="2"></textarea></FormGroup></div>
                  <FormGroup label="اسم المستشفى"><StyledInput readOnly value={form.hospital_name} /></FormGroup>
                  <FormGroup label="عدد المصابين"><StyledInput readOnly value={form.injured_count} className="text-yellow-500 font-bold" /></FormGroup>
                  <FormGroup label="عدد الوفيات"><StyledInput readOnly value={form.deaths_count} className="text-red-500 font-bold" /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="لينك الخبر الأصلي"><a href={form.news_link} target="_blank" rel="noreferrer" className="block w-full bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-sm text-blue-400 hover:text-blue-300 truncate" dir="ltr">{form.news_link}</a></FormGroup></div>
                </div>
              </SectionCard>
            </div>
            
            <div className="p-4 md:p-5 border-t border-white/10 bg-[#0a0a0a] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:bg-white/5">إغلاق التقرير</button>
            </div>
          </div>
        </div>
      )}

      <DangerConfirmModal
        show={aiNewsToDelete !== null}
        title="تأكيد الحذف"
        message="هل أنت متأكد من حذف هذا السجل نهائياً؟"
        confirmLabel="نعم، احذف"
        onCancel={() => setAiNewsToDelete(null)}
        onConfirm={confirmDeleteAiNews}
      />

      <DangerConfirmModal
  show={showClearAllConfirm}
  title="تأكيد الحذف"
  message="سيتم حذف جميع أخبار ورصد الذكاء الاصطناعي نهائياً. هذا الإجراء لا يمكن التراجع عنه."
  confirmationCode={clearAllCode}
  onConfirmationCodeChange={setClearAllCode}
  showConfirmationInput={true}
  onCancel={() => {
    setShowClearAllConfirm(false);
    setClearAllCode('');
  }}
  onConfirm={confirmClearAllAINews}
/>

      {/* 👇 شاشة التنبيهات عشان الزرار يرد عليك 👇 */}
      {customAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-purple-500/50 rounded-2xl p-6 max-w-md w-full shadow-[0_0_40px_rgba(168,85,247,0.3)] animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4 border-b border-white/10 pb-4">
              <AIIcon className="w-7 h-7 text-purple-500" />
              <h3 className="text-xl font-bold text-white">رسالة النظام</h3>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{customAlert}</p>
            <div className="mt-8 flex justify-end">
              <button onClick={() => setCustomAlert(null)} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(168,85,247,0.4)] w-full">
                علم
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 👆 نهاية شاشة التنبيهات 👆 */}
    </div>
  );
}

// 💡 نافذة تأكيد موحّدة لعمليات الحذف
function DangerConfirmModal({
  show,
  title = 'تأكيد الحذف',
  message,
  onCancel,
  onConfirm,
  confirmLabel = 'نعم، احذف الكل',
  confirmationCode = '',
  onConfirmationCodeChange,
  showConfirmationInput = false
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[110] p-4">
      <div className="bg-[#0c0c0c] border border-[#c70000]/30 rounded-3xl w-full max-w-md p-8 flex flex-col items-center shadow-[0_0_40px_rgba(199,0,0,0.2)] animate-fade-in-up text-center">

        <div className="w-20 h-20 bg-[#c70000]/10 rounded-full flex items-center justify-center mb-5 border border-[#c70000]/20 text-[#c70000]">
          <TrashIcon className="w-10 h-10" />
        </div>

        <h3 className="text-xl font-bold text-white mb-2">
          {title}
        </h3>

        <p className="text-gray-400 text-sm mb-8 leading-relaxed">
          {message}
        </p>

        {showConfirmationInput && (
          <div className="w-full mb-6 text-right">
            <label className="block text-gray-400 text-sm font-bold mb-2">
              أدخل رمز التأكيد للمتابعة
            </label>

            <input
              type="password"
              value={confirmationCode}
              onChange={(e) => onConfirmationCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onConfirm();
                }
              }}
              placeholder="رمز التأكيد"
              autoComplete="new-password"
name="clear_all_confirmation"
              className="w-full bg-[#111] border border-white/10 focus:border-[#c70000]/50 rounded-xl px-4 py-3 text-white text-center tracking-[0.35em] outline-none transition-colors"
            />
          </div>
        )}

        <div className="flex gap-4 w-full">

          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-300 hover:bg-white/5 border border-white/10 transition-colors"
          >
            إلغاء
          </button>

          <button
            onClick={onConfirm}
            disabled={showConfirmationInput && confirmationCode !== "301014"}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-colors ${
              showConfirmationInput && confirmationCode !== "301014"
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-[#c70000] hover:bg-[#a50000] text-white shadow-[0_0_15px_rgba(199,0,0,0.3)]"
            }`}
          >
            {confirmLabel}
          </button>

        </div>
      </div>
    </div>
  );
}

// 💡 أيقونات
const AIIcon = ({ className = "", ...props }) => <svg {...props} className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h.01M15 9h.01" /></svg>;

// ==========================================
// 9. شاشة القوة البشرية (للمالك فقط - تجميع من المهام بدون تكرار)
// ==========================================
function HumanResourcesView({ branches, isOwner }) {
  const [hrList, setHrList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchHR = async () => {
      const token = localStorage.getItem('access_token');
      try {
        const res = await fetch('https://eoc-system-b12f.vercel.app/api/human-resources', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          setHrList(await res.json());
        }
      } catch (err) {
        console.error("Failed to fetch HR");
      } finally {
        setIsLoading(false);
      }
    };
    fetchHR();
  }, []);

  const filteredHR = hrList.filter(p => {
    const matchBranch = filterBranch === 'all' ? true : p.branch_name === filterBranch;
    const matchType = filterType === 'all' ? true : p.participant_type === filterType;
    const matchSearch = p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || p.membership_number.toLowerCase().includes(searchTerm.toLowerCase());
    return matchBranch && matchType && matchSearch;
  });

  const handleExportExcel = () => {
    if (filteredHR.length === 0) return alert("لا توجد بيانات لتصديرها.");
    const ws = XLSX.utils.json_to_sheet(filteredHR.map((p, i) => ({
      "م": i + 1,
      "الاسم الرباعي": p.full_name,
      "رقم العضوية / الصفة": p.membership_number,
      "الفرع التابع له": p.branch_name === 'القاهرة' ? 'المركز العام' : p.branch_name,
      "النوع": p.participant_type === 'volunteer' ? 'متطوع' : 'غير متطوع',
      "إجمالي المهام الميدانية": p.missions_count,
      "إجمالي الساعات (ساعة)": p.total_hours
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "القوة البشرية");
    XLSX.writeFile(wb, `سجل_القوة_البشرية.xlsx`);
  };

  const branchNames = [...new Set(branches.map(b => b.name === 'المركز العام' ? 'القاهرة' : b.name))];

  return (
    <div className="space-y-6 pb-10 animate-fade-in-up">
      <div className="bg-[#111] border border-[#c70000]/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(199,0,0,0.1)]">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><UsersIcon className="text-[#c70000]"/> سجل القوة البشرية الفعالة (إدارة المتطوعين)</h3>
        <p className="text-gray-400 text-sm mt-2">يتم استخراج البيانات تلقائياً من المهام الميدانية بدون تكرار، وربط المتطوع بعدد مشاركاته وساعاته الفعلية.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي القوة (بدون تكرار)" value={filteredHR.length} color="text-white" borderHighlight />
        <StatCard title="إجمالي المتطوعين الفعليين" value={filteredHR.filter(p => p.participant_type === 'volunteer').length} color="text-blue-400" />
        <StatCard title="مشاركين خارجيين (غير متطوع)" value={filteredHR.filter(p => p.participant_type === 'non_volunteer').length} color="text-yellow-500" />
        <StatCard title="متطوعين شاركوا +5 مهام" value={filteredHR.filter(p => p.missions_count >= 5).length} color="text-green-500" />
      </div>

      <div className="bg-[#0c0c0c] border border-white/5 rounded-3xl overflow-hidden shadow-lg flex flex-col h-[650px]">
        <div className="p-6 border-b border-white/5 bg-[#111] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <input type="text" placeholder="بحث بالاسم أو الكود..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-[#c70000]/50 w-full md:w-auto" />
            
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none cursor-pointer w-full md:w-auto">
              <option value="all">كل الفروع والتمركزات</option>
              <option value="المركز العام">المركز العام</option>
              {branchNames.filter(n => n !== 'القاهرة').map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none cursor-pointer w-full md:w-auto">
              <option value="all">الكل (متطوع وغير متطوع)</option>
              <option value="volunteer">متطوعين فقط</option>
              <option value="non_volunteer">غير متطوعين</option>
            </select>
          </div>

          {isOwner && <button onClick={handleExportExcel} className="bg-[#1a1a1a] hover:bg-[#252525] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors w-full md:w-auto justify-center"><ExcelIcon /> تصدير سجل القوة البشرية</button>}
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-20 bg-[#1a1a1a] text-gray-400">
              <tr>
                <th className="p-4 font-semibold border-l border-white/5 w-16 text-center">م</th>
                <th className="p-4 font-semibold border-l border-white/5">الاسم</th>
                <th className="p-4 font-semibold border-l border-white/5 text-[#c70000]">رقم العضوية / الصفة</th>
                <th className="p-4 font-semibold border-l border-white/5">الفرع التابع له</th>
                <th className="p-4 font-semibold border-l border-white/5 text-center">النوع</th>
                <th className="p-4 font-semibold text-center text-green-500 border-l border-white/5">عدد المهام</th>
                <th className="p-4 font-semibold text-center text-orange-400">إجمالي الساعات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? <tr><td colSpan="7" className="p-8 text-center text-gray-500 font-bold">جاري حصر وتحليل الأفراد من المهام السابقة...</td></tr> : 
               filteredHR.length > 0 ? filteredHR.map((person, idx) => (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td className="p-4 text-gray-500 font-bold border-l border-white/5 text-center">{idx + 1}</td>
                  <td className="p-4 text-white font-bold border-l border-white/5">{person.full_name}</td>
                  <td className="p-4 text-[#c70000] font-mono font-bold border-l border-white/5">{person.membership_number}</td>
                  <td className="p-4 text-gray-300 border-l border-white/5">{person.branch_name === 'القاهرة' ? 'المركز العام' : person.branch_name}</td>
                  <td className="p-4 border-l border-white/5 text-center">
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold ${person.participant_type === 'volunteer' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-gray-600/20 text-gray-400 border border-gray-600/30'}`}>
                      {person.participant_type === 'volunteer' ? 'متطوع' : 'غير متطوع'}
                    </span>
                  </td>
                  <td className="p-4 border-l border-white/5 text-center">
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${person.missions_count >= 5 ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-[#111] text-gray-300 border border-white/10'}`}>
                      {person.missions_count} مهمة
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${person.total_hours > 0 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-[#111] text-gray-500 border border-white/10'}`}>
                      {person.total_hours} ساعة
                    </span>
                  </td>
                </tr>
              )) : <tr><td colSpan="7" className="p-8 text-center text-gray-500">لا توجد بيانات مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}