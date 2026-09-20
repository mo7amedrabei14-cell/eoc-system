import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Fragment, memo, Component } from 'react';
import { createPortal } from 'react-dom'; // ✅ createPortal يُصدَّر من react-dom (وليس react) في React 19
import { useNavigate } from 'react-router-dom';
import EocSelect from './components/EocSelect';
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// ⏰ وحدة الزمن الموحّدة — العرض 12 ساعة فقط، الآلة 24 ساعة (راجع timeutils.js)
import { normTime, formatTime12, formatDateTime12 } from './timeutils';
import { SegDateField, SegTimeField, SegDateTimeField } from './SegInputs';
import { translate } from './i18n.js';

// 🔧 Module-level API base. Must be declared here (module scope), NOT inside a
// component's effect: MissionsView's live modal-sync effect fetches
// `${BASE}/api/missions/...` from its own scope, and a local `const BASE`
// inside Dashboard's radar effect caused `ReferenceError: BASE is not defined`
// → React 18 unmounts the whole tree (no error boundary) → blank page.
const BASE = 'https://eoc-system-b12f.vercel.app';

const getBrowserStorages = () => {
  const storages = [];
  for (const name of ['sessionStorage', 'localStorage']) {
    try {
      const storage = globalThis[name];
      if (storage) storages.push(storage);
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }
  return storages;
};

const getStoredAccessToken = () => {
  for (const storage of getBrowserStorages()) {
    try {
      const token = storage.getItem('access_token');
      if (typeof token === 'string' && token.trim() !== '') return token;
    } catch {
      // Continue to the next storage area if access is denied.
    }
  }
  return null;
};

const getStoredAuth = () => {
  for (const storage of getBrowserStorages()) {
    try {
      const userStr = storage.getItem('user');
      const token = storage.getItem('access_token');
      if (!userStr || typeof token !== 'string' || token.trim() === '') continue;
      const user = JSON.parse(userStr);
      if (user && typeof user === 'object' && !Array.isArray(user)) {
        return { user, token };
      }
    } catch {
      // Ignore inaccessible or malformed browser storage without exposing its contents.
    }
  }
  return null;
};

const clearStoredAuth = () => {
  for (const storage of getBrowserStorages()) {
    try {
      storage.removeItem('access_token');
      storage.removeItem('user');
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }
};

const getRoleFlags = (user) => {
  const userRole = user?.role?.toUpperCase() || 'VOLUNTEER';
  const isOwner = user?.is_global_admin === true || userRole === 'OWNER' || userRole === 'المالك';
  const isSupervisor = ['MANAGER', 'SUPERVISOR', 'ADMIN'].includes(userRole) || userRole === 'مشرف';
  const isJoker = userRole === 'JOKER' || userRole === 'جوكر';
  const isVolunteer = !isOwner && !isSupervisor && !isJoker;
  const weatherEligible = !['VOLUNTEER', 'متطوع'].includes(userRole);
  return { userRole, isOwner, isSupervisor, isJoker, isVolunteer, weatherEligible };
};

class WeatherIntelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card-surface p-8 text-center rounded-3xl border border-[var(--border)]">
          <h3 className="text-xl font-bold text-white mb-2">تعذر عرض استخبارات الطقس / Weather Intelligence unavailable</h3>
          <p className="text-[var(--muted)]">حدث خطأ أثناء عرض الوحدة. يمكنك العودة إلى لوحة العمليات أو إعادة المحاولة.</p>
          <p className="text-[var(--muted)] text-sm mt-1">The dashboard remains available; return to Operations or try another tab.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// 🚀 أرصفة الذاكرة (React.memo): العروض الثقيلة تُعاد رسمها فقط عندما تتغير قيم بروبسها الفعلية.
// بهذا لا يجرّ تبديل الثيم (الذي يغيّر data-theme فقط) إعادة رسم الجداول الثقيلة مثل شبكة الطقس
// (27 محافظة × 12 خلية) — يبقى التنقل بين الدارك والفاتح ناعماً بلا عمليات إعادة رسم بلا داعٍ.
const MemoHomeView = memo(HomeView);
const MemoBranchesAndInventoryView = memo(BranchesAndInventoryView);
const MemoMissionsView = memo(MissionsView);
const MemoAuditLogsView = memo(AuditLogsView);
const MemoLocalNewsView = memo(LocalNewsView);
const MemoWeatherForecastView = memo(WeatherForecastView);
const MemoHandoverView = memo(HandoverView);
const MemoGlobalDisastersView = memo(GlobalDisastersView);
const MemoEarthquakesView = memo(EarthquakesView);
const MemoAINewsMonitorView = memo(AINewsMonitorView);
const MemoHumanResourcesView = memo(HumanResourcesView);
const MemoWeatherIntelView = memo(WeatherIntelView);

// Static dashboard labels are kept in Arabic in the existing screens.  This
// table lets the whole dashboard share Login.jsx's language choice without
// changing API values, form values, or exported data.
const ENGLISH_UI = {
  'رصد آلي جديد (AI) 🤖': 'New AI detection 🤖',
  'الذكاء الاصطناعي وجد خبراً جديداً': 'AI found a new report',
  'تحديث بواسطة:': 'Updated by:',
  'إجراء:': 'Action:',
  'مؤشرات الغرفة': 'Operations overview',
  'رصد الذكاء الاصطناعي': 'AI monitoring',
  'سجل المهام الميدانية': 'Field missions',
  'سجل القوة البشرية': 'Workforce register',
  'سجل الأخبار المحلية': 'Local news register',
  'رصد الكوارث العالمية': 'Global disaster monitoring',
  'مركز رصد الزلازل': 'Earthquake monitoring center',
  'الفروع والمخزون الاستراتيجي': 'Branches & strategic inventory',
  'سجل النظام': 'System log',
  'تسليم وتسلم مشرفين': 'Supervisors handover',
  'سجل التسليمات': 'Handover log',
  'إنشاء تسليم يومي': 'Create daily handover',
  'تنزيل السجل الشامل': 'Download comprehensive log',
  'تنزيل سجل تسليم': 'Download handover record',
  'إنشاء تسليم': 'Create handover',
  'تعديل تسليم': 'Update handover',
  'حذف تسليم': 'Delete handover',
  'إنهاء الجلسة الآمنة': 'End secure session',
  'خروج': 'Log out',
  'سيتم حذف جميع بيانات المهام نهائياً. هذا الإجراء لا يمكن التراجع عنه.': 'All mission data will be permanently deleted. This action cannot be undone.',
  'سيتم حذف جميع الأخبار المحلية نهائياً. هذا الإجراء لا يمكن التراجع عنه.': 'All local news will be permanently deleted. This action cannot be undone.',
  'سيتم حذف جميع الكوارث العالمية نهائياً. هذا الإجراء لا يمكن التراجع عنه.': 'All global disasters will be permanently deleted. This action cannot be undone.',
  'سيتم حذف جميع سجلات الزلازل المصرية والعالمية نهائياً. هذا الإجراء لا يمكن التراجع عنه.': 'All Egyptian and global earthquake records will be permanently deleted. This action cannot be undone.',
  'موجز عمليات اليوم': 'Today’s operations brief',
  'إدارة المهام الميدانية': 'Field mission management',
  'الانتشار الجغرافي والمخزون': 'Geographic coverage & inventory',
  'سجل النظام والعمليات (مراقب)': 'System and operations log (monitor)',
  'مركز عمليات الطوارئ (EOC)': 'Emergency Operations Center (EOC)',
  'تفعيل الوضع الفاتح': 'Enable light mode',
  'تفعيل الوضع الداكن': 'Enable dark mode',
  'المالك': 'Owner',
  'مشرف': 'Supervisor',
  'جوكر': 'Joker',
  'نظام': 'System',
  'تحديث': 'Update',
  'غير محدد': 'Unspecified',
  'بدون عنوان': 'No address',
  'المركز الرئيسي للعمليات': 'Main operations center',
  'الرؤية الشاملة للوضع الميداني والزلزالي (على مستوى الجمهورية)': 'National overview of field operations and seismic activity',
  'المؤشرات الحية لفرع/محافظة:': 'Live indicators for branch/governorate:',
  'المركز العام (القاهرة)': 'Headquarters (Cairo)',
  'إقليم المركز العام': 'Headquarters (and affiliated branches)',
  'المركز العام': 'Headquarters',
  'القاهرة': 'Cairo',
  'إحصائيات يوم:': 'Statistics for:',
  'عرض الكل': 'Show all',
  'إلغاء التحديد (عرض الجمهورية)': 'Clear selection (national view)',
  'إلغاء التحديد': 'Clear selection',
  'المهام اليومية (نشطة)': 'Daily missions (active)',
  'المهام المفتوحة': 'Open missions',
  'الأخبار المحلية المرصودة': 'Monitored local news',
  'استجابة': 'responses',
  'الكوارث العالمية': 'Global disasters',
  'الزلازل العالمية (اليوم)': 'Global earthquakes (today)',
  'زلازل مصر المرصودة': 'Monitored Egypt earthquakes',
  'خريطة الانتشار التفاعلية الفروع (انقر للفلترة أو إلغاء التحديد)': 'Interactive branch map (click to filter or clear)',
  'مفعل (انقر للإلغاء)': 'Active (click to clear)',
  'انقر للفلترة': 'Click to filter',
  'بيانات تمركز:': 'Deployment data:',
  'البيانات الكلية (على مستوى الجمهورية)': 'National totals',
  'قائمة التمركزات': 'Deployment list',
  'الأرصدة اللوجستية والفنية': 'Logistics and technical inventory',
  'إجمالي شنط الإسعاف': 'Total first-aid kits',
  'شنطة مجهزة': 'equipped kit',
  'أجهزة اتصال لاسلكي': 'Radio communication devices',
  'جهاز نشط': 'active device',
  'مخزون الإيواء': 'Shelter stock',
  'خيمة وبطانية': 'tents and blankets',
  'أسطول السيارات (شامل الإسعاف)': 'Vehicle fleet (including ambulances)',
  'سيارة جاهزة': 'ready vehicle',
  'الفرع / التمركز': 'Branch / deployment',
  'سيارات': 'Vehicles',
  'إسعاف': 'Ambulances',
  'خيم': 'Tents',
  'بطاطين': 'Blankets',
  'مراتب': 'Mattresses',
  'ملايات': 'Bed sheets',
  'مخدات': 'Pillows',
  'حصر': 'Mats',
  'تنك مياه': 'Water tanks',
  'بستلة': 'Buckets',
  'جركن': 'Jerrycans',
  'شنط إسعاف': 'First-aid kits',
  'نقالات': 'Stretchers',
  'مستشفى ميداني': 'Field hospital',
  'بنك دم': 'Blood bank',
  'لاسلكي تترا': 'TETRA radio',
  'لاسلكي هواوي': 'Huawei radio',
  'طفايات': 'Fire extinguishers',
  'مكن تطهير': 'Disinfection machines',
  'بخاخات': 'Sprayers',
  'خوذ': 'Helmets',
  'فيستات': 'Vests',
  'كابات': 'Caps',
  'نظارات': 'Goggles',
  'بوت': 'Boots',
  'آيس بوكس': 'Ice boxes',
  'فرق إسعافات': 'First-aid teams',
  'متطوعين إسعافات': 'First-aid volunteers',
  'فرق طوارئ': 'Emergency teams',
  'متطوعين طوارئ': 'Emergency volunteers',
  'فرق دعم نفسي': 'Psychosocial support teams',
  'متطوعين دعم نفسي': 'Psychosocial support volunteers',
  'فرق توعية': 'Awareness teams',
  'متطوعين توعية': 'Awareness volunteers',
  'مدربين (مركز عام)': 'Trainers (headquarters)',
  'مدربين (فرع)': 'Trainers (branch)',
  'إصحاح بيئي': 'WASH',
  'تأكيد الحذف': 'Confirm deletion',
  'هل أنت متأكد من حذف هذه المهمة نهائياً؟': 'Are you sure you want to permanently delete this mission?',
  'سيتم حذف جميع أخبار ورصد الذكاء الاصطناعي نهائياً. هذا الإجراء لا يمكن التراجع عنه.': 'All AI-monitored news will be permanently deleted. This action cannot be undone.',
  'إلغاء': 'Cancel',
  'نعم، احذف': 'Yes, delete',
  'نعم، احذف الكل': 'Yes, delete all',
  'سجل متابعة المهام': 'Mission tracking register',
  'حساب إداري | الصلاحية: كل الأقاليم': 'Administrative account | access: all regions',
  'كل المهام': 'All missions',
  'المهام العادية': 'Regular missions',
  'كل الأقاليم': 'All regions',
  'إقليم القنال': 'Canal region',
  'إقليم الدلتا': 'Delta region',
  'إقليم الصعيد': 'Upper Egypt region',
  'إلغاء التاريخ': 'Clear date',
  'السجل': 'Register',
  'تصدير': 'Export',
  '+ إنشاء مهمة': '+ Create mission',
  'بحث سريع باسم المهمة، المكان، الكود، أو نوع المهمة...': 'Quick search by mission name, location, code, or type...',
  'خط السير الأساسي': 'Main itinerary',
  'خط سير مخصص': 'Custom itinerary',
  'عادية': 'Regular',
  'مفتوحة': 'Open',
  'نشطة الآن': 'Active now',
  'مكتملة': 'Completed',
  'مسودة': 'Draft',
  'نشطة': 'Active',
  'قيد المراجعة': 'Under review',
  'معتمدة (بانتظار الانتهاء)': 'Approved (awaiting completion)',
  'إرجاع للمتطوع': 'Returned to volunteer',
  'ملغاة': 'Cancelled',
  'التاريخ': 'Date',
  'المحافظة': 'Governorate',
  'الفرع': 'Branch',
  'إجراءات': 'Actions',
  'المهام': 'Missions',
  'الأخبار المحلية': 'Local news',
  'الزلازل': 'Earthquakes',
  'لا توجد سجلات مطابقة للبحث': 'No records match your search',
  'جاري سحب السجلات السرية...': 'Loading secure records...',
  'سجل العمليات والنشاط': 'Operations and activity log',
  'ابحث بالاسم أو نوع الإجراء...': 'Search by name or action type...',
  'نوع الإجراء': 'Action type',
  'تفاصيل العملية (ماذا حدث؟)': 'Operation details (what happened?)',
  'إجمالي الحوادث المسجلة': 'Total logged incidents',
  'تم الإبلاغ عنها': 'Reported',
  'بلاغات تم الرد عليها': 'Reports responded to',
  'استجابة ميدانية (تحرك)': 'Field response (mobilized)',
  'متوسط نقاط الاستجابة': 'Average response score',
  'كل المحافظات': 'All governorates',
  'كل الحوادث': 'All incidents',
  'تصدير السجل': 'Export register',
  '+ إضافة خبر': '+ Add news report',
  'وصف الحادث': 'Incident description',
  'نقاط (رد/تحرك/وصول)': 'Points (response/movement/arrival)',
  'المتطوعين': 'Volunteers',
  'مدخل الخبر': 'News entry user',
  'جاري التحميل...': 'Loading...',
  'نقاط الرد': 'Response points',
  'نقاط التحرك': 'Movement points',
  'نقاط الوصول': 'Arrival points',
  'فتح الرابط': 'Open link',
  'لا توجد أخبار مطابقة للفلاتر': 'No news matches the filters',
  'تعديل الخبر والمؤشرات': 'Edit news report and indicators',
  'إضافة خبر جديد': 'Add new report',
  '1. بيانات الخبر الأساسية': '1. Basic news information',
  'التاريخ (مطلوب)': 'Date (required)',
  'الشهر (تلقائي)': 'Month (automatic)',
  'نوع الخبر (مطلوب)': 'News type (required)',
  'اختر نوع الحادث...': 'Select incident type...',
  'وصف الحادث (مطلوب)': 'Incident description (required)',
  'ناشر الخبر': 'News publisher',
  'المحافظة (مطلوب)': 'Governorate (required)',
  'اختر المحافظة...': 'Select governorate...',
  'المنطقة': 'Area',
  'الشارع': 'Street',
  '2. الإبلاغ والرد (تقييم السرعة)': '2. Reporting and response (speed assessment)',
  'تم الإبلاغ؟': 'Reported?',
  'نعم': 'Yes',
  'لا': 'No',
  'توقيت الإرسال': 'Report time',
  'تم الرد؟': 'Responded?',
  'توقيت الرد': 'Response time',
  'رد الفرع': 'Branch response',
  'زمن الرد (تلقائي)': 'Response time (automatic)',
  '3. الاستجابة الميدانية': '3. Field response',
  'تم التحرك؟': 'Mobilized?',
  'توقيت التحرك': 'Movement time',
  'توقيت الوصول للميدان': 'Field arrival time',
  'المسافة بالكيلومتر': 'Distance in kilometers',
  'نوع التدخل': 'Intervention type',
  'الفرع المتدخل': 'Responding branch',
  'اسم الاستمارة': 'Form name',
  'عدد المشاركين': 'Participant count',
  '4. تفاصيل الحادث': '4. Incident details',
  'اسم المستشفى': 'Hospital name',
  'عدد المصابين': 'Injured count',
  'عدد الوفيات': 'Fatality count',
  'تطورات الخبر': 'News updates',
  'لينك الخبر': 'News link',
  'اسم مدخل الخبر': 'News entry user',
  'ملاحظات': 'Notes',
  'حفظ': 'Save',
  'تنبيه': 'Alert',
  'حسناً': 'OK',
  'الزلازل العالمية': 'Global earthquakes',
  'زلازل مصر': 'Egypt earthquakes',
  'إضافة زلزال عالمي': 'Add global earthquake',
  'إضافة زلزال محلي': 'Add local earthquake',
  'آخر تحديث': 'Last update',
  'القوة (ريختر)': 'Magnitude (Richter)',
  'العمق': 'Depth',
  'الموقع': 'Location',
  'الدولة': 'Country',
  'المصدر': 'Source',
  'رصد زلزال محلي (مصر)': 'Log local earthquake (Egypt)',
  'تعديل زلزال مصر': 'Edit Egypt earthquake',
  'التوقيت': 'Time',
  'المنطقة داخل مصر': 'Area within Egypt',
  'القوة (ريختر) - إلزامي': 'Magnitude (Richter) - required',
  'العمق (سيتم إضافة KM آلياً)': 'Depth (KM added automatically)',
  'مثال: 10': 'Example: 10',
  'استعلامات الذكاء الاصطناعي (OSINT God-Mode)': 'AI intelligence (OSINT God-Mode)',
  'استخبارات الذكاء الاصطناعي (OSINT God-Mode)': 'AI intelligence (OSINT God-Mode)',
  'رصد تكتيكي حي وتحليل استراتيجي من السوشيال ميديا والمواقع الإخبارية.': 'Live tactical monitoring and strategic analysis of social media and news sites.',
  'الروبوت نشط (دوريات المسح تعمل)': 'Robot active (scanning patrols running)',
  'آخر فحص:': 'Last scan:',
  'إجمالي الأخبار المرصودة': 'Total monitored reports',
  'الدول المرصودة': 'Monitored countries',
  'خريطة الرصد اللحظي للذكاء الاصطناعي': 'AI real-time monitoring map',
  'إلغاء الفلترة (عرض كل الأخبار)': 'Clear filter (show all news)',
  'خطورة:': 'Severity:',
  'لا توجد صورة': 'No image available',
  'حادث': 'Incident',
  'انقر لفلترة الجدول': 'Click to filter the table',
  'الكل': 'All',
  'إطلاق الرادار': 'Launch radar',
  'جاري المسح...': 'Scanning...',
  'نوع الخبر': 'News type',
  'الناشر': 'Publisher',
  'لا يوجد وصف': 'No description',
  'فتح مصدر الخبر': 'Open news source',
  'قراءة التقرير الاستخباراتي': 'Read intelligence report',
  'حذف السجل': 'Delete record',
  'لا توجد أخبار مطابقة...': 'No matching news...',
  'التقرير الاستخباراتي (OSINT)': 'Intelligence report (OSINT)',
  'التقرير الاستراتيجي الميداني': 'Field strategic report',
  'لا يوجد تقرير متاح لهذا الحدث.': 'No report is available for this event.',
  'صورة الحدث': 'Event image',
  'تفاصيل الرصد': 'Monitoring details',
  'المحافظة (الفرع)': 'Governorate (branch)',
  'وصف الحادث (الملخص)': 'Incident description (summary)',
  'لينك الخبر الأصلي': 'Original news link',
  'إغلاق التقرير': 'Close report',
  'رسالة النظام': 'System message',
  'علم': 'Got it',
  'سجل القوة البشرية الفعالة (إدارة المتطوعين)': 'Active workforce register (volunteer management)',
  'يتم استخراج البيانات تلقائياً من المهام الميدانية بدون تكرار، وربط المتطوع بعدد مشاركاته وساعاته الفعلية ووضعه الحالي لحظياً.': 'Data is automatically compiled from field missions without duplication and linked to each volunteer’s participation count, actual hours, and live current status.',
  'إجمالي القوة (بدون تكرار)': 'Total workforce (unique)',
  'إجمالي المتطوعين': 'Total volunteers',
  'إجمالي المتطوعين الفعليين': 'Total active volunteers',
  'مشاركين خارجيين (غير متطوع)': 'External participants (non-volunteers)',
  'متطوعين شاركوا +5 مهام': 'Volunteers with 5+ missions',
  'بحث بالاسم أو الكود...': 'Search by name or ID...',
  'كل الفروع والتمركزات': 'All branches and deployments',
  'الكل (متطوع وغير متطوع)': 'All (volunteer and non-volunteer)',
  'متطوعين فقط': 'Volunteers only',
  'غير متطوعين': 'Non-volunteers',
  'تصدير سجل القوة البشرية': 'Export workforce register',
  'متاح': 'Available',
  'يعتمد على حالة الـ Database لحظياً': 'Depends on the live Database state',
  'تحديث لحظي...': 'Realtime update...',
  'م': '#',
  'الاسم': 'Name',
  'رقم العضوية / الصفة': 'Membership number / role',
  'صفة المشارك': 'Participant Designation',
  'الفرع التابع له': 'Affiliated branch',
  'النوع': 'Type',
  'عدد المهام': 'Mission count',
  'إجمالي الساعات': 'Total hours',
  'جاري حصر وتحليل الأفراد من المهام السابقة...': 'Compiling and analysing personnel from previous missions...',
  'متطوع': 'Volunteer',
  'غير متطوع': 'Non-volunteer',
  'مهمة': 'mission',
  'ساعة': 'hour',
  'قيد الحصر': 'Calculating',
  'لا مشاركات': 'No missions',
  'لا توجد مشاركات ميدانية سابقة': 'No previous field participation',
  'يوجد مهام بدون تاريخ انتهاء محسوب — المدة لم تُحتسب بعد': 'Missions present but hours not calculated yet',
  'لا توجد بيانات مطابقة': 'No matching data',
  'توثيق مهمة ميدانية': 'Document field mission',
  'اسم الاستمارة (عنوان رئيسي)': 'Form name (main title)',
  'مثال: تأمين مول...': 'Example: mall security...',
  'كود الاستمارة': 'Form code',
  'لا يمكن تعديله (للمالك فقط)': 'Only the owner can edit this',
  'البيانات الأساسية للمهمة': 'Mission basic information',
  'تصنيف المهمة': 'Mission classification',
  'مهمة عادية': 'Regular mission',
  'مهمة مفتوحة': 'Open mission',
  'التمركز / الفرع': 'Deployment / branch',
  'نوع المهمة': 'Mission type',
  'مكان المهمة': 'Mission location',
  'حالة العملية الميدانية': 'Field operation status',
  'نشطة (لم تنتهي بعد)': 'Active (not yet completed)',
  'مكتملة (تم الانتهاء)': 'Completed',
  'مسؤول المهمة': 'Mission lead',
  'تاريخ الإنشاء (يسجل آلياً)': 'Creation date (recorded automatically)',
  'مصدر البلاغ': 'Report source',
  'واتساب': 'WhatsApp',
  'واتساب - هاتفياً': 'WhatsApp - Phone',
  'واتساب - هاتفياً - لاسلكي': 'WhatsApp - Phone - Radio',
  'واتساب - لاسلكي': 'WhatsApp - Radio',
  'هاتفياً - لاسلكي': 'Phone - Radio',
  'هاتفياً': 'Phone',
  'لاسلكي': 'Radio',
  'التواريخ والتوقيتات': 'Dates and times',
  'تاريخ المهمة': 'Mission date',
  'تاريخ الخروج': 'Departure date',
  'تاريخ الوصول للمكان': 'Arrival date',
  'تاريخ العودة': 'Return date',
  'تاريخ الانتهاء': 'Completion date',
  'ساعة البدء': 'Start time',
  'ساعة التحرك': 'Movement time',
  'ساعة الوصول': 'Arrival time',
  'ساعة الانتهاء': 'Completion time',
  'تفاصيل خط السير الأساسي': 'Main itinerary details',
  '+ إضافة مسار': '+ Add route',
  'لا يوجد خط سير': 'No itinerary',
  '+ تفعيل خط السير': '+ Enable itinerary',
  'إلى (الوجهة)...': 'To (destination)...',
  'ساعة التحرك:': 'Movement time:',
  'ساعة الوصول:': 'Arrival time:',
  'أيام المهمة / مسارات التحرك': 'Mission days / movement routes',
  'خطوط سير مخصصة (لفرق أو أفراد محددين)': 'Custom itineraries (for selected teams or people)',
  '+ إضافة يوم / مسار جديد': '+ Add day / route',
  '+ إضافة خط سير مخصص': '+ Add custom itinerary',
  'يرجى إضافة أيام المهمة أو المسارات...': 'Please add mission days or routes...',
  'لا يوجد خطوط سير مخصصة.': 'No custom itineraries.',
  'اكتب اسم اليوم (مثال: تحركات اليوم الأول)...': 'Enter the day name (e.g. first-day movements)...',
  'اكتب اسم خط السير المخصص هنا...': 'Enter the custom itinerary name here...',
  '+ مسار': '+ Route',
  'حذف المخصص': 'Delete custom itinerary',
  'الوجهة...': 'Destination...',
  'السيارات والسائقين (أسطول المهمة)': 'Vehicles and drivers (mission fleet)',
  '+ إضافة سيارة': '+ Add vehicle',
  'لا يوجد سيارات': 'No vehicles',
  '+ تفعيل أسطول السيارات': '+ Enable vehicle fleet',
  'القوة البشرية والمشاركين': 'Workforce and participants',
  '+ إضافة مشارك': '+ Add participant',
  'الفريق / الكود': 'Team / code',
  'المرحلة': 'Phase',
  'التواجد': 'Presence',
  'المسار': 'Route',
  'الحالة': 'Status',
  'كود الفريق/الإدارة': 'Team / Dept. code',
  'في مهمة حاليًا': 'On a mission now',
  'ليس في مهمة حاليًا': 'Not on a mission',
  'حالة المشاركة': 'Participation status',
  'الإشعارات اللحظية': 'Realtime notifications',
  'تحديد الكل كمقروء': 'Mark all as read',
  'لا توجد إشعارات بعد': 'No notifications yet',
  'ستظهر هنا كل التحديثات اللحظية': 'All live updates will appear here',
  'متصل': 'Connected',
  'جاري الاتصال': 'Connecting…',
  'حقل مستقل عن المشاركين، يُحفظ ويُسترجَع تلقائياً مع كل مهمة.': 'Separate from participants; saved & restored with the mission.',
  'حذف': 'Delete',
  'الاسم...': 'Name...',
  'اليوم الأول': 'First day',
  'ذهاب وعودة': 'Round trip',
  'بالمهمة': 'On mission',
  'مازال بالمهمة': 'Still on mission',
  'تم انتهاء مهمتة': 'Mission completed',
  'مسؤول المتابعة': 'Follow-up lead',
  'المشرف': 'Supervisor',
  'المشرف المراجع': 'Review supervisor',
  'معبئ الاستمارة': 'Form preparer',
  'مستكمل الاستمارة': 'Form completer',
  'مراجع الاستمارة': 'Form reviewer',
  'الفريق': 'Team',
  'كود الفريق': 'Team code',
  'رقم السيارة': 'Vehicle number',
  'اسم السائق': 'Driver name',
  'المستفيدين': 'Beneficiaries',
  '+ إضافة مستفيد': '+ Add beneficiary',
  'التصنيف': 'Category',
  'مباشر': 'Direct',
  'غير مباشر': 'Indirect',
  'سجل الميدان': 'Field log',
  'ملاحظات داخلية': 'Internal notes',
  'حفظ كمسودة': 'Save as draft',
  'إرسال للمراجعة': 'Send for review',
  'اعتماد المهمة': 'Approve mission',
  'إنهاء المهمة': 'Complete mission',
  'إغلاق': 'Close',
  'حادث تصادم سيارات': 'Vehicle collision',
  'حادث غرق سفينة': 'Ship sinking',
  'حادث تصادم قطارات': 'Train collision',
  'حادث انقلاب قطار': 'Train derailment',
  'حادث انقلاب سيارة': 'Vehicle rollover',
  'حادث فقدان أشخاص في البحر': 'Missing persons at sea',
  'حادث تصادم سفن': 'Vessel collision',
  'انهيار مبنى تجاري': 'Commercial building collapse',
  'حريق مبنى سكني': 'Residential building fire',
  'حريق مبنى تجاري': 'Commercial building fire',
  'حريق مبنى صناعي': 'Industrial building fire',
  'حادث انفجار': 'Explosion',
  'انهيار مبنى صناعي': 'Industrial building collapse',
  'انهيار ارضي': 'Landslide',
  'حريق منطقة زراعية': 'Agricultural area fire',
  'حادث تسرب مواد كيميائية أو غازات سامة': 'Chemical or toxic-gas leak',
  'سيول': 'Flash floods',
  'فيضانات': 'Floods',
  'امطار غزيرة': 'Heavy rain',
  'زلزال': 'Earthquake',
  'انهيار مبنى سكني': 'Residential building collapse',
  'حادث دهس اشخاص': 'Pedestrian accident',
  'حريق مبنى طبي': 'Medical building fire',
  'انهيار مبنى طبي': 'Medical building collapse',
  'حريق مخزن': 'Warehouse fire',
  'حريق مزرعة': 'Farm fire',
  'حريق سيارة': 'Vehicle fire',
  'حريق مبنى ديني': 'Religious building fire',
  'حريق مبنى تعليمي': 'Educational building fire',
  'حادث تدافع': 'Crowd crush',
  'حريق مبنى رياضي': 'Sports facility fire',
  'حريق قطار': 'Train fire',
  'حادث تصادم سيارة بقطار': 'Car-train collision',
  'حادث تسمم': 'Poisoning incident',
  'حريق مبنى حكومي': 'Government building fire',
  'انهيار مبنى حكومي': 'Government building collapse',
  'انهيار مبنى ديني': 'Religious building collapse',
  'اليوم': 'Today',
  'جاري التحقق...': 'Checking...',
  'لا توجد بيانات': 'No data',
  'تعذر فتح الاستمارة': 'Couldn\'t open the form',
  'فشل تحميل بيانات الاستمارة من السيرفر.': 'Failed to load the form data from the server.',
  'تم إبقاء الاستمارة مفتوحة — أعد المحاولة أو تواصل مع المالك.': 'The form stays open — retry or contact the owner.',
  'رمز الخطأ:': 'Error code:',
  'خطأ في الاتصال بالخادم': 'Server connection error',
  'إعادة المحاولة': 'Retry',
  'غير متاح': 'Unavailable',
  'يناير': 'January',
  'فبراير': 'February',
  'مارس': 'March',
  'أبريل': 'April',
  'مايو': 'May',
  'يونيو': 'June',
  'يوليو': 'July',
  'أغسطس': 'August',
  'سبتمبر': 'September',
  'أكتوبر': 'October',
  'نوفمبر': 'November',
  'ديسمبر': 'December',
  'الإسكندرية': 'Alexandria',
  'الجيزة': 'Giza',
  'القليوبية': 'Qalyubia',
  'البحيرة': 'Beheira',
  'مطروح': 'Matrouh',
  'الإسماعيلية': 'Ismailia',
  'بورسعيد': 'Port Said',
  'السويس': 'Suez',
  'شمال سيناء': 'North Sinai',
  'جنوب سيناء': 'South Sinai',
  'الشرقية': 'Sharqia',
  'الغربية': 'Gharbia',
  'الدقهلية': 'Dakahlia',
  'كفر الشيخ': 'Kafr El Sheikh',
  'المنوفية': 'Monufia',
  'دمياط': 'Damietta',
  'الفيوم': 'Faiyum',
  'بني سويف': 'Beni Suef',
  'المنيا': 'Minya',
  'أسيوط': 'Assiut',
  'سوهاج': 'Sohag',
  'قنا': 'Qena',
  'الأقصر': 'Luxor',
  'أسوان': 'Aswan',
  'الوادي الجديد': 'New Valley',
  'البحر الأحمر': 'Red Sea',
  'مسح': 'Clear',
  'سجل متابعة المهام الميدانية الشامل': 'Comprehensive field mission tracking register',
  'تاريخ الإنشاء': 'Creation date',
  'فترة المهمة': 'Mission period',
  'كود المهمة': 'Mission code',
  'التمركز (الفرع)': 'Deployment (branch)',
  'اسم المهمة': 'Mission name',
  'السيارات والسائقين': 'Vehicles and drivers',
  'تاريخ التحرك': 'Movement date',
  'الإجراءات': 'Actions',
  'جاري السحب...': 'Loading...',
  'لا توجد مهام مطابقة': 'No matching missions',
  '🔄 عودة': '🔄 Return',
  '⛺ مبيت': '⛺ Overnight stay',
  'بدون خط سير': 'No itinerary',
  '📍 مازال بالمهمة': '📍 Still on mission',
  '🏠 تم انتهاء مهمتة': '🏠 Mission completed',
  '+ إضافة تصنيف': '+ Add category',
  'تصدير الاستمارة': 'Export form',
  'إرسال للجوكر': 'Send to Joker',
  'تم مراجعة المهمة (مستمرة)': 'Mission reviewed (in progress)',
  'إنهاء وإغلاق المهمة': 'Complete and close mission',
  'إلغاء الإغلاق (إعادة فتح)': 'Cancel closure (reopen)',
  'إرسال إلى الجوكر': 'Send to Joker',
  'إرجاع للتعديل': 'Return for editing',
  'إرسال التحديثات للجوكر': 'Send updates to Joker',
  'حفظ التعديلات (وهي مقفولة)': 'Save edits (while locked)',
  'إرجاع الاستمارة للمتطوع': 'Return form to volunteer',
  'برجاء كتابة سبب الإرجاع أو التعديلات المطلوبة بوضوح.': 'Please clearly state the reason for return or the requested changes.',
  'تأكيد الإرجاع': 'Confirm return',
  'تنبيه النظام': 'System alert',
  'علم، جاري التعديل': 'Got it, editing now',
  'اسم السائق:': 'Driver name:',
  'رقم السيارة:': 'Vehicle number:',
  'سجل الإجراءات الرقابية': 'Oversight action log',
  'سري للغاية': 'Top secret',
  'النظام': 'System',
  'التاريخ والوقت': 'Date and time',
  'القسم': 'Section',
  'اسم المستخدم': 'User name',
  'تصدير الخبر الحالي': 'Export current report',
  'حفظ الخبر وتقييم الأداء': 'Save report and evaluate performance',
  'تحميل السجل الشامل للكوارث': 'Download comprehensive disaster register',
  '+ رصد كارثة': '+ Log disaster',
  'الدولة / المكان': 'Country / location',
  'نوع الكارثة': 'Disaster type',
  'الخبر': 'Report',
  'الوفيات': 'Fatalities',
  'المصابين': 'Injured',
  'جاري تحميل البيانات...': 'Loading data...',
  'لا توجد كوارث مسجلة حالياً بهذا التاريخ': 'No disasters are recorded for this date',
  'اختر المكان...': 'Select location...',
  'اختر النوع...': 'Select type...',
  'تحميل سجل الكارثة': 'Download disaster register',
  'حفظ وتوثيق الكارثة': 'Save and document disaster',
  'هل أنت متأكد من حذف هذا الرصد نهائياً؟': 'Are you sure you want to permanently delete this record?',
  'خريطة الرصد (': 'Monitoring map (',
  'عالمي 🔴': 'Global 🔴',
  'مصر 🟢': 'Egypt 🟢',
  'إلغاء الفلترة': 'Clear filter',
  'عالمي': 'Global',
  'مصر': 'Egypt',
  'انقر لفلترة السجل': 'Click to filter the register',
  'سجل بيانات الزلازل': 'Earthquake data register',
  'تصدير العالمي': 'Export global',
  'استيراد شيت EMSC': 'Import EMSC sheet',
  '+ رصد عالمي': '+ Log global earthquake',
  'تصدير مصر': 'Export Egypt',
  '+ رصد زلزال مصر': '+ Log Egypt earthquake',
  'التاريخ / الوقت': 'Date / time',
  'الإحداثيات': 'Coordinates',
  'لا توجد زلازل عالمية': 'No global earthquakes',
  'المنطقة (مصر)': 'Area (Egypt)',
  'لا توجد زلازل مسجلة لمصر': 'No earthquakes recorded for Egypt',
  'اختر الدولة...': 'Select country...',
  'إجمالي المهام': 'Total filtered missions',
  'الكود': 'Code',
  'اليوم 1...': 'Day 1...',
  'إحصائيات المستفيدين': 'Beneficiary statistics',
  'تصنيف المستفيدين': 'Beneficiary category',
  'مثال: أطفال، مصابين...': 'Example: children, injured...',
  'مستفيدين (مباشر)': 'Direct beneficiaries',
  'مستفيدين (غير مباشر)': 'Indirect beneficiaries',
  'فريق إدارة الغرفة (الهيكل الإداري)': 'Operations room team (administrative structure)',
  'مسؤول المتابعة (قائد العملية)': 'Follow-up lead (operation commander)',
  'الاسم ورقم الهاتف...': 'Name and phone number...',
  'الجوكر': 'Joker',
  'الحالة والملاحظات العامة': 'Status and general notes',
  'موقف الاستمارة إدارياً وميدانياً (مغلق)': 'Administrative and field form status (locked)',
  'أسباب الإرجاع والتعديلات (مغلق)': 'Reasons for return and edits (locked)',
  'لا توجد ملاحظات إرجاع حالياً... (تُحذف تلقائياً عند الاعتماد أو الإغلاق)': 'No return notes currently... (automatically cleared upon approval or closure)',
  'الملاحظات والتحديثات (متاحة للجميع)': 'Notes and updates (available to everyone)',
  'اكتب هنا أي ملاحظات إضافية، تحديثات ميدانية متاحة للغرفة...': 'Enter any additional notes or field updates available to the room...',
  'مثال: يرجى استكمال بيانات السيارات...': 'Example: please complete the vehicle data...',
  'بحث باسم المستخدم...': 'Search by user name...',
  'حالة توقيت الرد (نقاط)': 'Response-time status (points)',
  '3. الاستجابة الميدانية والتحرك': '3. Field response and movement',
  'تمت الاستجابة؟': 'Response completed?',
  'المدة (إبلاغ ➔ تحرك)': 'Duration (report ➔ movement)',
  'طول المسافة (كم)': 'Distance (km)',
  'مثال: 15': 'Example: 15',
  'توقيت الوصول (أول متطوع)': 'Arrival time (first volunteer)',
  'الزمن المتوقع (تلقائي)': 'Expected time (automatic)',
  'نقاط الاستجابة للمسافة': 'Distance response points',
  '4. تفاصيل التدخل الميداني': '4. Field intervention details',
  'نوع الاستجابة': 'Response type',
  'اسم استمارة المهمة': 'Mission form name',
  '5. الملاحظات والمتابعة': '5. Notes and follow-up',
  'ملاحظات عامة': 'General notes',
  'لينك الخبر (إلزامي)*': 'News link (required)*',
  'إجمالي الكوارث المرصودة': 'Total monitored disasters',
  'الدول/المناطق المتضررة': 'Affected countries/areas',
  'إجمالي الوفيات المرصودة': 'Total monitored fatalities',
  'إجمالي المصابين': 'Total injured',
  'تعديل': 'Edit',
  'بيانات الكارثة الأساسية': 'Basic disaster information',
  'الدولة (مطلوب)': 'Country (required)',
  'نوع الكارثة (مطلوب)': 'Disaster type (required)',
  'الخبر (وصف مختصر)': 'Report (brief description)',
  'المناطق المتأثرة من الكارثة': 'Areas affected by disaster',
  'المناطق المتوقعة الخطر': 'Areas at risk',
  'الإصابات والتدخلات': 'Injuries and interventions',
  'عدد المفقودين': 'Missing count',
  'تدخلات الجمعيات ': 'National Society interventions',
  'التوثيق (إلزامي)': 'Documentation (required)',
  'الزلازل العالمية المرصودة': 'Monitored global earthquakes',
  'أقوى هزة / زلزال': 'Strongest tremor / earthquake',
  'Latitude (دوائر العرض)': 'Latitude',
  'Longitude (خطوط الطول)': 'Longitude',
  'الولايات المتحدة الأمريكية': 'United States',
  'المملكة المتحدة البريطانية': 'United Kingdom',
  'جمهورية الكونغو الديمقراطية': 'Democratic Republic of the Congo',
  'الكونغو': 'Republic of the Congo',
  'البوسنة والهرسك': 'Bosnia and Herzegovina',
  'جزر البهاما': 'Bahamas',
  'جمهورية إفريقيا الوسطى': 'Central African Republic',
  'جمهورية الدومينيكان': 'Dominican Republic',
  'غينيا الاستوائية': 'Equatorial Guinea',
  'كوريا الشمالية': 'North Korea',
  'سانت كيتس ونيفيس': 'Saint Kitts and Nevis',
  'سانت لوسيا': 'Saint Lucia',
  'سانت فنسنت وجزر غرينادين': 'Saint Vincent and the Grenadines',
  'بابوا غينيا الجديدة': 'Papua New Guinea',
  'ترينيداد وتوباغو': 'Trinidad and Tobago',
  'الإمارات العربية المتحدة': 'United Arab Emirates',
  'المحيط الهادي': 'Pacific Ocean',
  'المحيط الاطلسي': 'Atlantic Ocean',
  'المحيط الهندي': 'Indian Ocean',
  'القطب الجنوبي': 'Antarctica',
  'القطب الشمالي': 'Arctic',
  'البحر الكاريبي': 'Caribbean Sea',
  'البحر الابيض المتوسط': 'Mediterranean Sea',
  'البحر الاحمر': 'Red Sea',
  'البحر الأسود': 'Black Sea',
  'البحر الميت': 'Dead Sea',
  'الخليج الفارسي': 'Persian Gulf',
  'بحر الشمال': 'North Sea',
  'بحر العرب': 'Arabian Sea',
  'بحر إيجة': 'Aegean Sea',
  'بحر قزوين': 'Caspian Sea',
  'بحر البلطيق': 'Baltic Sea',
  'جبال الهند': 'Himalayas',
  'أنتاركتيكا': 'Antarctica',
  'جزيرة': 'Island',

  // ── أفعال/أحداث الـ backend (تنبعث في realtime + audit لوحة) — تُترجم نصاً نصاً في وضع الإنجليزية
  'إنشاء مهمة': 'Mission created',
  'تحديث/مراجعة': 'Update / review',
  'حذف مهمة': 'Mission deleted',
  'إنشاء خبر': 'News created',
  'تحديث خبر': 'News updated',
  'حذف خبر': 'News deleted',
  'رصد كارثة عالمية': 'Global disaster recorded',
  'تحديث كارثة عالمية': 'Global disaster updated',
  'حذف كارثة عالمية': 'Global disaster deleted',
  'رفع سجل زلازل': 'Earthquake log uploaded',
  'إضافة زلزال': 'Earthquake added',
  'تعديل زلزال': 'Earthquake edited',
  'رصد خبر آلي': 'AI news alert',
  'تحديث خبر آلي': 'AI news updated',
  'حذف خبر آلي': 'AI news deleted',
  'إجراء:': 'Action:',
  'الكل': 'All',
};

const translatedTextCache = new WeakMap();
const translatedAttributeCache = new WeakMap();
const ISO_REGION_CODES = 'AF,AL,DZ,AD,AO,AG,AR,AM,AU,AT,AZ,BS,BH,BD,BB,BY,BE,BZ,BJ,BT,BO,BA,BW,BR,BN,BG,BF,BI,CV,KH,CM,CA,CF,TD,CL,CN,CO,KM,CD,CG,CR,HR,CU,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FJ,FI,FR,GA,GM,GE,DE,GH,GR,GD,GT,GN,GW,GY,HT,HN,HU,IS,IN,ID,IR,IQ,IE,IL,IT,CI,JM,JP,JO,KZ,KE,KI,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MG,MW,MY,MV,ML,MT,MH,MR,MU,MX,FM,MD,MC,MN,ME,MA,MZ,MM,NA,NR,NP,NL,NZ,NI,NE,NG,KP,MK,NO,OM,PK,PW,PA,PG,PY,PE,PH,PL,PT,QA,RO,RU,RW,KN,LC,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SK,SI,SB,SO,ZA,KR,SS,ES,LK,SD,SR,SE,CH,SY,TJ,TZ,TH,TL,TG,TO,TT,TN,TR,TM,TV,UG,UA,AE,GB,US,UY,UZ,VU,VE,VN,YE,ZM,ZW,TW,GL,GU,AI,KY,GI,PR,GP,MQ,NC,PN,BM,JE,IM,BL,MF'.split(',');
const englishRegionNameCache = new Map();
const ENGLISH_UI_PREFIXES = [
  ['المؤشرات الحية لفرع/محافظة:', 'Live indicators for branch/governorate:'],
  ['بيانات تمركز:', 'Deployment data:'],
  ['تحديث بواسطة:', 'Updated by:'],
  ['إجراء:', 'Action:'],
  ['آخر فحص:', 'Last scan:'],
  ['🔥 خطورة:', '🔥 Severity:'],
  ['سيتم عرض مهام', 'Showing missions for'],
  ['تم تحديث مهمتك: ', 'Your mission was updated: '],
  ['تم إنهاء مهمتك: ', 'Your mission has ended: '],
];

function getEnglishRegionName(value) {
  if (englishRegionNameCache.has(value)) return englishRegionNameCache.get(value);

  try {
    const arabicNames = new Intl.DisplayNames(['ar'], { type: 'region' });
    const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const matchingCode = ISO_REGION_CODES.find((code) => arabicNames.of(code) === value);
    const translatedName = matchingCode ? englishNames.of(matchingCode) : null;
    englishRegionNameCache.set(value, translatedName);
    return translatedName;
  } catch {
    englishRegionNameCache.set(value, null);
    return null;
  }
}

function translateGeneratedUiText(value) {
  let translated = value;

  translated = translated
    .replace(/(\d+)\s*يوم/g, '$1 day')
    .replace(/(\d+)\s*ساعة/g, '$1 hour')
    .replace(/(\d+)\s*دقيقة/g, '$1 minute')
    .replace(/(\d+)\s*نقطة/g, '$1 point')
    .replace(/^من:/, 'From:')
    .replace(/^إلى:/, 'To:')
    .replace(/\(حتى الآن\.\.\.\)/g, '(to date...)')
    .replace(/^اليوم، الساعة\s*/, 'Today at ')
    .replace(/(\d{1,2}:\d{2})\s*ص$/u, '$1 AM')
    .replace(/(\d{1,2}:\d{2})\s*م$/u, '$1 PM');

  if (/^\d{1,2}\s/.test(translated) && translated.includes('، الساعة')) {
    Object.entries({
      'يناير': 'January', 'فبراير': 'February', 'مارس': 'March', 'أبريل': 'April',
      'مايو': 'May', 'يونيو': 'June', 'يوليو': 'July', 'أغسطس': 'August',
      'سبتمبر': 'September', 'أكتوبر': 'October', 'نوفمبر': 'November', 'ديسمبر': 'December',
    }).forEach(([arabic, english]) => { translated = translated.replace(arabic, english); });
    translated = translated.replace('، الساعة ', ' at ');
  }

  return translated;
}

function getEnglishUiText(value) {
  if (typeof value !== 'string') return value;
  const leadingWhitespace = value.match(/^\s*/)?.[0] || '';
  const trailingWhitespace = value.match(/\s*$/)?.[0] || '';
  const key = value.trim();
  const directTranslation = ENGLISH_UI[key];
  if (directTranslation) return `${leadingWhitespace}${directTranslation}${trailingWhitespace}`;

  const regionTranslation = getEnglishRegionName(key);
  if (regionTranslation) return `${leadingWhitespace}${regionTranslation}${trailingWhitespace}`;

  const prefixTranslation = ENGLISH_UI_PREFIXES.find(([arabicPrefix]) => key.startsWith(arabicPrefix));
  if (prefixTranslation) {
    const [arabicPrefix, englishPrefix] = prefixTranslation;
    const tail = key.slice(arabicPrefix.length);
    // نترجم أيضًا ما بعد البادئة (مثل: إجراء: حذف مهمة) حتى لا يبقى عربي في وضع الإنجليزية
    return `${leadingWhitespace}${englishPrefix}${localizeActionSuffix(tail)}${trailingWhitespace}`;
  }

  const generatedTranslation = translateGeneratedUiText(key);
  if (generatedTranslation !== key) return `${leadingWhitespace}${generatedTranslation}${trailingWhitespace}`;

  // أمان أخير: أي نص عربي يحوي مقاطع أفعال معروفة (action_text وغيرها) يُترجم جزئياً
  const suffixedTranslation = localizeActionSuffix(key);
  if (suffixedTranslation !== key) return `${leadingWhitespace}${suffixedTranslation}${trailingWhitespace}`;

  return value;
}

// 💡 ترجمة جُمل action_text الصادرة من الـ backend (نستبدل المقاطع العربية المعروفة
// بالإنجليزية في وضع الإنجليزية — والاسم/البيانات المدخلة تبقى كما هي لأنها بيانات وليست نص واجهة).
function localizeActionSuffix(value) {
  if (typeof value !== 'string' || !value) return value;
  const PAIRS = [
    ['قام بإنشاء استمارة جديدة بكود: ', 'Created a new form with code: '],
    ['قام بتحديث الاستمارة أو تغيير حالتها إلى: ', 'Updated the form or changed its status to: '],
    ['قام بحذف الاستمارة رقم ', 'Deleted form #'],
    ['قام بإضافة خبر محلي جديد في منطقة: ', 'Added local news in area: '],
    ['قام بتحديث بيانات الخبر في منطقة: ', 'Updated news data in area: '],
    ['قام بحذف الخبر رقم ', 'Deleted news #'],
    ['قام برصد كارثة جديدة (', 'Recorded new disaster ('],
    ['قام بتحديث بيانات كارثة (', 'Updated disaster data ('],
    ['قام بحذف رصد الكارثة رقم ', 'Deleted disaster record #'],
    ['قام برفع ملف زلازل عالمية يحتوي على ', 'Uploaded a global earthquake file with '],
    ['أضاف زلزال عالمي بقوة ', 'Added a global earthquake of magnitude '],
    ['أضاف زلزال محلي (مصر) بقوة ', 'Added a local (Egypt) earthquake of magnitude '],
    ['عدّل بيانات زلزال عالمي بقوة ', 'Edited a global earthquake of magnitude '],
    ['عدّل بيانات زلزال محلي (مصر) بقوة ', 'Edited a local (Egypt) earthquake of magnitude '],
    ['محرك الذكاء الاصطناعي رصد خبراً جديداً (', 'AI engine detected new news ('],
    ['تم تحديث بيانات رصد الذكاء الاصطناعي للخبر رقم ', 'Updated AI news data for #'],
    ['تم حذف الرصد الآلي رقم ', 'Deleted AI detection #'],
    [' نهائياً من النظام', ' permanently'],
    [' نهائياً', ' permanently'],
    [' سجل', ' records'],
    [' في ', ' in '],
    [' بقوة ', ' of magnitude '],
    [' في: ', ' in: '],
    [') في: ', ') in: '],
    ['قام بإنشاء تسليم يومي بتاريخ ', 'Created a daily handover for date '],
    ['قام بتعديل تسليم يومي بتاريخ ', 'Updated a daily handover for date '],
    ['قام بحذف تسليم يومي بتاريخ ', 'Deleted a daily handover for date '],
    ['قام بتنزيل سجل تسليم يومي رقم ', 'Downloaded daily handover record #'],
    ['قام بتنزيل السجل الشامل لتسليمات المشرفين', 'Downloaded the comprehensive supervisors handover log'],
  ];
  let out = value;
  PAIRS.forEach(([ar, en]) => { out = out.split(ar).join(en); });
  return out;
}

// 💡 تفاصيل الإشعار (details) — نعرض الجملة النظيفة بدل JSON خام، ونترجمها في وضع الإنجليزية
function localizeMissionDetails(raw, language) {
  let d = raw;
  if (typeof d === 'string') {
    const t = d.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try { d = JSON.parse(t); } catch { /* ابقِه كنص */ }
    }
  }
  if (d === null || d === undefined || d === '') return d ?? '';
  if (typeof d === 'object') {
    if (d.action_text) return language === 'en' ? localizeActionSuffix(String(d.action_text)) : String(d.action_text);
    if (d.mission_name) return language === 'en' ? `Your mission was updated: ${d.mission_name}` : `تم تحديث مهمتك: ${d.mission_name}`;
    return raw; // حقل غير متوقع — نحافظ على القيمة الأصلية حتى لا نفقد معلومة
  }
  const s = String(d);
  return language === 'en' ? localizeActionSuffix(s) : s;
}

function getSelectedOptionSourceText(selectElement) {
  const selectedOption = selectElement?.options?.[selectElement.selectedIndex];
  return selectedOption?.dataset.i18nSource || selectedOption?.text || '';
}

function localizeDashboardDom(root, language) {
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let textNode;
  while ((textNode = textWalker.nextNode())) textNodes.push(textNode);

  textNodes.forEach((node) => {
    const current = node.nodeValue || '';
    const previous = translatedTextCache.get(node);
    const source = previous && current === previous.rendered ? previous.source : current;
    const rendered = language === 'en' ? getEnglishUiText(source) : source;
    if (current !== rendered) node.nodeValue = rendered;
    if (node.parentElement?.tagName === 'OPTION') {
      node.parentElement.dataset.i18nSource = source;
    }
    translatedTextCache.set(node, { source, rendered });
  });

  root.querySelectorAll('[placeholder], [title], [aria-label], [alt]').forEach((element) => {
    ['placeholder', 'title', 'aria-label', 'alt'].forEach((attribute) => {
      const current = element.getAttribute(attribute);
      if (current === null) return;
      const previous = translatedAttributeCache.get(element)?.[attribute];
      const source = previous && current === previous.rendered ? previous.source : current;
      const rendered = language === 'en' ? getEnglishUiText(source) : source;
      if (current !== rendered) element.setAttribute(attribute, rendered);
      translatedAttributeCache.set(element, {
        ...translatedAttributeCache.get(element),
        [attribute]: { source, rendered },
      });
    });
  });
}


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

// 💡 توحيد تنسيق "تاريخ + وقت" (متطلب #4/#8): العرض دائماً DD/MM/YYYY والوقت 12 ساعة
// AM/PM. يقبل قيم السيرفر بصورها المختلفة (مع أو بدون ثواني، تاريخ فقط) ويعرضها
// بثبات بدون أي تحويل للمنطقة الزمنية — يحافظ على التوقيت الذي يعمل به النظام.
// القاعدة العالمية: العرض 12 ساعة و DD/MM/YYYY — لا تُفهم DD/MM/YYYY أبداً كـ MM/DD/YYYY.
// التفويض لوحدة timeutils.js — نقاط العرض كلها تمر من هنا (تعديل واحد يغيّر الكل).
const formatDateTime = (val) => formatDateTime12(val);

/* ════════════════════════════════════════════════════════════════
   خريطة أساس حسب الثيم — World_Light_Gray في الفاتح / World_Dark_Gray في الداكن
   حتى لا تبقى الخريطة داكنة داخل وضع فاتح مضاء (مشكلة اتساق حقيقية)
   ════════════════════════════════════════════════════════════════ */
const baseMapUrl = (theme) =>
  theme === 'light'
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';

// 🎯 طبقة الخريطة بتتابع الثيم بنفسها (بدل ما تاخده Prop من الأب) عشان أي صفحة
// تقيلة فيها خريطة (المهام، الزلازل، الفروع، رصد الذكاء الاصطناعي) تقدر تستخدمها
// من غير ما تحتاج theme كـ Prop على مستوى الصفحة كلها - وده اللي كان بيلغي فايدة
// React.memo على الصفحات دي ويجبرها تعيد الرسم بالكامل (شبكات كبيرة وجداول) في كل
// مرة يتم فيها الضغط على زرار الدارك/لايت مود، وهو السبب الحقيقي وراء إحساس التهنيج.
function ThemedTileLayer() {
  const [localTheme, setLocalTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  useEffect(() => {
    const handler = () => setLocalTheme(document.documentElement.dataset.theme || 'dark');
    window.addEventListener('dashboard-theme-change', handler);
    return () => window.removeEventListener('dashboard-theme-change', handler);
  }, []);
  return <TileLayer url={baseMapUrl(localTheme)} />;
}

/* ════════════════════════════════════════════════════════════════
   Motion Primitives — أدوات حركة قابلة لإعادة الاستخدام
   • عداد رقمي متحرك (count-up) — transform/digit فقط، بلا jank
   • تأثير مغناطيسي خفيف للـ CTA — transform3d فقط، لا reflow
   ════════════════════════════════════════════════════════════════ */
function useAnimatedNumber(target) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = prevRef.current;
    if (from === target) { setDisplay(target); return undefined; }
    const start = performance.now();
    const dur = 520;
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * e);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else prevRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target]);
  return display;
}

function Magnetic({ children, strength = 0.2, className = '' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const handleMove = (e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: (e.clientX - (r.left + r.width / 2)) * strength,
      y: (e.clientY - (r.top + r.height / 2)) * strength * 0.45,
    });
  };
  const handleLeave = () => setPos({ x: 0, y: 0 });
  const moving = pos.x !== 0 || pos.y !== 0;
  return (
    <div
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{
        transform: `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`,
        transition: moving ? 'transform 90ms linear' : 'transform 0.4s var(--ease-out)',
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   خلية ساعات الميدان — معنى ذكي فوري:
   • ساعات فعلية         → رقم حي بتعداد + شريط قياس نسبي (ذهبي = قياس لا تحذير)
   • مهام بلا ساعات        → "قيد الحصر" (لا 0 زائف) — الحقيقة: لم تُحتسب بعد
   • لا مشاركات           → "—" لا مشاركات (لا 0 ساعة مضلّلة)
   ════════════════════════════════════════════════════════════════ */
function HoursCell({ person, maxHours, lang = 'ar' }) {
  const ar = lang !== 'en';
  const animated = useAnimatedNumber(person.total_hours > 0 ? person.total_hours : 0);
  const hasHours = person.total_hours > 0;
  const hasMissions = person.missions_count > 0;
  const scale = hasHours ? Math.max((person.total_hours / Math.max(maxHours, 1)) * 100, 2.5) : 0;

  if (!hasMissions) {
    return (
      <div className="hm" title={ar ? 'لا توجد مشاركات ميدانية سابقة' : 'No previous field participation'}>
        <div className="hm-main"><span className="hm-num hm-num--none">—</span></div>
        <div className="hm-track hm-track--none"><div className="hm-fill" /></div>
        <span className="hm-chip hm-chip--none">{ar ? 'لا مشاركات' : 'No missions'}</span>
      </div>
    );
  }
  if (!hasHours) {
    return (
      <div className="hm" title={ar ? 'يوجد مهام بدون تاريخ انتهاء محسوب — المدة لم تُحتسب بعد' : 'Missions present but hours not calculated yet'}>
        <div className="hm-main"><span className="hm-num hm-num--pend">0</span><span className="hm-unit">{ar ? 'ساعة' : 'hrs'}</span></div>
        <div className="hm-track hm-track--none"><div className="hm-fill" /></div>
        <span className="hm-chip hm-chip--pend">{ar ? 'قيد الحصر' : 'Calculating'}</span>
      </div>
    );
  }
  const avg = person.missions_count > 0 ? person.total_hours / person.missions_count : 0;
  return (
    <div className="hm" title={ar ? `إجمالي ${person.missions_count} مهمة · متوسط ${fmtHours(avg, 'ar')}/مهمة` : `${person.missions_count} missions · avg ${fmtHours(avg, 'en')}/mission`}>
      <div className="hm-main"><span className="hm-num">{fmtHours(animated, lang)}</span></div>
      <div className="hm-track"><div className="hm-fill" style={{ '--hm-scale': scale / 100 }} /></div>
    </div>
  );
}

// fix #3/#8: ساعة العميل المحلية "الآن" — الإطار المرجعي الذي تُخزَّن به أزمنة الجلسات (JOIN/LEAVE)
// تُرسل إلى الخادم مع طلبات GET/POST حتى تُقارن أوقات الجلسة بساعة العميل لا بساعة الخادم.
function clientNowLocal() {
  const d = new Date();
  return `${d.toLocaleDateString('sv')} ${d.toTimeString().slice(0, 5)}`;
}

// 🆕 تاريخ/وقت إنشاء المهمة (إصدار المستخدم) — مكوّنات محلية صافية YYYY-MM-DD HH:MM:SS
// تُلتقط مرة واحدة عند أول إنشاء الاستمارة (لا toISOString أبداً — قيمة بدون منطقة
// زمنية تُعرض كما هي، وإلا ستُنقل بياناتها لتتحرك مع منطقة السيرفر).
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 📅 تاريخ اليوم (YYYY-MM-DD) — يُلحق باسم كل ملف سجل يتم تنزيله (شامل وفردي على السواء)
function todayFileDate() {
  return isoLocal(new Date()).slice(0, 10);
}

// 📊 التنسيق الموحّد لكل ملفات الإكسيل المُصدَّرة في النظام:
//   - اتجاه الورقة RTL
//   - كل الخلايا متمركزة أفقياً وعمودياً (مع التفاف النص)
//   - صف العناوين: خلفية #cbcbcb بخط عريض
//   - حواف رفيعة صلبة على كل جوانب كل الخلايا
// العائلة المكتوبة في النظام (SheetJS CE 0.18.5) لا تكتب أنماط الخلايا إطلاقاً
// (source: xlsx.js write_ws_xml_cell → get_cell_style تُهمل cell.s تماماً) —
// لذلك نكتب الأنماط فعلياً عبر exceljs الذي يدعم RTL والتمركز والحدود والتعبئة.

// تحويل صفوف JSON (مصفوفة أشياء بنفس المفاتيح) إلى جدول {header, rows} موحّد
const gridFromRows = (objs) => {
  if (!objs || !objs.length) return { header: [], rows: [] };
  const header = Object.keys(objs[0]);
  return { header, rows: objs.map(o => header.map(h => (o[h] === undefined || o[h] === null ? '' : o[h]))) };
};

// 📦 تصدير مصنّف Excel منسّق — sheets: [{name, header, rows, merges?, widths?}]
const exportWorkbook = async (sheets, fileName) => {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'EOC System';
  const headerStyle = {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBCBCB' } },
    font: { bold: true },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const cellStyle = {
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  sheets.forEach(({ name, header = [], rows = [], merges = [], widths }) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
    if (header.length) ws.addRow(header).eachCell((c) => Object.assign(c, headerStyle));
    rows.forEach((r) => ws.addRow(r).eachCell((c) => Object.assign(c, cellStyle)));
    merges.forEach((m) => ws.mergeCells(m[0], m[1], m[2], m[3]));
    if (widths) ws.columns = widths.map((w) => ({ width: w }));
    else if (header.length) ws.columns = header.map(() => ({ width: 20 }));
  });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
};

// fix #5: عرض الساعات بالدقائق — الحساب يبقى دقيقًا (كسور داخلية)، والتحويل للدقائق عند العرض فقط.
// أمثلة: 0.75 → "45 دقيقة"/"45 min" · 1.33 → "1س 20د"/"1h 20m" · 2.083 → "2س 05د"/"2h 05m"
function fmtHours(hours, lang = 'ar') {
  if (hours == null || isNaN(Number(hours))) return '—';
  const totalMin = Math.round(Number(hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ar = lang !== 'en';
  const mm = String(m).padStart(2, '0');
  if (h === 0) return ar ? `${m} دقيقة` : `${m} min`;
  if (m === 0) return ar ? `${h}س` : `${h}h`;
  return ar ? `${h}س ${mm}د` : `${h}h ${mm}m`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const initialAuthRef = useRef(getStoredAuth());

  // 💡 1. نسحب اليوزر من اللحظة الأولى (Synchronous) عشان نمنع أي خطفة أو تحميل متأخر
  const [userData, setUserData] = useState(() => initialAuthRef.current?.user || null);

  // 💡 2. نحدد الشاشة الافتراضية بناءً على الرتبة فوراً بثبات
  const initialRoleFlags = getRoleFlags(initialAuthRef.current?.user);
  const [activeTab, setActiveTab] = useState(() => {
    const isLeader = initialAuthRef.current?.user?.is_global_admin || ['OWNER', 'المالك', 'MANAGER', 'SUPERVISOR', 'ADMIN', 'مشرف'].includes(initialRoleFlags.userRole);
    return isLeader ? 'home' : 'missions';
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [customAlert, setCustomAlert] = useState(null);

  useEffect(() => {
    if (!customAlert) return undefined;
    const timeout = setTimeout(() => setCustomAlert(null), 4000);
    return () => clearTimeout(timeout);
  }, [customAlert]);

const [theme, setTheme] = useState(() => {
  return localStorage.getItem('dashboard-theme') || 'dark';
});

useEffect(() => {
  // 🚀 السبب المتبقي للإحساس بالبطء: مئات العناصر في الصفحة بتعمل Transition
  // للونها/حدودها/ظلها في نفس اللحظة بالظبط لما data-theme يتغيّر — وده تكلفة على
  // مستوى المتصفح نفسه (رسم/تركيب) مش React، فمكانش هيتصلح بمجرد منع إعادة الرسم.
  // الحل: نجمّد كل الـ Transitions والأنيميشن لحظيًا وقت التبديل بس (كسر واحد للثانية
  // تقريبًا)، فيترسم الوضع الجديد فورًا بدل ما ننتظر مئات الانتقالات تتزامن مع بعض،
  // وبعدها نرجّعها زي ما هي عادي فورًا.
  const freezeStyle = document.createElement('style');
  freezeStyle.textContent = '*, *::before, *::after { transition: none !important; animation-duration: 0.001ms !important; }';
  document.head.appendChild(freezeStyle);

  localStorage.setItem('dashboard-theme', theme);
  // 🎯 الجذر الحقيقي للثيم: <html> يوصل data-theme لحديث CSS الجذري
  // (كل القواعد مكتوبة على :root[data-theme=...]) — بدونه كان الوضع الفاتح يبقى داكن فعلياً
  document.documentElement.dataset.theme = theme;
  // 🚀 حدث خفيف لأي عنصر معزول محتاج يعرف تغيّر الثيم (زي طبقة الخريطة) من غير
  // ما ناخده كـ Prop في مكوّنات تقيلة (بيلغي فايدة React.memo ويسبب تهنيج عند التبديل).
  window.dispatchEvent(new Event('dashboard-theme-change'));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      freezeStyle.remove();
    });
  });
}, [theme]);

  // Keep the selected language in sync with Login.jsx, so it survives navigation.
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('dashboard-language') || 'ar';
  });
  const dashboardRootRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('dashboard-language', language);
    // 🎯 مزامنة الجذر الحقيقي (html) مع اللغة: lang للقارئات + dir للمحرك
    // (بدونها بتفضل لغة الصفحة الحقيقية عكس ما يقرأه المستخدم في الشاشة)
    document.documentElement.lang = language === 'en' ? 'en' : 'ar';
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
  }, [language]);

  // ✨ توهّج الضوء (Lightswind signature) — مندوب pointermove على الجذر، حقن خفيف
  // لطبقة .spot-glow داخل كل .spot-card وضبط --spot-x/--spot-y عبر requestAnimationFrame
  useEffect(() => {
    const root = dashboardRootRef.current;
    if (!root) return;

    const spots = new Map(); // element -> glow div
    let raf = null;

    const applySpot = (el, x, y) => {
      el.style.setProperty('--spot-x', `${x}%`);
      el.style.setProperty('--spot-y', `${y}%`);
    };

    const onMove = (e) => {
      const t = e.target;
      const card = t.closest ? t.closest('.spot-card') : null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applySpot(card, x, y));
      // حقن طبقة التوهّج عند أول مرور (مرة واحدة لكل بطاقة)
      if (!spots.has(card)) {
        const glow = document.createElement('div');
        glow.className = 'spot-glow';
        card.appendChild(glow);
        spots.set(card, glow);
      }
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      spots.forEach((glow) => glow.remove());
      spots.clear();
    };
  }, []);

  useEffect(() => {
    const root = dashboardRootRef.current;
    if (!root) return undefined;

    const localize = () => localizeDashboardDom(root, language);
    localize();

    const observer = new MutationObserver(localize);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'],
    });

    return () => observer.disconnect();
  }, [language]);

  const [branchesList, setBranchesList] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({ active_missions: '-', ready_teams: '-', emergency_level: '-', under_review: '-', approved: '-', completed: '-', drafts: '-' });

  // 💡 1. حالات نظام الإشعارات والرادار (الجديدة)
  // 💡 1. حالات نظام الإشعارات والرادار (تم إضافة رصد الذكاء الاصطناعي)
  const [toasts, setToasts] = useState([]);
  // 🎬 طابور الإشعارات (واحد تلو الآخر):
  // - إشعار واحد فقط يظهر في النافذة المرئية في كل لحظة؛ الباقي ينتظر في الطابور
  //   مع عدّاد «+N إشعارات أخرى» للتخطّي السريع.
  // - كل توست يُختم بـ shownAt لحظة دخوله النافذة المرئية → ينقضي بعد TOAST_LIFETIME_MS
  //   ثم ينتقل الطابور للذي يليه (الخارج يلعب أنيميشن الـ TOAST_EXIT_MS بينما الجديد يستعد).
  // - dismissToast/closeAllToasts تضيف حالة closing فتلعب أنيميشن الخروج ثم يحذفه عدّاد
  //   التنظيف المركزي بعد TOAST_EXIT_MS — لا timers متضاربة، لا تكرار عمليات حذف.
  const MAX_VISIBLE_TOASTS = 1;
  const TOAST_LIFETIME_MS = 9000;
  const TOAST_EXIT_MS = 320;

  const dismissToast = (id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, closing: true, closingAt: Date.now() } : t));
  };

  const closeAllToasts = () => {
    setToasts(prev => prev.map(t => t.closing ? t : { ...t, closing: true, closingAt: Date.now() }));
  };

  // الضغط على «+N إشعارات أخرى»: يُخرج أقدم توست مرئي (أو يُظهر أول توست في الطابور) ليحلّ
  // الموضع التالي — فيتدفق الطابور للتقدّم بشكل سلس لا قطرة واحدة.
  const flowNextQueued = () => {
    setToasts(prev => {
      const shown = prev.find(t => !t.closing && t.shownAt);
      if (shown) return prev.map(t => t.id === shown.id ? { ...t, closing: true, closingAt: Date.now() } : t);
      const first = prev.find(t => !t.closing && !t.shownAt);
      if (first) return prev.map(t => t.id === first.id ? { ...t, shownAt: Date.now() } : t);
      return prev;
    });
  };

  // موجة انقضاء موحّدة: كل ~750ms نُعلّم المنقضي بـ closing، ونحذف المنتهي منه بعد أن تلعب
  // أنيميشن الخروج — الدفعة تنسحب معًا بدل التنقيط الواحد لملء الشاشة.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts(prev => {
        let mutated = false;
        const next = [];
        for (const t of prev) {
          if (t.closing) {
            // انتهاء أنيميشن الخروج → حذف نهائي (لا نفتح عدّاد 9 ثوانٍ جديد على المغلق)
            if (now - (t.closingAt ?? 0) >= TOAST_EXIT_MS) { mutated = true; continue; }
            next.push(t);
            continue;
          }
          if (t.shownAt && now - t.shownAt >= TOAST_LIFETIME_MS) { mutated = true; next.push({ ...t, closing: true, closingAt: now }); continue; }
          next.push(t);
        }
        return mutated ? next : prev;
      });
    }, 750);
    return () => clearInterval(interval);
  }, []);

  // ختم shownAt فور دخول التوست النافذة المرئية (أول MAX_VISIBLE_TOASTS غير المغلق):
  // يَضمن أن عدّاد الـ 9 ثوانٍ يبدأ من لحظة الظهور الفعلي، لا من لحظة وصوله للطابور.
  useEffect(() => {
    setToasts(prev => {
      let mutated = false;
      let visible = 0;
      const next = prev.map(t => {
        if (t.closing) return t;
        if (visible >= MAX_VISIBLE_TOASTS) return t;
        visible += 1;
        if (!t.shownAt) { mutated = true; return { ...t, shownAt: Date.now() }; }
        return t;
      });
      return mutated ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);
  const [newUpdates, setNewUpdates] = useState({ missions: false, local_news: false, global_disasters: false, earthquakes: false, audit: false, ai_news: false, handover: false, weather: false });
  // 🔄 عدّاد بيزيد كل مرة يوصل تحديث جديد لنوع بيانات معين، بنستخدمه عشان
  // الشاشة اللي فاتحة فعلاً (زي سجل المهام) تعمل Refetch لوحدها من غير ما المستخدم يعمل Refresh يدوي.
  const [liveUpdateVersion, setLiveUpdateVersion] = useState({ missions: 0, local_news: 0, global_disasters: 0, earthquakes: 0, ai_news: 0, audit: 0, handover: 0, weather: 0 });

  const { userRole, isOwner, isSupervisor, isJoker, isVolunteer, weatherEligible } = getRoleFlags(userData);

  // 💡 مركز الإشعارات الفوري (متطلب #5):
  // - Incremental polling بوسم تصاعدي (event_id) — من غير ما ننزل الـ audit_logs كاملة
  // - المستلم يتحدد من الـ backend بالـ user_id (مش مقارنة بالأسماء زي زمان)
  // - لا تداخل بين الطلبات / لا تكرار أحداث / تنظيف عند unmount / إعادة اتصال مع backoff
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifClosing, setNotifClosing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef(null);
  const bellRef = useRef(null);
  const notifCloseTimerRef = useRef(null);

  // 💡 لوحة الأوامر السريعة (⌘K / Ctrl+K) — Lightswind command-palette:
  // قفزة فورية بين وحدات التشغيل التي يسمح بها دور المستخدم + إجراءات سريعة،
  // تنقل كامل بالكيبورد (↑↓ Enter Esc) مع فلاتر ذكية.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef(null);
  const paletteBtnRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('');
      setPaletteIndex(0);
      const t = setTimeout(() => paletteInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [paletteOpen]);


  // 💡 إغلاق ذكي: ضغط خارج اللوحة أو زر Esc يغلقها بحركة خروج سلسة (لا تكرار مستمعين)
  const closeNotifPanel = useCallback(({ refocus = false } = {}) => {
    setNotificationsOpen((open) => {
      if (!open) return open;
      setNotifClosing(true);
      if (notifCloseTimerRef.current) clearTimeout(notifCloseTimerRef.current);
      notifCloseTimerRef.current = setTimeout(() => {
        setNotificationsOpen(false);
        setNotifClosing(false);
        if (refocus) bellRef.current?.focus();
        notifCloseTimerRef.current = null;
      }, 175);
      return open;
    });
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const onPointerDown = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) closeNotifPanel();
    };
    const onKey = (e) => { if (e.key === 'Escape') closeNotifPanel({ refocus: true }); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [notificationsOpen, closeNotifPanel]);

  useEffect(() => () => {
    if (notifCloseTimerRef.current) clearTimeout(notifCloseTimerRef.current);
  }, []);
  const [pulseMissions, setPulseMissions] = useState([]);
  const [liveMissionEvents, setLiveMissionEvents] = useState([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // 📶 مؤشر اتصال المتصفح (Offline/Online) — حالة حرجة في غرفة العمليات:
  // عند انقطاع النت نعرض شريطًا واضحًا، وعند عودته نقول "تتم استعادة الاتصال"
  // ثم نعود هادئين — كله عبر tokens (يعمل في الوضعين) وبدون كبح للحركة.
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [justReconnected, setJustReconnected] = useState(false);
  const reconnectedTimerRef = useRef(null);
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      if (reconnectedTimerRef.current) clearTimeout(reconnectedTimerRef.current);
      // «تتم استعادة الاتصال» لفترة قصيرة فقط ثم تختفي من تلقاء نفسها
      reconnectedTimerRef.current = setTimeout(() => setJustReconnected(false), 3200);
    };
    const goOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
      if (reconnectedTimerRef.current) clearTimeout(reconnectedTimerRef.current);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (isOnline) goOnline(); // في حال كانت آخر حالة محفوظة Online — شريط الاستعادة يختفي
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      if (reconnectedTimerRef.current) clearTimeout(reconnectedTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastEventIdRef = useRef(null);        // watermark تصاعدي
  const seenEventIdsRef = useRef(new Set());  // حماية من أي تكرار أثناء إعادة المحاولة
  const pollInFlightRef = useRef(false);      // لا تداخل بين الطلبات
  const pollBackoffRef = useRef(4000);        // backoff لإعادة الاتصال
  const realtimeUnmountedRef = useRef(false);

  // 💡 2. رادار الغرفة المركزية المتطور (قناة ريال تايم)
  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    if (!token || !userData) return;

    let pollTimer = null;
    realtimeUnmountedRef.current = false;
    pollBackoffRef.current = 4000;

    const notifyRealtime = (e) => {
      if (!e || !e.event_id) return;
      // منع التكرار (لو وقع retry بعد فشل شبكة مثلاً)
      if (seenEventIdsRef.current.has(e.event_id)) return;
      seenEventIdsRef.current.add(e.event_id);
      if (seenEventIdsRef.current.size > 2000) {
        seenEventIdsRef.current = new Set([...seenEventIdsRef.current].slice(-1500));
      }

      const isAi = e.event_type === 'ai_news';
      const isMine = Number(userData?.user_id) > 0 && e.actor_user_id === Number(userData?.user_id);

      // تحديث حالة البيانات بالتأكيد (الريال تايم يعكس حالة الـ DB فعلًا):
      // - عداد التحديثات لكل شاشة مفتوحة تعمل refetch من غير Refresh يدوي
      setLiveUpdateVersion(prev => ({
        ...prev,
        missions: prev.missions + (e.event_type === 'mission' ? 1 : 0),
        local_news: prev.local_news + (e.event_type === 'local_news' ? 1 : 0),
        global_disasters: prev.global_disasters + (e.event_type === 'global_disaster' ? 1 : 0),
        earthquakes: prev.earthquakes + (e.event_type === 'earthquake' ? 1 : 0),
        ai_news: prev.ai_news + (isAi ? 1 : 0),
        audit: prev.audit + 1,
        handover: prev.handover + (e.event_type === 'handover' ? 1 : 0),
        weather: prev.weather + (e.event_type === 'weather' ? 1 : 0),
      }));

      // تنوير النقطة الحمراء في القائمة الجانبية
      setNewUpdates(prev => ({
        ...prev,
        missions: prev.missions || e.event_type === 'mission',
        local_news: prev.local_news || e.event_type === 'local_news',
        global_disasters: prev.global_disasters || e.event_type === 'global_disaster',
        earthquakes: prev.earthquakes || e.event_type === 'earthquake',
        ai_news: prev.ai_news || isAi,
        audit: true,
        handover: prev.handover || e.event_type === 'handover',
        weather: prev.weather || e.event_type === 'weather',
      }));

      // وميض صف المهمة المتغيّرة + تغذية أحداث المهام لفصل الـ modal
      if (e.event_type === 'mission' && e.mission_id) {
        const ts = Date.now();
        setPulseMissions(prev => [
          ...prev.filter(p => Date.now() - p.ts < 3500),
          { id: e.mission_id, ts, nonce: Math.random() },
        ].slice(-12));
        setLiveMissionEvents(prev => [
          { mission_id: e.mission_id, event_id: e.event_id, action: e.action, actor_name: e.actor_name, created_at: e.created_at },
          ...prev,
        ].slice(0, 20));
      }

      // الإشعار الظاهر والتوست: لا نُظهر للمستخدم فعله هو (بالـ user_id من الـ backend)
      if (isMine) return;

      const toastId = `rt-${e.event_id}-${Math.random()}`;
      setToasts(prev => [...prev, {
        id: toastId,
        eventId: e.event_id,
        user: String(e.actor_name || 'نظام'),
        action: String(e.action || 'تحديث'),
        details: typeof e.details === 'object' ? JSON.stringify(e.details) : String(e.details || ''),
        isAi,
        event_type: e.event_type,
        mission_id: e.mission_id,
        entity_id: e.entity_id ?? null,
        created_at: e.created_at,
        // ⏱️ انقضاء الموجة يُدار مركزيًا عبر shownAt (لا يوجد timer خاص بكل توست)
      }].slice(-40));

      const noticeId = `n-${e.event_id}`;
      setNotifications(prev => {
        if (prev.some(n => n.id === noticeId)) return prev;
        return [{
          id: noticeId,
          eventId: e.event_id,
          event_type: e.event_type,
          action: e.action,
          actor_name: e.actor_name,
          details: typeof e.details === 'object' ? JSON.stringify(e.details) : String(e.details || ''),
          mission_id: e.mission_id,
          entity_id: e.entity_id ?? null,
          created_at: e.created_at,
          read: false,
        }, ...prev].slice(0, 40);
      });
      setUnreadCount(prev => prev + 1);
    };

    const poll = async () => {
      if (pollInFlightRef.current) return;          // لا تداخل بين الطلبات
      pollInFlightRef.current = true;
      try {
        const init = lastEventIdRef.current === null;
        const url = init
          ? `${BASE}/api/realtime/events?init=1`
          : `${BASE}/api/realtime/events?after_id=${lastEventIdRef.current}&limit=100`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`realtime status ${res.status}`);
        const data = await res.json();
        if (init) {
          lastEventIdRef.current = data.latest_id || 0;   // نبدأ من الآن — بدون إعادة أحداث قديمة
        } else {
          const events = Array.isArray(data.events) ? data.events : [];
          events.forEach(notifyRealtime);
          if (events.length > 0) lastEventIdRef.current = events[events.length - 1].event_id;
        }
        pollBackoffRef.current = 4000;
        if (!realtimeUnmountedRef.current) setRealtimeConnected(true);
      } catch (e) {
        // network failure → backoff تصاعدي (لغاية 30 ثانية) ثم معاودة تلقائية
        pollBackoffRef.current = Math.min(pollBackoffRef.current * 2, 30000);
        if (!realtimeUnmountedRef.current) setRealtimeConnected(false);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const schedule = () => {
      pollTimer = setTimeout(async () => {
        await poll();
        if (!realtimeUnmountedRef.current) schedule();
      }, pollBackoffRef.current);
    };

    poll();
    schedule();

    return () => {
      realtimeUnmountedRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [userData]);

  // تنظيف دائم للميض القديم (للأمان مهما طالت الجلسة في الصفحة)
  useEffect(() => {
    const t = setInterval(() => {
      setPulseMissions(prev => prev.filter(p => Date.now() - p.ts < 3500));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const auth = getStoredAuth();
    if (!auth?.user || !auth?.token) {
      clearStoredAuth();
      navigate('/');
      return;
    }

    setUserData(auth.user);
    const flags = getRoleFlags(auth.user);
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    setActiveTab(requestedTab === 'weather_intel' && flags.weatherEligible
      ? 'weather_intel'
      : (auth.user.is_global_admin || ['OWNER', 'المالك', 'MANAGER', 'SUPERVISOR', 'ADMIN', 'مشرف'].includes(flags.userRole) ? 'home' : 'missions'));

    const fetchData = async () => {
      try {
        const branchesRes = await fetch(`${BASE}/api/branches/locations`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        });

        if (branchesRes.status === 401) {
          clearStoredAuth();
          setUserData(null);
          navigate('/');
          return;
        }

        if (branchesRes.ok) {
          const branchesData = await branchesRes.json().catch(() => null);
          const uniqueData = Array.isArray(branchesData)
            ? branchesData.filter((branch, index, self) =>
              index === self.findIndex((t) => (t.name || '').trim() === (branch.name || '').trim())
            )
            : [];

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
        const statsRes = await fetch(`${BASE}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${auth.token}` } });
        if (statsRes.ok) {
          const statsData = await statsRes.json().catch(() => null);
          if (statsData && typeof statsData === 'object' && !Array.isArray(statsData)) {
            setDashboardStats(prev => ({ ...prev, ...statsData }));
          }
        }
      } catch {
        // Keep the Dashboard shell mounted when optional dashboard data is unavailable.
      }
    };
    fetchData();
  }, [navigate]);

  // 💡 النزول لأول الصفحة أوتوماتيك مع كل تغيير للشاشة
  useEffect(() => {
    document.getElementById('main-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);
  // 💡 3. دالة الانتقال الذكية (بتفتح الصفحة، تقفل الموبايل، وتمسح الإشعار)
  const handleNavigation = (tabName) => {
    setActiveTab(tabName);
    setNewUpdates(prev => ({ ...prev, [tabName]: false })); // إخفاء النقطة الحمراء بعد قراءة التحديث
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  // 🎯 «عمق التتبّع»: يخبر الشاشة المفتوحة أيُّ صفٍ هو مصدر الإشعار حتى تنزل إليه وتومضه.
  //    - tab/type/id = الوجهة وصفّها، nonce = عداد يضمن إعادة الاشتعال لنفس الصف مرتين
  //    - id يقبل null (إشعار بلا entity_id) → تُفتح الصفحة فقط دون أي تتبع (سقوط آمن).
  const [focusTarget, setFocusTarget] = useState(null);
  const EVENT_TAB_MAP = { mission: 'missions', local_news: 'local_news', global_disaster: 'global_disasters', earthquake: 'earthquakes', ai_news: 'ai_news', handover: 'handover', weather: 'weather', audit: 'audit' };

  // فتح الإشعار (توست أو جرس): تنقّل للصفحة، واطلب تتبّع الصف لو لنا معرف.
  const handleNotificationOpen = (n) => {
    if (!n) return;
    const tab = EVENT_TAB_MAP[n.event_type] || 'missions';
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x)); // تحديد كمقروء (الجرس)
    closeNotifPanel();
    handleNavigation(tab);
    // 🗑️ إشعار حذف: السلعة حُذفت فعلًا ولم تعد موجودة في الصفحة — افتح الصفحة فقط
    //    دون بحث/نزول/تمييز لصف غير موجود، ودون أي تعارض مع حالة الحذف.
    const actionText = String(n.action || '');
    const isDeletion = /حذف/gi.test(actionText) || /delete/i.test(actionText);
    if (isDeletion) return;
    const id = n.entity_id ?? n.mission_id; // mission_id يبقى للتوافق حتى يصل الـ backend الجديد
    if (id != null) setFocusTarget({ tab, type: n.event_type, id, nonce: Date.now() });
  };

  const handleLogout = () => {
    clearStoredAuth();
    setUserData(null);
    navigate('/');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'home': return <MemoHomeView branches={branchesList} liveUpdateVersion={liveUpdateVersion} lang={language} weatherEligible={weatherEligible} />;
      case 'ai_news': return <MemoAINewsMonitorView branches={branchesList} isOwner={isOwner} lang={language} focusTarget={focusTarget} />;
      case 'weather': return <MemoWeatherForecastView branches={branchesList} isOwner={isOwner} isJoker={isJoker} userRole={userRole} lang={language} liveUpdateVersion={liveUpdateVersion.weather} />;
      case 'weather_intel': return weatherEligible
        ? <WeatherIntelErrorBoundary><MemoWeatherIntelView branches={branchesList} isOwner={isOwner} userRole={userRole} lang={language} setCustomAlert={setCustomAlert} /></WeatherIntelErrorBoundary>
        : <div className="card-surface p-8 text-center rounded-3xl border border-[var(--border)]"><h3 className="text-xl font-bold text-white mb-2">{language === 'ar' ? 'غير مصرح بالوصول' : 'Access denied'}</h3><p className="text-[var(--muted)]">{language === 'ar' ? 'هذه الصفحة غير متاحة لهذا الدور.' : 'This page is not available for this role.'}</p></div>;
      case 'missions': return <MemoMissionsView branches={branchesList} isVolunteer={isVolunteer} isJoker={isJoker} isSupervisor={isSupervisor} isOwner={isOwner} isSidebarOpen={isSidebarOpen} liveUpdateVersion={liveUpdateVersion.missions} pulseMissions={pulseMissions} liveMissionEvents={liveMissionEvents} lang={language} focusTarget={focusTarget} />;
      case 'local_news': return <MemoLocalNewsView branches={branchesList} isOwner={isOwner} isSupervisor={isSupervisor} isJoker={isJoker} isVolunteer={isVolunteer} focusTarget={focusTarget} />;
      case 'global_disasters': return <MemoGlobalDisastersView isOwner={isOwner} isSupervisor={isSupervisor} isJoker={isJoker} isVolunteer={isVolunteer} focusTarget={focusTarget} />;
      case 'earthquakes': return <MemoEarthquakesView isOwner={isOwner} isSupervisor={isSupervisor} lang={language} focusTarget={focusTarget} />;
      case 'branches_inventory': return <MemoBranchesAndInventoryView branches={branchesList} />;
      case 'handover': return (isOwner || isSupervisor)
        ? <MemoHandoverView isOwner={isOwner} isSupervisor={isSupervisor} lang={language} liveUpdateVersion={liveUpdateVersion.handover} focusTarget={focusTarget} />
        : <div className="card-surface p-8 text-center"><h3 className="text-xl font-bold text-white mb-2">{language === 'ar' ? 'غير مصرح بالوصول' : 'Access denied'}</h3><p className="text-[var(--muted)]">{language === 'ar' ? 'هذه الصفحة متاحة للمالك والمشرفين فقط' : 'This page is open to the owner and supervisors only'}</p></div>;
      case 'audit': return <MemoAuditLogsView isOwner={isOwner} liveUpdateVersion={liveUpdateVersion.audit} />;
      case 'human_resources': return <MemoHumanResourcesView branches={branchesList} isOwner={isOwner} liveUpdateVersion={liveUpdateVersion.missions} lang={language} />;
      default: return <MemoHomeView branches={branchesList} />;
    }
  };

  // 💡 بناء لوحة الأوامر حسب صلاحيات الدور (بدون كسر أي قاعدة صلاحيات/بيزنس)
  const paletteGroups = [
    {
      titleAr: 'الوحدات التشغيلية', titleEn: 'Operations',
      items: [
        ...((isOwner || isSupervisor || isJoker) ? [{ id: 'home', icon: <HomeIcon />, ar: 'مؤشرات الغرفة', en: 'Operations Overview' }] : []),
        { id: 'ai_news', icon: <AIIcon />, ar: 'رصد الذكاء الاصطناعي', en: 'AI Monitoring', update: newUpdates.ai_news },
        ...(weatherEligible ? [{ id: 'weather', icon: <WeatherIcon />, ar: 'توقعات الطقس', en: 'Weather Forecasts', update: newUpdates.weather }] : []),
        ...(weatherEligible ? [{ id: 'weather_intel', icon: <WeatherIntelIcon />, ar: 'استخبارات الطقس اليومية', en: 'Daily Weather Intelligence' }] : []),
        { id: 'missions', icon: <AlertIcon />, ar: 'سجل المهام الميدانية', en: 'Field Missions', update: newUpdates.missions },
        ...((isOwner || isSupervisor || isJoker) ? [{ id: 'human_resources', icon: <UsersIcon />, ar: 'سجل القوة البشرية', en: 'Human Resources', update: newUpdates.missions }] : []),
        { id: 'local_news', icon: <NewsIcon />, ar: 'سجل الأخبار المحلية', en: 'Local News', update: newUpdates.local_news },
        { id: 'global_disasters', icon: <GlobalWorldIcon />, ar: 'رصد الكوارث العالمية', en: 'Global Disasters', update: newUpdates.global_disasters },
        { id: 'earthquakes', icon: <EarthquakeIcon />, ar: 'مركز رصد الزلازل', en: 'Earthquake Center', update: newUpdates.earthquakes },
        ...((isOwner || isSupervisor) ? [{ id: 'branches_inventory', icon: <MapIcon />, ar: 'الفروع والمخزون الاستراتيجي', en: 'Branches & Inventory' }] : []),
        ...((isOwner || isSupervisor) ? [{ id: 'handover', icon: <HandoverIcon />, ar: 'تسليم وتسلم مشرفين', en: 'Supervisors Handover', update: newUpdates.handover }] : []),
        ...((isOwner || isSupervisor || isJoker) ? [{ id: 'audit', icon: <ShieldIcon />, ar: 'سجل النظام', en: 'System Audit', update: newUpdates.audit }] : []),
      ],
    },
    {
      titleAr: 'إجراءات', titleEn: 'Actions',
      items: [
        {
          id: '__theme', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>),
          ar: theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن',
          en: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
          action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
        },
        {
          id: '__lang', icon: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>),
          ar: language === 'ar' ? 'التبديل إلى English' : 'التبديل إلى العربية',
          en: language === 'ar' ? 'Switch to English' : 'Switch to Arabic',
          action: () => setLanguage(language === 'ar' ? 'en' : 'ar'),
        },
        {
          id: '__logout', icon: <LogoutIcon />,
          ar: 'إنهاء الجلسة الآمنة', en: 'Sign out', danger: true,
          action: handleLogout,
        },
      ],
    },
  ];

  // ── نافذة الطابور المرئية + عدّاد المتبقي لطبقة الرسم (F7) ──
  // المقفل (closing) يرسم أثناء أنيميشن الخروج؛ غير المقفل يظهر أول MAX_VISIBLE_TOASTS فقط.
  const closingToasts = toasts.filter(t => t.closing);
  const liveToasts = toasts.filter(t => !t.closing);
  const visibleToasts = liveToasts.slice(0, MAX_VISIBLE_TOASTS);
  const visibleLiveCount = visibleToasts.length;
  const queuedCount = liveToasts.length - visibleLiveCount;

  const palQuery = paletteQuery.trim().toLowerCase();
  const palResults = [];
  const palFlat = [];
  for (const g of paletteGroups) {
    const items = g.items.filter((it) => {
      if (!palQuery) return true;
      return (it.ar + ' ' + it.en + ' ' + it.id).toLowerCase().includes(palQuery);
    });
    if (items.length === 0) continue;
    palResults.push({ titleAr: g.titleAr, titleEn: g.titleEn, items });
    items.forEach((it) => palFlat.push(it));
  }
  const palTotal = palFlat.length;
  const palIdx = Math.min(paletteIndex, Math.max(0, palTotal - 1));
  const runPalette = (it) => {
    setPaletteOpen(false);
    if (it.id.startsWith('__')) { it.action(); return; }
    handleNavigation(it.id);
  };
  const palOnKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex((i) => Math.min(i + 1, palTotal - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (palFlat[palIdx]) runPalette(palFlat[palIdx]); }
  };

  return (
    <div ref={dashboardRootRef} data-theme={theme} className="app-shell min-h-screen bg-[var(--bg)] text-white font-sans selection:bg-[var(--accent)] selection:text-white flex overflow-hidden transition-colors duration-300" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}

      {/* 💡 الثيم الآن عبر data-theme + نظام CSS تصميمي واحد في index.css (light=طبقات بيضاء/ألوان حيادية، dark=أسطح عميقة) */}

      
      {/* 💡 4. طابور الإشعارات (يدعم إشعارات النظام العادية وإشعارات الذكاء الاصطناعي البنفسجية) */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 w-[min(94vw,640px)] pointer-events-none">
        {visibleLiveCount >= 2 && (
          <button
            type="button"
            onClick={closeAllToasts}
            className="toast-close-all pointer-events-auto self-center"
            title={language === 'en' ? 'Dismiss all visible notifications' : 'إغلاق كل الإشعارات الظاهرة'}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" /></svg>
            {language === 'en' ? 'Close all' : 'إغلاق الكل'}
          </button>
        )}
        {[...visibleToasts, ...closingToasts].map(toastItem => (
          <div key={toastItem.id} onClick={() => { dismissToast(toastItem.id); handleNotificationOpen(toastItem); }} className={`toast-item p-4 flex items-start gap-4 relative overflow-hidden pointer-events-auto cursor-pointer ${toastItem.closing ? 'toast-item-closing' : ''} ${toastItem.isAi ? 'toast-item-ai !border-[var(--ai)]/50' : ''}`}>
            <div className={`absolute start-0 top-0 bottom-0 w-1.5 ${toastItem.isAi ? 'bg-[var(--ai)]' : 'bg-[var(--accent)]'} animate-pulse`}></div>
            <div className={`w-10 h-10 mt-1 ${toastItem.isAi ? 'bg-[var(--ai-soft)] text-[var(--ai)] border-[var(--ai)]/30' : 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30'} rounded-full flex items-center justify-center border shrink-0`}>
              {toastItem.isAi ? <AIIcon className="w-5 h-5 animate-pulse" /> : <AlertIcon className="w-5 h-5 animate-bounce" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[var(--ink)] font-bold text-sm flex justify-between items-center">
                <span className="truncate">{toastItem.isAi ? 'رصد آلي جديد (AI) 🤖' : `تحديث بواسطة: `} {!toastItem.isAi && <span className="text-[var(--accent)] ms-1">{toastItem.user}</span>}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissToast(toastItem.id); }}
                  aria-label={language === 'en' ? 'Dismiss notification' : 'إغلاق الإشعار'}
                  title={language === 'en' ? 'Dismiss' : 'إغلاق'}
                  className="text-[var(--faint)] hover:text-[var(--ink)] transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </h4>
              <p className={`${toastItem.isAi ? 'text-[var(--ai)]' : 'text-[var(--info)]'} text-xs mt-2 font-bold bg-[var(--surface-3)] p-2 rounded-lg border border-[var(--border)] inline-block`}>
                {toastItem.isAi ? 'الذكاء الاصطناعي وجد خبراً جديداً' : <>{'إجراء: '}{toastItem.action}</>}
              </p>
              <p className="text-[var(--ink-2)] text-xs mt-2 leading-relaxed">{localizeMissionDetails(toastItem.details, language)}</p>
            </div>
            {/* ⏱️ شريط العدّاد التنازلي — يعكس 9 ثوانٍ وينكمش نحو النهاية المنطقية */}
            <span className={`toast-timer ${toastItem.isAi ? 'toast-timer-ai' : ''}`}></span>
          </div>
        ))}
        {queuedCount > 0 && (
          <button
            type="button"
            onClick={flowNextQueued}
            className="toast-stack-chip pointer-events-auto self-center"
            title={language === 'en' ? 'Show next queued notifications' : 'إظهار الإشعارات التالية في الطابور'}
          >
            {language === 'en' ? `+${queuedCount} more notifications` : `+${queuedCount} إشعارات أخرى`}
          </button>
        )}
      </div>

      {/* 💡 لوحة الأوامر السريعة (⌘K) — زجاجية بإضاءة Lightswind، تنقل كامل بالكيبورد */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[14vh] px-4" role="dialog" aria-modal="true" aria-label={language === 'en' ? 'Command palette' : 'لوحة الأوامر السريعة'}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md palette-scrim" onClick={() => setPaletteOpen(false)}></div>
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl palette-pop">
            <div className="flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--surface-2)]/60">
              <svg className="w-4 h-4 text-[var(--muted)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onKeyDown={palOnKey}
                placeholder={language === 'en' ? 'Type to search units or actions…' : 'ابحث عن وحدة أو إجراء…'}
                aria-label={language === 'en' ? 'Search' : 'بحث'}
                className="w-full py-3.5 bg-transparent text-[var(--ink)] text-sm font-semibold outline-none placeholder:text-[var(--faint)]"
              />
              <kbd className="px-1.5 py-0.5 rounded-md bg-[var(--surface-3)] border border-[var(--border)] text-[10px] font-bold text-[var(--faint)] shrink-0">ESC</kbd>
            </div>

            <div className="max-h-[46vh] overflow-y-auto custom-scrollbar p-2">
              {palResults.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  {language === 'en' ? 'No matching unit or action.' : 'لا توجد نتائج مطابقة.'}
                </p>
              )}
              {palResults.map((group) => (
                <div key={group.titleAr}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--faint)]">{language === 'en' ? group.titleEn : group.titleAr}</p>
                  {group.items.map((it) => {
                    const isSel = palFlat[palIdx] === it;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onMouseEnter={() => setPaletteIndex(palFlat.indexOf(it))}
                        onClick={() => runPalette(it)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-start transition-all duration-150 ${isSel ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-accent)] scale-[1.01]' : 'text-[var(--ink)] hover:bg-[var(--surface-2)]'} ${it.danger ? 'text-[var(--accent)]' : ''}`}
                      >
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${isSel ? 'bg-white/15 border-white/25' : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]'}`}>{it.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className={`block text-sm font-bold truncate ${isSel ? 'text-white' : it.danger ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}>{language === 'en' ? it.en : it.ar}</span>
                          <span className={`block text-[11px] truncate ${isSel ? 'text-white/80' : 'text-[var(--muted)]'}`}>{it.id.startsWith('__') ? (language === 'en' ? 'Action' : 'إجراء') : (language === 'en' ? 'Open unit' : 'فتح الوحدة')}</span>
                        </span>
                        {it.update && (
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isSel ? 'bg-white' : 'bg-[var(--accent)]'} animate-pulse`}></span>
                        )}
                        {isSel && <svg className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4 px-4 py-2.5 border-t border-[var(--border)] text-[10px] font-bold text-[var(--faint)] bg-[var(--surface-2)]/50">
              <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-[var(--surface-3)] border border-[var(--border)]">↑</kbd><kbd className="px-1 rounded bg-[var(--surface-3)] border border-[var(--border)]">↓</kbd> {language === 'en' ? 'Navigate' : 'تنقل'}</span>
              <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-[var(--surface-3)] border border-[var(--border)]">↵</kbd> {language === 'en' ? 'Open' : 'فتح'}</span>
              <span className="ms-auto inline-flex items-center gap-1"><kbd className="px-1 rounded bg-[var(--surface-3)] border border-[var(--border)]">ESC</kbd> {language === 'en' ? 'Close' : 'إغلاق'}</span>
            </div>
          </div>
        </div>
      )}

      <div className={`sidebar-backdrop ${isSidebarOpen ? 'is-visible' : ''} block md:hidden`} onClick={() => setIsSidebarOpen(false)} />

      <aside className={`sidebar-shell bg-[var(--surface)] border-l border-[var(--border)] flex flex-col justify-between fixed md:sticky top-0 h-screen overflow-hidden z-[70] ${isSidebarOpen ? 'is-open right-0 w-64 md:w-72 shadow-[12px_0_40px_-18px_rgba(0,0,0,0.55)]' : '-right-80 md:right-0 w-64 md:w-20'}`}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
          {isSidebarOpen ? (
            <div className="px-6 pt-7 pb-5 border-b border-[var(--border)] relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-24 bg-[radial-gradient(ellipse_at_top_right,rgba(199,0,0,0.13),transparent_70%)] pointer-events-none"></div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="sidebar-brand w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--border-strong)] flex items-center justify-center p-2 shadow-[0_0_26px_rgba(199,0,0,0.22)] shrink-0">
                  <img src="/Egyptian_Red_Crescent.png" alt="Egyptian Red Crescent" draggable="false" className="max-w-full max-h-full w-full aspect-square object-contain object-[39%] pointer-events-none" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-extrabold tracking-wide truncate">{userData?.full_name || translate('المالك', language)}</h2>
                  <p className="text-[11px] text-[var(--muted)] truncate">مركز عمليات الطوارئ</p>
                </div>
              </div>
              <p className="relative z-10 mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--accent)] bg-[var(--accent-softer)] border border-[var(--accent-soft)] px-3 py-1 rounded-full">
                <span className="status-dot status-dot-live"></span>
                {(userData?.role || 'OWNER')}
              </p>
            </div>
          ) : (
            <div className="p-4 border-b border-[var(--border)] flex justify-center">
              <div className="w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--border-strong)] flex items-center justify-center p-1 shadow-[0_0_18px_rgba(199,0,0,0.22)]" title={userData?.full_name}>
                <img src="/Egyptian_Red_Crescent.png" alt="Egyptian Red Crescent" draggable="false" className="max-w-full max-h-full w-full aspect-square object-contain object-[39%] pointer-events-none" />
              </div>
            </div>
          )}

          <nav key={isSidebarOpen ? 'nav-open' : 'nav-closed'} className="nav-shell p-3 space-y-1.5 mt-2">
            {isSidebarOpen && <p className="px-3 pt-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--faint)]">الوحدات التشغيلية</p>}
            {(isOwner || isSupervisor || isJoker) && <NavItem icon={<HomeIcon />} label="مؤشرات الغرفة" isActive={activeTab === 'home'} onClick={() => handleNavigation('home')} isOpen={isSidebarOpen} />}
            <NavItem icon={<AIIcon />} label="رصد الذكاء الاصطناعي" isActive={activeTab === 'ai_news'} onClick={() => handleNavigation('ai_news')} isOpen={isSidebarOpen} hasUpdate={newUpdates.ai_news} />
            {weatherEligible && <NavItem icon={<WeatherIcon />} label="توقعات الطقس" isActive={activeTab === 'weather'} onClick={() => handleNavigation('weather')} isOpen={isSidebarOpen} hasUpdate={newUpdates.weather} />}
            {weatherEligible && <NavItem icon={<WeatherIntelIcon />} label={language === 'ar' ? 'استخبارات الطقس' : 'Weather Intelligence'} isActive={activeTab === 'weather_intel'} onClick={() => handleNavigation('weather_intel')} isOpen={isSidebarOpen} />}

            <NavItem icon={<AlertIcon />} label="سجل المهام الميدانية" isActive={activeTab === 'missions'} onClick={() => handleNavigation('missions')} isOpen={isSidebarOpen} hasUpdate={newUpdates.missions} />

            {/* 💡 نقلنا زرار القوة البشرية هنا تحت المهام مباشرة */}
            {(isOwner || isSupervisor || isJoker) && <NavItem icon={<UsersIcon />} label="سجل القوة البشرية" isActive={activeTab === 'human_resources'} onClick={() => handleNavigation('human_resources')} isOpen={isSidebarOpen} />}

            <NavItem icon={<NewsIcon />} label="سجل الأخبار المحلية" isActive={activeTab === 'local_news'} onClick={() => handleNavigation('local_news')} isOpen={isSidebarOpen} hasUpdate={newUpdates.local_news} />
            <NavItem icon={<GlobalWorldIcon />} label="رصد الكوارث العالمية" isActive={activeTab === 'global_disasters'} onClick={() => handleNavigation('global_disasters')} isOpen={isSidebarOpen} hasUpdate={newUpdates.global_disasters} />
            <NavItem icon={<EarthquakeIcon />} label="مركز رصد الزلازل" isActive={activeTab === 'earthquakes'} onClick={() => handleNavigation('earthquakes')} isOpen={isSidebarOpen} hasUpdate={newUpdates.earthquakes} />
            {(isOwner || isSupervisor) && <NavItem icon={<MapIcon />} label="الفروع والمخزون الاستراتيجي" isActive={activeTab === 'branches_inventory'} onClick={() => handleNavigation('branches_inventory')} isOpen={isSidebarOpen} />}
            {(isOwner || isSupervisor) && <NavItem icon={<HandoverIcon />} label="تسليم وتسلم مشرفين" isActive={activeTab === 'handover'} onClick={() => handleNavigation('handover')} isOpen={isSidebarOpen} hasUpdate={newUpdates.handover} />}
            {(isOwner || isSupervisor || isJoker) && <NavItem icon={<ShieldIcon />} label="سجل النظام" isActive={activeTab === 'audit'} onClick={() => handleNavigation('audit')} isOpen={isSidebarOpen} hasUpdate={newUpdates.audit} />}
          </nav>
        </div>
        <div className="p-3 border-t border-[var(--border)]">
          <button onClick={handleLogout} title={!isSidebarOpen ? "خروج" : ""} className={`nav-item nav-item-danger ${isSidebarOpen ? '' : 'w-14 justify-center mx-auto'}`}>
            <LogoutIcon />
            {isSidebarOpen && <span className="font-semibold tracking-wide truncate">إنهاء الجلسة الآمنة</span>}
          </button>
        </div>
      </aside>

      <main id="main-scroll-container" className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_top_right,rgba(199,0,0,0.03),transparent_50%)] relative">
        <header className="glass-header px-4 md:px-8 py-3.5 md:py-4 flex items-center gap-3 md:gap-4 sticky top-0 z-40">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="قائمة التنقل" className="icon-btn !w-11 !h-11 shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
          </button>

          <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg md:text-2xl font-extrabold tracking-tight truncate">
                  {activeTab === 'home' && 'موجز عمليات اليوم'}
                  {activeTab === 'ai_news' && 'رصد الذكاء الاصطناعي'}
                  {activeTab === 'weather' && (language === 'ar' ? 'توقعات الطقس' : 'Weather Forecasts')}
                  {activeTab === 'weather_intel' && (language === 'ar' ? 'استخبارات الطقس اليومية' : 'Daily Weather Intelligence')}
                  {activeTab === 'missions' && 'إدارة المهام الميدانية'}
                  {activeTab === 'human_resources' && 'سجل القوة البشرية'}
                  {activeTab === 'local_news' && 'سجل الأخبار المحلية'}
                  {activeTab === 'global_disasters' && 'رصد الكوارث العالمية'}
                  {activeTab === 'earthquakes' && 'مركز رصد الزلازل'}
                  {activeTab === 'branches_inventory' && 'الانتشار الجغرافي والمخزون'}
                  {activeTab === 'handover' && 'تسليم وتسلم مشرفين'}
                  {activeTab === 'audit' && 'سجل النظام والعمليات (مراقب)'}
                </h1>
                <span className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${realtimeConnected ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>
                  <span className={`status-dot ${realtimeConnected ? 'status-dot-live' : 'animate-pulse'}`}></span>
                  {realtimeConnected ? 'متصل لحظياً' : 'جارٍ الاتصال…'}
                </span>
              </div>
              <p className="text-xs md:text-sm text-[var(--muted)] mt-0.5 truncate">مركز عمليات الطوارئ (EOC)</p>
            </div>
          </div>

  <button
    type="button"
    ref={paletteBtnRef}
    onClick={() => setPaletteOpen(true)}
    title={language === 'ar' ? 'بحث سريع (Ctrl+K)' : 'Quick search (Ctrl+K)'}
    aria-label={language === 'ar' ? 'بحث سريع' : 'Quick search'}
    className="hidden md:flex items-center gap-2 h-10 px-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border-strong)] text-[var(--muted)] text-sm font-semibold hover:border-[var(--accent-soft)] hover:text-[var(--ink)] transition-all duration-200 active:scale-[0.97] shrink-0"
  >
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
    <span className="tracking-wide">{language === 'en' ? 'Search' : 'بحث'}</span>
    <kbd className="px-1.5 py-0.5 rounded-md bg-[var(--surface-3)] border border-[var(--border)] text-[10px] font-bold text-[var(--faint)]">⌘K</kbd>
  </button>

  <button
    type="button"
    onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
    title={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
    aria-label={language === 'ar' ? 'Switch to English' : 'Switch to Arabic'}
    className="btn-ghost w-14 h-10 rounded-xl shrink-0 active:scale-[0.96]"
  >
    {language === 'ar' ? 'EN' : 'AR'}
  </button>

  <button
    type="button"
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    title={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
    aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
    className="relative w-[74px] h-10 rounded-full p-1 bg-[var(--surface-3)] border border-[var(--border-strong)] transition-all duration-300 hover:border-[var(--accent-soft)] active:scale-[0.97] shrink-0"
  >
    <svg className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--faint)] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    <svg className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--faint)] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <span
      className={`absolute top-1 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent)] text-white shadow-[var(--shadow-accent)] transition-all duration-500 ${theme === 'dark' ? 'start-1' : 'start-[34px]'}`}
    >
      {theme === 'dark' ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
      )}
    </span>
  </button>

  {/* 💡 جرس الإشعارات + مؤشر الاتصال + القائمة (RTL-aware، إغلاق بالضغط خارجها أو Esc) */}
  <div className="relative shrink-0" ref={notifRef}>
    <button
      ref={bellRef}
      type="button"
      onClick={() => {
        if (notificationsOpen) { closeNotifPanel(); return; }
        if (notifCloseTimerRef.current) clearTimeout(notifCloseTimerRef.current);
        setNotifClosing(false);
        setNotificationsOpen(true);
      }}
      title={notificationsOpen ? 'إغلاق الإشعارات' : 'الإشعارات اللحظية'}
      aria-label={notificationsOpen ? 'إغلاق الإشعارات' : 'الإشعارات اللحظية'}
      aria-expanded={notificationsOpen}
      className="icon-btn !w-11 !h-11 relative"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && <span className="bell-ring" />}
      {unreadCount > 0 && (
        <span key={unreadCount} className="absolute -top-1.5 -start-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--accent)] text-white text-[11px] font-bold flex items-center justify-center shadow-[0_0_12px_rgba(199,0,0,0.6)] animate-scale-pop">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      <span className={`absolute -bottom-1 -end-1 w-3 h-3 rounded-full border-2 border-[var(--bg)] ${realtimeConnected ? 'bg-[var(--ok)]' : 'bg-[var(--warn)] animate-pulse'}`} title={realtimeConnected ? 'متصل بالخادم لحظياً' : 'جارٍ إعادة الاتصال…'}></span>
    </button>

    {notificationsOpen && (
      <div
        role="dialog"
        aria-label="الإشعارات اللحظية"
        className={`notif-dropdown absolute end-0 top-12 w-[min(94vw,400px)] max-h-[min(84vh,680px)] min-h-[min(62vh,460px)] flex flex-col overflow-hidden z-[80] ${notifClosing ? 'notif-dropdown-close' : ''}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-soft)]">
          <h3 className="text-sm font-bold">الإشعارات اللحظية</h3>
          <div className="flex items-center gap-2.5">
            <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${realtimeConnected ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
              <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-[var(--ok)]' : 'bg-[var(--warn)] animate-pulse'}`}></span>
              {realtimeConnected ? 'متصل' : 'جاري الاتصال'}
            </span>
            {unreadCount > 0 && (
              <button type="button" onClick={() => { setNotifications(prev => prev.map(n => ({ ...n, read: true }))); setUnreadCount(0); }}
                className="text-[11px] text-[var(--accent)] hover:text-[var(--ink)] font-bold transition-colors">
                تحديد الكل كمقروء
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {notifications.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon animate-float-slow">🔔</div>
              <p className="text-sm font-semibold text-[var(--muted)]">لا توجد إشعارات بعد</p>
              <p className="text-xs text-[var(--faint)]">ستظهر هنا كل التحديثات اللحظية فور حدوثها</p>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--muted-2)] mt-1">
                <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-[var(--ok)]' : 'bg-[var(--warn)] animate-pulse'}`}></span>
                {realtimeConnected ? 'متصل — بانتظار الأحداث' : 'جارٍ الاتصال…'}
              </span>
            </div>
          ) : notifications.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => handleNotificationOpen(n)}
              className={`notif-item notif-item-in w-full text-start px-4 py-3 flex items-start gap-3 border-b border-[var(--border)] transition-colors ${n.read ? 'opacity-60 hover:opacity-100' : 'bg-[var(--accent-softer)] hover:bg-[var(--accent-soft)] ' + (notifications.find(x => !x.read)?.id === n.id ? 'update-glow-notif' : '')}`}
              style={{ animationDelay: `${Math.min(i, 8) * 42}ms` }}
            >
              <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${n.event_type === 'mission' ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-soft)]' : 'bg-[var(--surface-week)] text-[var(--muted)] border-[var(--border)]'}`}>
                {n.event_type === 'mission' ? <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg> : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--ink)] truncate">{n.actor_name || 'نظام'}</span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0"></span>}
                </span>
                <span className="block text-xs text-[var(--muted-2)] mt-0.5 truncate">{n.action}</span>
                <span className="block text-[11px] text-[var(--faint)] mt-0.5 truncate">{formatDateTime(n.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    )}
  </div>

</header>

        {/* 📶 شريط حالة الاتصال — يظهر فقط عند انقطاع النت أو لحظة عودة الاتصال */}
        {(!isOnline || justReconnected) && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-center gap-2.5 px-4 py-2 text-xs font-bold text-white border-b ${
              !isOnline
                ? 'bg-[var(--accent)] border-[var(--accent-deep)]'
                : 'bg-[var(--ok)] border-[var(--ok-soft)] text-white'
            } ${!isOnline ? 'conn-banner-offline' : 'conn-banner-back'}`}
          >
            {!isOnline ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-70"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
                <span className="tracking-wide">
                  {language === 'en'
                    ? 'Connection lost — check your network. The system will reconnect automatically.'
                    : 'انقطع الاتصال بالإنترنت — تحقق من الشبكة. سيُعاود النظام الاتصال تلقائيًا.'}
                </span>
              </>
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
                <span className="tracking-wide">
                  {language === 'en'
                    ? 'Connection restored — synchronizing data…'
                    : 'تمت استعادة الاتصال — جارٍ مزامنة البيانات…'}
                </span>
              </>
            )}
          </div>
        )}

        {/* 💡 شريط الأحداث الحية (Live tape) — Lightswind live-stream:
            نغمة ميدانية متدفقة آخر التحديثات من المهام، تتوقف عند التمرير. */}
        {liveMissionEvents.length > 0 && (
          <div className="ticker-shell" aria-hidden="true">
            <span className="ticker-label">
              <span className="live-dot" />
              {language === 'en' ? 'LIVE FEED' : 'أحداث حية'}
            </span>
            <div className="ticker-track">
              <div className="ticker-marquee">
                {[...liveMissionEvents, ...liveMissionEvents].map((ev, i) => (
                  <span key={`${ev.event_id}-${i}`} className="ticker-item">
                    <span className="ticker-actor">{ev.actor_name}</span>
                    <span className="ticker-action">{ev.action}</span>
                    <span className="ticker-time">{ev.created_at ? formatTime12(ev.created_at) : ''}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 💡 4. مسافات الشاشة صغرت للموبايل عشان تدي براح للعرض */}
        <div className="p-4 md:p-10">
          {renderContent()}
        </div>
      </main>
      
    </div>
  );
}

// ==========================================
// 1. شاشة الداش بورد (موجز العمليات التفاعلي)
// ==========================================
// 💡 عدّاد متحرك (CountUp) — Lightswind count-up signature: أي قيمة جديدة
// تنساب من القيمة السابقة بدالة easeOutExpo مع "نقرة" scale ملحوظة عند القفزة.
function CountUp({ value, duration = 750, className = '' }) {
  const [disp, setDisp] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = Number(value) || 0;
    if (from === to) return undefined;
    const t0 = performance.now();
    const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      setDisp(from + (to - from) * ease(p));
      if (p < 1) { rafRef.current = requestAnimationFrame(step); }
      else { prevRef.current = to; }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span key={value} className={`kpi-bump inline-block tabular-nums ${className}`}>{Math.round(disp)}</span>;
}

// 💡 بطاقة إمالة ثلاثية الأبعاد (Lightswind 3D-tilt): تتبع مؤشر الفأرة بزاوية
// perspective خفيفة وحركة نابضية عند العودة — تُطبق على بطاقات KPI.
function TiltCard({ children, className = '', max = 9 }) {
  const ref = useRef(null);
  const rafRef = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(850px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateY(-2px)`;
    });
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    el.style.transform = '';
  };
  return (
    <div ref={ref} className={`tilt-card ${className}`} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

function HomeView({ branches = [], liveUpdateVersion = {}, lang = 'ar', weatherEligible = true }) {
  const [missions, setMissions] = useState([]);
  const [news, setNews] = useState([]);
  const [globalDisasters, setGlobalDisasters] = useState([]);
  const [globalEqs, setGlobalEqs] = useState([]);
  const [egyptEqs, setEgyptEqs] = useState([]);
  const [selectedBranchName, setSelectedBranchName] = useState(null);

  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [filterDate, setFilterDate] = useState(getLocalDate());
  // 🌤️ الطقس اليومي المجمّع (قراءة فقط) — يتحدّث تلقائياً مع أي حفظ/إنهاء توقعات
  const [dailyWeather, setDailyWeather] = useState([]);

  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    Promise.all([
      fetch(`https://eoc-system-b12f.vercel.app/api/missions`, { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch(`https://eoc-system-b12f.vercel.app/api/local-news`, { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch(`https://eoc-system-b12f.vercel.app/api/global-disasters`, { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/global`, { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : []),
      fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/egypt`, { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.ok ? res.json() : [])
    ]).then(([missionsData, newsData, globalData, gEqs, eEqs]) => {
      setMissions(missionsData);
      setNews(newsData);
      setGlobalDisasters(globalData);
      setGlobalEqs(gEqs);
      setEgyptEqs(eEqs);
    });
  }, []);

  // 🌤️ سحب الطقس اليومي: عند تغيير تاريخ الفلتر أو عند وصول تحديث لحظي للطقس
  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    const d = filterDate || getLocalDate();
    fetch(`${BASE}/api/weather/daily?date=${d}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => setDailyWeather(data));
  }, [filterDate, liveUpdateVersion.weather]);

  const filterMissionBranch = selectedBranchName; 
  const filterNewsGov = (selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'القاهرة' : selectedBranchName;

  const filteredMissions = selectedBranchName ? missions.filter(m => { const mBranch = m.branch?.trim(); return mBranch === filterMissionBranch || (filterMissionBranch === 'المركز العام' && mBranch === 'القاهرة') || (filterMissionBranch === 'القاهرة' && mBranch === 'المركز العام'); }) : missions;
  const filteredNews = selectedBranchName ? news.filter(n => n.governorate === filterNewsGov) : news;

  const dailyMissions = filterDate ? filteredMissions.filter(m => {
    const createdAt = (m.created_at && m.created_at !== '-')
  ? String(m.created_at).split(/[ T]/)[0]
  : ((m.creation_datetime && m.creation_datetime !== '-')
    ? String(m.creation_datetime).split(/[ T]/)[0]
    : '');

    const isCompleted = m.status === 'Completed';
    const isCancelled = m.status === 'Cancelled';
    const isFinished = isCompleted || isCancelled;
    // Active missions persist across all days after creation until completed/cancelled;
    // when finished, visible ONLY on the day they finished (completion_date)
    if (!isFinished) {
      return createdAt <= filterDate;
    }
    const storedCompletedAt = (m.completion_date && m.completion_date !== '-')
  ? String(m.completion_date).split(/[ T]/)[0]
  : null;

// حماية للبيانات القديمة التي تحمل تاريخ إغلاق أقدم من إنشاء السجل
const completedAt =
  storedCompletedAt && storedCompletedAt >= createdAt
    ? storedCompletedAt
    : createdAt;

    if (isCompleted && completedAt) {
      return completedAt === filterDate;
    }
    // Cancelled without completion_date: show on creation date only
    return createdAt === filterDate;
  }) : filteredMissions;
  const dailyNews = filterDate ? filteredNews.filter(n => n.incident_date === filterDate) : filteredNews;
  const dailyDisasters = filterDate ? globalDisasters.filter(d => d.incident_date === filterDate) : globalDisasters;
  const dailyGlobalEqs = filterDate ? globalEqs.filter(e => e.date === filterDate) : globalEqs;
  const dailyEgyptEqs = filterDate ? egyptEqs.filter(e => e.date === filterDate) : egyptEqs;

  const activeDaily = dailyMissions.filter(m => m.mission_classification !== 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const activeOpen = dailyMissions.filter(m => m.mission_classification === 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const completedMissions = dailyMissions.filter(m => m.status === 'Completed').length;
  const totalNews = dailyNews.length;
  const activeNews = dailyNews.filter(n => n.is_field_response).length;
  
  const totalGlobalDisasters = dailyDisasters.length;
  const globalEqsToday = dailyGlobalEqs.length;
  const totalEgyptEqs = dailyEgyptEqs.length;

  // 🕐 ساعة العمليات الحية + حالة تشغيلية مشتقة من البيانات الراسخة (لا منطق جديد)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const liveActive = missions.filter(m => !['Completed', 'Cancelled'].includes(m.status)).length;
  const liveOpen = missions.filter(m => m.mission_classification === 'مفتوحة' && !['Completed', 'Cancelled'].includes(m.status)).length;
  const latestMissions = [...missions]
    .sort((a, b) => String(b.creation_datetime || b.created_at || '').localeCompare(String(a.creation_datetime || a.created_at || '')))
    .slice(0, 5);
  const liveClock = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const liveDate = `${now.toLocaleDateString('ar-EG', { weekday: 'long' })}، ${formatDateTime(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`)}`;
  const statusTone = m => {
    if (m.status === 'Cancelled') return 'bg-[var(--warn)]';
    if (m.status === 'Completed') return 'bg-[var(--ok)]';
    return m.mission_classification === 'مفتوحة' ? 'bg-[var(--info)]' : 'bg-[var(--accent)]';
  };

  // 🌤️ بطاقة الطقس اليومي: لكل مقياس نُبرز المحافظة صاحبة العظمى والمحافظة صاحبة الصغرى
  // (تتخطى القيم الفارغة NULL — لا تعطل، وتظهر «—» عند غياب البيانات)
  const weatherMetrics = [
    { key: 'temp', ar: 'درجة الحرارة', en: 'Temperature', unit: '°C' },
    { key: 'wind', ar: 'سرعة الرياح', en: 'Wind Speed', unit: 'كم/س' },
    { key: 'rain', ar: 'الأمطار', en: 'Rain', unit: 'مم' },
    { key: 'humidity', ar: 'الرطوبة', en: 'Humidity', unit: '%' },
    { key: 'clouds', ar: 'الغيوم', en: 'Clouds', unit: '%' },
    { key: 'aqi', ar: 'جودة الهواء/الغبار', en: 'Air Quality/Dust', unit: '' },
  ];
  const weatherHighlights = weatherMetrics.map(m => {
    const withMax = dailyWeather.filter(r => r[`${m.key}_max`] != null);
    const withMin = dailyWeather.filter(r => r[`${m.key}_min`] != null);
    const maxRow = withMax.length ? withMax.reduce((b, r) => (Number(r[`${m.key}_max`]) >= Number(b[`${m.key}_max`]) ? r : b)) : null;
    const minRow = withMin.length ? withMin.reduce((b, r) => (Number(r[`${m.key}_min`]) <= Number(b[`${m.key}_min`]) ? r : b)) : null;
    return { ...m, maxRow, minRow };
  });
  const weatherDateLabel = filterDate || getLocalDate();

  return (
    <div id="home-view-top" className="space-y-8 pb-10 animate-fade-in-up scroll-mt-6">
      {/* 🛰️ حزام قيادة العمليات: ساعة حية + LIVE + ملخص تشغيلي فوري */}
      <div className="ops-band p-5 md:p-6 spot-card">
        <div className="flex flex-wrap items-center justify-between gap-5 relative z-10">
          <div className="flex items-center gap-4">
            <span className="ops-chip text-[var(--ok)] border-[var(--ok-soft)] bg-[var(--ok-soft)]"><span className="live-dot" /> LIVE</span>
            <div className="hidden sm:flex flex-col">
              <span className="ops-clock text-2xl md:text-3xl font-black text-[var(--ink)]" dir="ltr">{liveClock}</span>
              <span className="text-xs font-bold text-[var(--muted)] mt-1">{liveDate}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" /> مهام جارية الآن: <b className="text-[var(--ink)] tabular-nums">{liveActive}</b></span>
            <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--info)]" /> مفتوحة: <b className="text-[var(--ink)] tabular-nums">{liveOpen}</b></span>
            <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)]" /> شبكة اتصال: <b className="text-[var(--ok)]">مستقرة</b></span>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-5">
        <div className="min-w-0">
          <p className="eyebrow mb-2">غرفة عمليات الطوارئ</p>
          <h2 className="text-2xl md:text-4xl font-black tracking-tight bg-gradient-to-l from-[var(--ink)] via-[var(--ink-2)] to-[var(--muted)] bg-clip-text text-transparent">المركز الرئيسي للعمليات</h2>
          <p className="text-[var(--muted)] text-sm mt-2 max-w-2xl">{selectedBranchName ? `المؤشرات الحية لفرع/محافظة: ${(selectedBranchName === 'المركز العام' || selectedBranchName === 'القاهرة') ? 'المركز العام (القاهرة)' : selectedBranchName}` : 'الرؤية الشاملة للوضع الميداني والزلزالي (على مستوى الجمهورية)'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="segmented">
            <span className="px-3 text-xs font-bold text-[var(--muted)] whitespace-nowrap">إحصائيات يوم:</span>
            <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-transparent text-sm font-bold outline-none cursor-pointer px-1" />
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="chip chip-active !py-1">
                عرض الكل
              </button>
            )}
          </div>
          {selectedBranchName && (
            <button onClick={() => setSelectedBranchName(null)} className="btn-ghost px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 active:scale-[0.97]">إلغاء التحديد (عرض الجمهورية) <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
        <TiltCard className="kpi-card card-surface p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">المهام اليومية (نشطة)</h3><div className="p-2 rounded-xl text-[var(--accent)] bg-[var(--accent-softer)] border border-[var(--accent-soft)] shrink-0"><AlertIcon/></div></div>
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            <p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={activeDaily} /></p>
            <span className="kpi-sub"><span className="live-dot" /> نشطة الآن</span>
          </div>
        </TiltCard>
                <TiltCard className="kpi-card card-surface p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">المهام المكتملة</h3><div className="p-2 rounded-xl text-[var(--ok)] bg-[var(--ok-soft)] border border-[var(--ok)]/20 shrink-0"><CheckIcon/></div></div>
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            <p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={completedMissions} /></p>
            <span className="kpi-sub">تم الانتهاء</span>
          </div>
        </TiltCard>
        <TiltCard className="kpi-card card-surface p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">الأخبار المحلية المرصودة</h3><div className="p-2 rounded-xl text-[var(--ai)] bg-[var(--ai-soft)] border border-[var(--ai)]/20 shrink-0"><NewsIcon/></div></div>
          <div className="flex items-end gap-2 relative z-10"><p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={totalNews} /></p><span className="text-xs font-bold text-[var(--ai)] mb-1.5">(<CountUp value={activeNews} className="!text-xs !text-[var(--ai)] font-bold" /> استجابة)</span></div>
        </TiltCard>
        <TiltCard className="kpi-card card-surface border-l-4 border-l-[var(--accent)] p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">الكوارث العالمية</h3><div className="p-2 rounded-xl text-[var(--accent)] bg-[var(--accent-softer)] border border-[var(--accent-soft)] shrink-0"><GlobalWorldIcon/></div></div>
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            <p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={totalGlobalDisasters} /></p>
            <span className="kpi-sub">الرصد العالمي</span>
          </div>
        </TiltCard>
        <TiltCard className="kpi-card card-surface p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">الزلازل العالمية (اليوم)</h3><div className="p-2 rounded-xl text-[var(--accent)] bg-[var(--danger-soft)] border border-[var(--accent)]/20 shrink-0"><EarthquakeIcon/></div></div>
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            <p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={globalEqsToday} /></p>
            <span className="kpi-sub">خلال 24 ساعة</span>
          </div>
        </TiltCard>
        <TiltCard className="kpi-card card-surface p-5 rounded-3xl relative overflow-hidden h-32 spot-card">
          <div className="flex items-center justify-between mb-3 relative z-10"><h3 className="text-[var(--muted)] font-bold text-sm">زلازل مصر المرصودة</h3><div className="p-2 rounded-xl text-[var(--ok)] bg-[var(--ok-soft)] border border-[var(--ok)]/20 shrink-0"><EarthquakeIcon/></div></div>
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            <p className="kpi-value text-4xl text-[var(--ink)]"><CountUp value={totalEgyptEqs} /></p>
            <span className="kpi-sub">خلال 24 ساعة</span>
          </div>
        </TiltCard>
      </div>

      {/* 🌤️ بطاقة الطقس اليومي — فوق الخريطة مباشرة، تتحدّث لحظياً مع أي حفظ توقعات */}
      {weatherEligible && (<div className="card-surface p-4 md:p-6 animate-fade-in-up">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <span className="text-[var(--accent)]"><WeatherIcon /></span>
            {lang === 'ar' ? 'الطقس اليومي' : 'Daily Weather'}
            <span className="text-xs font-bold text-[var(--muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-full px-2 py-0.5" dir="ltr">{weatherDateLabel}</span>
          </h3>
          <span className="ops-chip text-[var(--info)] border-[var(--info-soft)] bg-[var(--info-soft)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--info)] animate-pulse" /> {lang === 'ar' ? 'تجميع آلي للورديات الثلاث' : 'Auto aggregation of the 3 shifts'}</span>
        </div>
        {dailyWeather.length === 0 ? (
          <p className="text-[var(--muted)] text-sm">{lang === 'ar' ? 'لا توجد توقعات جوية موثقة بعد لهذا اليوم.' : 'No weather forecasts recorded for today yet.'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {weatherHighlights.map((m, i) => (
              <div key={m.key} className="kpi-card card-surface p-3.5 rounded-2xl border border-[var(--border)] spot-card animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[var(--muted)] font-bold text-xs">{lang === 'ar' ? m.ar : m.en}</h4>
                  <span className="text-[var(--faint)] font-bold text-[10px]">{m.unit}</span>
                </div>
                <div className="text-[11px] font-bold leading-relaxed">
                  <p className="text-[var(--ink)] truncate">{lang === 'ar' ? 'العظمى' : 'Max'}: {m.maxRow ? `${m.maxRow.branch_name} (${m.maxRow[`${m.key}_max`]}${m.unit})` : <span className="text-[var(--faint)]">—</span>}</p>
                  <p className="text-[var(--muted)] truncate mt-0.5">{lang === 'ar' ? 'الصغرى' : 'Min'}: {m.minRow ? `${m.minRow.branch_name} (${m.minRow[`${m.key}_min`]}${m.unit})` : <span className="text-[var(--faint)]">—</span>}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* 💡 صغرنا المسافات الداخلية في الموبايل */}
      <div className="card-surface p-4 md:p-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <h3 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2">
          <span className="text-[var(--accent)]"><MapIcon /></span> خريطة الانتشار التفاعلية الفروع (انقر للفلترة أو إلغاء التحديد)
        </h3>
        {/* 💡 الارتفاع بقى 300 في الموبايل و 450 في الديسكتوب */}
        <div className="h-[300px] md:h-[450px] w-full rounded-2xl overflow-hidden border border-[var(--border)] relative z-0">
          <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
            <ThemedTileLayer />
            {/* 💡 الخريطة الرئيسية للفروع فقط */}
            {branches.map(branch => branch.lat && branch.lng ? (
                <Marker keyboard={false} key={`dash-marker-${branch.id}`} position={[branch.lat, branch.lng]} icon={branchIcon} eventHandlers={{ click: () => { setSelectedBranchName(prev => prev === branch.name ? null : branch.name); document.getElementById('main-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top">
                    <strong className="text-[var(--ink-2)] font-bold text-sm text-center block mb-1">{branch.name === 'القاهرة' ? 'المركز العام (القاهرة)' : branch.name}</strong>
                    <span className="text-[10px] text-blue-600 block text-center font-bold">{selectedBranchName === branch.name ? 'مفعل (انقر للإلغاء)' : 'انقر للفلترة'}</span>
                  </Tooltip>
                </Marker>
              ) : null
            )}
          </MapContainer>
        </div>
      </div>

      {/* 📡 الفيد الحي — آخر التحديثات الميدانية (قراءة فقط من بيانات المهام) */}
      <div className="card-surface p-4 md:p-6 animate-fade-in-up">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <span className="text-[var(--accent)]"><AlertIcon /></span> آخر التحديثات الميدانية
          </h3>
          <span className="ops-chip text-[var(--info)] border-[var(--info-soft)] bg-[var(--info-soft)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--info)] animate-pulse" /> فيد لحظي — من سجل المهام</span>
        </div>
        {latestMissions.length === 0 ? (
          <p className="text-[var(--muted)] text-sm">لا توجد مهام مسجلة بعد.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {latestMissions.map((m, i) => (
              <div key={`rail-${m.mission_id}_${i}`} className="rail-item animate-fade-in-up" style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusTone(m)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-bold text-sm truncate text-[var(--ink)]">{m.mission_name || 'مهمة'}</p>
                    {m.mission_classification === 'مفتوحة' && <span className="badge badge-active shrink-0">مفتوحة</span>}
                  </div>
                  <p className="text-xs text-[var(--muted)] truncate mt-0.5" dir="auto">
                    {m.branch ? `${m.branch} · ` : ''}
                    {m.exit_date && m.exit_date !== '-' ? `تحرك: ${formatDateTime(m.exit_date)}` : formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
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
      <div className="flex justify-between items-end border-b border-[var(--border)] pb-4">
        <h2 className="text-xl font-bold text-[var(--accent)]">
          {selectedBranchId && displayedBranches.length > 0 ? `بيانات تمركز: ${displayedBranches[0]?.name === 'القاهرة' ? 'المركز العام' : displayedBranches[0]?.name}` : 'البيانات الكلية (على مستوى الجمهورية)'}
        </h2>
        {selectedBranchId && (
          <button onClick={() => setSelectedBranchId(null)} className="bg-[var(--surface-4)] hover:bg-[var(--accent)] text-[var(--muted-2)] hover:text-white border border-[var(--border)] px-4 py-2 rounded-lg text-sm transition-colors shadow-lg flex items-center gap-2">
            إلغاء التحديد <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        )}
      </div>

      {/* 💡 التعديل هنا: الارتفاع هيبقى تلقائي (auto) في الموبايل عشان الخريطة واللستة ياخدوا راحتهم، و 400 في الديسكتوب */}
      <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[400px]">
        
        {/* 💡 اللستة هتاخد 250 بيكسل في الموبايل وتقدر تعملها سكرول */}
        <div className="w-full lg:w-1/4 bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden flex flex-col shadow-lg h-[250px] lg:h-auto">
          <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-4)]"><h3 className="text-md font-bold text-center">قائمة التمركزات</h3></div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-right text-sm">
              <tbody className="divide-y divide-[var(--border)]">
                {branches.map(branch => (
                  <tr key={`list-${branch.id}`} onClick={() => handleSelectBranch(branch.id)} className={`transition-colors cursor-pointer ${selectedBranchId === branch.id ? 'bg-[var(--accent-soft)] border-r-4 border-[var(--accent)]' : 'hover:bg-[var(--surface-hover)] border-r-4 border-transparent'}`}>
                    <td data-label="الفرع" className={`p-4 font-bold ${selectedBranchId === branch.id ? 'text-[var(--accent)]' : 'text-white'}`}>{branch.name === 'القاهرة' ? 'المركز العام' : branch.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* 💡 الخريطة هتاخد 350 بيكسل في الموبايل */}
        <div className="w-full lg:w-3/4 bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl relative overflow-hidden shadow-lg z-0 h-[350px] lg:h-auto">
           <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
              <ThemedTileLayer />
              {branches.map(branch => branch.lat && branch.lng ? (
                  <Marker keyboard={false} key={`marker-${branch.id}`} position={[branch.lat, branch.lng]} icon={branchIcon} eventHandlers={{ click: () => { handleSelectBranch(branch.id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('inventory-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                    <Tooltip direction="top">
                      <strong className="text-[var(--ink-2)]">{branch.name === 'القاهرة' ? 'المركز العام' : branch.name}</strong>
                    </Tooltip>
                  </Marker>
                ) : null
              )}
            </MapContainer>
        </div>
      </div>

      <div id="inventory-table-section" className="space-y-4 mt-4 scroll-mt-6">
        <h3 className="text-lg font-bold text-white border-b border-[var(--border)] pb-2">الأرصدة اللوجستية والفنية</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InventoryCard title="إجمالي شنط الإسعاف" value={totalFirstAid.toLocaleString()} unit="شنطة مجهزة" color="text-[var(--accent)]" />
          <InventoryCard title="أجهزة اتصال لاسلكي" value={totalRadios.toLocaleString()} unit="جهاز نشط" color="text-blue-500" />
          <InventoryCard title="مخزون الإيواء" value={totalTentsBlankets.toLocaleString()} unit="خيمة وبطانية" color="text-[var(--data)]" />
          <InventoryCard title="أسطول السيارات (شامل الإسعاف)" value={totalCars.toLocaleString()} unit="سيارة جاهزة" color="text-green-500" />
        </div>
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden flex flex-col shadow-lg max-h-[600px] mt-4">
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full min-w-[2200px] text-center text-xs whitespace-nowrap">
              <thead className="bg-[var(--surface-3)] text-[var(--muted-2)] sticky top-0 z-10 shadow-md">
                <tr>
                  <th className="p-4 font-semibold border-l border-[var(--border)] sticky right-0 bg-[var(--surface-3)] z-20">الفرع / التمركز</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--accent)]">سيارات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--accent)]">إسعاف</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">خيم</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">بطاطين</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">مراتب</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">ملايات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">مخدات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">حصر</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">تنك مياه</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">بستلة</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">جركن</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-blue-400">شنط إسعاف</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-blue-400">نقالات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-blue-400">مستشفى ميداني</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-blue-400">بنك دم</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">لاسلكي تترا</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">لاسلكي هواوي</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">طفايات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">مكن تطهير</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">بخاخات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">خوذ</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">فيستات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">كابات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">نظارات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">بوت</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">آيس بوكس</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--data)]">فرق إسعافات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--data)]">متطوعين إسعافات</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--data)]">فرق طوارئ</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)] bg-[var(--surface-4)] text-[var(--data)]">متطوعين طوارئ</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">فرق دعم نفسي</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">متطوعين دعم نفسي</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">فرق توعية</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">متطوعين توعية</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">مدربين (مركز عام)</th>
                  <th className="p-4 font-semibold border-l border-[var(--border)]">مدربين (فرع)</th>
                  <th className="p-4 font-semibold">إصحاح بيئي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {displayedBranches.map((item) => (
                  <tr key={`inv-row-${item.id}`} className="hover:bg-[var(--surface-hover)] transition-colors group">
                    <td data-label="الفرع / التمركز" className="p-4 font-bold text-white group-hover:text-[var(--accent)] sticky right-0 bg-[var(--surface-2)] group-hover:bg-[var(--surface-3)] border-l border-[var(--border)] z-10">{item.name === 'القاهرة' ? 'المركز العام' : item.name}</td>
                    <td data-label="سيارات" className="p-4 text-[var(--ink-2)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.cars}</td>
                    <td data-label="إسعاف" className="p-4 text-[var(--ink-2)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.ambulances}</td>
                    <td data-label="خيم" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.tents}</td>
                    <td data-label="بطاطين" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.blankets}</td>
                    <td data-label="مراتب" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.mattresses}</td>
                    <td data-label="ملايات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.bed_sheets}</td>
                    <td data-label="مخدات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.pillows}</td>
                    <td data-label="حصر" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.plastic_mats}</td>
                    <td data-label="تنك مياه" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.water_tanks}</td>
                    <td data-label="بستلة" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.plastic_buckets}</td>
                    <td data-label="جركن" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.plastic_jerrycans}</td>
                    <td data-label="شنط إسعاف" className="p-4 text-blue-400 font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.first_aid_kits}</td>
                    <td data-label="نقالات" className="p-4 text-[var(--ink-2)] bg-[var(--surface-week)] border-l border-[var(--border)]">{item.stretchers}</td>
                    <td data-label="مستشفى ميداني" className="p-4 text-[var(--ink-2)] bg-[var(--surface-week)] border-l border-[var(--border)]">{item.hospitals > 0 ? '✔️' : '-'}</td>
                    <td data-label="بنك دم" className="p-4 text-[var(--ink-2)] bg-[var(--surface-week)] border-l border-[var(--border)]">{item.blood_banks > 0 ? '✔️' : '-'}</td>
                    <td data-label="لاسلكي تترا" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.motorola_radios}</td>
                    <td data-label="لاسلكي هواوي" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.huawei_radios}</td>
                    <td data-label="طفايات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.fire_extinguishers}</td>
                    <td data-label="مكن تطهير" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.disinfection_machines}</td>
                    <td data-label="بخاخات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.manual_sprayers}</td>
                    <td data-label="خوذ" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.helmets}</td>
                    <td data-label="فيستات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.vests}</td>
                    <td data-label="كابات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.caps}</td>
                    <td data-label="نظارات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.plastic_goggles}</td>
                    <td data-label="بوت" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.plastic_boots}</td>
                    <td data-label="آيس بوكس" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.ice_boxes}</td>
                    <td data-label="فرق إسعافات" className="p-4 text-[var(--data)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.first_aid_teams}</td>
                    <td data-label="متطوعين إسعافات" className="p-4 text-[var(--data)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.first_aid_vols}</td>
                    <td data-label="فرق طوارئ" className="p-4 text-[var(--data)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.emergency_teams}</td>
                    <td data-label="متطوعين طوارئ" className="p-4 text-[var(--data)] font-bold bg-[var(--surface-week)] border-l border-[var(--border)]">{item.emergency_vols}</td>
                    <td data-label="فرق دعم نفسي" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.psych_support_teams}</td>
                    <td data-label="متطوعين دعم نفسي" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.psych_support_vols}</td>
                    <td data-label="فرق توعية" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.health_awareness_teams}</td>
                    <td data-label="متطوعين توعية" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.health_awareness_vols}</td>
                    <td data-label="مدربين (مركز عام)" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.first_aid_trainers_hq}</td>
                    <td data-label="مدربين (فرع)" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{item.first_aid_trainers_branch}</td>
                    <td data-label="إصحاح بيئي" className="p-4 text-[var(--muted-2)]">{item.wash_vols}</td>
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
function MissionsView({ branches, isVolunteer, isJoker, isSupervisor, isOwner, isSidebarOpen, liveUpdateVersion, pulseMissions = [], liveMissionEvents = [], lang = 'ar', focusTarget = null }) {
  const [customAlert, setCustomAlert] = useState(null);
  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
  // 📥 نافذة تأكيد تنزيل السجل الفردي (محايدة وغير تحذيرية)
  const [downloadTarget, setDownloadTarget] = useState(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');
const [isModalOpen, setIsModalOpen] = useState(false);
  const [missionToDelete, setMissionToDelete] = useState(null);
  const [currentMissionData, setCurrentMissionData] = useState(null);
  const [isModalLoading, setIsModalLoading] = useState(false); // فتح فوري بسكلتون ثم البيانات
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 💡 خطأ فتح الاستمارة: يُعرض داخل المودال ولا يغلقه أبداً
  const [modalError, setModalError] = useState(null);
  // 💡 حماية من التكرار والسباق: الطلب قيد التشغيل + آخر مهمة فُتحت (لإعادة المحاولة)
  const inFlightMissionRef = useRef(null);
  const currentMissionIdRef = useRef(null);
  // 🔑 مفتاح ثابت لكل مرة يتفتح فيها فورم "مهمة جديدة" - بيتبعت مع كل محاولة إرسال
  // عشان السيرفر يقدر يرفض أي تكرار حتى لو الزرار اتضغط أكتر من مرة أو حصل تأخير في الشبكة.
  const newMissionIdempotencyKey = useRef(null);
  // 🔒 قفل إرسال لحظي (متزامن): يمنع أي ضغطة مزدوجة / Enter متكرر أثناء تنفيذ mutation
  // (isSubmitting هو state غير متزامن، فحده وحده لا يمنع السباق في نفس الـ tick)
  const submitLockRef = useRef(false);
  // 🆕 عدّادات حية للساعات: نحتفظ بالقيم في refs ثابتة حتى لا يعيد جدولة نفسه الـ useEffect (deps = refs فقط)
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;
  const liveMissionIdRef = useRef(null);
  liveMissionIdRef.current = currentMissionData?.mission_id ?? null;
  const liveMissionStatusRef = useRef(null);
  liveMissionStatusRef.current = currentMissionData?.status ?? null;
  // 🛡️ الحفاظ على حالة حقول «التواريخ والتوقيتات» (State Preservation):
  //    - timelineTouchedRef: الحقول التي حرّرها المستخدم فعلياً هذا الجلسة.
  //    - على الإرسال، الحقل غير المحرَّر الذي قرأ فارغاً يُحافَظ على آخر قيمته المحفوظة
  //      بدلاً من تجريده إلى null — حماية من أي إعادة ترطيب/تنسيق تُسقط القيمة خارج الناقل.
  const timelineTouchedRef = useRef(new Set());
  const touchTimeline = (id) => timelineTouchedRef.current.add(id);
  const timelineFieldValue = (id, storedKey) => {
    const raw = document.getElementById(id)?.value;
    if (raw) return raw;
    const prev = currentMissionData?.[storedKey];
    if (prev && !timelineTouchedRef.current.has(id)) return prev;
    return null;
  };
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  // 🆕 تاريخ/وقت إنشاء المهمة — يُلتقط مرة واحدة عند أول إنشاء الاستمارة، ثابت على
  // إعادة الفتح/الحفظ؛ يُعدَّله المالك فقط (backend يمنع غيره بـ 403).
  const [creationDateTime, setCreationDateTime] = useState('');

  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnText, setReturnText] = useState('');
  const [returnError, setReturnError] = useState('');
  const [mainRouteTitle, setMainRouteTitle] = useState('خط السير الأساسي');
  const [routes, setRoutes] = useState([{ id: 1 }]); 
  const [customItineraries, setCustomItineraries] = useState([]);
  const [vehicles, setVehicles] = useState([{ id: 1 }]);
  const [participants, setParticipants] = useState([{ id: 1 }]);
  const [beneficiaries, setBeneficiaries] = useState([{ id: 1 }]);
  // 🆕 كتالوج الانضمام/الانفصال — سجلات على مستوى المهمة (قابلة للاستخدام المتعدد)
  //    { id, title, kind: 'join'|'leave', dt } تُسنَد للمشاركين عبر مفاتيح
  //    «JL:J:<title>» / «JL:L:<title>» في خط السير المخصص (مصدر الحقيقة الوحيد للمشاركة).
  const [joinLeaveEntries, setJoinLeaveEntries] = useState([]);
  // 🆕 نافذة إنشاء/تعديل سجل انضمام أو انفصال (الكتالوج — لا زر لكل مشارك)
  const [entryDialog, setEntryDialog] = useState(null); // { mode: 'join'|'leave', editId?, dt? }
  // 🆕 معاينة حية داخل نافذة السجل — تُحدَّث من onChange للحقول الذكية (لا نقرأ DOM أثناء render)
  const [jlDraft, setJlDraft] = useState({ date: '', time: '' });
  // 🆕 كل المتطوعين عبر كل الفروع — لاختيار مشارك من أي فرع (#6)
  const [allVolunteers, setAllVolunteers] = useState([]);
  // 📋 الحقول الإلزامية (متطلب جديد): touched بعد أول محاولة مرفوضة،
  // attemptStatus آخر status حاول المستخدم تنفيذه (لعرض أخطاء الإنهاء عند التمام فقط)،
  // validationNonce يتغير عند أي تعديل على حقل إلزامي لإعادة الحساب الفوري.
  const [requiredTouched, setRequiredTouched] = useState(false);
  const [attemptStatus, setAttemptStatus] = useState(null);
  const [missingFields, setMissingFields] = useState([]);
  const [validationNonce, setValidationNonce] = useState(0);
  const [missionName, setMissionName] = useState('');

  const [missionsList, setMissionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRegionTab, setActiveRegionTab] = useState('all');
  // 🆕 فلتر الفروع — بجانب فلتر الأقاليم؛ الافتراضي «كل الفروع» مثل «كل الأقاليم»
  const [filterBranch, setFilterBranch] = useState('all');

  // 1. الدالة السحرية بأمان تام (لمنع أي شاشة بيضاء)
  const normalizeName = (name) => {
    if (!name) return '';
    return String(name).replace(/[أإآا]/g, 'ا').replace(/[يى]/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, '').trim();
  };

  // 2. خريطة الأقاليم بناءً على الأسماء الموحدة
  const regionMap = {
    'المركزالعام': 'hq', 'القاهره': 'hq', 'الجيزه': 'hq', 'القليوبيه': 'hq', 'البحيره': 'hq', 'الاسكندريه': 'hq', 'مرسيمطروح': 'hq', 'مطروح': 'hq',
    'الاسماعيليه': 'canal', 'بورسعيد': 'canal', 'السويس': 'canal', 'شمالسيناء': 'canal', 'جنوبسيناء': 'canal', 'الشرقيه': 'canal',
    'الغربيه': 'delta', 'الدقهليه': 'delta', 'كفرالشيخ': 'delta', 'المنوفيه': 'delta', 'دمياط': 'delta',
    'الفيوم': 'saeed', 'بنيسويف': 'saeed', 'المنيا': 'saeed', 'اسيوط': 'saeed', 'سوهاج': 'saeed', 'قنا': 'saeed', 'الاقصر': 'saeed', 'اسوان': 'saeed', 'الواديالجديد': 'saeed', 'البحرالاحمر': 'saeed'
  };

  // 3. خريطة الأقاليم بناءً على أرقام الفروع (مستحيل تغلط لو الأسماء اتغيرت)
  const branchIdToRegion = {
    19: 'hq', 13: 'hq', 20: 'hq', 8: 'hq', 12: 'hq', 32: 'hq', 
    9: 'canal', 25: 'canal', 15: 'canal', 29: 'canal', 26: 'canal', 16: 'canal',
    17: 'delta', 14: 'delta', 31: 'delta', 21: 'delta', 27: 'delta',
    18: 'saeed', 24: 'saeed', 22: 'saeed', 7: 'saeed', 28: 'saeed', 30: 'saeed', 10: 'saeed', 6: 'saeed', 23: 'saeed', 11: 'saeed'
  };

  // 4. استخراج بيانات اليوزر وتحديد إقليمه (تأمين ثلاثي الأبعاد ضد أخطاء الكاش)
  let currentUserData = {};
  try {
    currentUserData = JSON.parse(sessionStorage.getItem('user') || '{}');
  } catch (e) {
    currentUserData = {}; // كاش تالف في localStorage — لا نكسر التطبيق
  }
  const username = String(currentUserData?.username || '').toLowerCase();
  const userBranchId = Number(currentUserData?.branches?.[0]?.branch_id || currentUserData?.branch_id || 19);
  const userBranchName = String(currentUserData?.branches?.[0]?.branch_name || currentUserData?.branch || 'المركز العام');
  
  let userRegion = 'hq'; // الافتراضي
  
  if (username.includes('delta')) userRegion = 'delta';
  else if (username.includes('canal')) userRegion = 'canal';
  else if (username.includes('upper') || username.includes('saeed')) userRegion = 'saeed';
  else if (branchIdToRegion[userBranchId]) userRegion = branchIdToRegion[userBranchId];
  else userRegion = regionMap[normalizeName(userBranchName)] || 'hq';

  // 🆕 فروع كل إقليم (محتسبة من regionMap وجدول الفروع) — لأي مستوى صلاحية
  const regionBranches = useMemo(() => {
    const byRegion = { hq: [], canal: [], delta: [], saeed: [] };
    (branches || []).forEach(b => {
      const region = regionMap[normalizeName(b.name)] || 'hq';
      if (!byRegion[region].some(x => x.id === b.id)) byRegion[region].push(b);
    });
    return byRegion;
  }, [branches]);

  // 🆕 خيارات فلتر الفروع: متطوع ⇒ فروع إقليمه فقط | إداري ⇒ cascade حسب الإقليم المختار
  const branchFilterOptions = useMemo(() => {
    if (isVolunteer) return regionBranches[userRegion] || [];          // قفل أمني: إقليم المتطوع فقط
    if (activeRegionTab === 'all') {
      const all = [];
      Object.values(regionBranches).forEach(arr => arr.forEach(b => { if (!all.some(x => x.id === b.id)) all.push(b); }));
      return all;
    }
    return regionBranches[activeRegionTab] || [];
  }, [isVolunteer, userRegion, activeRegionTab, regionBranches]);

  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [missionViewType, setMissionViewType] = useState('all_types'); 
  const [missionClass, setMissionClass] = useState('عادية');

  // 🔧 المحرك الموحد: هل للمهمة أيام/مجموعات مخصصة فعلية (بعناوين)؟
  //    تحل محل الاعتماد على التصنيف (مفتوحة/عادية) لتحريك أعمدة الجدول
  //    ومنتقى الأيام واشتراط اليوم في الانضمام/الانفصال.
  const hasDayGroups = customItineraries.length > 0
    && customItineraries.some(ci => String(ci.title || '').trim() !== '');
  const [statusFilter, setStatusFilter] = useState('all'); 
  const [searchTerm, setSearchTerm] = useState(''); 

  const fetchMissions = async (silent = false) => {
    if (!silent) setIsLoading(true);
    const token = getStoredAccessToken();
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/missions', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.status === 401) {
        clearStoredAuth();
        setUserData(null);
        navigate('/');
        return;
      }
      if (res.ok) setMissionsList(await res.json());
    } catch {
      // Keep the Dashboard shell mounted when mission data is unavailable.
    }
    finally { if (!silent) setIsLoading(false); }
  };

  useEffect(() => { fetchMissions(); }, []);

  // 🎯 تتبّع إشعار المهام: ننزل إلى الصف المستهدف ونومّضه دون لمس فلاتر المستخدم الحالية.
  //    لو الصف غير ظاهر في العرض الحالي (فلتر/بحث) أو سلعة محذوفة → تُفتح الصفحة فقط (سقوط آمن).
  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'missions' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) {
        window.clearInterval(iv);
      }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  // 🔄 لو التاب ده مفتوح فعلاً وحصل تحديث لحظي (زي المتطوع بعت استمارة، أو الجوكر رجعها)
  // نعمل Refetch تلقائي (silent) من غير ما ننتظر المستخدم يعمل Refresh يدوي — وبدون وميض سكلتونز.
  const isFirstLiveUpdate = useRef(true);
  useEffect(() => {
    if (isFirstLiveUpdate.current) { isFirstLiveUpdate.current = false; return; }
    fetchMissions(true);
  }, [liveUpdateVersion]);

  // 🔄 إذا كانت تفاصيل مهمة مفتوحة حاليًا وتغيّرت من مستخدم آخر (حدث لحظي يخصّها)،
  // نعيد جلبها من السيرفر (مصدر الحقيقة) ونساندق حقول الاستمارة المعروضة — بدون أي reload.
  const lastSyncedEventRef = useRef(null);
  const [formGlowOn, setFormGlowOn] = useState(false);
  const formGlowTimer = useRef(null);
  const triggerFormGlow = () => {
    setFormGlowOn(true);
    clearTimeout(formGlowTimer.current);
    formGlowTimer.current = setTimeout(() => setFormGlowOn(false), 2400);
  };
  useEffect(() => {
    const ev = Array.isArray(liveMissionEvents) && liveMissionEvents.length ? liveMissionEvents[0] : null;
    if (!ev || !isModalOpen || !currentMissionData) return;
    if (ev.mission_id !== currentMissionData.mission_id) return;
    if (lastSyncedEventRef.current === ev.event_id) return;
    lastSyncedEventRef.current = ev.event_id;
    const token = sessionStorage.getItem('access_token');
    fetch(`${BASE}/api/missions/${currentMissionData.mission_id}?client_now=${encodeURIComponent(clientNowLocal())}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setModalError(null);
        setCurrentMissionData(data);
        triggerFormGlow();
        const el = (id) => document.getElementById(id);
        const idMap = {
          f_mission_name: 'mission_name', f_mission_code: 'mission_code', f_team_code: 'team_code',
          f_mission_class: 'mission_classification', f_mission_type: 'mission_type',
          f_mission_location: 'mission_location', f_responsible_person: 'responsible_person',
          f_data_source: 'data_source',
          // 🛡️ حقول SegInputs (f_exit_date / f_arrival_date / f_completion_date /
          //    f_departure_time / f_arrival_time / f_completion_time) مستثناة هُنا عمداً:
          //    ناقلها مدعوم بـ React (value مُتحكم فيه) والكتابة المباشرة على الـ DOM تفصل
          //    عرضها عن حالتها الداخلية وتُبطَل بأول إعادة عرض — القيم الحيّة تصل عند إعادة
          //    فتح الاستمارة (مثل حقول الخط السير r_* تماماً). الحقول المخفية البسيطة فقط
          //    (f_departure_date / f_start_time / f_return_date) آمنة للتحديث المباشر.
          f_departure_date: 'departure_date', f_start_time: 'start_time', f_return_date: 'return_date',
          f_internal_notes: 'internal_notes',
        };
        Object.entries(idMap).forEach(([id, key]) => {
          const node = el(id);
          if (!node) return;
          const v = data[key];
          if (v !== undefined && v !== null && String(node.value) !== String(v)) node.value = v;
        });
        const fieldStatusNode = el('f_mission_field_status');
        if (fieldStatusNode) {
          fieldStatusNode.value = (data.notes || '').includes('[حالة الميدان: مكتملة]') ? 'مكتملة' : 'نشطة';
        }
        const notesNode = el('f_notes');
        if (notesNode && data.notes) {
          const cleaned = String(data.notes).replace(/^\[حالة الميدان:[^\]]*\]\s*/, '');
          if (String(notesNode.value) !== cleaned) notesNode.value = cleaned;
        }
      });
  }, [liveMissionEvents, isModalOpen, currentMissionData]);

  // 🆕 ساعات العمل الحية: نحدّث دورياً كل 15 ثانية بينما النافذة مفتوحة والمهمة نشطة.
  // تعتمد على refs ثابتة فقط (mission_id/status/isModalOpen) فلا يستطيع إعادة جدولة نفسه أبداً.
  useEffect(() => {
    const pid = liveMissionIdRef.current;
    const st = liveMissionStatusRef.current;
    if (!pid || !isModalOpenRef.current) return undefined;
    if (['Completed', 'Cancelled'].includes(st)) return undefined; // جليدت / ملغاة → لا عدّ حي للدقائق
    const token = sessionStorage.getItem('access_token');
    let cancelled = false;
    const applyLive = (data) => {
      if (cancelled || !data) return;
      if (String(data.mission_id) !== String(liveMissionIdRef.current)) return;
      if (!isModalOpenRef.current) return; // النافذة أُغلقت أثناء الـ await
      setCurrentMissionData(prev => {
        if (!prev) return prev;
        const merged = { ...prev };
        if (data.working_hours !== undefined && prev.working_hours !== data.working_hours) merged.working_hours = data.working_hours;
        if (data.status !== undefined && prev.status !== data.status) merged.status = data.status;
        if (data.return_status !== undefined && prev.return_status !== data.return_status) merged.return_status = data.return_status;
        // 🆕 دمج كتالوج الانضمام/الانفصال (يُحدَّث في الأحياء الحية — يُتجاهل إن غاب)
        if (data.join_leave_entries !== undefined) merged.join_leave_entries = data.join_leave_entries;
        // دمج المشاركين: الساعات/الحالة/الأيام فقط — لا نلمس تعديلات جارية (names/roles/inputs)
        const srcMap = new Map((Array.isArray(data.participants) ? data.participants : []).map(pp => [String(pp.participant_id), pp]));
        merged.participants = (prev.participants || []).map(pp => {
          const sp = srcMap.get(String(pp.participant_id));
          if (!sp) return pp;
          const np = { ...pp };
          if (sp.working_hours !== undefined) np.working_hours = sp.working_hours;
          if (sp.status !== undefined) np.status = sp.status;
          if (sp.return_status !== undefined) np.return_status = sp.return_status;
          if (sp.assigned_days !== undefined) np.assigned_days = sp.assigned_days;
          return np;
        });
        return merged;
      });
    };
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/api/missions/${pid}?client_now=${encodeURIComponent(clientNowLocal())}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!r.ok) return;
        applyLive(await r.json());
      } catch { /* انقطاع لحظي — نتجاهل ولا نكسر المودال */ }
    };
    tick();
    const iv = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []); // deps ثابتة → يعمل مرة واحدة ويقرأ القيم الحية من refs

  const addRoute = () => setRoutes([...routes, { id: Date.now() }]);
  const removeRoute = (id) => setRoutes(routes.filter(r => r.id !== id));
  const addCustomItinerary = () => setCustomItineraries([...customItineraries, { id: Date.now(), title: '', routes: [{ id: Date.now() }] }]);
  const removeCustomItinerary = (id) => setCustomItineraries(customItineraries.filter(c => c.id !== id));
  const addRouteToCustom = (customId) => setCustomItineraries(customItineraries.map(c => c.id === customId ? { ...c, routes: [...c.routes, { id: Date.now() }] } : c));
  const removeRouteFromCustom = (customId, routeId) => setCustomItineraries(customItineraries.map(c => c.id === customId ? { ...c, routes: c.routes.filter(r => r.id !== routeId) } : c));
  const updateCustomTitle = (customId, newTitle) => {
    // 🆕 إعادة تسمية يوم/خط سير مخصص — تُرحَّل القيمة القديمة في إسنادات المشاركين
    //    (assigned_days) إلى الجديدة فوراً (نفس نمط renameEntry للكتالوج) كي يظل
    //    الربط مع mission_itineraries.group_title سليماً والحساب لا ينكسر.
    const prev = customItineraries.find(c => c.id === customId);
    const oldTitle = prev && prev.title;
    setCustomItineraries(list => list.map(c => c.id === customId ? { ...c, title: newTitle } : c));
    if (oldTitle && oldTitle !== newTitle) {
      setParticipants(list => list.map(p => ({
        ...p,
        assigned_days: (p.assigned_days || []).map(d => (d === oldTitle ? newTitle : d))
      })));
    }
  };
  const addVehicle = () => setVehicles([...vehicles, { id: Date.now() }]);
  const addParticipant = () => setParticipants([...participants, { id: Date.now() }]);
  const addBeneficiary = () => setBeneficiaries([...beneficiaries, { id: Date.now() }]);
  const removeVehicle = (id) => setVehicles(vehicles.filter(v => v.id !== id));
  const removeParticipant = (id) => setParticipants(participants.filter(p => p.id !== id));
  const removeBeneficiary = (id) => setBeneficiaries(beneficiaries.filter(b => b.id !== id));

  // 🆕 انضمام / تسجيل انفصال — قطاعات مستقلة عبر السيرفر (لا نافذة فترات يدوية)
  // ⚖️ دورة الحياة: «مسودة المهمة = مسودة المشاركة». الانضمام/الانفصال أثناء المسودة
  // ⚖️ مفاتيح تخصيص الكتالوج المشفّرة — مطابقة تامة مع backend (split_assigned_days):
  //    «JL:J:<title>» انضمام / «JL:L:<title>» انفصال؛ أي شيء آخر = مجموعة خط سير حرفية.
  const splitAssignedDays = (arr) => {
    const routes = [], events = [];
    for (const a of arr || []) {
      if (a && a.startsWith('JL:J:')) events.push({ kind: 'join', title: a.slice(5) });
      else if (a && a.startsWith('JL:L:')) events.push({ kind: 'leave', title: a.slice(5) });
      else routes.push(a);
    }
    return { routes, events };
  };
  const jlKey = (kind, title) => `JL:${kind === 'join' ? 'J' : 'L'}:${title}`;
  // 🆕 إدارة كتالوج الانضمام/الانفصال (قائمة المهمة — تصبح مشاركة فعلاً عند الإسناد):
  //    إنشاء/تعديل/حذف سجل بأي حالة مهمة — يُعاد الاشتقاق عند الحفظ (مثل المسارات).
  const openEntryDialog = (mode, edit) => {
    setJlDraft(edit
      ? { date: String(edit.dt || '').slice(0, 10), time: String(edit.dt || '').slice(11, 16) }
      : { date: '', time: '' });
    setEntryDialog(edit
      ? { mode: edit.kind, editId: edit.id, title: edit.title, dt: edit.dt }
      : { mode, title: '', dt: '' });
  };
  const saveEntry = () => {
    if (!entryDialog) return;
    const title = String(entryDialog.title || '').trim();
    const dateVal = document.getElementById(entryDialog.mode === 'join' ? 'jl_join_date' : 'jl_leave_date')?.value || '';
    const timeVal = document.getElementById(entryDialog.mode === 'join' ? 'jl_join_time' : 'jl_leave_time')?.value || '';
    if (!title) return setCustomAlert("أدخل عنوان السجل أولاً.");
    if (!dateVal || !timeVal) return setCustomAlert("أدخل التاريخ والوقت أولاً.");
    const dt = `${dateVal} ${timeVal}`;
    const dup = joinLeaveEntries.some(e =>
      e.id !== entryDialog.editId &&
      e.kind === entryDialog.mode &&
      String(e.title || '').trim().toLowerCase() === title.toLowerCase());
    if (dup) return setCustomAlert("يوجد بالفعل سجل بنفس العنوان — اختر عنواناً مختلفاً.");
    if (entryDialog.editId) {
      // إعادة تسمية/نقل كتالوج — نُرحّل مفاتيح JL:* في إسنادات المشاركين (مثل backend PATCH)
      const prev = joinLeaveEntries.find(x => x.id === entryDialog.editId);
      if (prev) {
        const oldKey = jlKey(prev.kind, prev.title);
        const newKey = jlKey(entryDialog.mode, title);
        if (oldKey !== newKey) {
          setParticipants(list => list.map(p => ({
            ...p,
            assigned_days: (p.assigned_days || []).map(d => (d === oldKey ? newKey : d))
          })));
        }
      }
      setJoinLeaveEntries(list => list.map(e => e.id === entryDialog.editId ? { ...e, title, dt, kind: entryDialog.mode } : e));
    } else {
      setJoinLeaveEntries(list => [...list, { id: Date.now(), server: false, title, dt, kind: entryDialog.mode }]);
    }
    setEntryDialog(null);
    setJlDraft({ date: '', time: '' });
  };
  const deleteEntry = (eid) => {
    const e = joinLeaveEntries.find(x => x.id === eid);
    if (!e) return;
    // احذف دعائم الإسناد من كل المشاركين مع السجل (مثل الـ backend: key يُحذف أيضاً)
    const key = jlKey(e.kind, e.title);
    setParticipants(list => list.map(p => ({
      ...p,
      assigned_days: (p.assigned_days || []).filter(d => d !== key)
    })));
    setJoinLeaveEntries(list => list.filter(x => x.id !== eid));
    setCustomAlert("حُذف سجل الانضمام/الانفصال (وفي أي إسناد له لدى المشاركين) — يُعاد الاشتقاق عند الحفظ.");
  };
  // إعادة تسمية سجل من بطاقته مباشرة — تُحدَّث مفاتيح الإسناد JL:* فوراً (مطابقة للـ backend
  //    في PATCH endpoint: عند تغيّر العنوان يُرحَّل مفتاح الإسناد القديم إلى الجديد).
  const renameEntry = (id, title) => {
    const prev = joinLeaveEntries.find(x => x.id === id);
    if (!prev) return;
    const clean = String(title || '').trim();
    // عنوان فارغ أو بدون تغيير فعلي → لا شيء (الحقل المتحكم يرتد في هذه الحالة)
    if (!clean || clean.toLowerCase() === String(prev.title || '').trim().toLowerCase()) return;
    const dup = joinLeaveEntries.some(x =>
      x.id !== id && x.kind === prev.kind && String(x.title || '').trim().toLowerCase() === clean.toLowerCase());
    if (dup) { setCustomAlert("يوجد بالفعل سجل بنفس العنوان — اختر عنواناً مختلفاً."); return; }
    const oldKey = jlKey(prev.kind, prev.title);
    const newKey = jlKey(prev.kind, clean);
    setJoinLeaveEntries(list => list.map(x => x.id === id ? { ...x, title: clean } : x));
    if (oldKey !== newKey && clean && clean.trim()) {
      setParticipants(list => list.map(p => ({
        ...p,
        assigned_days: (p.assigned_days || []).map(d => (d === oldKey ? newKey : d))
      })));
    }
  };
  // تعيين/إلغاء تعيين سجل — بأي حالة مهمة (مسامح: انفصال بلا بدء = صفر ساعات حتى يُسنَد أحد)
  const toggleJLAssignment = (pIdx, entry) => {
    const key = jlKey(entry.kind, entry.title);
    const p = participants[pIdx];
    if (!p) return;
    const days = p.assigned_days || [];
    if (days.includes(key)) {
      setParticipants(list => list.map((pp, i) => i === pIdx ? { ...pp, assigned_days: (pp.assigned_days || []).filter(d => d !== key) } : pp));
      return;
    }
    setParticipants(list => list.map((pp, i) => i === pIdx ? { ...pp, assigned_days: [...(pp.assigned_days || []), key] } : pp));
  };

  // 🔧 اختيار أيام/خطوط متعددة — أي مهمة لها مجموعات
  const [daysPicker, setDaysPicker] = useState(null); // participant index or null
  const toggleAssignedDay = (pIndex, title) => setParticipants(prev => prev.map((p, i) => {
    if (i !== pIndex) return p;
    const days = p.assigned_days || [];
    return { ...p, assigned_days: days.includes(title) ? days.filter(d => d !== title) : [...days, title] };
  }));

  
  // 🆕 تحميل كل المتطوعين عبر الفروع لاختيار المشارك (#6)
  const loadAllVolunteers = async () => {
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/volunteers/all', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setAllVolunteers(await res.json());
    } catch (e) { /* تجاهل: الاختيار يبقى بالكتابة اليدوية */ }
  };

  // اختيار مشارك من القائمة: تعبئة الاسم + رقم العضوية + الفرع تلقائياً
  const handleParticipantNameChange = (e, index) => {
    const val = e.target.value;
    const matched = allVolunteers.find(v => v.full_name === val);
    const newP = [...participants];
    newP[index].full_name = val;
    if (matched) {
      newP[index].volunteer_id = matched.volunteer_id;
      newP[index].membership_number = matched.membership_number || '';
      newP[index].branch_id = matched.branch_id;
      newP[index].participation_role = matched.membership_number || '';
      const roleEl = document.getElementById(`p_role_${index}`);
      if (roleEl) roleEl.value = matched.membership_number || '';
      const brEl = document.getElementById(`p_branch_${index}`);
      if (brEl) brEl.value = String(matched.branch_id || '');
      const posEl = document.getElementById(`p_position_${index}`);
      if (posEl) posEl.value = '';
    }
    setParticipants(newP);
  };

  const handleCreateNew = () => {
    inFlightMissionRef.current = null;   // تجاهل أي استجابة مهمة قادمة متأخرة
    currentMissionIdRef.current = null;
    setModalError(null);
    setCurrentMissionData(null);
    timelineTouchedRef.current = new Set();
    setCreationDateTime(isoLocal(new Date())); // 🆕 لحظة أول إنشاء الاستمارة (قيمة المستخدم)
    newMissionIdempotencyKey.current = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    setMissionName('');
    setMainRouteTitle('خط السير الأساسي');
    setMissionClass('عادية');
    setRoutes([{ id: Date.now() }]);
    setCustomItineraries([]);
    setVehicles([{ id: Date.now() }]);
    setParticipants([{ id: Date.now() }]);
    setBeneficiaries([{ id: Date.now() }]);
    setEntryDialog(null);
    setJlDraft({ date: '', time: '' });
    setJoinLeaveEntries([]);
    setDaysPicker(null);
    loadAllVolunteers(); // 🆕 كل الفروع (#6)
    setIsModalLoading(false);
    setIsModalOpen(true);
  };

  const handleViewMission = async (missionId) => {
    if (inFlightMissionRef.current === missionId) return; // منع طلبات مكررة من النقر المزدوج
    const token = sessionStorage.getItem('access_token');
    inFlightMissionRef.current = missionId;
    currentMissionIdRef.current = missionId;
    // 💡 فتح فوري: المودال يظهر بسكلتون فوراً ثم تُحقن البيانات — بدون انتظار الشبكة
    setModalError(null);
    setIsModalLoading(true);
    setIsModalOpen(true);
    try {
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/missions/${missionId}?client_now=${encodeURIComponent(clientNowLocal())}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (inFlightMissionRef.current !== missionId) return; // فُتحت مهمة/فورم أخرى في الأثناء — تجاهل القديم
      if (res.ok) {
        const data = await res.json();
        if (inFlightMissionRef.current !== missionId) return; // فحص ثانٍ بعد قراءة JSON
        setCurrentMissionData(data);
        timelineTouchedRef.current = new Set();
        setMissionName(data.mission_name || '');
        setMissionClass(data.mission_classification || 'عادية');
        // 🆕 تاريخ الإنشاء يبقى كما هو على إعادة الفتح (لا يُلتقط من جديد أبداً)
        setCreationDateTime(data.creation_datetime || data.created_at || '');
        
        // 🔧 المحرك الموحد: خط سير أساسي + أيام/مجموعات مخصصة معاً —
        //    تبقى المهمة نفسها مهما نما خط سيرها (بلا تصنيف). 'خط السير الأساسي'
        //    يذهب لمحرّره البسيط (من/إلى + تواريخ كاملة)؛ والباقي لمجموعات مخصصة.
        //    تحويل backend date/time → datetime-local للـ RouteCard UI
        const combineDateTime = (date, time) => (date && time ? `${date}T${time}` : '');
        if (data.routes && data.routes.length > 0) {
          const mainR = data.routes.filter(r => r.group_title === 'خط السير الأساسي');
          const customR = data.routes.filter(r => r.group_title !== 'خط السير الأساسي');
          setRoutes(mainR.length ? mainR.map((r, i) => ({
            id: i,
            ...r,
            departure_datetime: combineDateTime(r.departure_date, r.departure_time),
            arrival_datetime: combineDateTime(r.arrival_date, r.arrival_time)
          })) : [{ id: Date.now() }]);
          if (customR.length > 0) {
            const grouped = customR.reduce((acc, curr) => {
              if (!acc[curr.group_title]) acc[curr.group_title] = [];
              acc[curr.group_title].push({
                id: Date.now() + Math.random(),
                ...curr,
                departure_datetime: combineDateTime(curr.departure_date, curr.departure_time),
                arrival_datetime: combineDateTime(curr.arrival_date, curr.arrival_time)
              });
              return acc;
            }, {});
            setCustomItineraries(Object.keys(grouped).map((title, i) => ({ id: i, title: title, routes: grouped[title] })));
          } else { setCustomItineraries([]); }
        } else { setRoutes([{ id: Date.now() }]); setCustomItineraries([]); }

        setVehicles((data.vehicles && data.vehicles.length > 0) ? data.vehicles.map((v, i) => ({ id: i, ...v })) : [{ id: Date.now() }]);
        setParticipants((data.participants && data.participants.length > 0) ? data.participants.map((p, i) => ({ id: i, ...p })) : [{ id: Date.now() }]);
        // 🆕 كتالوج الانضمام/الانفصال — سجلات المهمة (تُسنَد للمشاركين عبر مفاتيح JL:*)
        //    `server` يميّز السجلات القادمة من الـ DB (تُرسل مع entry_id للإبقاء على الهوية)
        //    من السجلات المحلية الجديدة (تُرسل بلا entry_id ⇒ تُدرج INSERT عند أول حفظ).
        setJoinLeaveEntries((data.join_leave_entries && data.join_leave_entries.length > 0)
          ? data.join_leave_entries.map((e, i) => ({ id: e.entry_id ?? i, server: e.entry_id != null, title: e.title, kind: e.kind, dt: e.dt }))
          : []);
        setBeneficiaries((data.beneficiaries && data.beneficiaries.length > 0) ? data.beneficiaries.map((b, i) => ({ id: i, ...b })) : [{ id: Date.now() }]);
        inFlightMissionRef.current = null; // انتهى الطلب بنجاح — يسمح بإعادة الفتح لاحقاً
        setIsModalLoading(false);
        setIsModalOpen(true);
        loadAllVolunteers(); // 🆕 كل الفروع (#6)
      } else {
        // 💡 لا نغلق الاستمارة بسبب خطأ من السيرفر: نعرض خطأ واضحاً داخل المودال مع إعادة المحاولة
        inFlightMissionRef.current = null;
        setIsModalLoading(false);
        setModalError({ status: res.status });
      }
    } catch (error) {
      if (inFlightMissionRef.current !== missionId) return;
      inFlightMissionRef.current = null;
      console.error("Error fetching details:", error);
      setIsModalLoading(false);
      setModalError({ status: 0 }); // فشل اتصال/شبكة
    }
  };

  const getStaff = (role) => {
    if (!currentMissionData || !currentMissionData.eoc_staff) return '';
    const staff = currentMissionData.eoc_staff.find(s => s.role_name === role);
    return staff ? staff.staff_name : '';
  };

  const confirmDeleteMission = async () => {
    if (!missionToDelete) return;
    // 🔒 قفل متزامن: mutation واحدة في نفس السياق في كل لحظة (حذف ↔ إرسال/إرجاع...)
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/missions/${missionToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { setMissionToDelete(null); fetchMissions(); setCustomAlert("تم حذف المهمة بنجاح."); }
      else { const d = await res.json().catch(() => ({})); setCustomAlert(d.detail || "فشل حذف المهمة."); }
    } catch (error) { setCustomAlert("خطأ في الاتصال بالسيرفر!"); }
    finally { submitLockRef.current = false; }
  };

  const handleClearAllMissions = () => {
    if (!isOwner) return;
    setClearAllCode('');
    setShowClearAllConfirm(true);
};

  const confirmClearAllMissions = async () => {
    if (clearAllCode !== "301014") {
        setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
        return;
    }

    setShowClearAllConfirm(false);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("https://eoc-system-b12f.vercel.app/api/missions/clear-all", {
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

      setCustomAlert(`تم مسح جميع المهام بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      fetchMissions();
    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
  };
  const handleExportTableExcel = async () => {
    if (missionsList.length === 0) { setCustomAlert("لا توجد مهام لتصديرها."); return; }
    const missionsSheet = missionsList.map(m => ({
      "كود المهمة": m.mission_code,
      "تصنيف المهمة": m.mission_classification || "عادية",
      "تاريخ الإنشاء (السيرفر)": formatDateTime(m.created_at),
      "تاريخ المهمة (الفعلي)": m.exit_date !== '-' && m.exit_date ? formatDateTime(m.exit_date) : "غير مسجل",
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
            "التاريخ": formatDateTime(m.created_at)
          });
        });
      }
    });

    const sheets = [{ name: 'المهام الشاملة', ...gridFromRows(missionsSheet) }];
    if (beneficiariesSheet.length > 0) sheets.push({ name: 'إحصائيات المستفيدين', ...gridFromRows(beneficiariesSheet) });
    try { await exportWorkbook(sheets, `السجل_الشامل_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل الشامل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  // 🆕 تصدير الاستمارة — ملف Excel منسّق يعكس تصميم وتقسيم الاستمارة داخل النظام
  // (نفس الأقسام والترتيب والجداول)، واسم الملف هو اسم الاستمارة.
  // يُستدعى من زر التنزيل في صف الجدول: يجلب تفاصيل المهمة الكاملة (مع المسارات) ثم يُصدّر.
  const handleExportSingleMission = async (m) => {
    const text = (v) => (v === undefined || v === null ? '' : String(v));
    const val = (v) => (v === undefined || v === null ? '' : v);
    const dateT = (v) => (v ? formatDateTime(v) : '—');
    const tm12 = (v) => (v ? formatTime12(v) : '—');
    const branchName = (id) => {
      if (id == null || id === '') return '';
      if (String(id) === '19') return 'المركز العام';
      const b = branches.find(x => String(x.id) === String(id));
      return b ? b.name : String(id);
    };
    const staffName = (role) => {
      const s = ((detail && detail.eoc_staff) || []).find(x => x.role_name === role);
      return s ? s.staff_name : '';
    };

    // 🔄 جلب تفاصيل المهمة (نفس نقطة handleViewMission) — المسارات والأسطول والمشاركون تأتي هنا
    let detail = m || {};
    if (m && m.mission_id) {
      try {
        const token = sessionStorage.getItem('access_token');
        const res = await fetch(`${BASE}/api/missions/${m.mission_id}?client_now=${encodeURIComponent(clientNowLocal())}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) detail = await res.json();
      } catch (e) { /* نُبقي بيانات الصف الحالية عند فشل الشبكة */ }
    }

    const aoa = [];
    const merges = [];
    let row = 0;
    const TOTAL = 12; // أعمدة A:L
    const put = (c, v) => { if (!aoa[row]) aoa[row] = []; aoa[row][c] = v; };
    const span = (from, to) => { if (to > from) merges.push({ s: { r: row, c: from }, e: { r: row, c: to } }); };
    const section = (title) => { put(0, title); span(0, TOTAL - 1); row++; };
    const headerRow = (cols) => { cols.forEach((v, i) => put(i, v)); row++; };
    const dataRow = (cells) => { cells.forEach((v, i) => put(i, val(v))); row++; };
    const emptyRow = (msg) => { put(0, msg); span(0, TOTAL - 1); row++; };
    const field = (label, value) => {
      put(0, label); span(0, 2);
      put(3, text(value)); span(3, TOTAL - 1);
      row++;
    };

    // ── العنوان: اسم الاستمارة + كود الاستمارة + تاريخ الإنشاء ──
    const formName = text(detail.mission_name);
    const formCode = detail.mission_code;
    put(0, formName || 'استمارة مهمة'); span(0, TOTAL - 1); row++;
    const created = (detail.creation_datetime || detail.created_at) ? formatDateTime(detail.creation_datetime || detail.created_at) : '';
    put(0, `كود الاستمارة: ${formCode || '—'}${created ? `   |   تاريخ الإنشاء: ${created}` : ''}`); span(0, TOTAL - 1); row++;

    // 1) البيانات الأساسية للمهمة
    section('البيانات الأساسية للمهمة');
    field('تصنيف المهمة', detail.mission_classification);
    field('التمركز / الفرع', branchName(detail.branch_id));
    field('نوع المهمة', detail.mission_type);
    field('مكان المهمة', detail.mission_location);
    field('حالة العملية الميدانية', detail.notes && detail.notes.includes('[حالة الميدان: مكتملة]') ? 'مكتملة' : 'نشطة');
    field('مسؤول المهمة', detail.responsible_person);
    field('تاريخ إنشاء المهمة', created || '—');
    field('مصدر البلاغ', detail.data_source);

    // 2) التواريخ والتوقيتات
    section('التواريخ والتوقيتات');
    headerRow(['تاريخ المهمة', 'تاريخ الخروج', 'تاريخ الوصول', 'تاريخ العودة', 'تاريخ الانتهاء', 'ساعة البدء', 'ساعة التحرك', 'ساعة الوصول', 'ساعة الانتهاء']);
    dataRow([
      dateT(detail.exit_date), dateT(detail.departure_date), dateT(detail.arrival_date),
      dateT(detail.return_date), dateT(detail.completion_date),
      tm12(detail.start_time), tm12(detail.departure_time), tm12(detail.arrival_time), tm12(detail.completion_time),
    ]);

    // 3) تفاصيل خط السير الأساسي
    section('تفاصيل خط السير الأساسي');
    headerRow(['المجموعة', 'من', 'إلى (الوجهة)', 'تاريخ التحرك', 'ساعة التحرك', 'تاريخ الوصول', 'ساعة الوصول']);
    const allRoutes = detail.routes || [];
    let routeCount = 0;
    allRoutes.filter(r => r.group_title === 'خط السير الأساسي').forEach((r) => {
      if (!r.route_from && !r.route_to) return;
      routeCount++;
      dataRow(['خط السير الأساسي', r.route_from, r.route_to,
        r.departure_date ? dateT(r.departure_date) : '—',
        r.departure_time ? tm12(r.departure_time) : '—',
        r.arrival_date ? dateT(r.arrival_date) : '—',
        r.arrival_time ? tm12(r.arrival_time) : '—']);
    });
    if (!routeCount) emptyRow('لا توجد مسارات مسجلة');

    // 4) الأيام / خطوط السير المخصصة
    section('الأيام / خطوط السير المخصصة');
    headerRow(['المجموعة', 'من', 'إلى (الوجهة)', 'تاريخ التحرك', 'ساعة التحرك', 'تاريخ الوصول', 'ساعة الوصول']);
    const customGroups = {};
    allRoutes.filter(r => r.group_title !== 'خط السير الأساسي').forEach(r => {
      const t = r.group_title || '—';
      if (!customGroups[t]) customGroups[t] = [];
      customGroups[t].push(r);
    });
    let custCount = 0;
    Object.keys(customGroups).forEach(title => {
      customGroups[title].forEach(r => {
        if (!r.route_from && !r.route_to) return;
        custCount++;
        dataRow([title, r.route_from, r.route_to,
          r.departure_date ? dateT(r.departure_date) : '—',
          r.departure_time ? tm12(r.departure_time) : '—',
          r.arrival_date ? dateT(r.arrival_date) : '—',
          r.arrival_time ? tm12(r.arrival_time) : '—']);
      });
    });
    if (!custCount) emptyRow('لا توجد أيام / خطوط سير مخصصة');

    // 5) السيارات والسائقين (أسطول المهمة)
    section('السيارات والسائقين (أسطول المهمة)');
    headerRow(['اسم السائق', 'رقم السيارة']);
    let vCount = 0;
    (detail.vehicles || []).forEach(v => {
      if (!v.driver_name && !v.vehicle_number) return;
      vCount++;
      dataRow([v.driver_name || '', v.vehicle_number || '']);
    });
    if (!vCount) emptyRow('لا توجد سيارات');

    // 6) القوة البشرية والمشاركين (نفس أعمدة جدول الاستمارة)
    section('القوة البشرية والمشاركين');
    headerRow(['م', 'النوع', 'الاسم', 'رقم العضوية', 'صفة المشارك', 'الفريق', 'الساعات', 'خط السير المخصص', 'الفرع']);
    let pCount = 0;
    (detail.participants || []).forEach((p, i) => {
      if (!p.full_name) return;
      pCount++;
      const typeAr = p.participant_type === 'non_volunteer' ? 'غير متطوع' : 'متطوع';
      const days = (p.assigned_days || []).join(' + ') || '—';
      const wh = p.working_hours != null ? fmtHours(p.working_hours, lang) : '—';
      dataRow([i + 1, typeAr, p.full_name, p.participation_role || '', p.participant_position || '', p.team_name || '', wh, days, branchName(p.branch_id)]);
    });
    if (!pCount) emptyRow('لا يوجد مشاركون');

    // 7) كود الفريق/الإدارة
    section('كود الفريق/الإدارة');
    field('كود الفريق/الإدارة', detail.team_code);

    // 8) إحصائيات المستفيدين
    section('إحصائيات المستفيدين');
    headerRow(['تصنيف المستفيدين', 'مستفيدين (مباشر)', 'مستفيدين (غير مباشر)']);
    let bCount = 0;
    (detail.beneficiaries || []).forEach(b => {
      if (!b.category_name) return;
      bCount++;
      dataRow([b.category_name, b.direct_count, b.indirect_count]);
    });
    if (!bCount) emptyRow('لا توجد إحصائيات مسجلة');

    // 9) فريق إدارة الغرفة (الهيكل الإداري)
    section('فريق إدارة الغرفة (الهيكل الإداري)');
    headerRow(['المسؤولية', 'الاسم']);
    [
      ['مسؤول المتابعة (قائد العملية)', 'مسؤول المتابعة'],
      ['المشرف', 'المشرف'],
      ['المشرف المراجع', 'المشرف المراجع'],
      ['الجوكر', 'الجوكر'],
      ['معبئ الاستمارة', 'معبئ الاستمارة'],
      ['مستكمل الاستمارة', 'مستكمل الاستمارة'],
      ['مراجع الاستمارة', 'مراجع الاستمارة'],
    ].forEach(([label, role]) => dataRow([label, staffName(role)]));

    // 10) الحالة والملاحظات العامة
    section('الحالة والملاحظات العامة');
    const statusAr = detail.status ? ({ Draft: 'مسودة', Active: 'نشطة', 'Under Review': 'قيد المراجعة', Approved: 'معتمدة وفي انتظار الانتهاء', Completed: 'مكتملة (تم انتهاء المهمة)', Returned: 'إرجاع للمتطوع (يوجد أخطاء)', Cancelled: 'ملغاة' }[detail.status] || 'جديدة') : 'جديدة';
    field('موقف الاستمارة إدارياً', statusAr);
    field('سجل الميدان / ملاحظات عامة', detail.notes);
    field('ملاحظات داخلية', detail.internal_notes);

    // ── تصدير مصنّف منسّق (RTL · تمركز · حدود · رأس #cbcbcb) مع الحفاظ على دمج الخلايا ──
    // اسم الملف = اسم الاستمارة كما هو (مع إزالة محارف غير صالحة فقط)
    const rawName = text(detail.mission_name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'استمارة';
    try { await exportWorkbook([{
      name: 'الاستمارة',
      header: aoa[0] || [],
      rows: aoa.slice(1),
      merges: merges.map(({ s, e }) => [s.r + 1, s.c + 1, e.r + 1, e.c + 1]),
      widths: Array.from({ length: TOTAL }, (_, i) => (i === 0 ? 16 : 15)),
    }], `${rawName}_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير الاستمارة بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  // 📋 الحقول الإلزامية — أسماء/مفاتيح الحقول المطلوبة + معاينة المواقع المظلمة
  const FIELD_LABELS = {
    field_exit_date: 'تاريخ المهمة',
    field_departure_time: 'ساعة التحرك / البدء',
    field_participants: 'إضافة مشارك واحد على الأقل (بالاسم)',
    field_leader: 'مسؤول المتابعة (قائد العملية)',
    field_supervisor: 'المشرف',
    field_joker: 'الجوكر',
    field_filler: 'معبئ الاستمارة',
    field_completion_date: 'تاريخ الانتهاء (لإنهاء المهمة)',
    field_completion_time: 'ساعة الانتهاء (لإنهاء المهمة)',
    field_participant_position: 'صفة المشارك (لغير المتطوعين)',
  };

  // 🔎 قراءة الحقول الإلزامية الناقصة من الـ DOM (المصدر الحقيقي للبيانات)
  const readMissingFields = (status) => {
    const v = (id) => String(document.getElementById(id)?.value || '').trim();
    const missing = [];
    if (!v('f_exit_date')) missing.push('field_exit_date');
    if (!v('f_departure_time')) missing.push('field_departure_time');
    if (!(participants || []).some(p => String(p.full_name || '').trim() !== '')) missing.push('field_participants');
    // 🆕 صفة المشارك إلزامية لكل مشارك غير متطوع (المتطوع يُعرف برقم العضوية فقط)
    const positionMissing = participants.some((p, i) =>
      (p.participant_type || 'volunteer') === 'non_volunteer' &&
      !String(document.getElementById(`p_position_${i}`)?.value || '').trim());
    if (positionMissing) missing.push('field_participant_position');
    if (!v('eoc_leader')) missing.push('field_leader');
    if (!v('eoc_supervisor')) missing.push('field_supervisor');
    if (!v('eoc_joker')) missing.push('field_joker');
    if (!v('eoc_filler')) missing.push('field_filler');
    if (status === 'Completed') {
      if (!v('f_completion_date')) missing.push('field_completion_date');
      if (!v('f_completion_time')) missing.push('field_completion_time');
    }
    return missing;
  };

  // 🔄 إعادة الحساب الفوري للحقول الناقصة بعد أي تعديل (بعد أول محاولة مرفوضة فقط)
  useEffect(() => {
    if (requiredTouched) setMissingFields(readMissingFields(attemptStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, validationNonce]);

  const bumpValidation = () => setValidationNonce(n => n + 1);

  const handleSubmit = async (submitStatus) => {
     // 📋 متطلب الحقول الإلزامية: أي إجراء يغيّر حالة المهمة (حفظ/إرسال/اعتماد/إنهاء)
     // ممنوع ما دام حقل إلزامي ناقص — ما عدا "الإرجاع" (قرار رافض للسوبرفايزر يعمل دائماً).
     // الفحص قبل القفل المتزامن حتى لا يعلق القفل عند العودة المبكرة.
     if (submitStatus !== 'Returned') {
       // 📌 العنوان الإلزامي للأيام/خطوط السير المخصصة: أي يوم مخصص بلا عنوان يمنع
       //    الحفظ/الإرسال/الاعتماد/الإنهاء — العنوان يُحرَّر الحقول فيه. بدون أي يوم
       //    مخصص لا يوجد شرط (خط السير الأساسي لا يتطلب عنواناً). استثناء "الإرجاع"
       //    من نفس قاعدة استثناء الحقول الإلزامية أعلاه.
       const untitledCustom = customItineraries.filter(ci => String(ci.title || '').trim() === '');
       if (untitledCustom.length) {
         setRequiredTouched(true);
         setAttemptStatus(submitStatus);
         return setCustomAlert('يجب إدخال عنوان للمسار المخصص أولاً.');
       }
       const missing = readMissingFields(submitStatus);
       if (missing.length) {
         setRequiredTouched(true);
         setAttemptStatus(submitStatus);
         setMissingFields(missing);
         setCustomAlert('⚠️ لا يمكن إتمام هذه العملية — يُرجى استكمال الحقول الإلزامية التالية:\n\n' +
           missing.map(k => `• ${FIELD_LABELS[k] || k}`).join('\n'));
         return;
       }
     }
     // 🛡️ منع الإرسال المزدوج: قفل متزامن (useRef) + تعطيل الأزرار (state) —
     // القفل يُغلق لحظياً قبل أي await، فلا يمر أي double-click / Enter متكرر.
     if (submitLockRef.current || isSubmitting) return;
     submitLockRef.current = true;
     setIsSubmitting(true);
     try {
       const activeParticipants = {}; 
       let hasDuplicateError = false;

       participants.forEach((p, i) => {
         const pName = document.getElementById(`p_name_${i}`)?.value;
         if (!pName) return;

         const pRole = document.getElementById(`p_role_${i}`)?.value?.trim() || '';
         const pBranch = document.getElementById(`p_branch_${i}`)?.value || '19';
         // هوية المركّبة = رقم العضوية + الفرع (الرقم وحده ليس فريداً — يتكرر عبر الفروع)
         const branchName = (branches || []).find(b => String(b.id) === String(pBranch))?.name || pBranch;
         // 🔑 فترة الإسناد (assigned_days: أيام الخطوط + مفاتيح الانضمام/الانفصال JL:*) —
         //    مفتاح التكرار هو (الهوية + الفترة): نفس الهوية بنفس الفترة = تكرار حرفي
         //    يُمنع، ونفس الهوية بفترة مختلفة = فترة مشاركة مستقلة تُسمح (بعد LEAVE —
         //    القاعدة الأساسية: بمجرد تسجيل الانفصال يصبح المتطوع متاحاً من جديد).
         const iKey = (p?.assigned_days || []).slice().sort().join('|');
         const uniqueKey = `${pRole !== '' ? `${pRole}-${pBranch}` : `${pName}-${pBranch}`}::${iKey}`;

         if (activeParticipants[uniqueKey]) {
           setCustomAlert(`خطأ إداري: المشارك "${pName}" (رقم العضوية: ${pRole || 'بدون'} — فرع: ${branchName}) مكرر بنفس فترة الإسناد!\n\nالفترة نفسها (أيام/الانضمام-الانفصال) أُدخلت أكثر من مرة في الاستمارة. اختر فترة إسناد مختلفة — بعد تسجيل LEAVE يمكن إضافة فترة جديدة لنفس الهوية في نفس المهمة.`);
           hasDuplicateError = true;
         } else {
           activeParticipants[uniqueKey] = true;
         }
       });
       if (hasDuplicateError) return;

       const allRoutes = [];
       // 🔧 المحرك الموحد: خط السير الأساسي يُرسَل دائماً (بكل المسارات) وبتواريخ
       //    كاملة لكل مسار (التاريخ من صف المسار نفسه لا من حقول المهمة المخفية).
       //    «من/إلى» حقول منفصلة (route_from / route_to).
       //    datetime-local parsing: split 'YYYY-MM-DDTHH:MM' into date/time
       routes.forEach((_, i) => {
         const from = document.getElementById(`r_from_main_${i}`)?.value;
         const to = document.getElementById(`r_to_main_${i}`)?.value;
         const depVal = document.getElementById(`r_dep_main_${i}`)?.value || '';
         const arrVal = document.getElementById(`r_arr_main_${i}`)?.value || '';
         if (from || to) allRoutes.push({
           group_title: 'خط السير الأساسي',
           route_from: from || null,
           route_to: to,
           departure_date: depVal.split('T')[0] || null,
           departure_time: depVal.split('T')[1] || null,
           arrival_date: arrVal.split('T')[0] || null,
           arrival_time: arrVal.split('T')[1] || null
         });
       });
       customItineraries.forEach((ci, ciIndex) => {
         ci.routes.forEach((_, rIndex) => {
           const from = document.getElementById(`r_from_cust_${ciIndex}_${rIndex}`)?.value;
           const to = document.getElementById(`r_to_cust_${ciIndex}_${rIndex}`)?.value;
           const depVal = document.getElementById(`r_dep_cust_${ciIndex}_${rIndex}`)?.value || '';
           const arrVal = document.getElementById(`r_arr_cust_${ciIndex}_${rIndex}`)?.value || '';
           if (from || to) allRoutes.push({ group_title: ci.title || 'خط سير مخصص', route_from: from || null, route_to: to, departure_date: depVal.split('T')[0] || null, departure_time: depVal.split('T')[1] || null, arrival_date: arrVal.split('T')[0] || null, arrival_time: arrVal.split('T')[1] || null });
         });
       });

       const fieldStatus = document.getElementById('f_mission_field_status')?.value || 'نشطة الآن';
       
       // 🚨 التعديل الأول: منع إنهاء المهمة لو الحالة الميدانية لم تنتهي
       if (submitStatus === 'Completed' && fieldStatus !== 'مكتملة') {
         return setCustomAlert("عفواً! لا يمكن إنهاء وإغلاق المهمة إلا بعد تغيير 'حالة العملية الميدانية' في الاستمارة إلى (مكتملة).");
       }

       let generalNotes = document.getElementById('f_notes')?.value || '';
       let finalNotes = `[حالة الميدان: ${fieldStatus}]\n` + generalNotes;

       let sysNotes = document.getElementById('f_internal_notes')?.value || '';
       if (['Under Review', 'Approved', 'Completed'].includes(submitStatus)) {
           sysNotes = '';
       }

       const isClosingNow =
  submitStatus === 'Completed' &&
  currentMissionData?.status !== 'Completed';

const closeNow = new Date();
const pad2 = (n) => String(n).padStart(2, '0');

const actualCompletionDateTime =
  `${closeNow.getFullYear()}-${pad2(closeNow.getMonth() + 1)}-${pad2(closeNow.getDate())} ` +
  `${pad2(closeNow.getHours())}:${pad2(closeNow.getMinutes())}:${pad2(closeNow.getSeconds())}`;

const actualCompletionTime =
  `${pad2(closeNow.getHours())}:${pad2(closeNow.getMinutes())}`;


       const missionData = {
         mission_code: document.getElementById('f_mission_code')?.value || null,
         // 🆕 تاريخ إنشاء المهمة (إصدار المستخدم) — يُرسل كما هو، المالك فقط يعدّله
         creation_datetime: creationDateTime || null,
         mission_name: document.getElementById('f_mission_name')?.value || 'مهمة بدون اسم',
         mission_classification: document.getElementById('f_mission_class')?.value || 'عادية', 
         branch_id: parseInt(document.getElementById('f_branch_id')?.value || 19),
         mission_type: document.getElementById('f_mission_type')?.value || '',
         mission_location: document.getElementById('f_mission_location')?.value || '',
         responsible_person: document.getElementById('f_responsible_person')?.value || '',
         data_source: document.getElementById('f_data_source')?.value || '',
         status: submitStatus,
         // 🛡️ التواريخ/الأوقات: الحقل الذي لم يحرّره المستخدم (غير مسجَّل في timelineTouchedRef)
         //    يحتفظ بآخر قيمته المحفوظة لو قرأ فارغاً — لا يُكتب فوقه null أبداً (State Preservation).
         exit_date: timelineFieldValue('f_exit_date', 'exit_date'),
         departure_date: document.getElementById('f_departure_date')?.value || null,
         arrival_date: timelineFieldValue('f_arrival_date', 'arrival_date'),
         return_date: document.getElementById('f_return_date')?.value || null,
         completion_date: isClosingNow
  ? actualCompletionDateTime
  : timelineFieldValue('f_completion_date', 'completion_date'),

         start_time: document.getElementById('f_start_time')?.value || null,
         departure_time: timelineFieldValue('f_departure_time', 'departure_time'),
         arrival_time: timelineFieldValue('f_arrival_time', 'arrival_time'),
         completion_time: isClosingNow
  ? actualCompletionTime
  : timelineFieldValue('f_completion_time', 'completion_time'),

         injured_count: 0, indirect_beneficiaries_total: 0,
         notes: finalNotes,
         internal_notes: sysNotes,
         team_code: document.getElementById('f_team_code')?.value || '',
         routes: allRoutes,
         vehicles: vehicles.map((_, i) => ({ driver_name: document.getElementById(`v_driver_${i}`)?.value || '', vehicle_number: document.getElementById(`v_plate_${i}`)?.value || '' })).filter(v => v.driver_name !== '' || v.vehicle_number !== ''),
         participants: participants.map((_, i) => ({
           participant_type: document.getElementById(`p_type_${i}`)?.value || 'volunteer',
           full_name: document.getElementById(`p_name_${i}`)?.value || '',
           team_name: document.getElementById(`p_team_${i}`)?.value || '',
           participation_role: document.getElementById(`p_role_${i}`)?.value || '',
           participant_position: document.getElementById(`p_position_${i}`)?.value || '',
           branch_id: parseInt(document.getElementById(`p_branch_${i}`)?.value || 19),
           assigned_itinerary: hasDayGroups ? '' : (getSelectedOptionSourceText(document.getElementById(`p_itin_${i}`)) || 'خط السير الأساسي'),
           return_status: submitStatus === 'Completed' ? 'تم انتهاء مهمتة' : 'مازال بالمهمة',
           phase_name: document.getElementById(`p_phase_${i}`)?.value || 'اليوم الأول',
           stay_type: document.getElementById(`p_stay_${i}`)?.value || 'ذهاب وعودة',
           // 🔧 أيام/مجموعات متعددة — أي مهمة لها مجموعات فعلية أو لها كتالوج انضمام/انفصال
           //    (مفاتيح JL:* تُرسَل حرفياً — مصدر الحقيقة للمشاركة; تُفصل أمامياً عند العرض)
           ...((hasDayGroups || joinLeaveEntries.length > 0) ? { assigned_days: participants[i]?.assigned_days || [] } : {}),
           // 🆕 «يُحسب من بداية المهمة» — مفتاح نقي على مصدر البداية المخططة (افتراضي TRUE)
           start_from_mission: participants[i]?.start_from_mission !== false
         })).filter(p => p.full_name !== ''),
         beneficiaries: beneficiaries.map((_, i) => ({ category_name: document.getElementById(`b_cat_${i}`)?.value || '', direct_count: parseInt(document.getElementById(`b_count_${i}`)?.value || 0), indirect_count: parseInt(document.getElementById(`b_indirect_${i}`)?.value || 0) })).filter(b => b.category_name !== ''),
         eoc_staff: [ { role_name: 'مسؤول المتابعة', staff_name: document.getElementById('eoc_leader')?.value || '' }, { role_name: 'المشرف', staff_name: document.getElementById('eoc_supervisor')?.value || '' }, { role_name: 'المشرف المراجع', staff_name: document.getElementById('eoc_reviewer')?.value || '' }, { role_name: 'الجوكر', staff_name: document.getElementById('eoc_joker')?.value || '' }, { role_name: 'معبئ الاستمارة', staff_name: document.getElementById('eoc_filler')?.value || '' }, { role_name: 'مستكمل الاستمارة', staff_name: document.getElementById('eoc_completer')?.value || '' }, { role_name: 'مراجع الاستمارة', staff_name: document.getElementById('eoc_final_reviewer')?.value || '' } ].filter(s => s.staff_name !== ''),
         // 🆕 كتالوج الانضمام/الانفصال — سجلات المهمة (الإسناد عبر مفاتيح JL:* في assigned_days)
         //    `server` = سجل من الـ DB ⇒ نرسل entry_id لإبقاء هويته (UPDATE)؛ محلي جديد ⇒ INSERT.
         join_leave_entries: (joinLeaveEntries || []).map(e => ({
           ...(e.server ? { entry_id: e.id } : {}),
           title: e.title,
           kind: e.kind,
           dt: e.dt
         }))
       };

       const token = sessionStorage.getItem('access_token');

       // Generate or retain idempotency key for this submit attempt
       if (newMissionIdempotencyKey.current === null) {
         newMissionIdempotencyKey.current = crypto.randomUUID();
       }

       const isUpdate = currentMissionData !== null;
       const url = isUpdate ? `https://eoc-system-b12f.vercel.app/api/missions/${currentMissionData.mission_id}` : 'https://eoc-system-b12f.vercel.app/api/missions';
       const method = isUpdate ? 'PUT' : 'POST';

       const res = await fetch(url, {
         method: method,
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${token}`,
           'Idempotency-Key': newMissionIdempotencyKey.current
         },
         body: JSON.stringify(missionData)
       });
       if (res.ok) {
         // Success: clear the idempotency key so next submit gets a new key
         newMissionIdempotencyKey.current = null;
         // 💾 نجاح الحفظ — يُغلق مودال الاستبيان (تظهر القطاعات المشتقة عند إعادة فتح المهمة).
         setEntryDialog(null);
         setDaysPicker(null);
         setIsModalOpen(false);
         fetchMissions();
         const rd = await res.json().catch(() => ({}));
         setCustomAlert(isUpdate ? "تم تحديث المهمة بنجاح!" : "تم إنشاء المهمة بنجاح!");
         return { ok: true, mission_id: rd.mission_id };
       } else {
         // Error: keep the idempotency key for retry (idempotent if server actually committed)
         // ✅ Fix: res.json() throws when server returns non-JSON (504 HTML, Vercel error page).
         //    Parse safely; fall back to text so the user always sees a meaningful message.
         const errBody = await res.json().catch(async () => {
           try { return { detail: await res.text() }; } catch { return {}; }
         });
         const detail = errBody?.detail || `(status ${res.status})`;
         setCustomAlert(`🚫 تنبيه رقابي من السيرفر:\n\n${detail}`);
       }
     } catch (error) {
       // ✅ Fix: distinguish network failure from JS error for debugging
       const msg = error instanceof TypeError && error.message === 'Failed to fetch'
         ? '⚠️ فشل الاتصال بالسيرفر — تحقق من اتصال الإنترنت وحاول مرة أخرى.\n(قد يكون السيرفر يأخذ وقتاً أطول من المعتاد بسبب البرد البارد)'
         : `⚠️ خطأ غير متوقع:\n${error?.message || error}`;
       setCustomAlert(msg);
     }
     finally { setIsSubmitting(false); submitLockRef.current = false; }
  };

  const StatusBadge = ({ status }) => {
    const statuses = {
      'Draft': { text: 'مسودة', color: 'text-[var(--muted-2)] bg-[var(--surface-hover)] border-[var(--border)]' },
      'Active': { text: 'نشطة', color: 'text-[var(--ok)] bg-[var(--ok-soft)] border-[var(--ok)]/20' },
      'Under Review': { text: 'قيد المراجعة', color: 'text-[var(--warn)] bg-[var(--warn-soft)] border-[var(--warn)]/20' },
      'Approved': { text: 'معتمدة (بانتظار الانتهاء)', color: 'text-[var(--info)] bg-[var(--info-soft)] border-[var(--info)]/20' },
      'Completed': { text: 'مكتملة', color: 'text-[var(--ok)] bg-[var(--ok-soft)] border-[var(--ok)]/20' },
      'Returned': { text: 'إرجاع للمتطوع', color: 'text-[var(--warn)] bg-[var(--warn-soft)] border-[var(--warn)]/20' },
      'Cancelled': { text: 'ملغاة', color: 'text-[var(--accent)] bg-[var(--danger-soft)] border-[var(--accent)]/20' },
    };
    const s = statuses[status] || statuses['Draft'];
    return <span className={`badge ${s.color}`}>{s.text}</span>;
  };

  // 💡 Memoized: الفلاتر والإحصائيات تتحسب مرة واحدة فقط عند تغيّر مدخلاتها الحقيقية
  // (بدون إعادة حساب عند فتح/غلق المودال أو أي re-render غير متعلق) — تسريع ملموس لـ Open Modal
  const { filteredMissions, regionStats } = useMemo(() => {
    let baseMissions = missionsList;

    // 🚨 حائط الصد: المتطوع مقفول عليه إقليمه فقط
    if (isVolunteer) {
      baseMissions = baseMissions.filter(m => {
        const missionRegion = regionMap[normalizeName(m.branch)] || 'hq';
        return missionRegion === userRegion;
      });
    }

    if (missionViewType === 'open') baseMissions = baseMissions.filter(m => m.mission_classification === 'مفتوحة');
    else if (missionViewType === 'daily') baseMissions = baseMissions.filter(m => m.mission_classification !== 'مفتوحة');

    if (filterDate) {
       baseMissions = baseMissions.filter(m => {
          const createdAt = (m.created_at && m.created_at !== '-')
  ? String(m.created_at).split(/[ T]/)[0]
  : ((m.creation_datetime && m.creation_datetime !== '-')
    ? String(m.creation_datetime).split(/[ T]/)[0]
    : '');

          const isCompleted = m.status === 'Completed';
          const isCancelled = m.status === 'Cancelled';
          const isFinished = isCompleted || isCancelled;
          // Active missions persist across all days after creation until completed/cancelled
          if (!isFinished) {
             return createdAt <= filterDate;
          }
          const storedCompletedAt = (m.completion_date && m.completion_date !== '-')
  ? String(m.completion_date).split(/[ T]/)[0]
  : null;

// حماية للبيانات القديمة التي تحمل تاريخ إغلاق أقدم من إنشاء السجل
const completedAt =
  storedCompletedAt && storedCompletedAt >= createdAt
    ? storedCompletedAt
    : createdAt;

          if (isCompleted && completedAt) {
             return completedAt === filterDate;
          }
          // Cancelled without completion_date: show on creation date only
          return createdAt === filterDate;
       });
    }

    if (statusFilter === 'active') baseMissions = baseMissions.filter(m => !['Completed', 'Cancelled'].includes(m.status));
    else if (statusFilter === 'completed') baseMissions = baseMissions.filter(m => ['Completed', 'Cancelled'].includes(m.status));

    // 💡 إحصائيات الأقاليم
    const regionStats = {
      total: baseMissions.length,
      hq: baseMissions.filter(m => (regionMap[normalizeName(m.branch)] || 'hq') === 'hq').length,
      canal: baseMissions.filter(m => (regionMap[normalizeName(m.branch)] || 'hq') === 'canal').length,
      delta: baseMissions.filter(m => (regionMap[normalizeName(m.branch)] || 'hq') === 'delta').length,
      saeed: baseMissions.filter(m => (regionMap[normalizeName(m.branch)] || 'hq') === 'saeed').length,
    };

    let filteredMissions = activeRegionTab !== 'all' ? baseMissions.filter(m => (regionMap[normalizeName(m.branch)] || 'hq') === activeRegionTab) : baseMissions;

    // 🆕 فلتر الفروع — بعد فلتر الإقليم، نفس معادلة «القاهرة ↔ المركز العام» في HomeView
    const selectedBranch = filterBranch === 'all' ? null : filterBranch;
    if (selectedBranch) {
      filteredMissions = filteredMissions.filter(m => {
        const mb = String(m.branch || '').trim();
        return mb === selectedBranch
          || (selectedBranch === 'المركز العام' && mb === 'القاهرة')
          || (selectedBranch === 'القاهرة' && mb === 'المركز العام');
      });
    }

    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      filteredMissions = filteredMissions.filter(m =>
        (m.mission_name && m.mission_name.toLowerCase().includes(term)) ||
        (m.mission_location && m.mission_location.toLowerCase().includes(term)) ||
        (m.mission_code && m.mission_code.toLowerCase().includes(term)) ||
        (m.mission_type && m.mission_type.toLowerCase().includes(term))
      );
    }

    return { filteredMissions, regionStats };
  }, [missionsList, isVolunteer, userRegion, missionViewType, filterDate, statusFilter, activeRegionTab, filterBranch, searchTerm]);

  const getCreationDate = () => {
    if (currentMissionData && currentMissionData.created_at) { return String(currentMissionData.created_at).split(' ')[0]; }
    return filterDate || getLocalDate();
  };

  return (
    <div className="card-surface overflow-hidden flex flex-col min-h-[700px] flex-1">
      {/* 🗑️ تأكيد حذف مهمة فردية — التصميم الموحّد (كبسولة علوية عائمة) */}
      <DangerConfirmModal
        show={missionToDelete !== null}
        title="تأكيد الحذف"
        message="هل أنت متأكد من حذف هذه المهمة نهائياً؟"
        confirmLabel="نعم، احذف"
        onCancel={() => setMissionToDelete(null)}
        onConfirm={confirmDeleteMission}
      />

      <div className="p-5 md:p-6 border-b border-[var(--border)] bg-[var(--surface-2)] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
        <div className="flex flex-col gap-3 w-full">

          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">سجل متابعة المهام</h3>
            {isVolunteer ? (
              <span className="badge badge-active font-mono">سيتم عرض مهام {userRegion === 'delta' ? 'إقليم الدلتا' : userRegion === 'canal' ? 'إقليم القنال' : userRegion === 'saeed' ? 'إقليم الصعيد' : 'المركز العام'} فقط</span>
            ) : (
              <span className="badge badge-info font-mono">حساب إداري | الصلاحية: كل الأقاليم</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="segmented">
              <button onClick={() => setMissionViewType('all_types')} className={`segmented-btn ${missionViewType === 'all_types' ? 'is-active' : ''}`}>كل المهام</button>
              <button onClick={() => setMissionViewType('daily')} className={`segmented-btn ${missionViewType === 'daily' ? 'is-active-accent' : ''}`}>المهام العادية</button>
              <button onClick={() => { setMissionViewType('open'); setFilterDate(''); }} className={`segmented-btn ${missionViewType === 'open' ? 'is-active-accent' : ''}`}>المهام المفتوحة</button>
            </div>

            <div className="hidden md:block w-px h-6 bg-[var(--border)]"></div>

            <div className="segmented filters-seg">
              <button onClick={() => setStatusFilter('all')} className={`segmented-btn ${statusFilter === 'all' ? 'is-active' : ''}`}>الكل</button>
              <button onClick={() => setStatusFilter('active')} className={`segmented-btn ${statusFilter === 'active' ? 'is-active-accent' : ''}`}>نشطة</button>
              <button onClick={() => setStatusFilter('completed')} className={`segmented-btn ${statusFilter === 'completed' ? 'is-active-accent' : ''}`}>مكتملة</button>

              {!isVolunteer && (<>
                <div className="w-px h-6 bg-[var(--border)] mx-0.5"></div>
                <EocSelect variant="toolbar" className="px-2" value={activeRegionTab} onChange={(e) => { setActiveRegionTab(e.target.value); setFilterBranch('all'); }}>
                  <option value="all">كل الأقاليم</option>
                  <option value="hq">إقليم المركز العام</option>
                  <option value="canal">إقليم القنال</option>
                  <option value="delta">إقليم الدلتا</option>
                  <option value="saeed">إقليم الصعيد</option>
                </EocSelect>
              </>)}

              {/* 🆕 فلتر الفروع — يظهر للجميع؛ المتطوع يرى فروع إقليمه فقط، والإداري كل الفروع (يتتابع حسب الإقليم) */}
              <div className="w-px h-6 bg-[var(--border)] mx-0.5"></div>
              <EocSelect variant="toolbar" className="px-2" value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
                <option value="all">كل الفروع</option>
                {branchFilterOptions.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </EocSelect>
            </div>

            <div className="hidden md:block w-px h-6 bg-[var(--border)]"></div>

            <div className="flex items-center gap-2">
              <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="field !py-1.5 !px-3 w-auto" />
              {filterDate && <button onClick={() => setFilterDate('')} className="chip chip-active !py-1">إلغاء التاريخ</button>}
            </div>
          </div>
        </div>

        {/* 🔥 أكشن بار المهام — هرمية واضحة: ثانوية مجمّعة خفيفة + أساسية منفردة مُميَّزة */}
        <div className="actionbar justify-center md:justify-end w-full md:w-auto">
          <div className="actionbar-segment w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setIsTableExpanded(true)}
              data-tip={lang === 'ar' ? 'عرض السجل الشامل بملء الشاشة' : 'Open full-screen log'}
              className="action-btn action-btn--info flex-1 sm:flex-none"
            >
              <EyeIcon />
              <span className="hidden sm:inline">{lang === 'ar' ? 'السجل' : 'Log'}</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={handleExportTableExcel}
                data-tip={lang === 'ar' ? 'تصدير جدول Excel الحالي' : 'Export current table to Excel'}
                className="action-btn action-btn--ok flex-1 sm:flex-none"
              >
                <ExcelIcon />
                <span className="hidden sm:inline">{lang === 'ar' ? 'تصدير' : 'Export'}</span>
              </button>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={handleClearAllMissions}
                data-tip={lang === 'ar' ? 'مسح جميع المهام نهائيًا — لا يمكن التراجع' : 'Clear all missions — irreversible'}
                className="action-btn action-btn--danger flex-1 sm:flex-none"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                <span className="hidden sm:inline">{lang === 'ar' ? 'مسح الكل' : 'Clear all'}</span>
              </button>
            )}
          </div>

          <Magnetic strength={0.18} className="flex-1 sm:flex-none">
            <button
              type="button"
              onClick={handleCreateNew}
              className="btn-primary w-full justify-center"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {lang === 'ar' ? 'إنشاء مهمة' : 'Create mission'}
            </button>
          </Magnetic>
        </div>
      </div>

      <div className="mt-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl px-4 py-2 flex items-center gap-3 w-full focus-within:border-[var(--accent-soft)] focus-within:shadow-[var(--ring-soft)] transition-all">
        <svg className="w-5 h-5 text-[var(--faint)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" placeholder="بحث سريع باسم المهمة، المكان، الكود، أو نوع المهمة..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-transparent text-sm w-full outline-none font-bold" />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="chip chip-active !py-0.5 shrink-0">مسح</button>}
      </div>

      {!isVolunteer && (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-[var(--surface-week)] border-b border-[var(--border)] shrink-0">
        <StatCard title="إجمالي المهام" value={regionStats.total} color="text-[var(--ink)]" borderHighlight />
        <StatCard title="المركز العام" value={regionStats.hq} color="text-[var(--accent)]" />
        <StatCard title="إقليم القنال" value={regionStats.canal} color="text-[var(--info)]" />
        <StatCard title="إقليم الدلتا" value={regionStats.delta} color="text-[var(--ok)]" />
        <StatCard title="إقليم الصعيد" value={regionStats.saeed} color="text-[var(--warn)]" />
      </div>
      )}

      {isTableExpanded && <div className="fixed inset-0 bg-[var(--bg-deep)]/85 backdrop-blur-sm z-[140]" onClick={() => setIsTableExpanded(false)}></div>}

      <div className={isTableExpanded ? `fixed inset-4 z-[150] card-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up ${isSidebarOpen ? 'md:right-10 md:left-10' : 'md:right-20 md:left-10'}` : "flex-1 flex flex-col overflow-hidden relative"}>

        {isTableExpanded && (
          <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0">
            <h2 className="text-lg font-bold flex items-center gap-2 relative z-10"><span className="text-[var(--accent)]"><EyeIcon className="w-5 h-5" /></span> سجل متابعة المهام الميدانية الشامل</h2>
            <button onClick={() => setIsTableExpanded(false)} className="icon-btn icon-btn-danger"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full min-w-[1100px] text-start border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr className="text-[var(--muted-2)] text-[11px] md:text-xs">
              <th className="px-3 md:px-4 py-3 font-bold font-mono whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">تاريخ الإنشاء</th>
              <th className="px-3 md:px-4 py-3 font-bold font-mono whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50 text-[var(--accent)]">تاريخ المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50 text-[var(--info)]">تصنيف المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50 text-[var(--ok)]">فترة المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold font-mono whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">كود المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">التمركز (الفرع)</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">اسم المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">السيارات والسائقين</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">نوع المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">مكان المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">مسؤول المهمة</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">مصدر البلاغ</th>
              <th className="px-3 md:px-4 py-3 font-bold font-mono whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">تاريخ الانتهاء</th>
              <th className="px-3 md:px-4 py-3 font-bold whitespace-nowrap text-start bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">الحالة</th>
              <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="15" className="p-6">
                  <div className="space-y-3 animate-fade-in">
                    {[0,1,2,3,4].map(i => (
                      <div key={i} className="flex items-center gap-3 px-2">
                        <div className="skeleton h-3 w-24"></div>
                        <div className="skeleton h-3 w-16"></div>
                        <div className="skeleton h-3 w-40"></div>
                        <div className="skeleton h-3 w-20"></div>
                        <div className="skeleton h-3 w-32 flex-1"></div>
                        <div className="skeleton h-6 w-8 rounded-full"></div>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ) :
            filteredMissions.length > 0 ? filteredMissions.map(m => (
              <tr key={`mission-${m.mission_id}`} id={`focus-row-${m.mission_id}`} className={`group transition-colors duration-300 ${pulseMissions.some(p => p.id === m.mission_id) ? 'mission-flash-row' : 'hover:bg-[var(--surface-2)]/70'} ${String(focusedRowId) === String(m.mission_id) ? ' focus-row' : ''}`}>
                <td data-label="تاريخ الإنشاء" className="px-3 md:px-4 py-3 text-[var(--muted)] font-mono text-xs tabular-nums whitespace-nowrap align-middle border-b border-[var(--border)]/60">{formatDateTime(m.creation_datetime || m.created_at)}</td>
                <td data-label="تاريخ المهمة" className="px-3 md:px-4 py-3 align-middle whitespace-nowrap border-b border-[var(--border)]/60"><span className="inline-flex px-2.5 py-1 rounded-lg bg-[var(--accent-softer)] text-[var(--accent)] font-bold font-mono text-xs tabular-nums">{m.exit_date !== '-' && m.exit_date ? formatDateTime(m.exit_date) : 'غير مسجل'}</span></td>
                <td data-label="تصنيف المهمة" className="px-3 md:px-4 py-3 align-middle whitespace-nowrap border-b border-[var(--border)]/60"><span className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-bold border ${m.mission_classification === 'مفتوحة' ? 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/25' : 'bg-[var(--surface-week)] text-[var(--muted)] border-[var(--border)]'}`}>{m.mission_classification || 'عادية'}</span></td>
                <td data-label="فترة المهمة" className="px-3 md:px-4 py-3 align-middle border-b border-[var(--border)]/60">
                  <div className="inline-flex items-center gap-2 bg-[var(--surface-2)] px-2.5 py-1.5 rounded-lg border border-[var(--border)] font-mono text-[11px] whitespace-nowrap">
                    <span className="text-[var(--ok)]">من: {m.exit_date !== '-' && m.exit_date ? formatDateTime(m.exit_date) : (m.created_at ? formatDateTime(m.created_at) : 'غير مسجل')}</span>
                    <span className="text-[var(--faint)]">|</span>
                    <span className={['Completed', 'Cancelled'].includes(m.status) ? "text-[var(--faint)]" : "text-[var(--info)] animate-pulse"}>إلى: {['Completed', 'Cancelled'].includes(m.status) ? (m.completion_date !== '-' && m.completion_date ? formatDateTime(m.completion_date) : 'غير مسجل') : '(حتى الآن...)'}</span>
                  </div>
                </td>
                <td data-label="كود المهمة" className="px-3 md:px-4 py-3 font-mono text-xs text-[var(--ink-2)] whitespace-nowrap align-middle border-b border-[var(--border)]/60">{m.mission_code}</td>
                <td data-label="التمركز (الفرع)" className="px-3 md:px-4 py-3 font-semibold text-sm whitespace-nowrap align-middle border-b border-[var(--border)]/60">{m.branch}</td>
                <td data-label="اسم المهمة" className="px-3 md:px-4 py-3 align-middle border-b border-[var(--border)]/60 min-w-[180px] max-w-[280px]">
                  <button
                    type="button"
                    onClick={() => handleViewMission(m.mission_id)}
                    aria-label={`فتح مهمة: ${m.mission_name}`}
                    title={m.mission_name}
                    className="mission-name-cell block w-full max-w-full truncate bg-transparent border-0 p-0 text-start font-bold cursor-pointer underline underline-offset-4 decoration-transparent transition-[text-decoration-color,transform] duration-200 hover:decoration-[var(--accent)] active:scale-[0.99]"
                  >
                    {m.mission_name}
                  </button>
                </td>
                <td data-label="السيارات والسائقين" className="px-3 md:px-4 py-3 text-[var(--ok)] text-sm align-middle border-b border-[var(--border)]/60 min-w-[140px] max-w-[220px]"><span className="block truncate" title={m.vehicles_info}>{m.vehicles_info}</span></td>
                <td data-label="نوع المهمة" className="px-3 md:px-4 py-3 text-[var(--ink-2)] text-sm whitespace-nowrap align-middle border-b border-[var(--border)]/60">{m.mission_type}</td>
                <td data-label="مكان المهمة" className="px-3 md:px-4 py-3 text-[var(--ink-2)] text-sm align-middle border-b border-[var(--border)]/60 min-w-[160px] max-w-[240px]"><span className="block truncate" title={m.mission_location}>{m.mission_location}</span></td>
                <td data-label="مسؤول المهمة" className="px-3 md:px-4 py-3 text-[var(--muted)] text-sm whitespace-nowrap align-middle border-b border-[var(--border)]/60">{m.responsible_person}</td>
                <td data-label="مصدر البلاغ" className="px-3 md:px-4 py-3 text-[var(--muted)] text-sm whitespace-nowrap align-middle border-b border-[var(--border)]/60">{m.data_source}</td>
                <td data-label="تاريخ الانتهاء" className="px-3 md:px-4 py-3 text-[var(--muted)] text-sm whitespace-nowrap align-middle border-b border-[var(--border)]/60">{formatDateTime(m.completion_date)}</td>
                <td data-label="الحالة" className="px-3 md:px-4 py-3 align-middle whitespace-nowrap border-b border-[var(--border)]/60"><StatusBadge status={m.status} /></td>
                <td data-label="الإجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                  <div className="flex justify-center gap-1.5">
                    <button onClick={() => handleViewMission(m.mission_id)} className="icon-btn" title="فتح المهمة"><EyeIcon /></button>
                    <button onClick={() => setDownloadTarget(m)} className="icon-btn" title="تصدير الاستمارة"><DownloadIcon /></button>
                    {!isVolunteer && <button onClick={() => setMissionToDelete(m.mission_id)} className="icon-btn icon-btn-danger" title="حذف"><TrashIcon /></button>}
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="15"><div className="empty-state"><div className="empty-state-icon">📋</div><p className="text-sm font-semibold text-[var(--muted)]">لا توجد مهام مطابقة</p></div></td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {isModalOpen && (
        <div key={currentMissionData ? `edit-${currentMissionData.mission_id}` : 'new'} className="modal-backdrop fixed inset-0 flex items-center justify-center z-[200] p-4">
          <div className={`modal-card w-full max-w-6xl h-full max-h-[95vh] flex flex-col overflow-hidden ${formGlowOn ? 'update-glow' : ''}`}>

            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-8 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"></span>
                  <h2 className="text-lg font-bold">توثيق مهمة ميدانية</h2>
                </div>
                {currentMissionData && <StatusBadge status={currentMissionData.status} />}
              </div>
              <button onClick={() => setIsModalOpen(false)} className="icon-btn icon-btn-danger"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            {isModalLoading ? (
              <div className="p-8 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                <div className="flex flex-col md:flex-row items-end gap-4">
                  <div className="flex-1 w-full space-y-3">
                    <div className="skeleton h-4 w-40"></div>
                    <div className="skeleton h-10 w-full"></div>
                  </div>
                  <div className="w-full md:w-48 space-y-3">
                    <div className="skeleton h-4 w-28"></div>
                    <div className="skeleton h-10 w-full"></div>
                  </div>
                </div>
                <div className="card-surface p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[0,1,2,3,4,5].map(i => <div key={i} className="space-y-2"><div className="skeleton h-3.5 w-24"></div><div className="skeleton h-10 w-full"></div></div>)}
                  </div>
                </div>
                <div className="skeleton h-40 w-full rounded-2xl"></div>
              </div>
            ) : modalError ? (
              <div className="p-8 overflow-y-auto custom-scrollbar flex-1 grid place-items-center">
                <div className="card-surface p-6 rounded-2xl max-w-md w-full text-center space-y-4">
                  <div className="w-14 h-14 mx-auto rounded-full bg-[var(--danger-soft)] text-[var(--accent)] flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4m0 4h.01M10.29 4.86 2.7 17.2a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.71 4.86a2 2 0 0 0-3.42 0Z"/></svg>
                  </div>
                  <h3 className="text-lg font-bold">تعذر فتح الاستمارة</h3>
                  <p className="text-sm text-[var(--muted)]">فشل تحميل بيانات الاستمارة من السيرفر.</p>
                  <p className="text-xs text-[var(--faint)]">{translate('تم إبقاء الاستمارة مفتوحة — أعد المحاولة أو تواصل مع المالك.', language)}</p>
                  <div className="flex items-center justify-center gap-2">
                    {modalError.status === 0 ? (
                      <span className="text-xs text-[var(--faint)]">خطأ في الاتصال بالخادم</span>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--faint)]">رمز الخطأ: </span>
                        <code dir="ltr" className="text-xs font-mono bg-[var(--surface-4)] px-2 py-0.5 rounded border border-[var(--border)]">{modalError.status}</code>
                      </>
                    )}
                  </div>
                  <div className="pt-1">
                    <button type="button" onClick={() => handleViewMission(currentMissionIdRef.current)} className="btn-primary w-full">إعادة المحاولة</button>
                  </div>
                </div>
              </div>
            ) : (
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">

              <div className="card-surface p-6 flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1 w-full">
                  <label className="block text-[var(--accent)] text-sm font-bold mb-2">اسم الاستمارة (عنوان رئيسي)</label>
                  <input id="f_mission_name" type="text" defaultValue={missionName} onChange={(e) => setMissionName(e.target.value)} placeholder="مثال: تأمين مول..." className="w-full bg-transparent border-b-2 border-[var(--border-strong)] focus:border-[var(--accent)] text-[var(--ink)] text-2xl font-bold pb-2 outline-none transition-colors" />
                </div>
                <div className="w-full md:w-48"><FormGroup label="كود الاستمارة"><StyledInput id="f_mission_code" disabled={!isOwner} defaultValue={currentMissionData?.mission_code || ''} placeholder="#MSN-AUTO" className={`text-center font-mono ${!isOwner ? 'text-[var(--faint)] opacity-50 cursor-not-allowed' : ''}`} title={!isOwner ? 'لا يمكن تعديله (للمالك فقط)' : ''} /></FormGroup></div>
              </div>

              <SectionCard title="البيانات الأساسية للمهمة" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <FormGroup label="تصنيف المهمة">
                    <StyledSelect id="f_mission_class" value={missionClass} onChange={(e) => setMissionClass(e.target.value)}>
                      <option value="عادية">مهمة عادية</option>
                      <option value="مفتوحة">مهمة مفتوحة</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="التمركز / الفرع">
                    <StyledSelect id="f_branch_id" defaultValue={currentMissionData?.branch_id || userBranchId}>
                      {/* 💡 التعديل هنا: المركز العام يظهر للمديرين، ولأي متطوع تبع إقليم المركز العام (hq) */}
                      {(!isVolunteer || userRegion === 'hq') && <option value="19">المركز العام</option>}
                      {branches.map(b => {
                        const isBranchInMyRegion = (regionMap[normalizeName(b.name)] || 'hq') === userRegion;
                        if (b.name !== 'القاهرة' && b.name !== 'المركز العام' && (!isVolunteer || isBranchInMyRegion)) {
                          return <option key={b.id} value={b.id}>{b.name}</option>;
                        }
                        return null;
                      })}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="نوع المهمة"><StyledInput id="f_mission_type" defaultValue={currentMissionData?.mission_type || ''} /></FormGroup>
                  <FormGroup label="مكان المهمة"><StyledInput id="f_mission_location" defaultValue={currentMissionData?.mission_location || ''} /></FormGroup>
                  <FormGroup label="حالة العملية الميدانية">
                    <StyledSelect id="f_mission_field_status" defaultValue={currentMissionData?.notes?.includes('[حالة الميدان: مكتملة]') ? 'مكتملة' : 'نشطة'}>
                      <option value="نشطة">نشطة (لم تنتهي بعد)</option>
                      <option value="مكتملة">مكتملة (تم الانتهاء)</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="مسؤول المهمة"><StyledInput id="f_responsible_person" defaultValue={currentMissionData?.responsible_person || ''} /></FormGroup>
                  <FormGroup label="تاريخ إنشاء المهمة (يُسجل آلياً)">
                    {isOwner ? (
                      <div className="flex gap-2">
                        <SegDateField
                          value={creationDateTime ? creationDateTime.slice(0, 10) : ''}
                          onChange={(e) => {
                            const d = e.target.value;
                            const t = creationDateTime ? creationDateTime.slice(11, 19) : '00:00:00';
                            setCreationDateTime(d ? d + ' ' + t : '');
                          }}
                          className="field text-white border border-[var(--border)]"
                          title="للمالك فقط"
                        />
                        <SegTimeField
                          value={creationDateTime ? creationDateTime.slice(11, 16) : ''}
                          onChange={(e) => {
                            const d = creationDateTime ? creationDateTime.slice(0, 10) : new Date().toISOString().slice(0, 10);
                            const t = e.target.value;
                            setCreationDateTime(d ? d + ' ' + t + ':00' : '');
                          }}
                          className="field text-white border border-[var(--border)]"
                          title="للمالك فقط"
                        />
                      </div>
                    ) : (
                      <span
                        className="field inline-flex items-center px-3 text-white opacity-80 cursor-not-allowed bg-[var(--surface-2)] font-mono text-xs"
                        title="لا يمكن تعديله (للمالك فقط)"
                      >
                        {creationDateTime ? formatDateTime12(creationDateTime) : '—'}
                      </span>
                    )}
                  </FormGroup>
                  <FormGroup label="مصدر البلاغ"><StyledSelect id="f_data_source" defaultValue={currentMissionData?.data_source || 'واتساب'}><option>واتساب</option><option>واتساب - هاتفياً</option><option>واتساب - هاتفياً - لاسلكي</option><option>واتساب - لاسلكي</option><option>هاتفياً - لاسلكي</option><option>هاتفياً</option><option>لاسلكي</option></StyledSelect></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="التواريخ والتوقيتات" className="pt-6 pb-10 md:pt-7 md:pb-12" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}>
                {/* 💡 الموبايل: عمود واحد حتى لا تتزاحم حقول التاريخ/الوقت (كانت 3 أعمدة دائمة)؛
                    سطح المكتب يبقى 3 أعمدة تماماً كما هو عبر sm:grid-cols-3 (≥640px) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* تواريخ */}
                  <FormGroup className="items-center text-center" required label="تاريخ المهمة" invalid={requiredTouched && missingFields.includes('field_exit_date')}><SegDateField className={`field text-center ${requiredTouched && missingFields.includes('field_exit_date') ? 'field-invalid' : ''}`} id="f_exit_date" defaultValue={currentMissionData?.exit_date || ''} onChange={() => { bumpValidation(); touchTimeline('f_exit_date'); }} /></FormGroup>
                  <FormGroup className="items-center text-center" label="تاريخ الوصول"><SegDateField className="field text-center" id="f_arrival_date" defaultValue={currentMissionData?.arrival_date || ''} onChange={() => touchTimeline('f_arrival_date')} /></FormGroup>
                  <FormGroup className="items-center text-center" label="تاريخ الانتهاء" invalid={requiredTouched && missingFields.includes('field_completion_date')}><SegDateField className={`field text-center ${requiredTouched && missingFields.includes('field_completion_date') ? 'field-invalid' : ''}`} id="f_completion_date" defaultValue={currentMissionData?.completion_date || ''} onChange={() => { bumpValidation(); touchTimeline('f_completion_date'); }} /></FormGroup>
                  {/* أوقات */}
                  <FormGroup className="items-center text-center" required label="ساعة التحرك / البدء" invalid={requiredTouched && missingFields.includes('field_departure_time')}><SegTimeField className={`field text-center ${requiredTouched && missingFields.includes('field_departure_time') ? 'field-invalid' : ''}`} id="f_departure_time" defaultValue={currentMissionData?.departure_time || currentMissionData?.start_time || ''} onChange={() => { bumpValidation(); touchTimeline('f_departure_time'); }} /></FormGroup>
                  <FormGroup className="items-center text-center" label="ساعة الوصول"><SegTimeField className="field text-center" id="f_arrival_time" defaultValue={currentMissionData?.arrival_time || ''} onChange={() => touchTimeline('f_arrival_time')} /></FormGroup>
                  <FormGroup className="items-center text-center" label="ساعة الانتهاء" invalid={requiredTouched && missingFields.includes('field_completion_time')}><SegTimeField className={`field text-center ${requiredTouched && missingFields.includes('field_completion_time') ? 'field-invalid' : ''}`} id="f_completion_time" defaultValue={currentMissionData?.completion_time || ''} onChange={() => { bumpValidation(); touchTimeline('f_completion_time'); }} /></FormGroup>
                  {/* حقول مخفية للحفظ المباشر وحساب الساعات — مرور حرفي للقيم المحفوظة لا تمسها أي صياغة */}
                  <input type="hidden" id="f_departure_date" defaultValue={currentMissionData?.departure_date || ''} />
                  <input type="hidden" id="f_start_time" defaultValue={currentMissionData?.start_time || ''} />
                  <input type="hidden" id="f_return_date" defaultValue={currentMissionData?.return_date || ''} />
                </div>
              </SectionCard>

              {/* 🔧 المحرك الموحد: خط السير الأساسي يعمل لكل المهمات — «من/إلى» حقول
                  منفصلة + تاريخ ووقت كاملان لكل مسار (المبيت overnight آمن)
                  يتطابق مع واجهة "الأيام / خطوط السير المخصصة": صفان (من/إلى) + (تاريخ ووقت الانطلاق/الوصول) */}
              <SectionCard title="تفاصيل خط السير الأساسي" icon={<MapIcon />} actionBtn={<button onClick={addRoute} className="text-xs text-[var(--accent)] hover:text-white font-bold bg-[var(--accent-soft)] px-3 py-1.5 rounded-lg">+ إضافة مسار</button>}>
                <div className="w-full flex flex-col items-center">
                  <div className="mb-4 -mt-2">
                    {routes.length > 0 ? (<button onClick={() => setRoutes([])} className="bg-[var(--surface-4)] hover:bg-[var(--accent)] text-[var(--muted-2)] px-8 py-1.5 rounded-full text-xs font-bold border border-[var(--accent)]/30">لا يوجد خط سير</button>) : (<button onClick={() => setRoutes([{ id: Date.now() }])} className="bg-[var(--surface-4)] hover:bg-[var(--ok)] text-[var(--muted-2)] px-8 py-1.5 rounded-full text-xs font-bold border border-[var(--ok)]/30 hover:text-white">+ تفعيل خط السير</button>)}
                  </div>
                  <div className="w-full">
                    {routes.map((route, index) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        index={index}
                        prefix="main"
                        onChange={(updated) => setRoutes(prev => prev.map((r, i) => i === index ? { ...r, ...updated } : r))}
                        onRemove={removeRoute}
                        showRemove={routes.length > 1}
                        isBasic={true}
                      />
                    ))}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="الأيام / خطوط السير المخصصة (لفرق أو أفراد محددين)" icon={<MapIcon />} actionBtn={<button onClick={addCustomItinerary} className="text-xs text-[var(--accent)] hover:text-white font-bold bg-[var(--accent-soft)] px-3 py-1.5 rounded-lg">+ إضافة يوم / مسار جديد</button>}>
                <div className="space-y-4">
                  {customItineraries.length === 0 && <p className="text-center text-[var(--muted-2)] text-sm">لا توجد أيام أو خطوط سير مخصصة بعد.</p>}
                  {customItineraries.map((ci, ciIndex) => {
                    const untitled = String(ci.title || '').trim() === '';
                    return (
                    <div key={ci.id} className="bg-[var(--surface-4)] border border-[var(--border)] p-4 rounded-xl">
                      <div className="flex justify-between items-center mb-3 border-b border-[var(--border)] pb-2">
                        <input id={`r_title_${ci.id}`} type="text" defaultValue={ci.title} onChange={(e) => updateCustomTitle(ci.id, e.target.value)} placeholder="اكتب اسم اليوم أو خط السير المخصص (مثال: تحركات اليوم الأول)..." className="eoc-manual-field bg-transparent text-[var(--accent)] font-bold outline-none w-full md:w-1/2" />
                        <div className="flex gap-2">
                          <button onClick={() => addRouteToCustom(ci.id)} disabled={untitled}
                            className={`text-xs text-green-500 hover:bg-[var(--surface-hover)] px-2 py-1 rounded ${untitled ? 'opacity-40 cursor-not-allowed' : ''}`}>+ مسار</button>
                          <button onClick={() => removeCustomItinerary(ci.id)} className="text-xs text-[var(--accent)] hover:bg-[var(--surface-hover)] px-2 py-1 rounded">حذف المخصص</button>
                        </div>
                      </div>
                      {untitled && (
                        <p className="text-[var(--accent)] text-xs font-bold mb-2 flex items-center gap-1.5 px-1">⚠ يجب إدخال عنوان للمسار المخصص أولاً.</p>
                      )}
                      {ci.routes.map((cr, rIndex) => (
                        <RouteCard
                          key={cr.id}
                          route={cr}
                          index={rIndex}
                          prefix={`cust_${ciIndex}`}
                          onChange={(updated) => {
                            setCustomItineraries(prev => prev.map((c, cIdx) =>
                              cIdx === ciIndex
                                ? { ...c, routes: c.routes.map((r, rIdx) => rIdx === rIndex ? { ...r, ...updated } : r) }
                                : c
                            ));
                          }}
                          onRemove={() => removeRouteFromCustom(ci.id, cr.id)}
                          showRemove={ci.routes.length > 1}
                          isBasic={false}
                          disabled={untitled}
                        />
                      ))}
                    </div>
                  );
                  })}
                </div>
              </SectionCard>

              <SectionCard title="السيارات والسائقين (أسطول المهمة)" icon={<CarIcon />} actionBtn={<button onClick={addVehicle} className="text-xs text-[var(--accent)] hover:text-white font-bold bg-[var(--accent-soft)] px-3 py-1.5 rounded-lg">+ إضافة سيارة</button>}>
                <div className="w-full flex flex-col items-center">
                  <div className="mb-4 -mt-2">
                    {vehicles.length > 0 ? (<button onClick={() => setVehicles([])} className="bg-[var(--surface-4)] hover:bg-[var(--accent)] text-[var(--muted-2)] px-8 py-1.5 rounded-full text-xs font-bold border border-[var(--accent)]/30">لا يوجد سيارات</button>) : (<button onClick={() => setVehicles([{ id: Date.now() }])} className="bg-[var(--surface-4)] hover:bg-[var(--ok)] text-[var(--muted-2)] px-8 py-1.5 rounded-full text-xs font-bold border border-[var(--ok)]/30 hover:text-white">+ تفعيل أسطول السيارات</button>)}
                  </div>
                  <div className="w-full">
                    {vehicles.map((v, index) => (<VehicleRow key={`veh-${v.id}`} index={index} onRemove={() => removeVehicle(v.id)} data={v} />))}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={<span>القوة البشرية والمشاركين <span className="text-[var(--accent)]">*</span></span>} icon={<UsersIcon />} actionBtn={<button onClick={addParticipant} className="text-xs text-[var(--accent)] hover:text-white font-bold bg-[var(--accent-soft)] px-3 py-1.5 rounded-lg">+ إضافة مشارك</button>}>
                {requiredTouched && missingFields.includes('field_participants') && <p className="text-[var(--accent)] text-xs font-bold mb-2 flex items-center gap-1.5 px-1">⚠ يجب إضافة مشارك واحد على الأقل بالاسم لإتمام أي عملية على المهمة.</p>}
                <div className={`overflow-x-auto bg-[var(--surface-4)] rounded-xl border ${requiredTouched && missingFields.includes('field_participants') ? 'border-[var(--accent)]/60' : 'border-[var(--border)]'}`}>
                  <table className="w-full text-right text-sm min-w-[1120px]">
                    <thead className="bg-[var(--surface-3)] text-[var(--muted-2)] border-b border-[var(--border)]">
                      <tr>
                        <th className="p-3">م</th>
                        <th className="p-3">النوع</th>
                        <th className="p-3">الاسم</th>
                        <th className="p-3">رقم العضوية</th>
                        <th className="p-3 text-[var(--accent)]">صفة المشارك <span className="text-[var(--accent)]">*</span></th>
                        <th className="p-3 text-[var(--ink)]">الفريق</th>
                        <th className="p-3 text-[var(--info)]">الساعات</th>
                        <th className="p-3 text-[var(--ai)]">خط السير المخصص</th>
                        <th className="p-3">الفرع</th>
                        <th className="p-3 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {participants.map((p, index) => (
                        <tr key={p.id} className="hover:bg-[var(--surface-hover)]">
                          <td data-label="م" className="p-2 text-center text-[var(--muted-2)] font-bold">{index + 1}</td>
                          <td data-label="النوع" className="p-2">
                            <EocSelect variant="cell" id={`p_type_${index}`} value={p.participant_type || 'volunteer'} onChange={(e) => { const newP = [...participants]; newP[index].participant_type = e.target.value; setParticipants(newP); }}>
                              <option value="volunteer" className="bg-[var(--surface-4)]">متطوع</option>
                              <option value="non_volunteer" className="bg-[var(--surface-4)]">غير متطوع</option>
                            </EocSelect>
                          </td>
                          <td data-label="الاسم" className="p-2">
                            <input id={`p_name_${index}`} list="all-volunteers-datalist" type="text" defaultValue={p.full_name || ''} placeholder="الاسم (اختر أو اكتب)..." onChange={(e) => handleParticipantNameChange(e, index)} className="eoc-manual-field bg-transparent outline-none text-white w-full" />
                            <datalist id="all-volunteers-datalist">
                              {allVolunteers.map(v => <option key={v.volunteer_id} value={v.full_name}>{v.branch_name} — {v.membership_number || 'بدون رقم'}</option>)}
                            </datalist>
                          </td>
                          <td data-label="رقم العضوية" className="p-2">
                            <input id={`p_role_${index}`} type="text" defaultValue={p.participation_role || ''} placeholder={(p.participant_type || 'volunteer') === 'volunteer' ? 'رقم العضوية...' : '—'} disabled={(p.participant_type || 'volunteer') === 'non_volunteer'} className={`eoc-manual-field bg-transparent outline-none w-full ${(p.participant_type || 'volunteer') === 'non_volunteer' ? 'text-[var(--muted-2)] cursor-not-allowed' : 'text-white'}`} />
                          </td>
                          <td data-label="صفة المشارك" className="p-2">
                            <input id={`p_position_${index}`} type="text" defaultValue={p.participant_position || ''} placeholder={(p.participant_type || 'volunteer') === 'volunteer' ? '—' : 'اكتب صفة المشارك...'} disabled={(p.participant_type || 'volunteer') === 'volunteer'} onChange={(e) => { const newP = [...participants]; newP[index].participant_position = e.target.value; setParticipants(newP); bumpValidation(); }} className={`eoc-manual-field bg-transparent outline-none w-full ${(p.participant_type || 'volunteer') === 'volunteer' ? 'text-[var(--muted-2)] cursor-not-allowed' : (requiredTouched && !String(p.participant_position || '').trim() ? 'text-[var(--accent)]' : 'text-white')}`} />
                          </td>

                          {/* الفريق — حقل يدوي فارغ by default، يُستخدم لتسمية الفرق الداخلي */}
                          <td data-label="الفريق" className="p-2">
                            <input id={`p_team_${index}`} type="text" value={p.team_name || ''} placeholder="اكتب الفريق..." onChange={(e) => { const newP = [...participants]; newP[index].team_name = e.target.value; setParticipants(newP); }} className="eoc-manual-field bg-transparent outline-none text-[var(--ink)] w-full" />
                          </td>

                          {/* 🕒 الساعات — تُحسب من القطاعات (segments) أو الافتراضي من خطة السير */}
                          <td data-label="الساعات" className="p-2 text-center space-y-1">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${p.working_hours != null ? 'bg-[var(--info-soft)] text-[var(--info)]' : 'text-[var(--faint)]'}`}>
                              {p.working_hours != null ? fmtHours(p.working_hours, lang) : '—'}
                            </span>
                            {/* 🆕 «يُحسب من بداية المهمة» — مفتاح نقي: TRUE (افتراضي) ⇒ البداية المخططة
                                من بداية المهمة؛ FALSE ⇒ بداية مساره المحدد. لا شروط تواريخ إطلاقاً. */}
                            <label
                              className={`flex items-center justify-center gap-1.5 text-[10px] font-bold whitespace-nowrap cursor-pointer select-none ${p.start_from_mission !== false ? 'text-[var(--info)]' : 'text-[var(--muted-2)]'}`}
                              title="يُحسب من بداية المهمة (بدل بداية مساره المحدد) — للمالك/المشرف"
                            >
                              <input
                                type="checkbox"
                                checked={p.start_from_mission !== false}
                                onChange={(e) => { const newP = [...participants]; newP[index].start_from_mission = e.target.checked; setParticipants(newP); bumpValidation(); }}
                                className="accent-[var(--accent)]"
                              />
                              من بداية المهمة
                            </label>
                          </td>

                          {/* خط السير المخصص — موحد لكل أنواع المهام (يعرض الأيام/المجموعات المخصصة للمشارك) */}
                          <td data-label="خط السير المخصص" className="p-2">
                            <button
                              type="button"
                              onClick={() => setDaysPicker(daysPicker === index ? null : index)}
                              title="تحديد خطوط السير المخصصة للمشارك"
                              className={`text-xs font-bold px-2 py-1 rounded-lg border w-full text-right ${((p.assigned_days || []).length > 0) ? 'text-[var(--ai)] bg-[var(--ai-soft)] border-[var(--ai)]/30' : 'text-[var(--muted-2)] bg-[var(--surface-3)] border-[var(--border)]'}`}
                            >
                              {((p.assigned_days || []).length > 0) ? (() => {
                                const { routes: routeDays } = splitAssignedDays(p.assigned_days);
                                const jlDays = (p.assigned_days || []).filter(d => d && d.startsWith('JL:'));
                                return (
                                  <span className="inline-flex flex-wrap items-center gap-1">
                                    {routeDays.length > 0 && <span className="text-purple-400">📍</span>}
                                    {routeDays.map(day => (
                                      <span key={'r:'+day} className="inline-block bg-[var(--ai-soft)] text-[var(--ai)] px-1.5 py-0.5 rounded text-[10px]">{day}</span>
                                    ))}
                                    {jlDays.map(day => {
                                      const isJoin = day.startsWith('JL:J:');
                                      return (
                                        <span key={day} className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${isJoin ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--accent-softer)] text-[var(--accent)]'}`}>
                                          {isJoin ? '📥' : '📤'} {day.slice(5)}
                                        </span>
                                      );
                                    })}
                                  </span>
                                );
                              })() : (
                                'خط السير المخصص'
                              )}
                            </button>
                          </td>

                          {/* الفرع — كل الفروع بدون فلترة (داخل جدول المشاركين فقط) */}
                          <td data-label="الفرع" className="p-2">
                            <EocSelect variant="cell" id={`p_branch_${index}`} defaultValue={p.branch_id || userBranchId} disabled={(p.participant_type || 'volunteer') === 'non_volunteer'}>
                              {branches.map(b => (
                                <option key={b.id} value={b.id} className="bg-[var(--surface-4)]">{b.name}</option>
                              ))}
                            </EocSelect>
                          </td>

                          <td data-label="حذف" className="p-2 text-center"><button onClick={() => removeParticipant(p.id)} className="text-[var(--faint)] hover:text-[var(--accent)]"><TrashIcon /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {/* 📥📤 كتالوج الانضمام / الانفصال — بطاقات على مستوى المهمة (لا زر لكل مشارك) */}
              <SectionCard
                title="انضمام / انفصال"
                icon={<span className="text-lg">📥</span>}
                actionBtn={
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEntryDialog('join')}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors">
                      + إضافة انضمام
                    </button>
                    <button type="button" onClick={() => openEntryDialog('leave')}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition-colors">
                      + إضافة انفصال
                    </button>
                  </div>
                }
              >
                <div className="space-y-3">
                  {joinLeaveEntries.length === 0 && (
                    <p className="text-center text-[var(--muted-2)] text-sm py-4">لا توجد سجلات انضمام/انفصال بعد</p>
                  )}
                  {joinLeaveEntries.map((e) => {
                    const isJ = e.kind === 'join';
                    const assignedTo = participants
                      .filter(p => (p.assigned_days || []).includes(jlKey(e.kind, e.title)))
                      .map(p => p.full_name || 'مشارك');
                    return (
                      <div key={e.id} className={`flex items-center gap-3 p-3 rounded-xl border ${isJ ? 'border-green-500/20 bg-green-500/5' : 'border-[var(--accent)]/20 bg-[var(--accent)]/5'}`}>
                        <span className={`text-xl shrink-0 ${isJ ? 'text-green-400' : 'text-[var(--accent)]'}`}>{isJ ? '📥' : '📤'}</span>
                        <div className="flex-1 min-w-0">
                          <input
                            id={`jl_title_${e.id}`}
                            type="text"
                            value={e.title}
                            onChange={(ev) => renameEntry(e.id, ev.target.value)}
                            onBlur={(ev) => renameEntry(e.id, ev.target.value)}
                            className="font-bold text-sm bg-transparent outline-none text-white border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] transition-colors w-full"
                            title="أعد تسمية السجل — يُحدَّث مفتاح الإسناد فوراً"
                          />
                          <div className="text-[11px] text-[var(--muted-2)] mt-0.5">
                            {(() => {
                              try { return formatDateTime12(e.dt); } catch { return e.dt; }
                            })()}
                          </div>
                          {assignedTo.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {assignedTo.map(name => (
                                <span key={name} className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-[var(--ai-soft)] text-[var(--ai)]">{name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => openEntryDialog(e.kind, e)}
                            className="text-[10px] font-bold px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--muted-2)] hover:text-white hover:border-[var(--accent)] transition-colors"
                            title="تعديل">
                            تعديل
                          </button>
                          <button type="button" onClick={() => deleteEntry(e.id)}
                            className="text-[10px] font-bold px-2 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                            title="حذف">
                            حذف
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {/* 🆕 نافذة إنشاء/تعديل سجل انضمام أو انفصال — DateInput + TimeInput */}
              {entryDialog && (() => {
                const isJoin = entryDialog.mode === 'join';
                const isEdit = !!entryDialog.editId;
                const dateId = isJoin ? 'jl_join_date' : 'jl_leave_date';
                const timeId = isJoin ? 'jl_join_time' : 'jl_leave_time';
                // معاينة حية تُحدَّث عبر onChange للحقول الذكية (تجنب قراءة DOM أثناء render)
                const preview = (jlDraft.date && jlDraft.time) ? formatDateTime12(`${jlDraft.date} ${jlDraft.time}`) : '';
                return (
                  <div className="fixed inset-0 z-[222] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md card-surface rounded-2xl shadow-2xl border border-[var(--border-strong)] overflow-hidden animate-fade-in-up">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-3)]">
                        <h3 className="font-bold text-white flex items-center gap-2">
                          <span className={isJoin ? 'text-green-400' : 'text-[var(--accent)]'}>{isJoin ? '📥' : '📤'}</span>
                          {isJoin ? (isEdit ? 'تعديل انضمام' : 'إضافة انضمام') : (isEdit ? 'تعديل انفصال' : 'إضافة انفصال')}
                        </h3>
                        <button onClick={() => setEntryDialog(null)} className="touch-close text-[var(--muted-2)] hover:text-white text-xl leading-none" title="إغلاق">×</button>
                      </div>
                      <div className="p-5 space-y-4">
                        <div>
                          <label className="text-[10px] text-[var(--muted)] font-bold mb-1 block">العنوان</label>
                          <input
                            id="jl_entry_title"
                            type="text"
                            value={entryDialog.title || ''}
                            onChange={(ev) => setEntryDialog(d => ({ ...d, title: ev.target.value }))}
                            placeholder="مثال: بداية المشاركة"
                            className="eoc-manual-field w-full bg-[var(--surface-3)] text-white px-3 py-2 rounded-lg text-sm border border-[var(--border)] focus:border-[var(--accent)] outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] text-[var(--muted)] font-bold mb-1 block">التاريخ</label>
                            <SegDateField
                              id={dateId}
                              defaultValue={entryDialog.dt ? String(entryDialog.dt).slice(0, 10) : ''}
                              className="eoc-manual-field w-full bg-[var(--surface-3)] text-white px-2 py-1.5 rounded-lg text-sm"
                              onChange={(ev) => setJlDraft(d => ({ ...d, date: ev.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--muted)] font-bold mb-1 block">الوقت</label>
                            <SegTimeField
                              id={timeId}
                              defaultValue={entryDialog.dt ? String(entryDialog.dt).slice(11, 16) : ''}
                              className="eoc-manual-field w-full bg-[var(--surface-3)] text-white px-2 py-1.5 rounded-lg text-sm"
                              onChange={(ev) => setJlDraft(d => ({ ...d, time: ev.target.value }))}
                            />
                          </div>
                        </div>
                        {preview && (
                          <p className="text-xs text-center text-[var(--muted-2)] bg-[var(--surface-3)] rounded-lg py-2">
                            🕐 {preview}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-3)]">
                        <button onClick={() => setEntryDialog(null)} className="text-xs text-[var(--muted-2)] hover:text-white underline">إلغاء</button>
                        <button onClick={saveEntry} className={`text-white font-bold px-6 py-2 rounded-xl text-xs hover:opacity-90 ${isJoin ? 'bg-green-500 hover:bg-green-600' : 'bg-[var(--accent)] hover:bg-[var(--accent-soft)]'}`}>
                          {isEdit ? 'تعديل' : (isJoin ? 'إضافة انضمام' : 'إضافة انفصال')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 🔴 محدد الأيام/الخطوط المتعددة — ثلاث مجموعات: خطوط السير + انضمام + انفصال */}
              {daysPicker !== null && (() => {
                const dp = participants[daysPicker];
                if (!dp) return null;
                // Build list of all available route options: basic routes + custom itineraries
                const basicRouteOption = routes.length > 0 ? 'خط السير الأساسي' : null;
                const customOptions = customItineraries.map(ci => {
                  const ciTitle = document.getElementById(`r_title_${ci.id}`)?.value || ci.title || `مخصص ${ci.id}`;
                  return ciTitle;
                });
                const allOptions = [basicRouteOption, ...customOptions].filter(Boolean);

                return (
                  <div className="fixed inset-0 z-[221] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setDaysPicker(null)}>
                    <div className="w-full max-w-sm card-surface rounded-2xl shadow-2xl border border-[var(--border-strong)] overflow-hidden animate-fade-in-up" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-3)]">
                        <h3 className="font-bold text-white flex items-center gap-2">
                          <span className="text-purple-400">📍</span>
                          المشاركة — {dp.full_name || 'مشارك'}
                        </h3>
                        <button onClick={() => setDaysPicker(null)} className="text-[var(--muted-2)] hover:text-white text-xl leading-none" title="إغلاق">×</button>
                      </div>
                      <div className="p-5 max-h-[55vh] overflow-y-auto">
                        {/* ١) خطوط السير (روتين) — خروج بدون أي JL:* */}
                        <p className="text-[10px] text-purple-400 font-bold mb-1.5 flex items-center gap-1">🛣️ خطوط السير</p>
                        {allOptions.length === 0 && <p className="text-center text-[var(--muted-2)] text-xs py-2 mb-2">لا توجد خطوط سير متاحة. أضفها من قسم خطوط السير.</p>}
                        {allOptions.map((opt) => {
                          const checked = (dp.assigned_days || []).includes(opt);
                          const isBasic = opt === 'خط السير الأساسي';
                          return (
                            <label key={'opt:'+opt} className={`flex items-center gap-3 p-2.5 rounded-lg mb-1.5 cursor-pointer transition-colors ${checked ? 'bg-purple-400/10 border border-purple-400/30' : 'hover:bg-[var(--surface-hover)] border border-transparent'}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleAssignedDay(daysPicker, opt)} className="accent-purple-400 w-4 h-4" />
                              <span className={`text-sm font-bold ${checked ? 'text-purple-400' : 'text-[var(--muted-2)]'}`}>{isBasic ? '🛣️' : '📅'} {opt}</span>
                            </label>
                          );
                        })}
                        {/* ٢) انضمام — JL:J:<title> */}
                        <p className="text-[10px] text-green-400 font-bold mb-1.5 mt-4 flex items-center gap-1">📥 انضمام</p>
                        {joinLeaveEntries.filter(e => e.kind === 'join').length === 0 && (
                          <p className="text-center text-[var(--muted-2)] text-xs py-2 mb-2">لا توجد سجلات انضمام بعد — أضفها من قسم «انضمام / انفصال».</p>
                        )}
                        {joinLeaveEntries.filter(e => e.kind === 'join').map((e) => {
                          const key = jlKey('join', e.title);
                          const checked = (dp.assigned_days || []).includes(key);
                          return (
                            <label key={key} className={`flex items-center gap-3 p-2.5 rounded-lg mb-1.5 cursor-pointer transition-colors ${checked ? 'bg-green-400/10 border border-green-400/30' : 'hover:bg-[var(--surface-hover)] border border-transparent'}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleJLAssignment(daysPicker, e)} className="accent-green-400 w-4 h-4" />
                              <span className={`text-sm font-bold ${checked ? 'text-green-400' : 'text-[var(--muted-2)]'}`}>📥 {e.title}</span>
                              <span className="text-[10px] text-[var(--faint)] mr-auto">{(() => { try { return formatDateTime12(e.dt); } catch { return e.dt; } })()}</span>
                            </label>
                          );
                        })}
                        {/* ٣) انفصال — JL:L:<title> */}
                        <p className="text-[10px] text-[var(--accent)] font-bold mb-1.5 mt-4 flex items-center gap-1">📤 انفصال</p>
                        {joinLeaveEntries.filter(e => e.kind === 'leave').length === 0 && (
                          <p className="text-center text-[var(--muted-2)] text-xs py-2 mb-2">لا توجد سجلات انفصال بعد — أضفها من قسم «انضمام / انفصال».</p>
                        )}
                        {joinLeaveEntries.filter(e => e.kind === 'leave').map((e) => {
                          const key = jlKey('leave', e.title);
                          const checked = (dp.assigned_days || []).includes(key);
                          return (
                            <label key={key} className={`flex items-center gap-3 p-2.5 rounded-lg mb-1.5 cursor-pointer transition-colors ${checked ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30' : 'hover:bg-[var(--surface-hover)] border border-transparent'}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleJLAssignment(daysPicker, e)} className="accent-[var(--accent)] w-4 h-4" />
                              <span className={`text-sm font-bold ${checked ? 'text-[var(--accent)]' : 'text-[var(--muted-2)]'}`}>📤 {e.title}</span>
                              <span className="text-[10px] text-[var(--faint)] mr-auto">{(() => { try { return formatDateTime12(e.dt); } catch { return e.dt; } })()}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-end px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-3)]">
                        <button onClick={() => setDaysPicker(null)} className="text-xs bg-[var(--accent)] hover:bg-[var(--accent-soft)] text-white font-bold px-5 py-2 rounded-lg">تم</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 💡 كود الفريق/الإدارة: حقل مستقل تماماً عن جدول المشاركين (متطلب #3) */}
              <SectionCard title="كود الفريق/الإدارة" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" /></svg>}>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="w-full md:max-w-sm">
                    <label className="flex items-center gap-2 text-[var(--muted)] text-xs font-bold mb-1.5 px-1">
                      كود الفريق/الإدارة
                      <button type="button" title="يُحفظ مع بيانات المهمة ويظهر فوراً عند فتحها" className="inline-flex w-4 h-4 rounded-full bg-[var(--surface-3)] text-[var(--faint)] text-[10px] items-center justify-center border border-[var(--border)]">?</button>
                    </label>
                    <StyledInput id="f_team_code" name="f_team_code" defaultValue={currentMissionData?.team_code || ''} placeholder="مثال: B-12" maxLength={100} />
                  </div>
                  <p className="text-xs text-[var(--faint)] px-1 pt-1 md:pt-0">حقل مستقل عن المشاركين، يُحفظ ويُسترجَع تلقائياً مع كل مهمة.</p>
                </div>
              </SectionCard>

              <SectionCard title="إحصائيات المستفيدين" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>} actionBtn={<button onClick={addBeneficiary} className="text-xs text-[var(--accent)] hover:text-white font-bold bg-[var(--accent-soft)] px-3 py-1.5 rounded-lg">+ إضافة تصنيف</button>}>
                <div className="space-y-4">
                  {beneficiaries.map((ben, index) => (
                    <div key={`ben-${ben.id}`} className="flex flex-col md:flex-row gap-4 items-end bg-[var(--surface-4)] p-4 rounded-xl border border-[var(--border)]">
                      <div className="flex-1 w-full"><FormGroup label="تصنيف المستفيدين"><StyledInput id={`b_cat_${index}`} defaultValue={ben?.category_name || ''} placeholder="مثال: أطفال، مصابين..." className="bg-[var(--surface-3)]" /></FormGroup></div>
                      <div className="flex-1 w-full"><FormGroup label="مستفيدين (مباشر)"><StyledInput id={`b_count_${index}`} defaultValue={ben?.direct_count || ''} type="number" placeholder="0" className="bg-[var(--surface-3)]" /></FormGroup></div>
                      <div className="flex-1 w-full"><FormGroup label="مستفيدين (غير مباشر)"><StyledInput id={`b_indirect_${index}`} defaultValue={ben?.indirect_count || ''} type="number" placeholder="0" className="bg-[var(--surface-3)]" /></FormGroup></div>
                      {beneficiaries.length > 1 && (<button onClick={() => removeBeneficiary(ben.id)} className="mb-2 p-2 text-[var(--muted-2)] hover:text-[var(--accent)] bg-[var(--surface-3)] rounded-lg border border-[var(--border)]"><TrashIcon /></button>)}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="فريق إدارة الغرفة (الهيكل الإداري)" icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}>
                <div className="space-y-4">
                  <div className="bg-[var(--surface-4)] p-4 rounded-xl border border-[var(--accent)]/30 shadow-[0_0_15px_rgba(199,0,0,0.05)] w-full">
                    <FormGroup required label="مسؤول المتابعة (قائد العملية)" invalid={requiredTouched && missingFields.includes('field_leader')}><StyledInput id="eoc_leader" defaultValue={getStaff('مسؤول المتابعة')} placeholder="الاسم ورقم الهاتف..." className={`bg-[var(--surface-3)] text-lg font-bold ${requiredTouched && missingFields.includes('field_leader') ? 'field-invalid' : ''}`} onChange={bumpValidation} /></FormGroup>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormGroup required label="المشرف" invalid={requiredTouched && missingFields.includes('field_supervisor')}><StyledInput id="eoc_supervisor" defaultValue={getStaff('المشرف')} placeholder="الاسم..." className={requiredTouched && missingFields.includes('field_supervisor') ? 'field-invalid' : ''} onChange={bumpValidation} /></FormGroup>
                    <FormGroup label="المشرف المراجع"><StyledInput id="eoc_reviewer" defaultValue={getStaff('المشرف المراجع')} placeholder="الاسم..." /></FormGroup>
                    <FormGroup required label="الجوكر" invalid={requiredTouched && missingFields.includes('field_joker')}><StyledInput id="eoc_joker" defaultValue={getStaff('الجوكر')} placeholder="الاسم..." className={requiredTouched && missingFields.includes('field_joker') ? 'field-invalid' : ''} onChange={bumpValidation} /></FormGroup>
                    <FormGroup required label="معبئ الاستمارة" invalid={requiredTouched && missingFields.includes('field_filler')}><StyledInput id="eoc_filler" defaultValue={getStaff('معبئ الاستمارة')} placeholder="الاسم..." className={requiredTouched && missingFields.includes('field_filler') ? 'field-invalid' : ''} onChange={bumpValidation} /></FormGroup>
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
                      className="w-full bg-[var(--surface)] border border-[var(--border)] text-blue-400 font-bold rounded-xl p-3 text-sm outline-none resize-none cursor-not-allowed" 
                    />
                  </FormGroup>
                  
                  {/* 2. أسباب الرفض (مغلق - وبيتمسح لوحده برمجياً زي ما عملنا) */}
                  <FormGroup label="أسباب الإرجاع والتعديلات (مغلق)">
                    <textarea 
                      id="f_internal_notes" 
                      defaultValue={currentMissionData?.internal_notes || ''} 
                      readOnly 
                      rows="4" 
                      className="w-full bg-[var(--danger-soft)] border border-[var(--accent)]/20 text-[var(--accent)] rounded-xl p-3 text-sm outline-none resize-none cursor-not-allowed" 
                      placeholder="لا توجد ملاحظات إرجاع حالياً... (تُحذف تلقائياً عند الاعتماد أو الإغلاق)"
                    ></textarea>
                  </FormGroup>

                  {/* 3. الملاحظات العامة (مفتوحة للجميع) */}
                  <FormGroup label="الملاحظات والتحديثات (متاحة للجميع)">
                    <textarea 
                      id="f_notes" 
                      defaultValue={currentMissionData?.notes?.replace(/\[حالة الميدان: .*?\]\n?/g, '') || ''} 
                      rows="4" 
                      className="w-full bg-[var(--surface-4)] border border-[var(--border)] focus:border-[var(--accent)]/50 text-white rounded-xl p-3 text-sm outline-none resize-none shadow-inner" 
                      placeholder="اكتب هنا أي ملاحظات إضافية، تحديثات ميدانية متاحة للغرفة..."
                    ></textarea>
                  </FormGroup>
                </div>
              </SectionCard>

            </div>
            )}

            {/* 💡 أضفنا كلاسات بتخلي الزراير فوق بعض في الموبايل وبعرض الشاشة بالكامل لسهولة اللمس */}
            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-[var(--muted-2)] hover:bg-[var(--surface-hover)]">إغلاق</button>
              
              {/* 👑 المالك (God Mode) */}
              {isOwner ? (
                <>
                  <button onClick={() => handleSubmit('Draft')} disabled={isSubmitting} className="bg-[var(--surface-3)] hover:bg-[var(--surface-4)] text-[var(--ink-2)] px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">مسودة</button>
                  <button onClick={() => handleSubmit('Under Review')} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرسال للجوكر</button>
                  <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} disabled={isSubmitting} className="btn-warn px-6 py-3 md:py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرجاع للمتطوع</button>
                  <button onClick={() => handleSubmit('Approved')} disabled={isSubmitting} className="btn-success px-8 py-3 md:py-2.5 rounded-xl text-sm shadow-[0_0_18px_var(--ok-soft)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">تم مراجعة المهمة (مستمرة)</button>
                  <button onClick={() => handleSubmit('Completed')} disabled={isSubmitting} className="btn-accent px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إنهاء وإغلاق المهمة</button>
                  {currentMissionData?.status === 'Completed' && <button onClick={() => handleSubmit('Approved')} disabled={isSubmitting} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إلغاء الإغلاق (إعادة فتح)</button>}
                </>
              ) : (
                /* 👷 باقي الرتب */
                <>
                  {/* 1. للمتطوع أو الإداري لو الاستمارة جديدة/مسودة/معادة */}
                  {(!currentMissionData || currentMissionData.status === 'Draft' || currentMissionData.status === 'Returned') && (
                    <>
                      <button onClick={() => handleSubmit('Draft')} disabled={isSubmitting} className="bg-[var(--surface-3)] hover:bg-[var(--surface-4)] text-[var(--ink-2)] px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">حفظ كمسودة</button>
                      <button onClick={() => handleSubmit('Under Review')} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرسال إلى الجوكر</button>
                    </>
                  )}
                  
                  {/* 2. الإداري (الجوكر والمشرف) لو الاستمارة قيد المراجعة */}
                  {currentMissionData?.status === 'Under Review' && !isVolunteer && (
                    <>
                      <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} disabled={isSubmitting} className="btn-danger px-6 py-3 md:py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرجاع للتعديل</button>
                      <button onClick={() => handleSubmit('Approved')} disabled={isSubmitting} className="btn-success px-8 py-3 md:py-2.5 rounded-xl text-sm shadow-[0_0_18px_var(--ok-soft)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">تم مراجعة المهمة (مستمرة)</button>
                      <button onClick={() => handleSubmit('Completed')} disabled={isSubmitting} className="btn-accent px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إنهاء وإغلاق المهمة</button>
                    </>
                  )}
                  
                  {/* 3. لو الاستمارة معتمدة وشغالة */}
                  {currentMissionData?.status === 'Approved' && (
                    <>
                      {/* المتطوع يشوف زرار إرسال التحديثات فقط */}
                      {isVolunteer && <button onClick={() => handleSubmit('Under Review')} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرسال التحديثات للجوكر</button>}
                      
                      {/* الإداري (الجوكر وفوق) يقدر يرجعها، يخليها مستمرة، أو يقفلها */}
                      {!isVolunteer && (
                        <>
                          <button type="button" onClick={() => { setReturnError(''); setReturnModalOpen(true); }} disabled={isSubmitting} className="btn-warn px-6 py-3 md:py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إرجاع للمتطوع</button>
                          <button onClick={() => handleSubmit('Approved')} disabled={isSubmitting} className="btn-success px-8 py-3 md:py-2.5 rounded-xl text-sm shadow-[0_0_18px_var(--ok-soft)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">تم مراجعة المهمة (مستمرة)</button>
                          <button onClick={() => handleSubmit('Completed')} disabled={isSubmitting} className="btn-accent px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إنهاء وإغلاق المهمة</button>
                        </>
                      )}
                    </>
                  )}
                  
                  {/* 4. لو الاستمارة مكتملة (مغلقة) */}
                  {currentMissionData?.status === 'Completed' && !isVolunteer && (
                    <>
                      <button onClick={() => handleSubmit('Completed')} disabled={isSubmitting} className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(20,184,166,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">حفظ التعديلات (وهي مقفولة)</button>
                      <button onClick={() => handleSubmit('Approved')} disabled={isSubmitting} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">إلغاء الإغلاق (إعادة فتح)</button>
                    </>
                  )}
                </>
              )}
            </div>
            
            {returnModalOpen && (
              <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[120] p-4">
                <div className="bg-[var(--surface-2)] border border-[var(--warn)]/30 rounded-3xl w-full max-w-md p-8 flex flex-col items-center animate-fade-in-up text-center" style={{ boxShadow: '0 0 0 1px var(--warn-soft), 0 0 20px var(--warn-soft)' }}>
                  <div className="w-20 h-20 bg-[var(--warn)]/10 rounded-full flex items-center justify-center mb-5 border border-[var(--warn)]/20 text-[var(--warn)]"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                  <h3 className="text-xl font-bold text-white mb-2">إرجاع الاستمارة للمتطوع</h3>
                  <p className="text-[var(--muted-2)] text-sm mb-4 leading-relaxed">برجاء كتابة سبب الإرجاع أو التعديلات المطلوبة بوضوح.</p>
                  
                  {returnError && (
                    <div className="w-full bg-[var(--danger-soft)] border border-[var(--accent)]/30 text-[var(--accent)] text-xs font-bold p-3 rounded-xl mb-4 flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      {returnError}
                    </div>
                  )}
                  
                  <textarea 
                    value={returnText} 
                    onChange={(e) => { setReturnText(e.target.value); setReturnError(''); }} 
                    rows="4" 
                    className={`w-full bg-[var(--surface-4)] border ${returnError ? 'border-[var(--accent)]/50 focus:border-[var(--accent)]' : 'border-[var(--border)] focus:border-[var(--warn)]'} text-white rounded-xl p-3 text-sm outline-none resize-none mb-6 transition-colors`} 
                    placeholder="مثال: يرجى استكمال بيانات السيارات..."
                  ></textarea>
                  
                  <div className="flex gap-4 w-full">
                    <button onClick={() => { setReturnModalOpen(false); setReturnError(''); }} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-[var(--ink-2)] hover:bg-[var(--surface-hover)] border border-[var(--border)] transition-colors">إلغاء</button>
                    <button onClick={() => {
                      // 🔒 قفل متزامن قبل أي خطوة — لا تعديل للـDOM ولا غلق للمودال لو فيه إرسال جارٍ
                      if (submitLockRef.current || isSubmitting) return;
                      if (returnText.trim()) {
                        document.getElementById('f_internal_notes').value = `[مطلوب تعديل]: ${returnText}`;
                        setReturnModalOpen(false);
                        setReturnText('');
                        setReturnError('');
                        handleSubmit('Returned');
                      } else {
                        setReturnError('برجاء كتابة سبب الإرجاع بوضوح لتوجيه المتطوع!');
                      }
                    }} disabled={isSubmitting} className="btn-warn flex-1 px-4 py-3 rounded-xl text-sm font-bold shadow-[0_0_18px_var(--warn-soft)] transition-all disabled:opacity-40 disabled:cursor-not-allowed">تأكيد الإرجاع</button>
                  </div>
                </div>
              </div>
            )}
            </div>
        </div>
      )}
      <DangerConfirmModal
  show={showClearAllConfirm}
  title="تأكيد الحذف"
  message="سيتم حذف جميع بيانات المهام نهائياً. هذا الإجراء لا يمكن التراجع عنه."
  confirmationCode={clearAllCode}
  onConfirmationCodeChange={setClearAllCode}
  showConfirmationInput={true}
  onCancel={() => {
    setShowClearAllConfirm(false);
    setClearAllCode('');
  }}
  onConfirm={confirmClearAllMissions}
/>

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}

      {/* 📥 تأكيد تنزيل الاستمارة — نافذة محايدة، «نعم» ينزّل و«إلغاء» يُغلق */}
      <DownloadConfirmModal
        show={downloadTarget !== null}
        title="تصدير الاستمارة"
        onCancel={() => setDownloadTarget(null)}
        onConfirm={() => { const rec = downloadTarget; setDownloadTarget(null); handleExportSingleMission(rec); }}
      />
    </div>
  );
}

const FormGroup = ({ label, className = "", required = false, invalid = false, children }) => (<div className={`flex flex-col gap-1.5 w-full ${className}`}><div className={`flex items-center gap-1 px-1 text-xs font-bold ${invalid ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}><span>{label}</span>{required && <span className="text-[var(--accent)] text-sm leading-none">*</span>}{invalid && <span className="text-[10px] font-bold text-[var(--accent)]">إلزامي</span>}</div>{children}</div>);
const StyledInput = ({ className="", ...props }) => (<input className={`field ${className}`} {...props} />);

// =====================================================================
// 🗓️ DateInput — حقل تاريخ/وقت إلزامي العرض DD/MM/YYYY (لا يعتمد على لغة المتصفح/النظام،
// فلا يظهر تنسيق MM/DD/YYYY أبداً مهما كانت لغة نظام المستخدم).
// الحقل الأصلي المخفي (المُعرَّف بالـ id) يحمل قيمة الخادم ISO (YYYY-MM-DD أو YYYY-MM-DDTHH:MM)،
// بينما العنصر المرئي يعرض DD/MM/YYYY دائماً. النقر يفتح منتقي التاريخ الأصلي،
// ويمكن أيضاً الكتابة اليدوية بصيغة DD/MM/YYYY.
// يدعم: value/onChange (متحكم) أو defaultValue (غير متحكم)، id، disabled، max، type (date|datetime-local).
// =====================================================================
const DateInput = ({ type = "date", value, onChange, defaultValue, id, className = "", disabled, max, ...props }) => {
  // ✅ DD/MM/YYYY في كل النظام: منتقي تقويم مخصص (بدلاً من منتقي المتصفح الأصلي
  //    الذي يتبع لغة المتصفح/نظام التشغيل ولا يمكن التحكم به) — يعرض دائماً
  //    DD/MM/YYYY في الحقل وفي نافذة التقويم المنبثقة.
  // 🆕 كتابة يدوية حرة بصيغة DD/MM/YYYY (أو DD/MM/YYYY HH:MM للـ datetime-local).
  //    📅 يفتح التقويم للـ type="date". (type="datetime-local" — خط السير الأساسي/المخصص — يبقى كما هو تماماً.)

  // ISO (YYYY-MM-DD أو YYYY-MM-DDTHH:MM) → DD/MM/YYYY (أو DD/MM/YYYY HH:MM AM/PM)
  function isoToDmy(iso, t) {
    if (!iso) return '';
    const s = String(iso).trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (!m) return s;
    const [, yy, mo, dd, hh, mm] = m;
    const datePart = `${dd.padStart(2, '0')}/${mo.padStart(2, '0')}/${yy}`;
    // 12 ساعة إلزامياً في العرض: HH:MM AM/PM — لا تسرّب 24 ساعة في أي حقل تاريخ+وقت
    return hh !== undefined ? `${datePart} ${formatTime12(`${hh.padStart(2, '0')}:${mm}`)}` : datePart;
  }
  // DD/MM/YYYY (أو + HH:MM) → ISO
  function dmyToIso(dmy, t) {
    const s = String(dmy).trim();
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return s;
    const [, dd, mo, yy, hh, mm] = m;
    const d = `${yy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    if (hh !== undefined) return t === 'datetime-local' ? `${d}T${hh.padStart(2, '0')}:${mm}` : `${d} ${hh.padStart(2, '0')}:${mm}`;
    return d;
  }

  const initial = (value !== undefined ? value : (defaultValue || ''));

  function parseISO(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
    const now = new Date();
    return { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
  }
  function isoDate(y, mo, d) { return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

  const isDate = type === 'date';
  const [machine, setMachine] = useState(initial);
  const [display, setDisplay] = useState(() => isoToDmy(initial, type));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [view, setView] = useState(() => { const p = parseISO(initial); return { y: p.y, mo: p.mo }; });
  const [selDate, setSelDate] = useState(() => { const p = parseISO(initial); return p.d ? isoDate(p.y, p.mo, p.d) : ''; });
  const [clock, setClock] = useState(() => {
    const m = String(initial || '').match(/T(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}`;
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  });
  const textRef = useRef(null);
  const popRef = useRef(null);

  // مزامنة الحالة المتحكمة (عند تغيّر prop value من الخارج)
  useEffect(() => {
    if (value !== undefined && value !== null) {
      setMachine(value || '');
      setDisplay(isoToDmy(value, type));
      const p = parseISO(value);
      if (p.d) setSelDate(isoDate(p.y, p.mo, p.d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const apply = (iso) => {
    setMachine(iso || '');
    setDisplay(isoToDmy(iso, type));
    const p = parseISO(iso);
    if (p.d) { setSelDate(isoDate(p.y, p.mo, p.d)); setView({ y: p.y, mo: p.mo }); }
    if (onChange) onChange({ target: { value: iso || '' } });
  };

  const GAP = 8; // مسافة صغيرة بين الحقل والنافذة (ليست إزاحة موضعية ثابتة)
  const EDGE = 8; // هامش أمان من حواف الشاشة

  // ✅ وضع ديناميكي: يُثبَّت أسفل الحقل تماماً، وينقلب للأعلى إن لم يكفِ الفراغ،
  //    ويُزاح أفقياً ليُبقى داخل الشاشة (يسار/يمين) — بلا إزاحات موضعية ثابتة.
  const positionPopup = () => {
    const el = textRef.current, pop = popRef.current;
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;

    // عمودياً: أسفل الحقل أولاً، وإن لم يكفِ → أعلى الحقل
    let top = r.bottom + GAP;
    if (top + ph > vh - EDGE) top = r.top - GAP - ph;
    if (top < EDGE) top = EDGE; // لا يوجد فراغ في الاتجاهين — ألصقها بأعلى الشاشة

    // أفقياً: بمحاذاة يسار الحقل، ثم تُزاح لليمين/لليسار لتبقى داخل الشاشة
    let left = r.left;
    if (left + pw > vw - EDGE) left = vw - pw - EDGE;
    if (left < EDGE) left = EDGE;

    setPos({ top, left });
  };

  const openCalendar = () => {
    if (disabled) return;
    const el = textRef.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ top: r.bottom + GAP, left: r.left }); }
    setOpen(true);
  };

  // بعد فتح النافذة نعرف أبعادها الفعلية فنضبط وضعها النهائي (قلب/إزاحة)
  useLayoutEffect(() => {
    if (open) positionPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // إغلاق النافذة عند النقر خارجها / Escape، وإعادة تموضعها عند التمرير أو تغيّر الحجم
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (textRef.current && textRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => positionPopup();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // capture=true يلتقط التمرير داخل أي حاوية (مثل المودال overflow-y-auto)
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickDay = (dIso) => {
    setSelDate(dIso);
    const p = parseISO(dIso);
    setView({ y: p.y, mo: p.mo });
    if (type === 'datetime-local') {
      // تبقى مفتوحة ليحدد المستخدم الوقت ثم يضغط «تطبيق»
      return;
    }
    apply(dIso);
    setOpen(false);
  };

  const applyDatetime = () => {
    if (!selDate) return;
    const t = clock || '00:00';
    apply(`${selDate}T${t}`);
    setOpen(false);
  };

  const handleNative = (e) => { apply(e.target.value); };

  // كتابة يدوية بصيغة DD/MM/YYYY — تُحدّث القيمة الآلية عند اكتمال تاريخ صالح
  const handleText = (e) => {
    const raw = e.target.value;
    setDisplay(raw);
    const iso = dmyToIso(raw, type);
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(iso)) {
      setMachine(iso);
      const p = parseISO(iso);
      setSelDate(isoDate(p.y, p.mo, p.d));
      if (onChange) onChange({ target: { value: iso } });
    }
  };

  const changeMonth = (delta) => setView(v => {
    let mo = v.mo + delta, y = v.y;
    if (mo < 1) { mo = 12; y--; }
    if (mo > 12) { mo = 1; y++; }
    return { y, mo };
  });

  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const WEEK = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']; // الأحد ← السبت
  const { y, mo } = view;
  const start = new Date(y, mo - 1, 1).getDay();
  const dim = new Date(y, mo, 0).getDate();
  const todayISO = isoDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  const cells = [];
  for (let i = 0; i < start; i++) cells.push(<span key={'e' + i} className="h-9" />);
  for (let d = 1; d <= dim; d++) {
    const iso = isoDate(y, mo, d);
    const overMax = max && iso > max;
    const isSel = iso === selDate;
    const isToday = iso === todayISO;
    cells.push(
      <button key={d} type="button" disabled={overMax} onClick={() => pickDay(iso)}
        className={`h-9 w-9 text-xs rounded-lg transition flex items-center justify-center
          ${overMax ? 'opacity-25 cursor-not-allowed' : 'hover:bg-[var(--surface-hover)]'}
          ${isSel ? 'bg-[var(--accent)] text-white font-bold' : 'text-[var(--ink-2)]'}
          ${isToday && !isSel ? 'ring-1 ring-[var(--accent)]' : ''}`}>
        {d}
      </button>
    );
  }

  return (
    <>
      <div className="relative">
        <input
          ref={textRef}
          type="text"
          value={display}
          placeholder={isDate ? "DD/MM/YYYY" : "DD/MM/YYYY HH:MM"}
          className={`${className} ${isDate ? 'text-center pr-7 pl-7' : 'relative cursor-pointer'}`}
          dir="ltr"
          onFocus={openCalendar}
          onChange={handleText}
          disabled={disabled}
          max={max}
          autoComplete="off"
          {...props}
        />
        {/* القيمة الآلية ISO (المصدر الحقيقي للباك) — مخفية تماماً لكن تحمل id */}
        <input
          id={id}
          type={type}
          value={machine || ''}
          onChange={handleNative}
          tabIndex={-1}
          aria-hidden="true"
          max={max}
          disabled={disabled}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
        />
        {isDate && <button type="button" onClick={openCalendar} disabled={disabled} className="absolute left-0 top-1/2 -translate-y-1/2 w-6 text-[var(--muted-2)] hover:text-white text-sm" title="فتح التقويم">📅</button>}
      </div>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[9999] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl p-3 w-[280px]"
          style={{ top: pos.top, left: pos.left, position: 'fixed' }}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => changeMonth(-1)} className="w-7 h-7 rounded hover:bg-[var(--surface-hover)] text-[var(--ink-2)] text-lg leading-none">‹</button>
            <div className="text-sm font-bold text-[var(--ink-2)]">{MONTHS[mo - 1]} {y}</div>
            <button type="button" onClick={() => changeMonth(1)} className="w-7 h-7 rounded hover:bg-[var(--surface-hover)] text-[var(--ink-2)] text-lg leading-none">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEK.map((w, i) => <div key={i} className="h-6 text-[10px] text-[var(--muted-2)] flex items-center justify-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">{cells}</div>
          {type === 'datetime-local' && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
              <span className="text-xs text-[var(--muted-2)]">الوقت:</span>
              <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} className="field !py-1 !px-2 text-xs w-full bg-[var(--surface-3)] text-white rounded-lg" />
              <button type="button" onClick={applyDatetime} className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-white font-bold shrink-0">تطبيق</button>
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-[var(--border)] text-center text-xs text-[var(--muted-2)]" dir="ltr">
            {selDate ? isoToDmy(type === 'datetime-local' ? `${selDate}T${clock || '00:00'}` : selDate, type)
              : (type === 'datetime-local' ? 'DD/MM/YYYY HH:MM' : 'DD/MM/YYYY')}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ⏰ منتقي الوقت المخصص — تصميم فاخر مطابق لمنتقي التاريخ (نافذة منبثقة بنفس
// الهوية البصرية + عجلات لف ساعات/دقائق). يحل محل منتقي الوقت الأصلي للمتصفح
// في كل حقول الوقت المستقلة بالنظام (إصلاح التصميم فقط — القيمة تبقى HH:MM
// لنفس الـ id ومُعاملات الـ on/Change المعتادة).
// المساعدات تُعرَّف على مستوى الوحدة (module-level) وفوق المكوّنات: المُهيّئات
// الكسولة لـ useState تُنفَّذ أثناء أول render، فلا يمكنها الإشارة إلى `const`
// معرَّف لاحقاً (TDZ ⇒ شاشة بيضاء) — الأمان مضمون هكذا.

const StyledSelect = (props) => <EocSelect variant="field" {...props} />;
const SectionCard = ({ title, icon, actionBtn, children, className = "" }) => (<div className={`card-surface p-5 md:p-6 ${className}`}><div className="flex justify-between items-center mb-5 border-b border-[var(--border)] pb-3"><div className="flex items-center gap-2.5"><span className="text-[var(--accent)] shrink-0">{icon}</span><h4 className="font-bold text-sm tracking-wide section-title">{title}</h4></div>{actionBtn && <div className="shrink-0">{actionBtn}</div>}</div>{children}</div>);

const VehicleRow = ({ index, onRemove, data }) => (
  <div className="flex flex-col md:flex-row w-full border border-[var(--border)] rounded-lg overflow-hidden mb-2 bg-[var(--surface-4)]">
    <div className="flex-1 flex border-b md:border-b-0 md:border-l border-[var(--border)]"><div className="bg-[var(--surface-3)] text-[var(--muted-2)] text-xs px-3 flex items-center justify-center">اسم السائق:</div><input id={`v_driver_${index}`} type="text" defaultValue={data?.driver_name || ''} className="eoc-manual-field w-full bg-transparent outline-none text-white text-sm px-4 py-2" /></div>
    <div className="flex-1 flex"><div className="bg-[var(--surface-3)] text-[var(--muted-2)] text-xs px-3 flex items-center justify-center border-l border-[var(--border)]">رقم السيارة:</div><input id={`v_plate_${index}`} type="text" defaultValue={data?.vehicle_number || ''} className="eoc-manual-field w-full bg-transparent outline-none text-white text-sm px-4 py-2" /><button onClick={onRemove} className="px-3 text-[var(--faint)] hover:text-[var(--accent)] bg-[var(--surface-4)]"><TrashIcon /></button></div>
  </div>
);

// 🛣️ Shared RouteCard Component — Unified two-row design for Basic & Custom routes
// Row 1: من [FROM] ← إلى [TO]
// Row 2: التحرك [datetime-local]    الوصول [datetime-local]
const RouteCard = ({
  route,
  index,
  prefix,  // 'main' or 'cust_0' etc.
  onChange,
  onRemove,
  showRemove,
  isBasic,
  disabled = false
}) => {
  // Use pre-computed datetime-local from handleViewMission, or fall back to combining date/time
  const depDateTime = route.departure_datetime || (route.departure_date && route.departure_time
    ? `${route.departure_date}T${route.departure_time}`
    : '');
  const arrDateTime = route.arrival_datetime || (route.arrival_date && route.arrival_time
    ? `${route.arrival_date}T${route.arrival_time}`
    : '');

  const handleDepChange = (e) => {
    const val = e.target.value; // YYYY-MM-DDTHH:MM
    if (!val) {
      onChange?.({ ...route, departure_date: '', departure_time: '', departure_datetime: '' });
      return;
    }
    const [date, time] = val.split('T');
    onChange?.({ ...route, departure_date: date, departure_time: time, departure_datetime: val });
  };

  const handleArrChange = (e) => {
    const val = e.target.value;
    if (!val) {
      onChange?.({ ...route, arrival_date: '', arrival_time: '', arrival_datetime: '' });
      return;
    }
    const [date, time] = val.split('T');
    onChange?.({ ...route, arrival_date: date, arrival_time: time, arrival_datetime: val });
  };

  const handleFromChange = (e) => onChange?.({ ...route, route_from: e.target.value });
  const handleToChange = (e) => onChange?.({ ...route, route_to: e.target.value });

  return (
    <div key={route.id} className="flex flex-col md:flex-row w-full border border-[var(--border)] rounded-lg overflow-hidden mb-2 bg-[var(--surface-3)]">
      {/* الصف الأول: من / إلى */}
      <div className="flex-1 flex border-l border-[var(--border)]">
        <label className="text-[var(--muted-2)] text-xs px-3 self-center shrink-0 whitespace-nowrap">من</label>
        <input
          id={`r_from_${prefix}_${index}`}
          type="text"
          value={route.route_from || ''}
          onChange={handleFromChange}
          disabled={disabled}
          placeholder="من (نقطة الانطلاق)..."
          className={`eoc-manual-field w-full bg-transparent outline-none text-white text-sm px-4 py-2 ${disabled ? 'opacity-40' : ''}`}
        />
        <span className="text-[var(--faint)] self-center px-1">⇠</span>
        <label className="text-[var(--muted-2)] text-xs px-3 self-center shrink-0 whitespace-nowrap">إلى</label>
        <input
          id={`r_to_${prefix}_${index}`}
          type="text"
          value={route.route_to || ''}
          onChange={handleToChange}
          disabled={disabled}
          placeholder="إلى (الوجهة)..."
          className={`eoc-manual-field w-full bg-transparent outline-none text-white text-sm px-4 py-2 ${disabled ? 'opacity-40' : ''}`}
        />
      </div>
      {/* الصف الثاني: التحرك + الوصول (datetime-local مدمج) */}
      <div className="w-full md:w-auto flex flex-wrap border-l border-[var(--border)] bg-[var(--surface-4)] p-2.5 gap-2 md:gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <span className="text-[var(--muted-2)] text-xs whitespace-nowrap shrink-0">🚀 التحرك:</span>
          <SegDateTimeField
            id={`r_dep_${prefix}_${index}`}
            value={depDateTime}
            onChange={handleDepChange}
            twoIcons
            disabled={disabled}
            className="field text-center w-full md:w-[330px]"
          />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <span className="text-[var(--muted-2)] text-xs whitespace-nowrap shrink-0">🏁 الوصول:</span>
          <SegDateTimeField
            id={`r_arr_${prefix}_${index}`}
            value={arrDateTime}
            onChange={handleArrChange}
            twoIcons
            disabled={disabled}
            className="field text-center w-full md:w-[330px]"
          />
        </div>
        {showRemove && (
          <button onClick={() => onRemove?.(route.id)} className="px-3 text-[var(--faint)] hover:text-[var(--accent)] bg-[var(--surface-4)] border-r border-[var(--border)] self-center">
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
};

// 💡 دالة زراير القائمة (مزودة بدعم النقطة الحمراء للإشعارات)
function NavItem({ icon, label, isActive, onClick, isOpen = true, hasUpdate = false }) {
  return (
    <button onClick={onClick} title={!isOpen ? label : ''} className={`nav-item active:scale-[0.98] ${isActive ? 'is-active' : ''} ${isOpen ? '' : 'w-14 justify-center mx-auto'}`}>
      <div className="shrink-0 relative">
        {icon}
      </div>
      <span className={`nav-label font-bold text-sm tracking-wide flex-1 text-start ${isOpen ? 'nav-label-on' : 'nav-label-off'}`}>{label}</span>
      {/* 💡 نقطة التنبيه والقائمة مفتوحة (صغيرة في نهاية الصف) */}
      {isOpen && hasUpdate && <span className="w-2 h-2 bg-[#ff4d4d] rounded-full animate-pulse shadow-[0_0_8px_rgba(199,0,0,0.8)] shrink-0"></span>}
    </button>
  );
}
// 💡 صف تحميل بريميوم للجداول — حلقة EOC + نص قراءة لطيف بدل النص المجرد
const TableLoadingRow = ({ colSpan = 7, label = null }) => (
  <tr>
    <td colSpan={colSpan} className="p-6 md:p-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="eoc-loader"></div>
        <span className="text-xs font-bold text-[var(--faint)] tracking-wide">
          {label || 'جاري التحميل…'}
        </span>
      </div>
    </td>
  </tr>
);

function InventoryCard({ title, value, unit, color }) {
  return (
    <div className="kpi-card card-surface p-5 rounded-2xl">
      <p className="text-[var(--muted)] text-xs font-bold mb-1">{title}</p>
      <p className={`kpi-value text-3xl ${color}`}>{value}</p>
      <p className="text-[10px] text-[var(--faint)] mt-1">{unit}</p>
    </div>
  );
}
function StatCard({ title, value, color, icon, borderHighlight }) { return ( <div className={`kpi-card card-surface p-5 rounded-3xl h-32 hover-lift spot-card ${borderHighlight ? 'border-l-4 border-l-[var(--accent)]' : ''}`}>{icon && <div className="relative z-10 mb-1">{icon}</div>}<p className="text-[var(--muted)] text-xs font-semibold mb-1 relative z-10">{title}</p><p className={`kpi-value text-3xl ${color} relative z-10`}>{value}</p></div> ); }

const EyeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.8 12S6.1 6 12 6s9.2 6 9.2 6-3.3 6-9.2 6S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="3"/><path d="M12 9.6a2.4 2.4 0 1 0 2.4 2.4"/></svg>;
const TrashIcon = (props) => <svg {...props} className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16"/><path d="M9.5 7V4.4h5V7"/><path d="M6.5 7l.8 12.5a2 2 0 0 0 2 1.5h5.4a2 2 0 0 0 2-1.5L17.5 7"/><path d="M10 11v5.4M14 11v5.4"/></svg>;
const HomeIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
const AlertIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 4.3 2.7 17.2a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.6v3.6"/><path d="M12 16.4h.01"/></svg>;
const UsersIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
const MapIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
const LogoutIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>;
const InventoryIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
const HandoverIcon = (props) => <svg {...props} className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7h12M8 7l4-4M8 7l4 4"/><path d="M16 17H4M16 17l-4-4m4 4-4 4"/></svg>;
const EditIcon = (props) => <svg {...props} className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>;
const DownloadIcon = (props) => <svg {...props} className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>;
const CheckIcon = ({ className = '', ...props }) => (
  <svg
    {...props}
    className={`w-5 h-5 ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const PendingIcon = (props) => <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const ExcelIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9L13 3z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3v6h6"/><path strokeLinecap="round" strokeWidth={2} d="M9 13.5h6M9 16.5h6M9 19h4"/></svg>;
// ==========================================
// 5. شاشة سجل النظام (للمالك فقط)
// ==========================================
function AuditLogsView({ isOwner, liveUpdateVersion = 0 }) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('الكل');
  const [entityFilter, setEntityFilter] = useState('all'); // الفلتر الجديد (الكل، مهام، أخبار)
  const [customAlert, setCustomAlert] = useState(null);

  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    fetch('https://eoc-system-b12f.vercel.app/api/audit-logs', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => { setLogs(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);

  // 🔄 سجل النظام يتحدث لحظياً (silent refetch) عند أي تغيير حقيقي في الـ DB
  const isFirstAuditLive = useRef(true);
  useEffect(() => {
    if (isFirstAuditLive.current) { isFirstAuditLive.current = false; return; }
    const token = sessionStorage.getItem('access_token');
    fetch('https://eoc-system-b12f.vercel.app/api/audit-logs', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setLogs(data); })
      .catch(() => {});
  }, [liveUpdateVersion]);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.full_name?.includes(searchTerm) || log.details?.includes(searchTerm);
    const matchesAction = actionFilter === 'الكل' || log.action === actionFilter;
    // 💡 التعديل هنا: لو اختار "system" يجيب أي حاجة ملهاش قسم (يعني تسجيل دخول، باسورد، إلخ)
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter || (entityFilter === 'system' && !['mission', 'local_news', 'global_disaster', 'earthquake', 'ai_news', 'handover'].includes(log.entity_type));
    return matchesSearch && matchesAction && matchesEntity;
  });

  const uniqueActions = ['الكل', ...new Set(logs.map(l => l.action))];
  
  const handleExportLogs = async () => {
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/audit-logs/export', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        setCustomAlert(`خطأ من السيرفر: ${errorData.detail || 'غير معروف'}`);
        return;
      }
      
      const allLogs = await res.json();
      
      // بنفلتر البيانات اللي جاية من السيرفر قبل التصدير بناءً على الفلتر اللي اليوزر مختاره
      const logsToExport = allLogs.filter(log => entityFilter === 'all' || log.entity_type === entityFilter);
      if (logsToExport.length === 0) { setCustomAlert("لا توجد سجلات لهذا القسم لتصديرها."); return; }
      
      const excelData = logsToExport.map(log => ({
        "التاريخ والوقت": formatDateTime(log.created_at),
        "القسم": log.entity_type === 'mission' ? 'المهام الميدانية' : log.entity_type === 'local_news' ? 'الأخبار المحلية' : log.entity_type === 'global_disaster' ? 'الكوارث العالمية' : log.entity_type === 'handover' ? 'تسليم وتسلم مشرفين' : 'نظام داخلي',
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
      if (entityFilter === 'handover') fileName = 'سجل_لوج_تسليم_وتسلم_المشرفين.xlsx';

      await exportWorkbook([{ name: 'الأرشيف', ...gridFromRows(excelData) }], `${fileName.replace(/\.xlsx$/i, '')}_${todayFileDate()}.xlsx`);
      setCustomAlert("تم تصدير الأرشيف بنجاح!");
    } catch (err) {
      setCustomAlert("حدث خطأ أثناء التصدير.");
    }
  };

  return (
    <div className="w-full min-w-0 max-w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col min-h-[85vh] flex-1">
      <div className="p-6 border-b border-[var(--border)] bg-[var(--surface-4)] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 shrink-0 bg-[var(--accent-soft)] rounded-xl flex items-center justify-center border border-[var(--accent)]/20 text-[var(--accent)]"><ShieldIcon /></div>
          <div className="flex flex-col items-start">
            <h3 className="text-xl font-bold text-white tracking-wide whitespace-nowrap">سجل الإجراءات الرقابية</h3>
            <span className="text-[10px] font-bold text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)]/30 px-2 py-0.5 rounded mt-1">سري للغاية</span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full flex-1 pb-2 md:pb-0">
          
          {/* فلتر القطاع (مهام / أخبار) */}
          <div className="flex flex-wrap items-center gap-1 bg-[var(--surface-3)] p-1 rounded-xl border border-[var(--border)] shadow-inner">
            <button onClick={() => setEntityFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'all' ? 'bg-[var(--surface-3)] text-[var(--ink)]' : 'text-[var(--muted-2)] hover:text-white'}`}>الكل</button>
            <button onClick={() => setEntityFilter('mission')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'mission' ? 'bg-blue-600 text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>المهام</button>
            <button onClick={() => setEntityFilter('local_news')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'local_news' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>الأخبار المحلية</button>
            <button onClick={() => setEntityFilter('global_disaster')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'global_disaster' ? 'bg-orange-600 text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>الكوارث العالمية</button>
            <button onClick={() => setEntityFilter('earthquake')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'earthquake' ? 'bg-purple-600 text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>الزلازل</button>
            <button onClick={() => setEntityFilter('handover')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'handover' ? 'bg-teal-600 text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>تسليم وتسلم مشرفين</button>
            {/* 💡 الزرار الجديد لفلترة النظام */}
            <button onClick={() => setEntityFilter('system')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${entityFilter === 'system' ? 'bg-[var(--surface-4)] text-[var(--ink)]' : 'text-[var(--muted-2)] hover:text-white'}`}>النظام</button>
          </div>

          <input type="text" placeholder="بحث باسم المستخدم..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-[var(--surface-3)] border border-[var(--border)] focus:border-[var(--accent)]/50 text-white rounded-xl px-4 py-2 text-sm outline-none w-48 shrink-0" />
          
          <EocSelect variant="toolbar" className="shrink-0" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            {uniqueActions.map(action => <option key={action} value={action}>{action}</option>)}
          </EocSelect>

          {isOwner && (
            <button onClick={handleExportLogs} className="bg-[var(--surface-3)] hover:bg-[var(--surface-4)] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shrink-0 mr-auto">
              <ExcelIcon /> تصدير السجل
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar relative">
        <table className="w-full min-w-[700px] text-right text-sm whitespace-nowrap">
          <thead className="bg-[var(--surface-3)] text-[var(--muted-2)] sticky top-0 z-10 shadow-md">
            <tr>
              <th className="p-4 font-semibold border-l border-[var(--border)] w-48">التاريخ والوقت</th>
              <th className="p-4 font-semibold border-l border-[var(--border)] text-purple-400 w-24 text-center">القسم</th>
              <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--accent)] w-48">اسم المستخدم</th>
              <th className="p-4 font-semibold border-l border-[var(--border)] text-blue-400 w-40">نوع الإجراء</th>
              <th className="p-4 font-semibold">تفاصيل العملية (ماذا حدث؟)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (<TableLoadingRow colSpan={5} label="جاري سحب السجلات السرية…" />) :
            filteredLogs.length > 0 ? filteredLogs.map((log, idx) => (
              <tr key={idx} className="hover:bg-[var(--surface-hover)] transition-colors">
                <td data-label="التاريخ والوقت" className="p-4 text-[var(--muted-2)] font-mono border-l border-[var(--border)]" dir="ltr">{formatDateTime(log.created_at)}</td>
                <td data-label="القسم" className="p-4 border-l border-[var(--border)] text-center">
                  {log.entity_type === 'mission' ? <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/30">المهام</span> :
                   log.entity_type === 'local_news' ? <span className="bg-[var(--accent-soft)] text-[var(--accent)] px-2 py-1 rounded text-xs border border-[var(--accent)]/30">الأخبار المحلية</span> :
                   log.entity_type === 'global_disaster' ? <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs border border-orange-500/30">الكوارث العالمية</span> :
                   log.entity_type === 'earthquake' ? <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs border border-purple-500/30">الزلازل</span> :
                   log.entity_type === 'handover' ? <span className="bg-teal-500/20 text-teal-400 px-2 py-1 rounded text-xs border border-teal-500/30">تسليم وتسلم مشرفين</span> :
                   <span className="bg-[var(--surface-hover)] text-[var(--muted-2)] px-2 py-1 rounded text-xs border border-[var(--border)]">نظام</span>}
                </td>
                <td data-label="اسم المستخدم" className="p-4 font-bold text-white border-l border-[var(--border)]">{log.full_name}</td>
                <td data-label="نوع الإجراء" className="p-4 font-bold border-l border-[var(--border)]"><span className="bg-[var(--surface-4)] px-3 py-1 rounded-lg border border-[var(--border)] text-xs">{log.action}</span></td>
                <td data-label="تفاصيل العملية" className="p-4 text-[var(--ink-2)] truncate max-w-md whitespace-normal">{log.details}</td>
              </tr>
            )) : (<tr><td colSpan="5" className="p-8 text-center text-[var(--faint)]">لا توجد سجلات مطابقة للبحث</td></tr>)}
          </tbody>
        </table>
      </div>
      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
    </div>
  );
}

// ==========================================
// 6. شاشة الأخبار المحلية (نظام التقييم والاستجابة)
// ==========================================
function LocalNewsView({ branches, isOwner, isSupervisor, isJoker, isVolunteer, focusTarget = null }) {
  const [newsList, setNewsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newsToDelete, setNewsToDelete] = useState(null);
  
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // حالات الفلاتر والتنبيهات
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [filterGov, setFilterGov] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [customAlert, setCustomAlert] = useState(null);
  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
  // 📥 نافذة تأكيد تنزيل السجل الفردي (محايدة وغير تحذيرية)
  const [downloadTarget, setDownloadTarget] = useState(null);
  // 🔒 قفل النموذج أثناء الحفظ لمنع الضغط المزدوج وإرسال طلبات متكررة
  const [savingNews, setSavingNews] = useState(false);
  const submitLockRef = useRef(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');

const [nd, setNd] = useState({
    news_id: null, incident_date: '', incident_description: '', news_type: '', news_publisher: '', street_name: '', area_name: '', governorate: 'القاهرة',
    is_reported: false, report_time: '',
    is_responded: false, branch_response_text: '', response_time: '',
    is_field_response: false, movement_time: '', field_arrival_time: '', distance_km: '',
    intervention_type: 'طوارئ', intervening_branch: 'المركز العام', mission_form_name: '', participants_count: 0,
    hospital_name: '', injured_count: 0, deaths_count: 0, news_updates: '', news_link: '', data_entry_name: '', notes: ''
  });

  useEffect(() => { fetchNews(); }, []);

  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'local_news' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) { window.clearInterval(iv); }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  const fetchNews = async () => {
    setIsLoading(true);
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/local-news', { headers: { 'Authorization': `Bearer ${token}` } });
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
    // تتولى صيغ ISO (YYYY-MM-DD) و DD/MM/YYYY مباشرةً حتى لا يفسّرها محرك JS كيوم/شهر معكوسين
    const iso = String(dateStr).split('T')[0].split('-');
    if (iso.length === 3 && iso[0].length === 4) {
      return months[Number(iso[1]) - 1] || '';
    }
    const dmy = String(dateStr).split('/');
    if (dmy.length === 3) {
      return months[Number(dmy[1]) - 1] || '';
    }
    return months[new Date(dateStr).getMonth()] || '';
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
    try {
      const token = sessionStorage.getItem('access_token');
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/local-news/${newsToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { setNewsToDelete(null); fetchNews(); setCustomAlert("تم حذف الخبر بنجاح."); }
      else { const d = await res.json().catch(() => ({})); setCustomAlert(d.detail || "فشل حذف الخبر."); }
    } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); }
  };

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
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
      distance_km:
  nd.distance_km === '' || nd.distance_km == null
    ? null
    : Number(nd.distance_km),

      incident_month: getMonthName(nd.incident_date),
      response_time_points: nd.is_reported && nd.is_responded ? responsePoints : 0,
      response_duration: nd.is_reported && nd.is_responded ? formatDuration(responseDiff) : '',
      movement_points: nd.is_reported && nd.is_field_response ? movePoints : 0,
      report_to_movement_duration: nd.is_reported && nd.is_field_response ? formatDuration(moveDiff) : '',
      field_response_points: nd.is_field_response ? fieldPoints : 0,
      report_to_arrival_duration: nd.is_field_response ? formatDuration(getMinutesDiff(nd.report_time, nd.field_arrival_time)) : ''
    };

    const token = sessionStorage.getItem('access_token');
    const url = nd.news_id ? `https://eoc-system-b12f.vercel.app/api/local-news/${nd.news_id}` : 'https://eoc-system-b12f.vercel.app/api/local-news';
    const method = nd.news_id ? 'PUT' : 'POST';

    submitLockRef.current = true;
    setSavingNews(true);
    try {
      const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) {
  setIsModalOpen(false);
  fetchNews();
  setCustomAlert(
    nd.news_id
      ? "تم تحديث الخبر بنجاح!"
      : "تم إضافة الخبر بنجاح!"
  );
} else {
  const errorBody = await res.json().catch(() => ({}));

  const detail =
    typeof errorBody?.detail === 'string'
      ? errorBody.detail
      : (
          errorBody?.detail
            ? JSON.stringify(errorBody.detail)
            : 'لم يحدد السيرفر سبب الخطأ'
        );

  setCustomAlert(
    `فشل حفظ الخبر (HTTP ${res.status}):\n${detail}`
  );
}
} catch (error) {
  setCustomAlert(
    `تعذر الاتصال بالسيرفر أثناء حفظ الخبر:\n${
      error?.message || 'تحقق من الاتصال بالشبكة'
    }`
  );
}

    finally {
      setSavingNews(false);
      submitLockRef.current = false;
    }
  };
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
      const token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
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
  const handleExportExcel = async () => {
    if (newsList.length === 0) return setCustomAlert("لا توجد أخبار للتصدير حالياً.");
    const newsRows = filteredNews.map(n => ({
      "التاريخ": formatDateTime(n.incident_date), "الشهر": n.incident_month || '', "وصف الحادث": n.incident_description || '', "نوع الخبر": n.news_type || '', "ناشر الخبر": n.news_publisher || '',
      "اسم الشارع": n.street_name || '', "المنطقة": n.area_name || '', "المحافظة": n.governorate || '',
      "الابلاغ": n.is_reported ? 'نعم' : 'لا', "توقيت ارسال الخبر": format12H(n.report_time), "حالة الرد": n.is_responded ? 'نعم' : 'لا', "رد الفرع": n.branch_response_text || '',
      "توقيت الرد": format12H(n.response_time), "حالة توقيت الرد": n.response_time_points || 0, "زمن الرد": n.response_duration || '',
      "الاستجابة": n.is_field_response ? 'نعم' : 'لا', "توقيت التحرك للاستجابة الميدانية من الفرع": format12H(n.movement_time), "المدة بين الابلاغ و التحرك": n.report_to_movement_duration || '',
      "حالة المدة بين الابلاغ و التحرك": n.movement_points || 0, "توقيت الاستجابة الميدانية (اول متطوع يوصل)": format12H(n.field_arrival_time), "حالة الاستجابة": n.field_response_points || 0,
      "الزمن المتخذ لبدء الاستجابة": n.report_to_arrival_duration || '', "نوع الاستجابة": n.intervention_type || '', "الفرع المتدخل": n.intervening_branch || '',
      "اسم الاستمارة": n.mission_form_name || '', "عدد المشاركين": n.participants_count || 0, "اسم المستشفى": n.hospital_name || '', "عدد المصابين": n.injured_count || 0, "عدد الوفيات": n.deaths_count || 0,
      "تطورات الخبر": n.news_updates || '', "لينك الخبر": n.news_link || '', "اسم مدخل الخبر": n.data_entry_name || '', "ملاحظات": n.notes || '', "طول المسافة بين مكان الحادث و الفرع": n.distance_km || ''
    }));
    try { await exportWorkbook([{ name: 'سجل الأخبار', ...gridFromRows(newsRows) }], `سجل_الأخبار_المحلية_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  // تصدير خبر واحد — يُستدعى من زر التنزيل في صف الجدول (البيانات من نفس الصف مباشرة)
  const handleExportSingleNews = async (n) => {
    const newsRow = [{
      "التاريخ": formatDateTime(n.incident_date), "الشهر": n.incident_month || '', "وصف الحادث": n.incident_description || '', "نوع الخبر": n.news_type || '', "ناشر الخبر": n.news_publisher || '',
      "اسم الشارع": n.street_name || '', "المنطقة": n.area_name || '', "المحافظة": n.governorate || '',
      "الابلاغ": n.is_reported ? 'نعم' : 'لا', "توقيت ارسال الخبر": format12H(n.report_time), "حالة الرد": n.is_responded ? 'نعم' : 'لا', "رد الفرع": n.branch_response_text || '',
      "توقيت الرد": format12H(n.response_time), "حالة توقيت الرد": n.response_time_points || 0, "زمن الرد": n.response_duration || '',
      "الاستجابة": n.is_field_response ? 'نعم' : 'لا', "توقيت التحرك للاستجابة الميدانية من الفرع": format12H(n.movement_time), "المدة بين الابلاغ و التحرك": n.report_to_movement_duration || '',
      "حالة المدة بين الابلاغ و التحرك": n.movement_points || 0, "توقيت الاستجابة الميدانية (اول متطوع يوصل)": format12H(n.field_arrival_time), "حالة الاستجابة": n.field_response_points || 0,
      "الزمن المتخذ لبدء الاستجابة": n.report_to_arrival_duration || '', "نوع الاستجابة": n.intervention_type || '', "الفرع المتدخل": n.intervening_branch || '',
      "اسم الاستمارة": n.mission_form_name || '', "عدد المشاركين": n.participants_count || 0, "اسم المستشفى": n.hospital_name || '', "عدد المصابين": n.injured_count || 0, "عدد الوفيات": n.deaths_count || 0,
      "تطورات الخبر": n.news_updates || '', "لينك الخبر": n.news_link || '', "اسم مدخل الخبر": n.data_entry_name || '', "ملاحظات": n.notes || '', "طول المسافة بين مكان الحادث و الفرع": n.distance_km || ''
    }];
    try { await exportWorkbook([{ name: 'تفاصيل الخبر', ...gridFromRows(newsRow) }], `خبر_${n.area_name || 'محلي'}_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير الخبر بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
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
        <StatCard title="متوسط نقاط الاستجابة" value={filteredNews.length ? Math.round(filteredNews.reduce((a,b)=>a+b.field_response_points,0)/filteredNews.length) : 0} color="text-[var(--data)]" />
      </div>

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col h-[650px]">
        <div className="p-6 border-b border-[var(--border)] bg-[var(--surface-4)] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full lg:w-auto">
            <h3 className="text-xl font-bold text-white whitespace-nowrap">الأخبار المحلية</h3>
            
            <div className="flex flex-wrap items-center gap-2 w-full">
              <EocSelect variant="toolbar" value={filterGov} onChange={(e) => setFilterGov(e.target.value)}>
                <option value="all">كل المحافظات</option>
                {governorates.map(g => <option key={g} value={g}>{g}</option>)}
              </EocSelect>
              <EocSelect variant="toolbar" className="max-w-[200px]" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">كل الحوادث</option>
                {newsTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </EocSelect>
              <div className="flex items-center gap-2">
                <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer" />
                {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-[var(--accent)] hover:text-white bg-[var(--danger-soft)] px-2 py-2 rounded-lg">الكل</button>}
              </div>
            </div>
          </div>

          <div className="actionbar">
            {isOwner && (
              <button
                type="button"
                onClick={handleExportExcel}
                data-tip="تصدير السجل إلى Excel"
                className="action-btn action-btn--ok shrink-0"
              >
                <ExcelIcon />
                <span className="hidden md:inline">تصدير السجل</span>
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={handleClearAllLocalNews}
                data-tip="مسح جميع الأخبار نهائيًا"
                className="action-btn action-btn--danger shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                <span className="hidden md:inline">مسح الكل</span>
              </button>
            )}
            <Magnetic strength={0.16} className="shrink-0">
              <button
                type="button"
                onClick={handleCreateNew}
                className="btn-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                <span>إضافة خبر</span>
              </button>
            </Magnetic>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap min-w-[720px] text-sm">
            <thead className="sticky top-0 z-20 bg-[var(--surface-3)] text-[var(--muted-2)]">
              <tr>
                <th className="p-4 font-semibold border-l border-[var(--border)]">التاريخ</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">المحافظة</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-blue-400 max-w-[200px]">وصف الحادث</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--data)]">نقاط (رد/تحرك/وصول)</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">المتطوعين</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">مدخل الخبر</th>
                <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? <TableLoadingRow colSpan={7} /> :
               filteredNews.length > 0 ? filteredNews.map(n => (
                <tr key={n.news_id} id={`focus-row-${n.news_id}`} className={`group hover:bg-[var(--surface-hover)]${String(focusedRowId) === String(n.news_id) ? ' focus-row' : ''}`}>
                  <td data-label="التاريخ" className="p-4 text-white border-l border-[var(--border)]">{formatDateTime(n.incident_date)}</td>
                  <td data-label="المحافظة" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)] font-bold">{n.governorate}</td>
                  <td data-label="وصف الحادث" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] truncate max-w-[250px]">{n.incident_description}</td>
                  <td data-label="نقاط (رد/تحرك/وصول)" className="p-4 border-l border-[var(--border)]">
                    <div className="flex gap-1">
                      <span className="bg-[var(--data-soft)] text-[var(--data)] px-2 py-0.5 rounded text-xs border border-[var(--data)]/30" title="نقاط الرد">{n.response_time_points}</span>
                      <span className="bg-orange-500/20 text-orange-500 px-2 py-0.5 rounded text-xs border border-orange-500/30" title="نقاط التحرك">{n.movement_points}</span>
                      <span className="bg-green-500/20 text-green-500 px-2 py-0.5 rounded text-xs border border-green-500/30" title="نقاط الوصول">{n.field_response_points}</span>
                    </div>
                  </td>
                  <td data-label="المتطوعين" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)]">{n.participants_count}</td>
                  <td data-label="مدخل الخبر" className="p-4 text-[var(--faint)] border-l border-[var(--border)] text-xs">{n.data_entry_name}</td>
                  <td data-label="إجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                    <div className="flex justify-center gap-1.5">
                      {n.news_link && <a href={n.news_link} target="_blank" rel="noreferrer" className="icon-btn" title="فتح الرابط"><GlobalWorldIcon /></a>}
                      <button onClick={() => handleEdit(n)} className="icon-btn" title="فتح الخبر"><EyeIcon /></button>
                      <button onClick={() => setDownloadTarget(n)} className="icon-btn" title="تصدير الخبر"><DownloadIcon /></button>
                      {(isOwner || isSupervisor || isJoker) && <button onClick={() => setNewsToDelete(n.news_id)} className="icon-btn icon-btn-danger" title="حذف"><TrashIcon /></button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="7" className="p-8 text-center text-[var(--faint)]">لا توجد أخبار مطابقة للفلاتر</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-2xl animate-fade-in-up">
            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><NewsIcon /> {nd.news_id ? 'تعديل الخبر والمؤشرات' : 'إضافة خبر جديد'}</h2>
              <button onClick={() => setIsModalOpen(false)} disabled={savingNews} className="touch-close bg-[var(--surface-4)] text-[var(--muted-2)] hover:bg-[var(--accent)] hover:text-white p-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"><TrashIcon /></button>
            </div>

            <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 ${savingNews ? 'opacity-60 pointer-events-none' : ''}`} inert={savingNews}>

              <SectionCard title="1. بيانات الخبر الأساسية" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="التاريخ (مطلوب)"><SegDateField value={nd.incident_date} onChange={e => setNd({...nd, incident_date: e.target.value})} className="field border-[var(--accent)]/30" /></FormGroup>
                  <FormGroup label="الشهر (تلقائي)"><StyledInput disabled value={getMonthName(nd.incident_date)} className="bg-[var(--surface-2)] text-[var(--faint)]" /></FormGroup>
                  <FormGroup label="نوع الخبر (مطلوب)">
                    <StyledSelect value={nd.news_type} onChange={e => setNd({...nd, news_type: e.target.value})} className="border-[var(--accent)]/30">
                      <option value="" disabled className="bg-[var(--surface-4)] text-[var(--faint)]">اختر نوع الحادث...</option>
                      {newsTypes.map(type => <option key={type} value={type} className="bg-[var(--surface-4)] text-white">{type}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <div className="md:col-span-3"><FormGroup label="وصف الحادث (مطلوب)"><textarea value={nd.incident_description} onChange={e => setNd({...nd, incident_description: e.target.value})} className="w-full bg-[var(--surface-4)] border border-[var(--accent)]/30 rounded-xl p-3 text-sm outline-none text-white focus:border-[var(--accent)]" rows="2"></textarea></FormGroup></div>
                  <FormGroup label="ناشر الخبر"><StyledInput value={nd.news_publisher} onChange={e => setNd({...nd, news_publisher: e.target.value})} /></FormGroup>
                  <FormGroup label="المحافظة (مطلوب)">
                    <StyledSelect value={nd.governorate} onChange={e => setNd({...nd, governorate: e.target.value})} className="border-[var(--accent)]/30">
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
                  <FormGroup label="توقيت الإرسال"><SegTimeField disabled={!nd.is_reported} value={nd.report_time} onChange={e => setNd({...nd, report_time: e.target.value})} className={`field ${!nd.is_reported ? 'opacity-50' : 'border-[var(--accent)]/30'}`}/></FormGroup>
                  
                  <FormGroup label="تم الرد؟">
                    <StyledSelect disabled={!nd.is_reported} value={nd.is_responded ? 'نعم' : 'لا'} onChange={e => setNd({...nd, is_responded: e.target.value === 'نعم'})} className={!nd.is_reported ? 'opacity-50' : ''}>
                      <option value="لا">لا</option><option value="نعم">نعم</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="توقيت الرد"><SegTimeField disabled={!nd.is_responded} value={nd.response_time} onChange={e => setNd({...nd, response_time: e.target.value})} className={`field ${!nd.is_responded ? 'opacity-50' : 'border-[var(--accent)]/30'}`}/></FormGroup>
                  
                  <div className="md:col-span-2"><FormGroup label="رد الفرع"><StyledInput disabled={!nd.is_responded} value={nd.branch_response_text} onChange={e => setNd({...nd, branch_response_text: e.target.value})} className={!nd.is_responded ? 'opacity-50' : 'border-[var(--accent)]/30'} /></FormGroup></div>
                  <FormGroup label="زمن الرد (تلقائي)"><div className="bg-[var(--surface-2)] text-blue-400 font-bold p-3 rounded-xl border border-[var(--border)] text-sm">{nd.is_responded ? formatDuration(responseDiff) : '-'}</div></FormGroup>
                  <FormGroup label="حالة توقيت الرد (نقاط)"><div className="bg-[var(--surface-2)] text-[var(--data)] font-bold p-3 rounded-xl border border-[var(--border)] text-sm text-center">{nd.is_responded ? `${responsePoints} نقطة` : '-'}</div></FormGroup>
                </div>
              </SectionCard>

              <SectionCard title="3. الاستجابة الميدانية والتحرك" icon={<CarIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <FormGroup label="تمت الاستجابة؟">
                    <StyledSelect disabled={!nd.is_reported} value={nd.is_field_response ? 'نعم' : 'لا'} onChange={e => setNd({...nd, is_field_response: e.target.value === 'نعم'})} className={!nd.is_reported ? 'opacity-50' : ''}>
                      <option value="لا">لا</option><option value="نعم">نعم</option>
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="توقيت التحرك"><SegTimeField disabled={!nd.is_field_response} value={nd.movement_time} onChange={e => setNd({...nd, movement_time: e.target.value})} className={`field ${!nd.is_field_response ? 'opacity-50' : 'border-[var(--accent)]/30'}`} /></FormGroup>
                  <FormGroup label="المدة (إبلاغ ➔ تحرك)"><div className="bg-[var(--surface-2)] text-blue-400 font-bold p-3 rounded-xl border border-[var(--border)] text-sm">{nd.is_field_response ? formatDuration(moveDiff) : '-'}</div></FormGroup>
                  <FormGroup label="نقاط التحرك"><div className="bg-[var(--surface-2)] text-orange-500 font-bold p-3 rounded-xl border border-[var(--border)] text-sm text-center">{nd.is_field_response ? `${movePoints} نقطة` : '-'}</div></FormGroup>

                  <FormGroup label="طول المسافة (كم)"><StyledInput type="number" disabled={!nd.is_field_response} value={nd.distance_km} onChange={e => setNd({...nd, distance_km: e.target.value})} className={!nd.is_field_response ? 'opacity-50' : 'border-[var(--accent)]/30'} placeholder="مثال: 15" /></FormGroup>
                  <FormGroup label="توقيت الوصول (أول متطوع)"><SegTimeField disabled={!nd.is_field_response} value={nd.field_arrival_time} onChange={e => setNd({...nd, field_arrival_time: e.target.value})} className={`field ${!nd.is_field_response ? 'opacity-50' : 'border-[var(--accent)]/30'}`} /></FormGroup>
                  <FormGroup label="الزمن المتوقع (تلقائي)"><div className="bg-[var(--surface-2)] text-[var(--faint)] p-3 rounded-xl border border-[var(--border)] text-sm">{nd.is_field_response && expectedTravelMins !== null ? `${Math.floor(expectedTravelMins)} دقيقة` : '-'}</div></FormGroup>
                  <FormGroup label="نقاط الاستجابة للمسافة"><div className="bg-[var(--surface-2)] text-green-500 font-bold p-3 rounded-xl border border-[var(--border)] text-sm text-center">{nd.is_field_response ? `${fieldPoints} نقطة` : '-'}</div></FormGroup>
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
                  <FormGroup label="تطورات الخبر"><textarea value={nd.news_updates} onChange={e => setNd({...nd, news_updates: e.target.value})} className="w-full bg-[var(--surface-4)] border border-[var(--border)] rounded-xl p-3 text-sm outline-none text-white focus:border-[var(--accent)]" rows="3"></textarea></FormGroup>
                  <FormGroup label="ملاحظات عامة"><textarea value={nd.notes} onChange={e => setNd({...nd, notes: e.target.value})} className="w-full bg-[var(--surface-4)] border border-[var(--border)] rounded-xl p-3 text-sm outline-none text-white focus:border-[var(--accent)]" rows="3"></textarea></FormGroup>
                  <div className="md:col-span-2"><FormGroup label="لينك الخبر (إلزامي)*"><StyledInput value={nd.news_link} onChange={e => setNd({...nd, news_link: e.target.value})} placeholder="https://..." dir="ltr" className="text-left border-blue-500/50 focus:border-blue-500 bg-blue-500/5" required /></FormGroup></div>
                </div>
              </SectionCard>

            </div>
            
            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setIsModalOpen(false)} disabled={savingNews} className="px-6 py-2.5 rounded-xl text-sm font-bold text-[var(--muted-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed">إلغاء</button>
              <button onClick={handleSubmit} disabled={savingNews} className="btn-accent px-8 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">{savingNews ? 'جاري الحفظ...' : 'حفظ الخبر وتقييم الأداء'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ تأكيد حذف خبر فردي — التصميم الموحّد (كبسولة علوية عائمة) */}
      <DangerConfirmModal
        show={newsToDelete !== null}
        title="تأكيد الحذف"
        message="هل أنت متأكد من حذف هذا الخبر نهائياً؟"
        confirmLabel="نعم، احذف"
        onCancel={() => setNewsToDelete(null)}
        onConfirm={confirmDelete}
      />

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

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}

      {/* 📥 تأكيد تنزيل الخبر — نافذة محايدة، «نعم» ينزّل و«إلغاء» يُغلق */}
      <DownloadConfirmModal
        show={downloadTarget !== null}
        title="تصدير الخبر"
        onCancel={() => setDownloadTarget(null)}
        onConfirm={() => { const rec = downloadTarget; setDownloadTarget(null); handleExportSingleNews(rec); }}
      />
    </div>
  );
}

// ==========================================
// وحدة الطقس - Weather Module
// (توقعات الورديات الثلاث لكل محافظة + الطقس اليومي المجمّع آلياً)
// ==========================================
// دورة التوقعات الاستباقية: كل وردية تدخل توقعات الوردية التي تليها:
//   Morning (صباحية) 08:00 ص - 04:00 م → 04:00 م - 12:00 ص نفس التاريخ
//   Evening (مسائية) 04:00 م - 12:00 ص → 12:00 ص - 08:00 ص تاريخ اليوم التالي
//   Night (ليلية)    12:00 ص - 08:00 ص → 08:00 ص - 04:00 م نفس التاريخ
// القاعدة: «القاهرة» (المركز العام) كيان واحد بنفس رمز الفرع (branch_id 19) — ليس لهما سطران منفصلان.
const WEATHER_SHIFT_CHIPS = [
  { key: 'night', ar: 'وردية الليل (12:00 ص - 08:00 ص)', en: 'Night Shift (12:00 AM - 08:00 AM)' },
  { key: 'morning', ar: 'وردية الصباح (08:00 ص - 04:00 م)', en: 'Morning Shift (08:00 AM - 04:00 PM)' },
  { key: 'evening', ar: 'وردية المساء (04:00 م - 12:00 ص)', en: 'Evening Shift (04:00 PM - 12:00 AM)' },
];
const WEATHER_METRICS = [
  { key: 'temp', ar: 'درجة الحرارة', en: 'Temperature', unit: '°C' },
  { key: 'wind', ar: 'سرعة الرياح', en: 'Wind Speed', unit: 'كم/س' },
  { key: 'rain', ar: 'الأمطار', en: 'Rain', unit: 'مم' },
  { key: 'humidity', ar: 'الرطوبة', en: 'Humidity', unit: '%' },
  { key: 'clouds', ar: 'الغيوم', en: 'Clouds', unit: '%' },
  { key: 'aqi', ar: 'جودة الهواء/الغبار', en: 'Air Quality/Dust', unit: '' },
];
const WEATHER_METRIC_FIELDS = (m) => [`${m.key}_min`, `${m.key}_max`];
// خريطة الأقاليم بالرقم (مرآة للواجهة الحالية و main.py BRANCH_ID_TO_REGION)
const W_BRANCH_ID_TO_REGION = {
  19: 'hq', 13: 'hq', 20: 'hq', 8: 'hq', 12: 'hq', 32: 'hq',
  9: 'canal', 25: 'canal', 15: 'canal', 29: 'canal', 26: 'canal', 16: 'canal',
  17: 'delta', 14: 'delta', 31: 'delta', 21: 'delta', 27: 'delta',
  18: 'saeed', 24: 'saeed', 22: 'saeed', 7: 'saeed', 28: 'saeed', 30: 'saeed', 10: 'saeed', 6: 'saeed', 23: 'saeed', 11: 'saeed',
};
// خريطة الأقاليم باسم المحافظة الموحّد (قاهرة/مركز عام = نفس nطاق «المركز العام»)
const W_REGION_NAME_MAP = {
  'المركزالعام': 'hq', 'القاهره': 'hq', 'الجيزه': 'hq', 'القليوبيه': 'hq', 'البحيره': 'hq', 'الاسكندريه': 'hq', 'مرسيمطروح': 'hq', 'مطروح': 'hq',
  'الاسماعيليه': 'canal', 'بورسعيد': 'canal', 'السويس': 'canal', 'شمالسيناء': 'canal', 'جنوبسيناء': 'canal', 'الشرقيه': 'canal',
  'الغربيه': 'delta', 'الدقهليه': 'delta', 'كفرالشيخ': 'delta', 'المنوفيه': 'delta', 'دمياط': 'delta',
  'الفيوم': 'saeed', 'بنيسويف': 'saeed', 'المنيا': 'saeed', 'اسيوط': 'saeed', 'سوهاج': 'saeed', 'قنا': 'saeed', 'الاقصر': 'saeed', 'اسوان': 'saeed', 'الواديالجديد': 'saeed', 'البحرالاحمر': 'saeed',
};
const W_REGION_LABELS = { hq: 'المركز العام', canal: 'أقاليم القنال', delta: 'أقاليم الدلتا', saeed: 'أقاليم الصعيد' };
// قائمة «إنهاء التوقعات» للأدوار العامة — الخيارات 1-4 = نيابةً عن إقليم، الخيار 5 = اعتماد وطني شامل
const W_FINISH_REGIONS = [
  { region: 'hq', label: 'Operation.HQ' },
  { region: 'canal', label: 'Operation.Canal' },
  { region: 'delta', label: 'Operation.Delta' },
  { region: 'saeed', label: 'Operation.Upper' },
];

function WeatherForecastView({ branches = [], isOwner, isJoker, userRole, lang = 'ar', liveUpdateVersion = 0 }) {
  // 🌤️ صلاحيات مستقلة: لا نستخدم isVolunteer هنا (دور «أوبريشن» أهونها يفتح الطقس)
  const weatherEligible = !['VOLUNTEER', 'متطوع'].includes(userRole);
  const isSupervisor = ['MANAGER', 'SUPERVISOR', 'ADMIN'].includes(userRole) || userRole === 'مشرف';
  const isGlobalWeather = isOwner || isJoker || ['MANAGER', 'ADMIN', 'مدير', 'أدمن'].includes(userRole);
  // 🔒 «إنهاء التوقعات» بقى حصريًا من الجوكر فما فوق (جوكر/مشرف/أونر) — اتشالت من رول الأوبريشن
  const canFinishForecast = isOwner || isJoker || isSupervisor;

  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // فلاتر الأدوات الأربعة: (1) الوردية (2) التاريخ
  const [shift, setShift] = useState('night');
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [rows, setRows] = useState([]);            // توقعات الوردية المختارة (من السيرفر)
  const [formValues, setFormValues] = useState({}); // {branchId: {metric_min: '', ...}}
  const [daily, setDaily] = useState([]);           // الطقس اليومي المجمّع (قراءة فقط)
  const [isLoading, setIsLoading] = useState(true);
  const [customAlert, setCustomAlert] = useState(null);
  // 🔒 قفل الحفظ (متزامن) لمنع الضغط المزدوج
  const [savingWeather, setSavingWeather] = useState(false);
  const submitLockRef = useRef(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearAllCode, setClearAllCode] = useState('');
  // 🌤️ تتبع اللمس: فقط المحافظات التي عدّل المستخدم قيمها فعلاً هي ما يُرفع (لا نعيد إرسال الصفوف الجاهزة)
  const touchedRef = useRef(new Set());
  // 📉 قائمة «إنهاء التوقعات» (للأدوار العامة فقط)
  const [finishOpen, setFinishOpen] = useState(false);

  // — تحديد إقليم المستخدم (نفس منطق الواجهة الحالية: username ثم فرعه ثم اسم الفرع)
  const wNormalize = (name) => String(name || '').replace(/[أإآا]/g, 'ا').replace(/[يى]/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, '').trim();
  let currentUserData = {};
  try { currentUserData = JSON.parse(sessionStorage.getItem('user') || '{}'); } catch (e) { currentUserData = {}; }
  const wUsername = String(currentUserData?.username || '').toLowerCase();
  const wBranchId = Number(currentUserData?.branches?.[0]?.branch_id || currentUserData?.branch_id || 19);
  const wBranchName = String(currentUserData?.branches?.[0]?.branch_name || currentUserData?.branch || 'المركز العام');
  let userRegion = 'hq';
  if (wUsername.includes('delta')) userRegion = 'delta';
  else if (wUsername.includes('canal')) userRegion = 'canal';
  else if (wUsername.includes('upper') || wUsername.includes('saeed')) userRegion = 'saeed';
  else if (W_BRANCH_ID_TO_REGION[wBranchId]) userRegion = W_BRANCH_ID_TO_REGION[wBranchId];
  else if (W_REGION_NAME_MAP[wNormalize(wBranchName)]) userRegion = W_REGION_NAME_MAP[wNormalize(wBranchName)];
  // وإلا يبقى 'hq' (المركز العام / غير محدد)

  // — فروع كل إقليم (محتسبة من الأسماء والرموز) ثم المحافظات الظاهرة للمستخدم
  const wRegionBranches = useMemo(() => {
    const byRegion = { hq: [], canal: [], delta: [], saeed: [] };
    (branches || []).forEach(b => {
      const region = W_REGION_NAME_MAP[wNormalize(b.name)] || W_BRANCH_ID_TO_REGION[b.id] || 'hq';
      if (!byRegion[region].some(x => x.id === b.id)) byRegion[region].push(b);
    });
    return byRegion;
  }, [branches]);
  const WEATHER_BRANCH_ORDER = [
  19, // المركز العام — يظهر للمستخدم القاهرة (المركز العام)
  13, // الجيزة
  20, // القليوبية
  8,  // الاسكندرية
  32, // مرسي مطروح
  12, // البحيرة
  26, // جنوب سيناء
  29, // شمال سيناء
  15, // السويس
  16, // الشرقية
  9,  // الاسماعيلية
  25, // بورسعيد
  21, // المنوفية
  17, // الغربية
  14, // الدقهلية
  31, // كفر الشيخ
  27, // دمياط
  18, // الفيوم
  24, // بنى سويف
  22, // المنيا
  7,  // اسيوط
  23, // الوادي الجديد
  28, // سوهاج
  30, // قنا
  10, // الاقصر
  11, // البحر الاحمر
  6,  // اسوان
];

const visibleBranches = (
  isGlobalWeather
    ? branches
    : (wRegionBranches[userRegion] || [])
)
  .slice()
  .sort((a, b) => {
    const indexA = WEATHER_BRANCH_ORDER.indexOf(Number(a.id));
    const indexB = WEATHER_BRANCH_ORDER.indexOf(Number(b.id));

    return (indexA === -1 ? 999 : indexA) -
           (indexB === -1 ? 999 : indexB);
  });
  
  console.table(
  (branches || []).map((b) => ({
    id: b.id,
    name: b.name,
  }))
);

  const scopeRegionLabel = isGlobalWeather ? null : W_REGION_LABELS[userRegion];

  // — جلب توقعات الوردية المختارة (جدول الإدخال) والطقس اليومي (المجمّع)
  const loadGrid = async (silent = false) => {
    if (!silent) setIsLoading(true);
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch(`${BASE}/api/weather?date=${filterDate}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        // السيرفر يعيد كل الورديات لهذا التاريخ (مطلوب لتصدير سجل الورديات الثلاث) —
        // جدول الإدخال لا يملأ إلا قيم الوردية المختارة فقط.
        const shiftRows = (data || []).filter(r => r.shift === shift);
        setRows(shiftRows);
        const m = {};
        shiftRows.forEach(r => {
          m[r.branch_id] = {
            temp_min: r.temp_min ?? '', temp_max: r.temp_max ?? '',
            wind_min: r.wind_min ?? '', wind_max: r.wind_max ?? '',
            rain_min: r.rain_min ?? '', rain_max: r.rain_max ?? '',
            humidity_min: r.humidity_min ?? '', humidity_max: r.humidity_max ?? '',
            clouds_min: r.clouds_min ?? '', clouds_max: r.clouds_max ?? '',
            aqi_min: r.aqi_min ?? '', aqi_max: r.aqi_max ?? '',
          };
        });
        setFormValues(m);
      } else {
        setRows([]); setFormValues({});
      }
    } catch (e) { setRows([]); setFormValues({}); }
    finally { setIsLoading(false); }
  };
  const loadDaily = async (silent = false) => {
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch(`${BASE}/api/weather/daily?date=${filterDate}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setDaily(await res.json());
    } catch (e) { /* صامت — يظهر «—» */ }
  };

  // كل تغيير (وردية/تاريخ) → نبدأ من لوح نظيف ونعيد جلب الوردية واليومي
  useEffect(() => { touchedRef.current = new Set(); loadGrid(false); loadDaily(false); }, [shift, filterDate]);
  // تحديث لحظي: مستخدم آخر حفظ توقعات أو أنهى وردية → refetch صامت
  useEffect(() => { if (liveUpdateVersion > 0) { loadGrid(true); loadDaily(true); } }, [liveUpdateVersion]);
  // التنبيهات غير الحاجبة: تنغلق تلقائيًا بدل أن تحجب الشاشة وتدفع المستخدم لـ Refresh
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);

  const setCell = (bid, field, value) => {
    touchedRef.current.add(bid);
    setFormValues(prev => ({ ...prev, [bid]: { ...(prev[bid] || {}), [field]: value } }));
  };
  const cellVal = (bid, field) => {
    const v = (formValues[bid] || {})[field];
    return v ?? '';
  };
  const govLabel = (b) => (b.id === 19
    ? (lang === 'ar' ? 'القاهرة (المركز العام)' : 'Cairo (General HQ)')
    : b.name);

  const handleSave = async () => {
    if (submitLockRef.current) return;
    // فقط المحافظات الملموسة (touched) والتي بها ≥1 قيمة
    const dirtyRows = visibleBranches
      .filter(b => touchedRef.current.has(b.id))
      .map(b => ({ branch_id: b.id, shift, ...(formValues[b.id] || {}) }))
      .filter(r => Object.keys(r).some(k => k.endsWith('_min') || k.endsWith('_max'))
        && WEATHER_METRICS.some(m => {
          const v = (formValues[r.branch_id] || {});
          return (v[`${m.key}_min`] !== '' && v[`${m.key}_min`] != null) || (v[`${m.key}_max`] !== '' && v[`${m.key}_max`] != null);
        }));
    if (!dirtyRows.length) {
      return setCustomAlert(lang === 'ar' ? 'لا توجد قيم جديدة لحفظها — أدخل قيماً في الخلايا أولاً.' : 'Nothing to save — enter values first.');
    }

    submitLockRef.current = true;
    setSavingWeather(true);
    const token = sessionStorage.getItem('access_token');
    const bodyRows = dirtyRows.map(r => {
      const o = { branch_id: r.branch_id, shift: r.shift };
      WEATHER_METRICS.forEach(m => {
        WEATHER_METRIC_FIELDS(m).forEach(f => {
          const v = r[f];
          o[f] = (v !== '' && v != null) ? Number(v) : null;
        });
      });
      return o;
    });
    try {
      const res = await fetch(`${BASE}/api/weather/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ date: filterDate, shift, rows: bodyRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCustomAlert(data.detail || (lang === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Failed to save'));
        return;
      }
      setCustomAlert(data.message || (lang === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully'));
      touchedRef.current = new Set();
      loadGrid(true); loadDaily(true);
    } catch (err) {
      setCustomAlert(lang === 'ar' ? 'حدث خطأ في الاتصال بالسيرفر.' : 'Network error');
    } finally {
      submitLockRef.current = false;
      setSavingWeather(false);
    }
  };

  const clearAllBusyRef = useRef(false);
  const handleClearAllWeather = () => { if (!isOwner) return; setClearAllCode(''); setShowClearAllConfirm(true); };
  const confirmClearAllWeather = async () => {
    if (clearAllCode !== "301014") {
      setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
      return;
    }
    if (clearAllBusyRef.current) return;
    clearAllBusyRef.current = true;
    setShowClearAllConfirm(false);
    try {
      const token = sessionStorage.getItem('access_token');
      const res = await fetch(`${BASE}/api/weather/clear-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ confirmation_code: clearAllCode }),
      });
      const data = await res.json();
      if (!res.ok) { setCustomAlert(data.detail || 'فشل تنفيذ عملية المسح.'); return; }
      touchedRef.current = new Set();
      setCustomAlert(`تم مسح جميع توقعات الطقس بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      setClearAllCode('');
      loadGrid(true); loadDaily(true);
    } catch (error) {
      console.error(error);
      setCustomAlert('حدث خطأ أثناء الاتصال بالسيرفر.');
    } finally {
      clearAllBusyRef.current = false;
    }
  };

  // — تصديران (المالك فقط) + تسجيل كلٍّ منهما حدثاً مميزاً في سجل النظام
  const logWeatherExport = async (kind) => {
    const token = sessionStorage.getItem('access_token');
    try {
      await fetch(`${BASE}/api/weather/export-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ kind }),
      });
    } catch (e) { /* لا نمنع التنزيل لتعثر تسجيل */ }
  };
  const handleExportDaily = async () => {
    if (!isOwner) return;
    try {
      await logWeatherExport('daily');
      const token = sessionStorage.getItem('access_token');
      const res = await fetch(`${BASE}/api/weather/daily?date=${filterDate}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return setCustomAlert('تعذّر جلب الطقس اليومي للتصدير.');
      const data = await res.json();
      if (!data.length) return setCustomAlert(lang === 'ar' ? 'لا توجد بيانات طقس يومي للتصدير في هذا التاريخ.' : 'No daily weather data to export.');
      const shiftRows = data.map(r => ({
        'المحافظة': r.branch_name,
        'حرارة صغرى (°C)': r.temp_min ?? '', 'حرارة عظمى (°C)': r.temp_max ?? '',
        'رياح صغرى (كم/س)': r.wind_min ?? '', 'رياح عظمى (كم/س)': r.wind_max ?? '',
        'أمطار صغرى (مم)': r.rain_min ?? '', 'أمطار عظمى (مم)': r.rain_max ?? '',
        'رطوبة صغرى (%)': r.humidity_min ?? '', 'رطوبة عظمى (%)': r.humidity_max ?? '',
        'غيوم صغرى (%)': r.clouds_min ?? '', 'غيوم عظمى (%)': r.clouds_max ?? '',
        'جودة هواء صغرى': r.aqi_min ?? '', 'جودة هواء عظمى': r.aqi_max ?? '',
      }));
      await exportWorkbook([{ name: 'الطقس اليومي', ...gridFromRows(shiftRows) }], `الطقس_اليومي_${filterDate}.xlsx`);
      setCustomAlert("تم تصدير الطقس اليومي بنجاح!");
    } catch (e) { setCustomAlert('حدث خطأ أثناء التصدير.'); }
  };
  const handleExportLog = async () => {
    if (!isOwner) return;
    try {
      await logWeatherExport('log');
      const token = sessionStorage.getItem('access_token');
      const res = await fetch(`${BASE}/api/weather?date=${filterDate}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return setCustomAlert('تعذّر جلب سجل الورديات للتصدير.');
      const data = await res.json();
      if (!data.length) return setCustomAlert(lang === 'ar' ? 'لا توجد توقعات مسجلة في هذا التاريخ.' : 'No forecasts recorded for this date.');
      const shiftAr = WEATHER_SHIFT_CHIPS.reduce((a, s) => { a[s.key] = s.ar; return a; }, {});
      const toLogRow = (r) => ({
        'التاريخ': r.forecast_date, 'الوردية': shiftAr[r.shift] || r.shift, 'المحافظة': r.branch_name,
        'حرارة صغرى (°C)': r.temp_min ?? '', 'حرارة عظمى (°C)': r.temp_max ?? '',
        'رياح صغرى (كم/س)': r.wind_min ?? '', 'رياح عظمى (كم/س)': r.wind_max ?? '',
        'أمطار صغرى (مم)': r.rain_min ?? '', 'أمطار عظمى (مم)': r.rain_max ?? '',
        'رطوبة صغرى (%)': r.humidity_min ?? '', 'رطوبة عظمى (%)': r.humidity_max ?? '',
        'غيوم صغرى (%)': r.clouds_min ?? '', 'غيوم عظمى (%)': r.clouds_max ?? '',
        'جودة هواء صغرى': r.aqi_min ?? '', 'جودة هواء عظمى': r.aqi_max ?? '',
      });
      // 📑 مصنّف بأوراقٍ منفصلة لكل وردية (صباح/مساء/ليل) — الأوراق الفارغة تُستبعد تلقائياً.
      const SHIFT_SHEET_NAMES = { morning: 'وردية الصباح', evening: 'وردية المساء', night: 'وردية الليل' };
      const sheets = ['morning', 'evening', 'night']
        .map(k => ({ name: SHIFT_SHEET_NAMES[k], ...gridFromRows(data.filter(r => r.shift === k).map(toLogRow)) }))
        .filter(s => s && s.rows.length > 0);
      await exportWorkbook(sheets, `سجل_الورديات_الثلاث_${filterDate}.xlsx`);
      setCustomAlert("تم تصدير سجل الورديات بنجاح!");
    } catch (e) { setCustomAlert('حدث خطأ أثناء التصدير.'); }
  };

  // — «إنهاء التوقعات»: إقليمي = زر واحد، عام = قائمة من 5 خيارات
  const handleFinish = async (kind, region) => {
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch(`${BASE}/api/weather/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ kind, region: region || null }),
      });
      const data = await res.json();
      if (!res.ok) { setCustomAlert(data.detail || 'تعذّر تنفيذ خطوة الإنهاء.'); return; }
      setCustomAlert(data.message || 'تم إرسال إشعار الإنهاء');
      setFinishOpen(false);
    } catch (e) { setCustomAlert('حدث خطأ أثناء الاتصال بالسيرفر.'); }
  };

  if (!weatherEligible) {
    return (
      <div className="card-surface p-8 text-center">
        <h3 className="text-xl font-bold text-white mb-2">{lang === 'ar' ? 'غير مصرح بالوصول' : 'Access denied'}</h3>
        <p className="text-[var(--muted)]">{lang === 'ar' ? 'وحدة الطقس متاحة لأدوار الأوبريشن فما فوق' : 'Weather module is open to Operation roles and above'}</p>
      </div>
    );
  }

  const cellCls = "w-20 bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-1.5 py-1.5 text-center text-sm text-white outline-none focus:border-[var(--accent)]/50 transition-colors";
  const T = (ar, en) => (lang === 'ar' ? ar : en);

  return (
    <div className="space-y-6 pb-10 animate-fade-in-up">
      {/* — شريط الفلاتر: الوردية + التاريخ (+ أدوات المالك) — */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 text-xs font-bold text-[var(--muted)] whitespace-nowrap">{T('الوردية:', 'Shift:')}</span>
          <div className="segmented flex-wrap">
            {WEATHER_SHIFT_CHIPS.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setShift(s.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${shift === s.key ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-accent)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
              >
                {T(s.ar, s.en)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 text-xs font-bold text-[var(--muted)] whitespace-nowrap">{T('التاريخ:', 'Date:')}</span>
            <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer" />
          </div>
        </div>

        <div className="actionbar flex-wrap">
          {/* — زر «إنهاء التوقعات» — (في موضعه الأصلي: أول عناصر الشريط) — حصريًا جوكر/مشرف/أونر */}
          {canFinishForecast && (
          isGlobalWeather ? (
            <div className="relative shrink-0">
              <button type="button" onClick={() => setFinishOpen(o => !o)} className="btn-primary">
                <CheckIcon /><span>{T('إنهاء التوقعات', 'Finish Forecast')}</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {finishOpen && (
                <>
                  <div className="fixed inset-0 z-[40]" onClick={() => setFinishOpen(false)} />
                  <div className="absolute end-0 top-full z-[41] mt-2 w-72 max-w-[min(18rem,calc(100vw-1.5rem))] bg-[var(--surface-3)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden animate-fade-in-up origin-top-right">
                    {W_FINISH_REGIONS.map(r => (
                      <button key={r.region} type="button" onClick={() => handleFinish('region', r.region)}
                        className="w-full text-right px-4 py-3 text-sm font-bold text-[var(--ink)] hover:bg-[var(--surface-hover)] border-b border-[var(--border)] flex items-center gap-2">
                        <WeatherIcon className="w-4 h-4 text-[var(--muted)]" /> {r.label}
                        <span className="text-[10px] text-[var(--faint)] font-normal">{W_REGION_LABELS[r.region]}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => handleFinish('all', null)}
                      className="w-full text-right px-4 py-3 text-sm font-bold text-[var(--ok)] hover:bg-[var(--surface-hover)] flex items-center gap-2">
                      <CheckIcon /> ✅ Approve All Regions (Global Completion)
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => handleFinish('region', userRegion)} className="btn-primary shrink-0">
              <CheckIcon /><span>{T(`إنهاء توقعات ${scopeRegionLabel || ''}`, 'Finish Forecast')}</span>
            </button>
          )
          )}
          {isOwner && (
            <>
              <button type="button" onClick={handleExportDaily} data-tip="تصدير الطقس اليومي إلى Excel" className="action-btn action-btn--ok shrink-0">
                <ExcelIcon /><span className="hidden md:inline">{T('تصدير الطقس اليومي', 'Export Daily Weather')}</span>
              </button>
              <button type="button" onClick={handleExportLog} data-tip="تصدير سجل الورديات الثلاث" className="action-btn action-btn--ok shrink-0">
                <ExcelIcon /><span className="hidden md:inline">{T('تصدير سجل الورديات الثلاث', 'Export 3-Shift Log')}</span>
              </button>
              <button type="button" onClick={handleClearAllWeather} data-tip="مسح جميع التوقعات نهائيًا" className="action-btn action-btn--danger shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                <span className="hidden md:inline">{T('مسح الكل', 'Delete All')}</span>
              </button>
            </>
          )}
          </div>
      </div>

      {/* — ملخص دورة التوقعات — */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {WEATHER_SHIFT_CHIPS.map(s => (
          <div key={s.key} className="card-surface px-4 py-3 rounded-2xl border border-[var(--border)]">
            <p className="text-sm font-bold text-[var(--ink)]">{T(s.ar, s.en)}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{T(
              s.key === 'morning' ? 'تُدخل توقعات الفترة (04:00 م - 12:00 ص) لنفس التاريخ' :
              s.key === 'evening' ? 'تُدخل توقعات الفترة (12:00 ص - 08:00 ص) لليوم التالي' :
              'تُدخل توقعات الفترة (08:00 ص - 04:00 م) لنفس التاريخ',
              s.key === 'morning' ? 'Forecasts the (04:00 PM - 12:00 AM) block for the same date' :
              s.key === 'evening' ? 'Forecasts the (12:00 AM - 08:00 AM) block for the next date' :
              'Forecasts the (08:00 AM - 04:00 PM) block for the same date'
            )}</p>
          </div>
        ))}
      </div>

      {/* — جدول الإدخال: المحافظة + 6 مقاييس × (صغرى/عظمى) — */}
      <div className="card-surface p-4 md:p-6 rounded-3xl border border-[var(--border)]">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <span className="text-[var(--accent)]"><WeatherIcon /></span>
            {T('إدخال توقعات الوردية المختارة', 'Enter Forecasts for Selected Shift')}
            {scopeRegionLabel && !isGlobalWeather && (
              <span className="text-xs font-bold text-[var(--info)] bg-[var(--info-soft)] border border-[var(--info)]/20 rounded-full px-2.5 py-0.5">{T('نطاقك: ' + scopeRegionLabel, 'Scope: ' + scopeRegionLabel)}</span>
            )}
          </h3>
          <span className="text-xs text-[var(--muted)] font-bold">{T('ابدأ بيوم نظيف كل يوم — املأ القيم بالترتيب حسب الحاجة', 'Clean slate each day — fill values as needed')}</span>
        </div>
        {isLoading ? (
          <p className="text-[var(--muted)] text-sm py-8 text-center">{T('جارٍ تحميل التوقعات…', 'Loading forecasts…')}</p>
        ) : visibleBranches.length === 0 ? (
          <p className="text-[var(--muted)] text-sm py-8 text-center">{T('لا توجد محافظات ضمن نطاقك.', 'No governorates within your scope.')}</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar" style={{ pointerEvents: savingWeather ? 'none' : undefined, opacity: savingWeather ? 0.6 : 1 }}>
            <table className="w-full text-right whitespace-nowrap min-w-[1100px] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--surface-3)] text-[var(--muted-2)]">
                <tr>
                  <th rowSpan="2" className="p-3 font-semibold border-l border-[var(--border)]">{T('المحافظة', 'Governorate')}</th>
                  {WEATHER_METRICS.map(m => (
                    <th key={m.key} colSpan="2" className="p-3 font-semibold border-l border-[var(--border)] text-center">
                      {T(m.ar, m.en)}{m.unit ? <span className="text-[10px] font-normal text-[var(--faint)]"> ({m.unit})</span> : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  {WEATHER_METRICS.map(m => (
                    <Fragment key={m.key}>
                      <th className="p-2 font-semibold border-l border-[var(--border)] text-[var(--faint)]">{T('صغرى', 'Min')}</th>
                      <th className="p-2 font-semibold border-l border-[var(--border)] text-[var(--faint)]">{T('عظمى', 'Max')}</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBranches.map(b => (
                  <tr key={b.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="p-2 font-bold text-[var(--ink)] whitespace-nowrap">{govLabel(b)}</td>
                    {WEATHER_METRICS.map(m => (
                      <Fragment key={m.key}>
                        <td className="p-2"><input type="number" step="any" min="0" inputMode="decimal" value={cellVal(b.id, `${m.key}_min`)} onChange={e => setCell(b.id, `${m.key}_min`, e.target.value)} className={cellCls} placeholder="—" /></td>
                        <td className="p-2"><input type="number" step="any" min="0" inputMode="decimal" value={cellVal(b.id, `${m.key}_max`)} onChange={e => setCell(b.id, `${m.key}_max`, e.target.value)} className={cellCls} placeholder="—" /></td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-[var(--muted)]">{T('عدد المحافظات المرئية', 'Visible governorates')}: <b className="text-[var(--ink)]">{visibleBranches.length}</b> {scopeRegionLabel && !isGlobalWeather ? `(${T('نطاق ' + scopeRegionLabel, 'Region ' + scopeRegionLabel)})` : ''}</span>
          <button type="button" onClick={handleSave} disabled={savingWeather} className="btn-accent px-8 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
            {savingWeather ? T('جاري الحفظ...', 'Saving…') : T(`حفظ توقعات الوردية`, 'Save Shift Forecast')}
          </button>
        </div>
      </div>

      {/* — الطقس اليومي (تجميع آلي قراءة فقط) — */}
      <div className="card-surface p-4 md:p-6 rounded-3xl border border-[var(--border)]">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
            <span className="text-[var(--data)]"><WeatherIcon /></span>
            {T('الطقس اليومي (تجميع آلي للورديات الثلاث)', 'Daily Weather (Auto Aggregation)')}
          </h3>
          <span className="ops-chip text-[var(--ok)] border-[var(--ok-soft)] bg-[var(--ok-soft)]"><span className="live-dot" /> {T('قراءة فقط', 'Read-only')}</span>
        </div>
        {daily.length === 0 ? (
          <p className="text-[var(--muted)] text-sm py-6 text-center">{T('لا توجد بيانات مجمّعة لهذا اليوم بعد — أدخل توقعات الورديات أولاً.', 'No aggregated data yet — enter shift forecasts first.')}</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-right whitespace-nowrap min-w-[1100px] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--surface-3)] text-[var(--muted-2)]">
                <tr>
                  <th rowSpan="2" className="p-3 font-semibold border-l border-[var(--border)]">{T('المحافظة', 'Governorate')}</th>
                  {WEATHER_METRICS.map(m => (
                    <th key={m.key} colSpan="2" className="p-3 font-semibold border-l border-[var(--border)] text-center">
                      {T(m.ar, m.en)}{m.unit ? <span className="text-[10px] font-normal text-[var(--faint)]"> ({m.unit})</span> : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  {WEATHER_METRICS.map(m => (
                    <Fragment key={m.key}>
                      <th className="p-2 font-semibold border-l border-[var(--border)] text-[var(--faint)]">{T('صغرى', 'Min')}</th>
                      <th className="p-2 font-semibold border-l border-[var(--border)] text-[var(--faint)]">{T('عظمى', 'Max')}</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map(r => (
                  <tr key={r.branch_id} className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="p-2 font-bold text-[var(--ink)]">{r.branch_name}</td>
                    {WEATHER_METRICS.map(m => (
                      <Fragment key={m.key}>
                        <td className="p-2 text-[var(--ink-2)]">{r[`${m.key}_min`] != null ? r[`${m.key}_min`] : <span className="text-[var(--faint)]">—</span>}</td>
                        <td className="p-2 text-[var(--ink-2)]">{r[`${m.key}_max`] != null ? r[`${m.key}_max`] : <span className="text-[var(--faint)]">—</span>}</td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* — نافذة تأكيد مسح الكل — */}
      <DangerConfirmModal
        show={showClearAllConfirm}
        title="تأكيد الحذف"
        message="سيتم حذف جميع توقعات الطقس (كل الورديات وكل المحافظات) نهائياً. هذا الإجراء لا يمكن التراجع عنه."
        confirmationCode={clearAllCode}
        onConfirmationCodeChange={setClearAllCode}
        showConfirmationInput={true}
        onCancel={() => { setShowClearAllConfirm(false); setClearAllCode(''); }}
        onConfirm={confirmClearAllWeather}
      />

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
    </div>
  );
}

// ==========================================
// تسليم وتسلم المشرفين (Supervisors Handover)
// ==========================================
const HANDOVER_SHIFTS = [
  { key: 'night', ar: 'وردية الليل', en: 'Night Shift' },
  { key: 'morning', ar: 'وردية الصباح', en: 'Morning Shift' },
  { key: 'evening', ar: 'وردية المساء', en: 'Evening Shift' },
];
const HANDOVER_DEPTS = [
  { key: 'relief', ar: 'الإغاثة', en: 'Relief' },
  { key: 'youth', ar: 'إدارة الشباب والمتطوعين', en: 'Youth & Volunteer Mgmt' },
  { key: 'resources', ar: 'تنمية الموارد', en: 'Resource Development' },
  { key: 'case', ar: 'إدارة الحالات', en: 'Case Management' },
];
const EMPTY_SHIFT_MATRIX = () => {
  const m = {};
  HANDOVER_SHIFTS.forEach(s => HANDOVER_DEPTS.forEach(d => { m[`${s.key}_${d.key}`] = 0; }));
  return m;
};
const HANDOVER_SHIFT_AR = { night: 'وردة الليل', morning: 'وردة الصباح', evening: 'وردة المساء' };
const HANDOVER_DEPT_AR = { relief: 'الإغاثة', youth: 'الشباب والمتطوعين', resources: 'تنمية الموارد', case: 'إدارة الحالات' };
const splitIssuesText = (text) => { const arr = String(text || '').split('\n').map(s => s.trim()).filter(Boolean); return arr.length ? arr : ['']; };
const joinIssuesList = (list) => (list || []).map(s => (s || '').trim()).filter(Boolean).join('\n');

function HandoverView({ isOwner, isSupervisor, lang = 'ar', liveUpdateVersion = 0, focusTarget = null }) {
  const T = (ar, en) => (lang === 'ar' ? ar : en);
  const canAccess = isOwner || isSupervisor;

  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const emptyForm = (date) => ({
    handover_date: date || todayStr(),
    local_news_count: 0, global_news_count: 0, forms_count: 0,
    issuesList: [''],
    tetra_count: 0, huawei_count: 0,
    shift_matrix: EMPTY_SHIFT_MATRIX(),
    followUpsList: [''],
  });

  const [handovers, setHandovers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const submitLockRef = useRef(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(() => emptyForm(todayStr()));
  // 🗑️ نافذة تأكيد الحذف المخصصة (بدلاً من confirm الجاهزة في المتصفح)
  const [deleteTarget, setDeleteTarget] = useState(null);
  // 📥 نافذة تأكيد تنزيل السجل الفردي (محايدة وغير تحذيرية)
  const [downloadTarget, setDownloadTarget] = useState(null);
  // 🗑️ نافذة تأكيد مسح جميع التسليمات
  const [handoverClearAllCode, setHandoverClearAllCode] = useState('');
  const [showHandoverClearAllConfirm, setShowHandoverClearAllConfirm] = useState(false);
  // 🔔 كانت setCustomAlert بتتنادى في كل العمليات هنا (حفظ/حذف/مسح الكل/تنزيل) من غير
  // ما تتعرّف أصلاً - يعني كل عملية ناجحة كانت بتوقع بعدها بخطأ (ReferenceError) بيقطع
  // تنفيذ باقي الكود (زي إعادة تحميل البيانات) وبيتحوّل غلط لرسالة "فشل الاتصال بالخادم".
  const [customAlert, setCustomAlert] = useState(null);
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
  // Auto-logout timeout (8 hours of inactivity)
  useEffect(() => {
    const timeoutDuration = 8 * 60 * 60 * 1000; // 8 hours
    let timeoutId;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(logoutDueToInactivity, timeoutDuration);
    };

    const logoutDueToInactivity = () => {
      clearStoredAuth();
      setUserData(null);
      navigate('/');
      setCustomAlert("تم تسجيل خروجك تلقائيًا بسبب عدم النشاط.");
    };

    // Set initial timeout
    timeoutId = setTimeout(logoutDueToInactivity, timeoutDuration);

    // Listen for activity events
    const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimeout);
    });

    // Cleanup on unmount
    return () => {
      clearTimeout(timeoutId);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimeout);
      });
    };
  }, []); // Empty run-once effect

  const fetchHandovers = useCallback(() => {
    setIsLoading(true);
    fetch(`${BASE}/api/handovers`, { headers: { 'Authorization': `Bearer ${sessionStorage.getItem('access_token') || ''}` } })
      .then(res => (res.ok ? res.json() : []))
      .then(data => { setHandovers(data || []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  useEffect(() => { if (canAccess) fetchHandovers(); }, [canAccess, fetchHandovers]);
  useEffect(() => { if (canAccess && liveUpdateVersion > 0) fetchHandovers(); }, [liveUpdateVersion, canAccess, fetchHandovers]);

  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'handover' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) { window.clearInterval(iv); }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  const loadIntoForm = (rec) => {
    setForm({
      handover_date: rec.handover_date || todayStr(),
      local_news_count: rec.local_news_count || 0,
      global_news_count: rec.global_news_count || 0,
      forms_count: rec.forms_count || 0,
      issuesList: splitIssuesText(rec.issues_text),
      tetra_count: rec.tetra_count || 0,
      huawei_count: rec.huawei_count || 0,
      shift_matrix: { ...EMPTY_SHIFT_MATRIX(), ...(rec.shift_matrix || {}) },
      followUpsList: splitIssuesText(rec.follow_ups_text),
    });
  };

  const openCreate = () => {
    setNotice(null);
    setEditingId(null);
    // 📌 ترحيل المشاكل والملاحظات من آخر تسليم مسجّل إلى استمارة اليوم الجديد،
    // حتى تتابع من يوم لآخر حتى تُحذف يدوياً من آخر استمارة وتُحفظ فارغة.
    const latest = handovers[0];
    const base = emptyForm(todayStr());
    if (latest && latest.issues_text) base.issuesList = splitIssuesText(latest.issues_text);
    setForm(base);
    setModalOpen(true); // يفتح فوراً دون انتظار الشبكة
    const token = sessionStorage.getItem('access_token') || '';
    fetch(`${BASE}/api/handovers/by-date/${todayStr()}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(rec => {
        if (rec) {
          setEditingId(rec.handover_id);
          loadIntoForm(rec);
          setNotice(T('يوجد سجل تسليم مسجل بالفعل لهذا اليوم — سيتم فتحه للتعديل', 'A handover already exists for today — opening it for editing'));
        }
      })
      .catch(() => {});
  };

  const openEdit = (rec) => {
    setNotice(null);
    setEditingId(rec.handover_id);
    loadIntoForm(rec);
    setModalOpen(true);
  };

  const handleDateChange = (dateStr) => {
    setForm(prev => ({ ...prev, handover_date: dateStr }));
    setNotice(null);
  };

  const onMatrixChange = (s, d, val) => {
    setForm(prev => ({ ...prev, shift_matrix: { ...prev.shift_matrix, [`${s}_${d}`]: val === '' ? '' : Math.max(0, Number(val)) } }));
  };

  const resetMatrix = () => setForm(prev => ({ ...prev, shift_matrix: EMPTY_SHIFT_MATRIX() }));

  const sumMatrix = (m) => { const mm = { ...EMPTY_SHIFT_MATRIX(), ...(m || {}) }; return Object.values(mm).reduce((a, b) => a + (Number(b) || 0), 0); };
  const shiftTotal = (sk) => HANDOVER_DEPTS.reduce((a, d) => a + (Number(form.shift_matrix[`${sk}_${d.key}`]) || 0), 0);
  const deptTotal = (dk) => HANDOVER_SHIFTS.reduce((a, s) => a + (Number(form.shift_matrix[`${s.key}_${dk}`]) || 0), 0);
  const matrixTotal = HANDOVER_SHIFTS.reduce((a, s) => a + shiftTotal(s.key), 0);
  const fmtDate = (d) => { if (!d) return '—'; const p = String(d).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; };

  const handleSave = async () => {
    if (submitLockRef.current) return;
    if (!form.handover_date) { setNotice(T('يرجى اختيار التاريخ', 'Please choose a date')); return; }
    setSaving(true);
    submitLockRef.current = true;
    const token = sessionStorage.getItem('access_token') || '';
    const { issuesList, followUpsList, ...formRest } = form;
    const normalize = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
    const payload = {
      ...formRest,
      local_news_count: normalize(form.local_news_count),
      global_news_count: normalize(form.global_news_count),
      forms_count: normalize(form.forms_count),
      tetra_count: normalize(form.tetra_count),
      huawei_count: normalize(form.huawei_count),
      issues_text: joinIssuesList(issuesList),
      follow_ups_text: joinIssuesList(followUpsList),
      shift_matrix: Object.fromEntries(Object.entries(form.shift_matrix || {}).map(([k, v]) => [k, normalize(v)])),
    };
    const url = editingId ? `${BASE}/api/handovers/${editingId}` : `${BASE}/api/handovers`;
    const method = editingId ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.status === 409) {
        const byDate = await fetch(`${BASE}/api/handovers/by-date/${form.handover_date}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const rec = byDate.ok ? await byDate.json() : null;
        setEditingId(rec ? rec.handover_id : null);
        setNotice(T('يوجد سجل تسليم لهذا التاريخ — تم فتحه للتعديل مع الحفاظ على مدخلاتك', 'A handover exists for this date — opened for editing with your input preserved'));
        setSaving(false);
        submitLockRef.current = false;
        return;
      }
      if (!res.ok) { setNotice(T('فشل الحفظ', 'Save failed')); setSaving(false); submitLockRef.current = false; return; }
      setModalOpen(false);
      setNotice(null);
      fetchHandovers();
      setCustomAlert(editingId ? "تم تحديث سجل التسليم بنجاح!" : "تم إنشاء سجل التسليم بنجاح!");
    } catch (error) {
      console.error('Save error:', error);
      setNotice(T('فشل الاتصال بالخادم', 'Connection failed'));
    }
    setSaving(false);
    submitLockRef.current = false;
  };

  const handleClearAllHandovers = () => {
    if (!isOwner) return; // Assuming only owners can clear all handovers
    setHandoverClearAllCode('');
    setShowHandoverClearAllConfirm(true);
  };

  const confirmClearAllHandovers = async () => {
    if (handoverClearAllCode !== "301014") {
      setCustomAlert("رمز التأكيد غير صحيح. لم يتم حذف أي بيانات.");
      return;
    }
    setShowHandoverClearAllConfirm(false);
    try {
      const token = sessionStorage.getItem('access_token') || '';
      const res = await fetch(`${BASE}/api/handovers/clear-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ confirmation_code: handoverClearAllCode })
      });
      const data = await res.json();
      if (!res.ok) {
        setCustomAlert(data.detail || "فشل تنفيذ عملية المسح.");
        return;
      }
      setCustomAlert(`تم مسح جميع سجلات التسليمات بنجاح.\nعدد السجلات المحذوفة: ${data.deleted_count}`);
      // Refetch handover data to update UI
      fetchHandovers();
    } catch (error) {
      console.error(error);
      setCustomAlert("حدث خطأ أثناء الاتصال بالسيرفر.");
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget == null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`${BASE}/api/handovers/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${sessionStorage.getItem('access_token') || ''}` } });
      if (res.ok) { fetchHandovers(); setCustomAlert("تم حذف سجل التسليم بنجاح."); }
      else setNotice(T('تعذر الحذف', 'Delete failed'));
    } catch { setNotice(T('تعذر الحذف', 'Delete failed')); }
  };

  const auditDownload = async (scope, scope_id) => {
    try {
      await fetch(`${BASE}/api/handovers/export-log`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('access_token') || ''}` }, body: JSON.stringify({ scope, scope_id }) });
    } catch (error) {
      // التسجيل في اللوج لا يمنع التنزيل
      console.warn('Failed to log download attempt:', error);
    }
  };

  const matrixToExportRow = (rec) => {
    const m = { ...EMPTY_SHIFT_MATRIX(), ...(rec.shift_matrix || {}) };
    const row = {
      [T('التاريخ', 'Date')]: rec.handover_date,
      [T('الأخبار المحلية', 'Local news')]: rec.local_news_count || 0,
      [T('الأخبار العالمية', 'Global news')]: rec.global_news_count || 0,
      [T('الاستمارات المنشأة', 'Forms created')]: rec.forms_count || 0,
      [T('أجهزة تيترا', 'Tetra devices')]: rec.tetra_count || 0,
      [T('أجهزة هواوي', 'Huawei devices')]: rec.huawei_count || 0,
    };
    HANDOVER_SHIFTS.forEach(s => HANDOVER_DEPTS.forEach(d => { row[`${HANDOVER_SHIFT_AR[s.key]} - ${HANDOVER_DEPT_AR[d.key]}`] = m[`${s.key}_${d.key}`] || 0; }));
    row[T('المشاكل والملاحظات', 'Issues')] = rec.issues_text || '';
    row[T('المتابعات العامة', 'Follow-ups')] = rec.follow_ups_text || '';
    return row;
  };

  const downloadSingle = async (rec) => {
    await auditDownload('single', rec.handover_id);
    try { await exportWorkbook([{ name: T('تسليم', 'Handover'), ...gridFromRows([matrixToExportRow(rec)]) }], `تسليم_تسلم_مشرفين_${rec.handover_date}_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير التسليم بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  const downloadAll = async () => {
    await auditDownload('all', null);
    if (!handovers.length) { setNotice(T('لا توجد تسليمات مسجلة بعد', 'No handovers recorded yet')); return; }
    // 📌 السجل الشامل: تبويب واحد يجمع كل سجلات الأيام (بدلاً من تبويب مستقل لكل يوم).
    const allRows = handovers.map(r => matrixToExportRow(r));
    try { await exportWorkbook([{ name: T('سجل تسليم وتسلم المشرفين', 'Handover Register'), ...gridFromRows(allRows) }], `السجل_الشامل_تسليمات_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل الشامل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  if (!canAccess) {
    return (
      <div className="card-surface p-8 text-center">
        <h3 className="text-xl font-bold text-white mb-2">{T('غير مصرح بالوصول', 'Access denied')}</h3>
        <p className="text-[var(--muted)]">{T('هذه الصفحة متاحة للمالك والمشرفين فقط', 'This page is open to the owner and supervisors only')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
      {notice && <div className="rounded-xl bg-[var(--warn-soft)] text-[var(--warn)] px-4 py-3 text-sm font-bold border border-[var(--warn)]/25">{notice}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up">
        <StatCard title={T('إجمالي التسليمات', 'Total Handovers')} value={handovers.length} color="text-white" borderHighlight />
        <StatCard title={T('آخر تسليم', 'Latest Handover')} value={handovers[0] ? fmtDate(handovers[0].handover_date) : '—'} color="text-[var(--accent)]" />
        <StatCard title={T('إجمالي أفراد الورديات', 'Total Shift Personnel')} value={handovers.reduce((a, r) => a + sumMatrix(r.shift_matrix), 0)} color="text-[var(--ok)]" />
        <StatCard title={T('إجمالي الأجهزة', 'Total Devices')} value={handovers.reduce((a, r) => a + (r.tetra_count || 0) + (r.huawei_count || 0), 0)} color="text-purple-400" />
      </div>

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col">
        <div className="p-6 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-bold text-white flex items-center gap-2.5"><HandoverIcon /> {T('سجل التسليمات', 'Handover Log')}</h3>
          <div className="actionbar">
            {isOwner && (
              <button
                type="button"
                onClick={downloadAll}
                data-tip={T('تنزيل السجل الشامل', 'Download Comprehensive Log')}
                className="action-btn action-btn--ok shrink-0"
              >
                <ExcelIcon />
                <span className="hidden md:inline">{T('تنزيل السجل الشامل', 'Download Comprehensive Log')}</span>
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={handleClearAllHandovers}
                data-tip={T('حذف جميع التسليمات', 'Delete All Handovers')}
                className="action-btn action-btn--danger shrink-0"
              >
                <TrashIcon className="w-5 h-5" />
                <span className="hidden md:inline">{T('حذف جميع التسليمات', 'Delete All Handovers')}</span>
              </button>
            )}
            <Magnetic strength={0.16} className="shrink-0">
              <button
                type="button"
                onClick={openCreate}
                className="btn-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                <span>{T('إنشاء تسليم يومي', 'Create Daily Handover')}</span>
              </button>
            </Magnetic>
          </div>
        </div>

        <div className="table-shell overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th>{T('التاريخ', 'Date')}</th>
                <th>{T('المحلية/العالمية', 'Local / Global')}</th>
                <th>{T('استمارات', 'Forms')}</th>
                <th>{T('معدات (ت/هـ)', 'Equipment (T/H)')}</th>
                <th>{T('أفراد الورديات', 'Shift Staff')}</th>
                <th>{T('المنشئ', 'Created by')}</th>
                <th>{T('آخر تعديل', 'Last updated')}</th>
                <th>{T('إجراءات', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">{T('جاري التحميل...', 'Loading...')}</td></tr>
              ) : handovers.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">{T('لا توجد تسليمات مسجلة بعد', 'No handovers recorded yet')}</td></tr>
              ) : handovers.map(r => (
                <tr key={r.handover_id} id={`focus-row-${r.handover_id}`} className={String(focusedRowId) === String(r.handover_id) ? 'focus-row' : undefined}>
                  <td data-label={T('التاريخ', 'Date')} className="font-bold text-[var(--accent)]" dir="ltr">{r.handover_date}</td>
                  <td data-label={T('المحلية/العالمية', 'Local / Global')}>{r.local_news_count || 0} / {r.global_news_count || 0}</td>
                  <td data-label={T('استمارات', 'Forms')}>{r.forms_count || 0}</td>
                  <td data-label={T('معدات (ت/هـ)', 'Equipment (T/H)')}>{r.tetra_count || 0} / {r.huawei_count || 0}</td>
                  <td data-label={T('أفراد الورديات', 'Shift Staff')}>{sumMatrix(r.shift_matrix)}</td>
                  <td data-label={T('المنشئ', 'Created by')}>{r.created_by_name || '—'}</td>
                  <td data-label={T('آخر تعديل', 'Last updated')}>{r.updated_at ? (r.updated_by_name || '—') : '—'}</td>
                  <td data-label="actions">
                    <div className="flex items-center justify-center gap-1.5">
                      <button title={T('تعديل', 'Edit')} onClick={() => openEdit(r)} className="icon-btn"><EditIcon /></button>
                      <button title={T('تنزيل سجل التسليم', 'Download record')} onClick={() => setDownloadTarget(r)} className="icon-btn"><DownloadIcon /></button>
                      {isOwner && <button title={T('حذف', 'Delete')} onClick={() => setDeleteTarget(r.handover_id)} className="icon-btn icon-btn-danger"><TrashIcon /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && createPortal(
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[9999] p-4">
          <div className="modal-card w-full max-w-6xl h-full max-h-[95vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-8 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"></span>
                  <h2 className="text-lg font-bold">{editingId ? T('تعديل تسليم يومي', 'Edit Daily Handover') : T('إنشاء تسليم يومي', 'Create Daily Handover')}</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setModalOpen(false)} disabled={saving} className="icon-btn icon-btn-danger disabled:opacity-40 disabled:cursor-not-allowed" title={T('إغلاق', 'Close')}><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            </div>

            <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 ${saving ? 'opacity-60 pointer-events-none' : ''}`} inert={saving}>
              {notice && <div className="rounded-xl bg-[var(--warn-soft)] text-[var(--warn)] px-4 py-3 text-sm font-bold border border-[var(--warn)]/25">{notice}</div>}

              <SectionCard title={T('التاريخ', 'Date')} icon={<HandoverIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormGroup label={T('تاريخ التسليم', 'Handover date')} invalid={!form.handover_date}>
                    <SegDateField value={form.handover_date} onChange={e => handleDateChange(e.target.value)} className="field" autocapitalize="none" />
                  </FormGroup>
                  <div className="flex flex-col justify-center text-xs text-[var(--muted)]">
                    <span>{T('سجل واحد لكل يوم — عند وجود سجل سابق يتم فتحه للتعديل', 'One record per day — an existing record opens for editing')}</span>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={T('عدّاد الأخبار والاستمارات', 'News & Forms Count')} icon={<NewsIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormGroup label={T('الأخبار المحلية', 'Local news count')}>
                    <StyledInput type="number" min="0" inputMode="numeric" value={form.local_news_count === '' ? '' : form.local_news_count}
                      onFocus={e => e.target.select()} onChange={e => setForm(prev => ({ ...prev, local_news_count: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} autocapitalize="none" />
                  </FormGroup>
                  <FormGroup label={T('الأخبار العالمية', 'Global news count')}>
                    <StyledInput type="number" min="0" inputMode="numeric" value={form.global_news_count === '' ? '' : form.global_news_count}
                      onFocus={e => e.target.select()} onChange={e => setForm(prev => ({ ...prev, global_news_count: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} autocapitalize="none" />
                  </FormGroup>
                  <FormGroup label={T('عدد الاستمارات المنشأة', 'Number of forms created')}>
                    <StyledInput type="number" min="0" inputMode="numeric" value={form.forms_count === '' ? '' : form.forms_count}
                      onFocus={e => e.target.select()} onChange={e => setForm(prev => ({ ...prev, forms_count: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} autocapitalize="none" />
                  </FormGroup>
                </div>
              </SectionCard>

              <SectionCard title={T('المشاكل والملاحظات', 'Issues & Notes')} icon={<AlertIcon />}>
                <div className="space-y-2.5">
                  {form.issuesList.map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--accent)]">{i + 1}</span>
                      <StyledInput value={item}
                        onChange={e => { const next = [...form.issuesList]; next[i] = e.target.value; setForm(prev => ({ ...prev, issuesList: next })); }}
                        placeholder={T(`مشكلة / ملحوظة رقم ${i + 1}...`, `Issue / note #${i + 1}...`)} autocapitalize="none" />
                      <button type="button" title={T('حذف', 'Remove')}
                        onClick={() => { const next = form.issuesList.filter((_, idx) => idx !== i); setForm(prev => ({ ...prev, issuesList: next.length ? next : [''] })); }}
                        className="p-2.5 rounded-xl hover:bg-[var(--accent-soft)] text-[var(--accent)] active:scale-95 transition"><TrashIcon className="w-5 h-5" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, issuesList: [...prev.issuesList, ''] }))}
                    className="action-btn action-btn--ok mt-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    {T('إضافة مشكلة / ملحوظة', 'Add Issue / Note')}
                  </button>
                </div>
              </SectionCard>

              <SectionCard title={T('عدد الأجهزة بالمركز', 'Number of Devices in the Center')} icon={<InventoryIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormGroup label={T('أجهزة تيترا', 'Tetra devices')}>
                    <StyledInput type="number" min="0" inputMode="numeric" value={form.tetra_count === '' ? '' : form.tetra_count}
                      onFocus={e => e.target.select()} onChange={e => setForm(prev => ({ ...prev, tetra_count: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} autocapitalize="none" />
                  </FormGroup>
                  <FormGroup label={T('أجهزة هواوي', 'Huawei devices')}>
                    <StyledInput type="number" min="0" inputMode="numeric" value={form.huawei_count === '' ? '' : form.huawei_count}
                      onFocus={e => e.target.select()} onChange={e => setForm(prev => ({ ...prev, huawei_count: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))} autocapitalize="none" />
                  </FormGroup>
                </div>
              </SectionCard>

              <SectionCard title={T('مصفوفة الورديات', 'Shift Personnel Matrix')}
                icon={<UsersIcon />}
                actionBtn={<button onClick={resetMatrix} className="action-btn action-btn--danger">{T('تصفير الكل', 'Reset All')}</button>}>
                <div className="table-shell overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr>
                        <th className="p-3 text-start">{T('الوردية', 'Shift')}</th>
                        {HANDOVER_DEPTS.map(d => <th key={d.key} className="p-3 text-center">{lang === 'ar' ? d.ar : d.en}</th>)}
                        <th className="p-3 text-center">{T('الإجمالي', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {HANDOVER_SHIFTS.map(s => (
                        <tr key={s.key}>
                          <td data-label={T('الوردية', 'Shift')} className="p-2 font-bold">{lang === 'ar' ? s.ar : s.en}</td>
                          {HANDOVER_DEPTS.map(d => (
                            <td key={d.key} data-label={lang === 'ar' ? d.ar : d.en} className="p-2">
                              <StyledInput type="number" min="0" inputMode="numeric" value={form.shift_matrix[`${s.key}_${d.key}`] === '' ? '' : (form.shift_matrix[`${s.key}_${d.key}`] ?? 0)}
                                onFocus={e => e.target.select()} onChange={e => onMatrixChange(s.key, d.key, e.target.value)} className="!py-1.5 !px-2 text-center w-24 mx-auto" autocapitalize="none" />
                            </td>
                          ))}
                          <td data-label={T('الإجمالي', 'Total')} className="p-2 text-center font-bold text-[var(--accent)]">{shiftTotal(s.key)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td data-label={T('الوردية', 'Shift')} className="p-2 font-bold">{T('الإجمالي', 'Total')}</td>
                        {HANDOVER_DEPTS.map(d => <td key={d.key} data-label={lang === 'ar' ? d.ar : d.en} className="p-2 text-center font-bold text-[var(--accent)]">{deptTotal(d.key)}</td>)}
                        <td data-label={T('الإجمالي', 'Total')} className="p-2 text-center font-bold text-[var(--accent)]">{matrixTotal}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard title={T('المتابعات العامة', 'General Follow-ups')} icon={<MapIcon />}>
                <div className="space-y-2.5">
                  {form.followUpsList.map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--accent)]">{i + 1}</span>
                      <StyledInput value={item}
                        onChange={e => { const next = [...form.followUpsList]; next[i] = e.target.value; setForm(prev => ({ ...prev, followUpsList: next })); }}
                        placeholder={T(`متابعة رقم ${i + 1}...`, `Follow-up #${i + 1}...`)} autocapitalize="none" />
                      <button type="button" title={T('حذف', 'Remove')}
                        onClick={() => { const next = form.followUpsList.filter((_, idx) => idx !== i); setForm(prev => ({ ...prev, followUpsList: next.length ? next : [''] })); }}
                        className="p-2.5 rounded-xl hover:bg-[var(--accent-soft)] text-[var(--accent)] active:scale-95 transition"><TrashIcon className="w-5 h-5" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, followUpsList: [...prev.followUpsList, ''] }))}
                    className="action-btn action-btn--ok mt-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    {T('إضافة متابعة', 'Add Follow-up')}
                  </button>
                </div>
              </SectionCard>
            </div>

            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setModalOpen(false)} disabled={saving} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-[var(--muted-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed">{T('إلغاء', 'Cancel')}</button>
              <button onClick={handleSave} disabled={saving} className="btn-accent px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">
                {saving ? T('جاري الحفظ...', 'Saving...') : (editingId ? T('حفظ التعديلات', 'Save Changes') : T('حفظ التسليم', 'Save Handover'))}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* 🗑️ نافذة تأكيد الحذف المخصصة بدلاً من confirm الجاهزة في المتصفح */}
      <DangerConfirmModal
        show={deleteTarget !== null}
        title={T('تأكيد الحذف', 'Confirm Deletion')}
        message={T('هل أنت متأكد من حذف هذا التسليم؟ لا يمكن التراجع.', 'Are you sure you want to delete this handover? This cannot be undone.')}
        confirmLabel={T('نعم، احذف', 'Yes, delete')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      {/* 📥 تأكيد تنزيل سجل التسليم — نافذة محايدة، «نعم» ينزّل و«إلغاء» يُغلق */}
      <DownloadConfirmModal
        show={downloadTarget !== null}
        title={T('تنزيل سجل التسليم', 'Download record')}
        onCancel={() => setDownloadTarget(null)}
        onConfirm={() => { const rec = downloadTarget; setDownloadTarget(null); downloadSingle(rec); }}
      />
      {/* 🗑️ نافذة تأكيد مسح جميع التسليمات */}
      <DangerConfirmModal
        show={showHandoverClearAllConfirm}
        title={T('تأكيد الحذف', 'Confirm Deletion')}
        message={T('سيتم حذف جميع سجلات التسليمات نهائياً. هذا الإجراء لا يمكن التراجع عنه.', 'All handover records will be permanently deleted. This action cannot be undone.')}
        confirmationCode={handoverClearAllCode}
        onConfirmationCodeChange={setHandoverClearAllCode}
        showConfirmationInput={true}
        onCancel={() => {
          setShowHandoverClearAllConfirm(false);
          setHandoverClearAllCode('');
        }}
        onConfirm={confirmClearAllHandovers}
      />
    </div>
  );
}

// ==========================================
// 7. شاشة الكوارث العالمية (Global Disasters)
// ==========================================
function GlobalDisastersView({ isOwner, isSupervisor, isJoker, isVolunteer, focusTarget = null }) {
  // 💡 1. تعريف دوال التاريخ في أول الشاشة عشان الكل يشوفها بدون تكرار
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => {
    if (!dateStr) return '';
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const iso = String(dateStr).split('T')[0].split('-');
    if (iso.length === 3 && iso[0].length === 4) return months[Number(iso[1]) - 1] || '';
    const dmy = String(dateStr).split('/');
    if (dmy.length === 3) return months[Number(dmy[1]) - 1] || '';
    return months[new Date(dateStr).getMonth()] || '';
  };

  // 💡 2. الحالات (States) وفلتر التاريخ
  const [disasters, setDisasters] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [disasterToDelete, setDisasterToDelete] = useState(null);
  const [customAlert, setCustomAlert] = useState(null);
  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
  // 📥 نافذة تأكيد تنزيل السجل الفردي (محايدة وغير تحذيرية)
  const [downloadTarget, setDownloadTarget] = useState(null);
  // 🔒 قفل النموذج أثناء الحفظ لمنع الضغط المزدوج وإرسال طلبات متكررة
  const [savingDisaster, setSavingDisaster] = useState(false);
  const submitLockRef = useRef(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');
  const [filterDate, setFilterDate] = useState(getLocalDate());

  // 💡 3. القوائم
  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  const DISASTER_TYPES = ['انفجار','زلزال','هزة أرضية','بركان','اعصار','حرائق غابات','صعق كهربائي','سيول','عاصفة','فيضان','وباء'];

  const [gd, setGd] = useState({
    disaster_id: null, incident_date: getLocalDate(), incident_month: '', news_title: '', country: '', disaster_type: '', affected_areas: '', at_risk_areas: '', source_name: '', injured_count: 0, deaths_count: 0, missing_count: 0, national_societies_interventions: '', news_link: '', news_updates: '', data_entry_name: '', notes: ''
  });

  const fetchDisasters = async () => {
    setIsLoading(true);
    const token = sessionStorage.getItem('access_token');
    try {
      const res = await fetch('https://eoc-system-b12f.vercel.app/api/global-disasters', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setDisasters(await res.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  useEffect(() => { fetchDisasters(); }, []);

  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'global_disasters' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) { window.clearInterval(iv); }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  const handleCreateNew = () => {
    setGd({ disaster_id: null, incident_date: getLocalDate(), incident_month: '', news_title: '', country: '', disaster_type: '', affected_areas: '', at_risk_areas: '', source_name: '', injured_count: 0, deaths_count: 0, missing_count: 0, national_societies_interventions: '', news_link: '', news_updates: '', data_entry_name: '', notes: '' });
    setIsModalOpen(true);
  };

  const handleEdit = (d) => { setGd({...d}); setIsModalOpen(true); };

  const confirmDelete = async () => {
    if (!disasterToDelete) return;
    try {
      const token = sessionStorage.getItem('access_token');
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/global-disasters/${disasterToDelete}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) { setDisasterToDelete(null); fetchDisasters(); setCustomAlert("تم حذف الكارثة بنجاح."); }
      else { const d = await res.json().catch(() => ({})); setCustomAlert(d.detail || "فشل حذف الكارثة."); }
    } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); }
  };

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
    if (!gd.news_link || gd.news_link.trim() === '') return setCustomAlert("عفواً، رابط الخبر (لينك الخبر) إلزامي ولا يمكن تسجيل الكارثة بدونه لتأكيد المصداقية!");
    if (!gd.incident_date) return setCustomAlert("عفواً، يجب إدخال التاريخ.");
    if (!gd.country) return setCustomAlert("عفواً، يجب تحديد الدولة/المكان.");
    if (!gd.disaster_type) return setCustomAlert("عفواً، يجب تحديد نوع الكارثة.");

    const payload = { ...gd, incident_month: getMonthName(gd.incident_date) };
    const token = sessionStorage.getItem('access_token');
    const url = gd.disaster_id ? `https://eoc-system-b12f.vercel.app/api/global-disasters/${gd.disaster_id}` : 'https://eoc-system-b12f.vercel.app/api/global-disasters';
    const method = gd.disaster_id ? 'PUT' : 'POST';

    submitLockRef.current = true;
    setSavingDisaster(true);
    try {
      const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { setIsModalOpen(false); fetchDisasters(); setCustomAlert(gd.disaster_id ? "تم تحديث الكارثة بنجاح!" : "تم إضافة الكارثة بنجاح!"); }
      else { setCustomAlert("حدث خطأ في الاتصال بالسيرفر! لم يتم الحفظ."); }
    } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); }
    finally {
      setSavingDisaster(false);
      submitLockRef.current = false;
    }
  };

  // 💡 تطبيق الفلتر على الجدول والإحصائيات وتصدير الإكسيل
  const filteredDisasters = filterDate 
    ? disasters.filter(d => d.incident_date === filterDate) 
    : disasters;

  // 💡 التصدير الشامل للجدول بالترتيب المطلوب
  const handleExportExcel = async () => {
    if (filteredDisasters.length === 0) return setCustomAlert("لا توجد كوارث للتصدير حالياً.");
    const disasterRows = filteredDisasters.map(d => ({
      "التاريخ": formatDateTime(d.incident_date),
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
      "تدخلات الجمعيات ": d.national_societies_interventions || '',
      "لينك الخبر": d.news_link || '',
      "تطورات الخبر": d.news_updates || '',
      "اسم مدخل الخبر": d.data_entry_name || '',
      "ملاحظات": d.notes || ''
    }));
    try { await exportWorkbook([{ name: 'الكوارث العالمية', ...gridFromRows(disasterRows) }], `سجل_الكوارث_العالمية_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  // 💡 تصدير الكارثة الفردية — يُستدعى من زر التنزيل في صف الجدول (البيانات من نفس الصف مباشرة)
  const handleExportSingleDisaster = async (d) => {
    const disasterRow = [{
      "التاريخ": formatDateTime(d.incident_date),
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
      "تدخلات الجمعيات ": d.national_societies_interventions || '',
      "لينك الخبر": d.news_link || '',
      "تطورات الخبر": d.news_updates || '',
      "اسم مدخل الخبر": d.data_entry_name || '',
      "ملاحظات": d.notes || ''
    }];
    try { await exportWorkbook([{ name: 'تفاصيل الكارثة', ...gridFromRows(disasterRow) }], `كارثة_${d.country || 'عالمية'}_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير الكارثة بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
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
      const token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
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
        <StatCard title="إجمالي الوفيات المرصودة" value={totalDeaths.toLocaleString()} color="text-[var(--accent)]" />
        <StatCard title="إجمالي المصابين" value={totalInjuries.toLocaleString()} color="text-[var(--data)]" />
      </div>

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col h-[650px]">
        <div className="p-6 border-b border-[var(--border)] bg-[var(--surface-4)] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            <h3 className="text-xl font-bold text-white flex items-center gap-2 whitespace-nowrap"><GlobalWorldIcon /> رصد الكوارث العالمية</h3>
            
            {/* 💡 فلتر التاريخ الجديد في الهيدر */}
            <div className="flex items-center gap-2">
              <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer" />
              {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-[var(--accent)] hover:text-white bg-[var(--danger-soft)] px-3 py-1.5 rounded-lg transition-colors">إلغاء التاريخ</button>}
            </div>
          </div>

          <div className="actionbar">
            {isOwner && (
              <button
                type="button"
                onClick={handleExportExcel}
                data-tip="تحميل السجل الشامل للكوارث"
                className="action-btn action-btn--ok shrink-0"
              >
                <ExcelIcon />
                <span className="hidden md:inline">تحميل السجل</span>
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={handleClearAllGlobalDisasters}
                data-tip="مسح جميع الكوارث نهائيًا"
                className="action-btn action-btn--danger shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                <span className="hidden md:inline">مسح الكل</span>
              </button>
            )}
            <Magnetic strength={0.16} className="shrink-0">
              <button
                type="button"
                onClick={handleCreateNew}
                className="btn-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                <span>رصد كارثة</span>
              </button>
            </Magnetic>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap min-w-[720px] text-sm">
            <thead className="sticky top-0 z-20 bg-[var(--surface-3)] text-[var(--muted-2)]">
              <tr>
                <th className="p-4 font-semibold border-l border-[var(--border)]">التاريخ</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-orange-400">الدولة / المكان</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--accent)]">نوع الكارثة</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] max-w-[200px]">الخبر</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-center">الوفيات</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-center">المصابين</th>
                <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? <TableLoadingRow colSpan={7} label="جاري تحميل البيانات…" /> :
               filteredDisasters.length > 0 ? filteredDisasters.map(d => (
                <tr key={d.disaster_id} id={`focus-row-${d.disaster_id}`} className={`group hover:bg-[var(--surface-hover)]${String(focusedRowId) === String(d.disaster_id) ? ' focus-row' : ''}`}>
                  <td data-label="التاريخ" className="p-4 text-white border-l border-[var(--border)]">{formatDateTime(d.incident_date)}</td>
                  <td data-label="الدولة / المكان" className="p-4 text-orange-400 border-l border-[var(--border)] font-bold">{d.country}</td>
                  <td data-label="نوع الكارثة" className="p-4 text-[var(--accent)] border-l border-[var(--border)] font-bold bg-[var(--accent-softer)]">{d.disaster_type}</td>
                  <td data-label="الخبر" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] truncate max-w-[250px]">{d.news_title}</td>
                  <td data-label="الوفيات" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)] text-center">{d.deaths_count}</td>
                  <td data-label="المصابين" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)] text-center">{d.injured_count}</td>
                  <td data-label="إجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                    <div className="flex justify-center gap-1.5">
                      {d.news_link && (
                        <a href={d.news_link} target="_blank" rel="noreferrer" className="icon-btn" title="فتح مصدر الخبر">
                          <GlobalWorldIcon />
                        </a>
                      )}
                      <button onClick={() => handleEdit(d)} className="icon-btn" title="تعديل">
                        <EyeIcon />
                      </button>
                      <button onClick={() => setDownloadTarget(d)} className="icon-btn" title="تحميل سجل الكارثة">
                        <DownloadIcon />
                      </button>
                      {(isOwner || isSupervisor || isJoker) && (
                        <button onClick={() => setDisasterToDelete(d.disaster_id)} className="icon-btn icon-btn-danger" title="حذف">
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="7" className="p-8 text-center text-[var(--faint)]">لا توجد كوارث مسجلة حالياً بهذا التاريخ</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="bg-[var(--surface)] border border-[var(--accent)]/30 rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-[0_0_50px_rgba(199,0,0,0.1)] animate-fade-in-up">
            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><GlobalWorldIcon /> {gd.disaster_id ? 'تعديل رصد الكارثة' : 'رصد كارثة عالمية جديدة'}</h2>
              <button onClick={() => setIsModalOpen(false)} disabled={savingDisaster} className="touch-close bg-[var(--surface-4)] text-[var(--muted-2)] hover:bg-[var(--accent)] hover:text-white p-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"><TrashIcon /></button>
            </div>

            <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 ${savingDisaster ? 'opacity-60 pointer-events-none' : ''}`} inert={savingDisaster}>
              <SectionCard title="بيانات الكارثة الأساسية" icon={<AlertIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="التاريخ"><SegDateField value={gd.incident_date} onChange={e => setGd({...gd, incident_date: e.target.value})} className="field" /></FormGroup>
                  <FormGroup label="الدولة (مطلوب)">
                    <StyledSelect value={gd.country} onChange={e => setGd({...gd, country: e.target.value})} className="border-orange-500/50 text-orange-400 font-bold">
                      <option value="" disabled className="text-[var(--faint)]">اختر المكان...</option>
                      {COUNTRIES_LIST.map(c => <option key={c} value={c} className="text-white">{c}</option>)}
                    </StyledSelect>
                  </FormGroup>
                  <FormGroup label="نوع الكارثة (مطلوب)">
                    <StyledSelect value={gd.disaster_type} onChange={e => setGd({...gd, disaster_type: e.target.value})} className="border-[var(--accent)]/50 text-[var(--accent)] font-bold">
                      <option value="" disabled className="text-[var(--faint)]">اختر النوع...</option>
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
                  <FormGroup label="عدد الوفيات"><StyledInput type="number" value={gd.deaths_count} onChange={e => setGd({...gd, deaths_count: parseInt(e.target.value) || 0})} className="bg-[var(--accent-soft)] text-[var(--accent)]" /></FormGroup>
                  <FormGroup label="عدد المصابين"><StyledInput type="number" value={gd.injured_count} onChange={e => setGd({...gd, injured_count: parseInt(e.target.value) || 0})} className="bg-yellow-500/10 text-yellow-400" /></FormGroup>
                  <FormGroup label="عدد المفقودين"><StyledInput type="number" value={gd.missing_count} onChange={e => setGd({...gd, missing_count: parseInt(e.target.value) || 0})} className="bg-[var(--surface-hover)] text-[var(--ink-2)]" /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="تدخلات الجمعيات "><textarea value={gd.national_societies_interventions} onChange={e => setGd({...gd, national_societies_interventions: e.target.value})} className="w-full bg-[var(--surface-4)] border border-[var(--border)] rounded-xl p-3 text-sm outline-none text-white focus:border-blue-500" rows="2"></textarea></FormGroup></div>
                </div>
              </SectionCard>

              <SectionCard title="التوثيق (إلزامي)" icon={<MapIcon />}>
                <div className="grid grid-cols-1 gap-4">
                  <FormGroup label="لينك الخبر (إلزامي)*">
                    <StyledInput value={gd.news_link} onChange={e => setGd({...gd, news_link: e.target.value})} placeholder="https://..." dir="ltr" className="text-left border-blue-500/50 focus:border-blue-500 bg-blue-500/5" required />
                  </FormGroup>
                  <FormGroup label="تطورات الخبر"><textarea value={gd.news_updates} onChange={e => setGd({...gd, news_updates: e.target.value})} className="w-full bg-[var(--surface-4)] border border-[var(--border)] rounded-xl p-3 text-sm outline-none text-white focus:border-[var(--accent)]" rows="2"></textarea></FormGroup>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormGroup label="اسم مدخل الخبر"><StyledInput value={gd.data_entry_name} onChange={e => setGd({...gd, data_entry_name: e.target.value})} /></FormGroup>
                    <FormGroup label="ملاحظات"><StyledInput value={gd.notes} onChange={e => setGd({...gd, notes: e.target.value})} /></FormGroup>
                  </div>
                </div>
              </SectionCard>
            </div>
            
            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setIsModalOpen(false)} disabled={savingDisaster} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-[var(--muted-2)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed">إلغاء</button>
              <button onClick={handleSubmit} disabled={savingDisaster} className="btn-accent px-8 py-3 md:py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 active:scale-[0.97]">{savingDisaster ? 'جاري الحفظ...' : 'حفظ وتوثيق الكارثة'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ تأكيد حذف رصد فردي — التصميم الموحّد (كبسولة علوية عائمة) */}
      <DangerConfirmModal
        show={disasterToDelete !== null}
        title="تأكيد الحذف"
        message="هل أنت متأكد من حذف هذا الرصد نهائياً؟"
        confirmLabel="نعم، احذف"
        onCancel={() => setDisasterToDelete(null)}
        onConfirm={confirmDelete}
      />

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

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}

      {/* 📥 تأكيد تنزيل الكارثة — نافذة محايدة، «نعم» ينزّل و«إلغاء» يُغلق */}
      <DownloadConfirmModal
        show={downloadTarget !== null}
        title="تحميل سجل الكارثة"
        onCancel={() => setDownloadTarget(null)}
        onConfirm={() => { const rec = downloadTarget; setDownloadTarget(null); handleExportSingleDisaster(rec); }}
      />
    </div>
  );
}


function EarthquakesView({ isOwner, isSupervisor, lang = 'ar', focusTarget = null }) {
  const [activeEqTab, setActiveEqTab] = useState('all'); 
  const [globalEqs, setGlobalEqs] = useState([]);
  const [egyptEqs, setEgyptEqs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customAlert, setCustomAlert] = useState(null);
  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const [clearAllCode, setClearAllCode] = useState('');
  
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => {
    if (!dateStr) return '';
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const iso = String(dateStr).split('T')[0].split('-');
    if (iso.length === 3 && iso[0].length === 4) return months[Number(iso[1]) - 1] || '';
    const dmy = String(dateStr).split('/');
    if (dmy.length === 3) return months[Number(dmy[1]) - 1] || '';
    return months[new Date(dateStr).getMonth()] || '';
  };

  const [filterDate, setFilterDate] = useState(getLocalDate()); 
  const [selectedEqId, setSelectedEqId] = useState(null); // 💡 فلتر الخريطة الجديد

  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [isEgyptModalOpen, setIsEgyptModalOpen] = useState(false);

  const COUNTRIES_LIST = ['أفغانستان','ألبانيا','الجزائر','أندورا','أنغولا','أنتيغوا وبربودا','الأرجنتين','أرمينيا','أستراليا','النمسا','أذربيجان','جزر البهاما','البحرين','بنغلاديش','باربادوس','بيلاروسيا','بلجيكا','بليز','بنين','بوتان','بوليفيا','البوسنة والهرسك','بوتسوانا','البرازيل','بروناي','بلغاريا','بوركينا فاسو','بوروندي','الرأس الأخضر','كمبوديا','الكاميرون','كندا','جمهورية إفريقيا الوسطى','تشاد','تشيلي','الصين','كولومبيا','جزر القمر','جمهورية الكونغو الديمقراطية','كوستاريكا','كرواتيا','كوبا','قبرص','التشيك','الدنمارك','جيبوتي','دومينيكا','جمهورية الدومينيكان','الإكوادور','مصر','السلفادور','غينيا الاستوائية','إريتريا','إستونيا','إسواتيني','إثيوبيا','فيجي','فنلندا','فرنسا','الغابون','غامبيا','جورجيا','ألمانيا','غانا','اليونان','غرينادا','غواتيمالا','غينيا','غينيا بيساو','غيانا','هايتي','هندوراس','المجر','آيسلندا','الهند','إندونيسيا','إيران','العراق','أيرلندا','إسرائيل','إيطاليا','ساحل العاج','جامايكا','اليابان','الأردن','كازاخستان','كينيا','كيريباتي','الكويت','قيرغيزستان','لاوس','لاتفيا','لبنان','ليسوتو','ليبيريا','ليبيا','ليختنشتاين','ليتوانيا','لوكسمبورغ','مدغشقر','ملاوي','ماليزيا','جزر المالديف','مالي','مالطا','جزر مارشال','موريتانيا','موريشيوس','المكسيك','ميكرونيزيا','مولدوفا','موناكو','منغوليا','الجبل الأسود','المغرب','موزمبيق','ميانمار','ناميبيا','ناورو','نيبال','هولندا','نيوزيلندا','نيكاراغوا','النيجر','نيجيريا','كوريا الشمالية','مقدونيا الشمالية','النرويج','عمان','باكستان','بالاو','فلسطين','بنما','بابوا غينيا الجديدة','باراغواي','بيرو','الفلبين','بولندا','البرتغال','قطر','رومانيا','روسيا','رواندا','سانت كيتس ونيفيس','سانت لوسيا','سانت فنسنت وجزر غرينادين','ساموا','سان مارينو','ساو تومي وبرينسيب','السعودية','السنغال','صربيا','سيشيل','سيراليون','سنغافورة','سلوفاكيا','سلوفينيا','جزر سليمان','الصومال','جنوب إفريقيا','كوريا الجنوبية','جنوب السودان','إسبانيا','سريلانكا','السودان','سورينام','السويد','سويسرا','سوريا','طاجيكستان','تنزانيا','تايلاند','تيمور الشرقية','توغو','تونغا','ترينيداد وتوباغو','تونس','تركيا','تركمانستان','توفالو','أوغندا','أوكرانيا','الإمارات العربية المتحدة','المملكة المتحدة البريطانية','الولايات المتحدة الأمريكية','أوروغواي','أوزبكستان','فانواتو','فنزويلا','فيتنام','اليمن','زامبيا','زيمبابوي','تايوان','المحيط الهادي','المحيط الاطلسي','المحيط الهندي','القطب الجنوبي','جزيرة','البحر الكاريبي','البحر الابيض المتوسط','جبال الهند','جزيرة جوام','جزيرة سايمن','مونتيجرو','ولايات مايكرونزيا المتحدة','غرينلاند','جزر كايمان','جبل طارق','بورتوريكو','غوادلوب','جزر المارتينيك','أنغويلا','البحر الاحمر','مضيق بحري','القطب الشمالي','مايوت','شبه جزيرة بوثيا','البحر الأيوني','جزيرة بوفيه','الخليج الفارسي','البحر الأدرياتيكي','بحر الشمال','البحر الميت','خليج البنغال','بحر آرافورا','بحر قزوين','بحر العرب','بحر إيجة','البحر التيراني','جبال البرانس','جزر مارياس','بحر سكوشيا','جبال لومونوسوف','البحر الأسود','المحيط المتجمد الشمالي','بحر سولو','بحر لاكاديفي','ولاية وايومنغ','بحيرة تنجانيقا','مضيق هرمز','أنتاركتيكا','بربادوس','كاليدونيا الجديدة','جزر بيتكيرن','برمودا','هنغاريا','جيرسي','جواتيمالا'];
  
  const [gForm, setGForm] = useState({ eq_id: null, date: getLocalDate(), time: '', country: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });
  const [eForm, setEForm] = useState({ eq_id: null, date: getLocalDate(), time: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' });

  const fetchEarthquakes = async () => {
    setIsLoading(true);
    const token = sessionStorage.getItem('access_token');
    try {
      const resG = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/global', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resG.ok) setGlobalEqs(await resG.json());
      const resE = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/egypt', { headers: { 'Authorization': `Bearer ${token}` } });
      if (resE.ok) setEgyptEqs(await resE.json());
    } catch (err) {} finally { setIsLoading(false); }
  };

  useEffect(() => { fetchEarthquakes(); }, []);

  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'earthquakes' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-g-${id}`) || document.getElementById(`focus-row-e-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) { window.clearInterval(iv); }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

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
        try {
          const token = sessionStorage.getItem('access_token');
          const res = await fetch('https://eoc-system-b12f.vercel.app/api/earthquakes/global/bulk', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(parsedData)
          });
          if (res.ok) { setCustomAlert(`تم استيراد ${parsedData.length} زلزال عالمي بنجاح من الشيت!`); fetchEarthquakes(); }
          else { setCustomAlert("حدث خطأ أثناء رفع الشيت للسيرفر."); setIsLoading(false); }
        } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); setIsLoading(false); }
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
      const token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
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
    // 🔒 قفل متزامن: يمنع الضغط المزدوج/الحفظ المتكرر (نفس نمط باقي الأقسام)
    if (eqSubmitLockRef.current) return;
    eqSubmitLockRef.current = true;

    // شيلنا الـ eq_id من الـ payload عشان السيرفر يقبله
    const payload = {
      date: gForm.date, time: gForm.time, country: gForm.country,
      magnitude: parseFloat(gForm.magnitude), status: parseFloat(gForm.magnitude) >= 5.1 ? 'زلزال' : 'هزة أرضية',
      month: getMonthName(gForm.date), depth_km: gForm.depth_km ? `${gForm.depth_km} KM` : 'KM',
      region: gForm.region, longitude: gForm.longitude !== '' ? parseFloat(gForm.longitude) : null,
      latitude: gForm.latitude !== '' ? parseFloat(gForm.latitude) : null
    };

    // ✅ إغلاق المودال فور الضغط على «حفظ» — يمنع تكرار الضغط وإرسال طلبات مكررة
    setIsGlobalModalOpen(false);

    const token = sessionStorage.getItem('access_token');
    const url = gForm.eq_id ? `https://eoc-system-b12f.vercel.app/api/earthquakes/global/${gForm.eq_id}` : 'https://eoc-system-b12f.vercel.app/api/earthquakes/global';
    try {
      const res = await fetch(url, { method: gForm.eq_id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { fetchEarthquakes(); setCustomAlert(gForm.eq_id ? "تم حفظ التعديل بنجاح!" : "تمت الإضافة بنجاح!"); }
      else { setCustomAlert("⚠️ السيرفر رفض التعديل! لو إنت شغال على اللينك اللايف، اتأكد إنك رفعت ملف main_2.py الجديد على Vercel."); }
    } catch(e) { setCustomAlert("خطأ في الاتصال بالسيرفر"); }
    finally { eqSubmitLockRef.current = false; }
  };

  const handleEgyptSubmit = async () => {
    if (!eForm.date) return setCustomAlert("التاريخ مطلوب");
    if (!eForm.magnitude) return setCustomAlert("القوة بالريختر مطلوبة");
    // 🔒 قفل متزامن: يمنع الضغط المزدوج/الحفظ المتكرر (نفس نمط باقي الأقسام)
    if (eqSubmitLockRef.current) return;
    eqSubmitLockRef.current = true;

    const payload = {
      date: eForm.date, time: eForm.time, magnitude: parseFloat(eForm.magnitude),
      depth_km: eForm.depth_km ? `${eForm.depth_km} KM` : 'KM', region: eForm.region,
      longitude: eForm.longitude !== '' ? parseFloat(eForm.longitude) : null, latitude: eForm.latitude !== '' ? parseFloat(eForm.latitude) : null
    };

    // ✅ إغلاق المودال فور الضغط على «حفظ» — يمنع تكرار الضغط وإرسال طلبات مكررة
    setIsEgyptModalOpen(false);

    const token = sessionStorage.getItem('access_token');
    const url = eForm.eq_id ? `https://eoc-system-b12f.vercel.app/api/earthquakes/egypt/${eForm.eq_id}` : 'https://eoc-system-b12f.vercel.app/api/earthquakes/egypt';
    try {
      const res = await fetch(url, { method: eForm.eq_id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (res.ok) { fetchEarthquakes(); setCustomAlert(eForm.eq_id ? "تم حفظ التعديل بنجاح!" : "تمت الإضافة بنجاح!"); }
      else { setCustomAlert("⚠️ السيرفر رفض التعديل! لو إنت شغال على اللينك اللايف، اتأكد إنك رفعت ملف main_2.py الجديد على Vercel."); }
    } catch(e) { setCustomAlert("خطأ في الاتصال بالسيرفر"); }
    finally { eqSubmitLockRef.current = false; }
  };

  const deleteGlobalEq = async (id) => { try { const token = sessionStorage.getItem('access_token'); const res = await fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/global/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); if (res.ok) { fetchEarthquakes(); setCustomAlert("تم حذف الزلزال بنجاح."); } else { const d = await res.json().catch(() => ({})); setCustomAlert(d.detail || "فشل حذف الزلزال."); } } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); } };
  const deleteEgyptEq = async (id) => { try { const token = sessionStorage.getItem('access_token'); const res = await fetch(`https://eoc-system-b12f.vercel.app/api/earthquakes/egypt/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); if (res.ok) { fetchEarthquakes(); setCustomAlert("تم حذف الزلزال بنجاح."); } else { const d = await res.json().catch(() => ({})); setCustomAlert(d.detail || "فشل حذف الزلزال."); } } catch { setCustomAlert("خطأ في الاتصال بالسيرفر!"); } };

  // 🗑️ تأكيد الحذف الفردي: نرصد الهدف أولاً (عالمي / مصري) ثم ننفّذ بعد موافقة المستخدم
  const [eqToDelete, setEqToDelete] = useState(null);
  // 🔒 قفل متزامن للحفظ (عالمي/مصري): يمنع الضغط المزدوج وإرسال طلبات متكررة للسيرفر
  const eqSubmitLockRef = useRef(false);
  const confirmDeleteEq = () => {
    if (!eqToDelete) return;
    const { kind, id } = eqToDelete;
    setEqToDelete(null);
    if (kind === 'global') deleteGlobalEq(id); else deleteEgyptEq(id);
  };

  const handleExportGlobalEqs = async () => {
    if (filteredGlobalEqs.length === 0) return setCustomAlert("لا توجد زلازل عالمية للتصدير حالياً.");
    const eqRows = filteredGlobalEqs.map(eq => ({ "التاريخ": formatDateTime(eq.date), "الشهر": eq.month || '', "الدولة": eq.country || '', "القوة بالريختر": eq.magnitude || '', "التوقيت": formatTime12(eq.time), "العمق": eq.depth_km || 'KM', "المنطقة": eq.region || '', "الحالة": eq.status || '', "longitude": eq.longitude || '', "Latitude": eq.latitude || '' }));
    try { await exportWorkbook([{ name: 'الزلازل العالمية', ...gridFromRows(eqRows) }], `سجل_الزلازل_العالمية_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير الزلازل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  const handleExportEgyptEqs = async () => {
    if (filteredEgyptEqs.length === 0) return setCustomAlert("لا توجد زلازل مصرية للتصدير حالياً.");
    const eqRows = filteredEgyptEqs.map(eq => ({ "التاريخ": formatDateTime(eq.date), "وقت الزلزال": formatTime12(eq.time), "العمق": eq.depth_km || 'KM', "القوة بالريختر": eq.magnitude || '', "المنطقة": eq.region || '', "longitude": eq.longitude || '', "Latitude": eq.latitude || '' }));
    try { await exportWorkbook([{ name: 'زلازل مصر', ...gridFromRows(eqRows) }], `سجل_زلازل_مصر_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير الزلازل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  const uniqueCountriesCount = [...new Set(filteredGlobalEqs.map(e => e.country))].filter(Boolean).length;
  const maxMagnitude = Math.max(...filteredGlobalEqs.map(e => parseFloat(e.magnitude) || 0), ...filteredEgyptEqs.map(e => parseFloat(e.magnitude) || 0), 0);

  return (
    <div className="space-y-6 pb-10">
      
      {/* 💡 الهيدر بدون فلاتر */}
      <div className="bg-[var(--surface-4)] border border-[var(--border)] rounded-3xl p-5 shadow-lg animate-fade-in-up">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><EarthquakeIcon/> مركز رصد الزلازل</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up">
        <StatCard title="الزلازل العالمية المرصودة" value={filteredGlobalEqs.length} color="text-[var(--accent)]" borderHighlight />
        <StatCard title="الدول المرصودة" value={uniqueCountriesCount} color="text-orange-400" />
        <StatCard title="زلازل مصر المرصودة" value={filteredEgyptEqs.length} color="text-green-500" />
        <StatCard title="أقوى هزة / زلزال" value={maxMagnitude > 0 ? `${maxMagnitude} ريختر` : '-'} color="text-[var(--data)]" />
      </div>

      {isOwner && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClearAllEarthquakes}
            data-tip={lang === 'ar' ? 'مسح جميع الزلازل المرصودة نهائيًا' : 'Clear all observed earthquakes — irreversible'}
            className="action-btn action-btn--danger shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            <span className="hidden md:inline">{lang === 'ar' ? 'مسح الكل' : 'Clear all'}</span>
          </button>
        </div>
)}

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl p-4 md:p-6 shadow-lg relative z-0 h-auto md:h-[500px]">
        {/* 💡 الفلاتر فوق الخريطة */}
        <div className="flex flex-col lg:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2"><MapIcon/> خريطة الرصد (<span className="text-[var(--accent)]">عالمي 🔴</span> / <span className="text-[var(--ok)]">مصر 🟢</span>)</h3>
            {selectedEqId && (
              <button onClick={() => setSelectedEqId(null)} className="bg-[var(--surface-4)] hover:bg-[var(--accent)] text-[var(--muted-2)] hover:text-white border border-[var(--border)] px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-[0_0_10px_rgba(199,0,0,0.3)]">
                إلغاء الفلترة
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2 bg-[var(--surface-3)] p-1 rounded-xl border border-[var(--border)] shadow-inner">
              <button onClick={() => setActiveEqTab('global')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'global' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>عالمي</button>
              <button onClick={() => setActiveEqTab('egypt')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'egypt' ? 'bg-[var(--ok)] text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>مصر</button>
              <button onClick={() => setActiveEqTab('all')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeEqTab === 'all' ? 'bg-blue-600 text-white' : 'text-[var(--muted-2)] hover:text-white'}`}>الكل</button>
            </div>
            <div className="flex items-center gap-2 bg-[var(--surface-3)] p-1 rounded-xl border border-[var(--border)] shadow-inner">
              <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-transparent px-3 py-1.5 text-sm text-white outline-none cursor-pointer" />
              {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-[var(--accent)] hover:text-white bg-[var(--danger-soft)] px-3 py-1.5 rounded-lg font-bold">إلغاء</button>}
            </div>
          </div>
        </div>

        {/* 💡 زوم أوت للخريطة */}
        <div className="h-[300px] md:h-[380px] w-full rounded-2xl overflow-hidden border border-[var(--border)] relative mt-4 md:mt-0">
          <MapContainer center={[20.0, 10.0]} zoom={2} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
            <ThemedTileLayer />
            
            {(activeEqTab === 'global' || activeEqTab === 'all') && tableGlobalEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker keyboard={false} key={`g-${eq.eq_id}`} position={[lat, lng]} icon={globalEqIcon} eventHandlers={{ click: () => { setSelectedEqId(prev => prev === eq.eq_id ? null : eq.eq_id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('earthquakes-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top"><strong className="text-red-600 block text-center mb-1">{eq.magnitude} ريختر ({eq.status})</strong><span className="text-xs text-[var(--ink-2)] text-center block font-bold">{eq.region}</span><span className="text-[10px] text-[var(--faint)] text-center block mt-1">{formatDateTime(eq.date)} | {formatTime12(eq.time)}</span><span className="text-[10px] text-blue-500 text-center block mt-1 font-bold">انقر لفلترة السجل</span></Tooltip>
                </Marker>
              );
            })}
            
            {(activeEqTab === 'egypt' || activeEqTab === 'all') && tableEgyptEqs.map(eq => {
              const lat = parseFloat(eq.latitude); const lng = parseFloat(eq.longitude);
              if (isNaN(lat) || isNaN(lng)) return null;
              return (
                <Marker keyboard={false} key={`e-${eq.eq_id}`} position={[lat, lng]} icon={egyptEqIcon} eventHandlers={{ click: () => { setSelectedEqId(prev => prev === eq.eq_id ? null : eq.eq_id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('earthquakes-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top"><strong className="text-green-600 block text-center mb-1">{eq.magnitude} ريختر (مصر)</strong><span className="text-xs text-[var(--ink-2)] text-center block font-bold">{eq.region}</span><span className="text-[10px] text-[var(--faint)] text-center block mt-1">{formatDateTime(eq.date)} | {formatTime12(eq.time)}</span><span className="text-[10px] text-blue-500 text-center block mt-1 font-bold">انقر لفلترة السجل</span></Tooltip>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div id="earthquakes-table-section" className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col h-[600px] scroll-mt-6">
        <div className="p-6 border-b border-[var(--border)] bg-[var(--surface-4)] flex flex-col md:flex-row justify-between items-center gap-4 z-10">
          <h3 className="text-xl font-bold text-white hidden md:block">سجل بيانات الزلازل</h3>
          
          {/* 💡 حل مشكلة الزراير المقطوعة بـ flex-wrap */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto mt-4 md:mt-0">
            {activeEqTab === 'global' || activeEqTab === 'all' ? (
              <>
                {isOwner && <button onClick={handleExportGlobalEqs} className="bg-[var(--surface-3)] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-4)]"><ExcelIcon/> تصدير العالمي</button>}
                <label className="bg-[var(--surface-3)] text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-4)] cursor-pointer">
                  <ExcelIcon/> استيراد شيت EMSC
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                </label>
                <button onClick={() => { setGForm({ eq_id: null, date: getLocalDate(), time: '', country: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' }); setIsGlobalModalOpen(true); }} className="btn-accent px-5 py-2 rounded-xl text-sm shadow-[var(--shadow-accent)]">+ رصد عالمي</button>
              </>
            ) : null}
            
            {activeEqTab === 'egypt' || activeEqTab === 'all' ? (
              <>
                {isOwner && <button onClick={handleExportEgyptEqs} className="bg-[var(--surface-3)] text-green-500 border border-green-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-4)]"><ExcelIcon/> تصدير مصر</button>}
                <button onClick={() => { setEForm({ eq_id: null, date: getLocalDate(), time: '', magnitude: '', depth_km: '', region: '', longitude: '', latitude: '' }); setIsEgyptModalOpen(true); }} className="btn-success px-5 py-2 rounded-xl text-sm shadow-[0_0_18px_var(--ok-soft)]">+ رصد زلزال مصر</button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          {(activeEqTab === 'global' || activeEqTab === 'all') ? (
            <div className="mb-8">
              {activeEqTab === 'all' && <h4 className="p-4 text-[var(--accent)] font-bold bg-[var(--surface-4)]">الزلازل العالمية</h4>}
              <table className="w-full text-right whitespace-nowrap min-w-[800px] text-sm">
                <thead className="sticky top-0 z-20 bg-[var(--surface-3)] text-[var(--muted-2)]">
                  <tr>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">التاريخ / الوقت</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">الدولة</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--accent)]">القوة (ريختر)</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">العمق</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)] max-w-[200px]">المنطقة</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">الإحداثيات</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)] text-center">الحالة</th>
                    <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {isLoading ? <TableLoadingRow colSpan={8} /> :
                   tableGlobalEqs.length > 0 ? tableGlobalEqs.map(eq => (
                    <tr key={`tbl-g-${eq.eq_id}`} id={`focus-row-g-${eq.eq_id}`} className={`group hover:bg-[var(--surface-hover)]${String(focusedRowId) === String(eq.eq_id) ? ' focus-row' : ''}`}>
                      <td data-label="التاريخ / الوقت" className="p-4 text-white border-l border-[var(--border)] font-mono">{formatDateTime(eq.date)} <span className="text-[var(--faint)]">{formatTime12(eq.time)}</span></td>
                      <td data-label="الدولة" className="p-4 text-orange-400 border-l border-[var(--border)] font-bold">{eq.country}</td>
                      <td data-label="القوة (ريختر)" className="p-4 text-[var(--accent)] border-l border-[var(--border)] font-bold">{eq.magnitude}</td>
                      <td data-label="العمق" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] font-mono">{eq.depth_km}</td>
                      <td data-label="المنطقة" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)] truncate max-w-[200px]">{eq.region}</td>
                      <td data-label="الإحداثيات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] font-mono text-xs" dir="ltr">{eq.latitude ? `${eq.latitude}, ${eq.longitude}` : '-'}</td>
                      <td data-label="الحالة" className="p-4 border-l border-[var(--border)] text-center"><span className={`px-2 py-1 rounded text-xs font-bold ${eq.status === 'زلزال' ? 'bg-[var(--danger-soft)] text-[var(--accent)] border border-[var(--accent)]/30' : 'bg-[var(--surface-hover)] text-[var(--muted-2)] border border-[var(--border)]'}`}>{eq.status}</span></td>
                      <td data-label="الإجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                        <div className="flex justify-center gap-1.5">
                          <button onClick={() => handleEditGlobal(eq)} className="icon-btn" title="فتح التعديل"><EyeIcon /></button>
                          {(isOwner || isSupervisor) && <button onClick={() => setEqToDelete({ kind: 'global', id: eq.eq_id })} className="icon-btn icon-btn-danger" title="حذف"><TrashIcon/></button>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="8" className="p-8 text-center text-[var(--faint)]">لا توجد زلازل عالمية</td></tr>}
                </tbody>
              </table>
            </div>
          ) : null}

          {(activeEqTab === 'egypt' || activeEqTab === 'all') ? (
            <div>
              {activeEqTab === 'all' && <h4 className="p-4 text-green-500 font-bold bg-[var(--surface-4)]">زلازل مصر</h4>}
              <table className="w-full text-right whitespace-nowrap min-w-[600px] text-sm">
                <thead className="sticky top-0 z-20 bg-[var(--surface-3)] text-[var(--muted-2)]">
                  <tr>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">التاريخ / الوقت</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)] text-green-500">القوة (ريختر)</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">العمق</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)] max-w-[200px]">المنطقة (مصر)</th>
                    <th className="p-4 font-semibold border-l border-[var(--border)]">الإحداثيات</th>
                    <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {isLoading ? <TableLoadingRow colSpan={6} /> :
                   tableEgyptEqs.length > 0 ? tableEgyptEqs.map(eq => (
                    <tr key={`tbl-e-${eq.eq_id}`} id={`focus-row-e-${eq.eq_id}`} className={`group hover:bg-[var(--surface-hover)]${String(focusedRowId) === String(eq.eq_id) ? ' focus-row' : ''}`}>
                      <td data-label="التاريخ / الوقت" className="p-4 text-white border-l border-[var(--border)] font-mono">{formatDateTime(eq.date)} <span className="text-[var(--faint)]">{formatTime12(eq.time)}</span></td>
                      <td data-label="القوة (ريختر)" className="p-4 text-green-500 border-l border-[var(--border)] font-bold">{eq.magnitude}</td>
                      <td data-label="العمق" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] font-mono">{eq.depth_km}</td>
                      <td data-label="المنطقة (مصر)" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)] truncate max-w-[200px]">{eq.region}</td>
                      <td data-label="الإحداثيات" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] font-mono text-xs" dir="ltr">{eq.latitude ? `${eq.latitude}, ${eq.longitude}` : '-'}</td>
                      <td data-label="الإجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                        <div className="flex justify-center gap-1.5">
                          <button onClick={() => handleEditEgypt(eq)} className="icon-btn" title="فتح التعديل"><EyeIcon /></button>
                          {(isOwner || isSupervisor) && <button onClick={() => setEqToDelete({ kind: 'egypt', id: eq.eq_id })} className="icon-btn icon-btn-danger" title="حذف"><TrashIcon/></button>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="6" className="p-8 text-center text-[var(--faint)]">لا توجد زلازل مسجلة لمصر</td></tr>}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {isGlobalModalOpen && (
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="modal-card w-full max-w-3xl h-full max-h-[95vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[var(--border)] shrink-0">
              <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><EarthquakeIcon/> {gForm.eq_id ? 'تعديل زلزال عالمي' : 'رصد زلزال عالمي (يدوي)'}</h2>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <FormGroup label="التاريخ"><SegDateField value={gForm.date} onChange={e => setGForm({...gForm, date: e.target.value})} className="field" /></FormGroup>
                <FormGroup label="التوقيت"><SegTimeField className="field" value={gForm.time} onChange={e => setGForm({...gForm, time: e.target.value})} /></FormGroup>
                <FormGroup label="الدولة">
                  <StyledSelect value={gForm.country} onChange={e => setGForm({...gForm, country: e.target.value})}>
                    <option value="" disabled>اختر الدولة...</option>
                    {COUNTRIES_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                  </StyledSelect>
                </FormGroup>
                <FormGroup label="المنطقة"><StyledInput value={gForm.region} onChange={e => setGForm({...gForm, region: e.target.value})} /></FormGroup>
                <FormGroup label="القوة (ريختر) - إلزامي"><StyledInput type="number" step="0.1" value={gForm.magnitude} onChange={e => setGForm({...gForm, magnitude: e.target.value})} className="border-[var(--accent)]/50" /></FormGroup>
                <FormGroup label="العمق (سيتم إضافة KM آلياً)"><StyledInput type="number" placeholder="مثال: 10" value={gForm.depth_km} onChange={e => setGForm({...gForm, depth_km: e.target.value})} /></FormGroup>
                <FormGroup label="Latitude (دوائر العرض)"><StyledInput type="number" step="any" value={gForm.latitude} onChange={e => setGForm({...gForm, latitude: e.target.value})} /></FormGroup>
                <FormGroup label="Longitude (خطوط الطول)"><StyledInput type="number" step="any" value={gForm.longitude} onChange={e => setGForm({...gForm, longitude: e.target.value})} /></FormGroup>
              </div>
            </div>
            <div className="flex flex-col-reverse md:flex-row justify-end gap-3 mt-4 [&>button]:w-full md:[&>button]:w-auto p-4 border-t border-[var(--border)] shrink-0">
              <button onClick={() => setIsGlobalModalOpen(false)} className="px-6 py-3 md:py-2 rounded-xl text-[var(--muted-2)] bg-[var(--surface-4)]">إلغاء</button>
              <button onClick={handleGlobalSubmit} className="px-6 py-2 rounded-xl text-white bg-[var(--accent)] font-bold">حفظ</button>
            </div>
          </div>
        </div>
      )}

      {isEgyptModalOpen && (
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="modal-card w-full max-w-3xl h-full max-h-[95vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[var(--border)] shrink-0">
              <h2 className="text-lg font-bold text-white mb-0 flex items-center gap-2"><EarthquakeIcon/> {eForm.eq_id ? 'تعديل زلزال مصر' : 'رصد زلزال محلي (مصر)'}</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <FormGroup label="التاريخ"><SegDateField value={eForm.date} onChange={e => setEForm({...eForm, date: e.target.value})} className="field" /></FormGroup>
                <FormGroup label="التوقيت"><SegTimeField className="field" value={eForm.time} onChange={e => setEForm({...eForm, time: e.target.value})} /></FormGroup>
                <FormGroup label="المنطقة داخل مصر"><StyledInput value={eForm.region} onChange={e => setEForm({...eForm, region: e.target.value})} /></FormGroup>
                <FormGroup label="القوة (ريختر) - إلزامي"><StyledInput type="number" step="0.1" value={eForm.magnitude} onChange={e => setEForm({...eForm, magnitude: e.target.value})} className="border-green-500/50" /></FormGroup>
                <FormGroup label="العمق (سيتم إضافة KM آلياً)"><StyledInput type="number" placeholder="مثال: 10" value={eForm.depth_km} onChange={e => setEForm({...eForm, depth_km: e.target.value})} /></FormGroup>
                <FormGroup label="Latitude (دوائر العرض)"><StyledInput type="number" step="any" value={eForm.latitude} onChange={e => setEForm({...eForm, latitude: e.target.value})} /></FormGroup>
                <FormGroup label="Longitude (خطوط الطول)"><StyledInput type="number" step="any" value={eForm.longitude} onChange={e => setEForm({...eForm, longitude: e.target.value})} /></FormGroup>
              </div>
            </div>
            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] shrink-0 flex flex-col-reverse md:flex-row justify-end gap-3 [&>button]:w-full md:[&>button]:w-auto">
              <button onClick={() => setIsEgyptModalOpen(false)} className="px-6 py-3 md:py-2 rounded-xl text-[var(--muted-2)] bg-[var(--surface-4)]">إلغاء</button>
              <button onClick={handleEgyptSubmit} className="px-6 py-2 rounded-xl text-white bg-[var(--ok)] font-bold">حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ تأكيد حذف زلزال فردي — التصميم الموحّد (كبسولة علوية عائمة) */}
      <DangerConfirmModal
  show={eqToDelete !== null}
  title="تأكيد الحذف"
  message="هل أنت متأكد من حذف هذا الزلزال نهائياً؟"
  confirmLabel="نعم، احذف"
  onCancel={() => setEqToDelete(null)}
  onConfirm={confirmDeleteEq}
/>

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

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
    </div>
  );
}

// ==========================================
// 10. شاشة استخبارات الطقس اليومية والتحليل المتقدم (Weather Intelligence Module)
// ==========================================
function WeatherIntelView({ branches, isOwner, userRole, lang, setCustomAlert }) {
  const isAr = lang === 'ar';
  const T = (ar, en) => (isAr ? ar : en);

  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const normalizeArray = (value) => Array.isArray(value) ? value : [];
  const normalizeObject = (value) => isObject(value) ? value : {};
  const safeScalar = (value, fallback = '') => {
    if (value === null || value === undefined) return fallback;
    return ['string', 'number', 'boolean'].includes(typeof value) ? value : fallback;
  };
  const safeText = (value, fallback = '') => {
    const scalar = safeScalar(value, fallback);
    return typeof scalar === 'string' ? scalar : String(scalar);
  };
  const safeNumber = (value, fallback = '') => {
    if (value === null || value === undefined) return fallback;
    const numberValue = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
    return Number.isFinite(numberValue) ? numberValue : fallback;
  };
  const normalizeAnomalyEntry = (value) => {
    if (isObject(value)) return value;
    if (typeof value === 'string') return { category: value };
    return { category: 'normal' };
  };
  const normalizeAnomalies = (value) => {
    const source = normalizeObject(value);
    return Object.entries(source).reduce((result, [key, anomaly]) => {
      result[key] = normalizeAnomalyEntry(anomaly);
      return result;
    }, {});
  };
  const normalizeForecast = (value) => {
    const source = normalizeObject(value);
    return {
      ...source,
      target_date: safeText(source.target_date),
      forecast_date: safeText(source.forecast_date),
      forecast_date_explicit: Boolean(source.forecast_date),
      tmax: safeScalar(source.tmax),
      tmin: safeScalar(source.tmin),
      precip: safeScalar(source.precip_mm),
      wind: safeScalar(source.wind_max_kph),
      gusts: safeScalar(source.wind_gusts_kph),
      humidity: safeScalar(source.humidity_mean_pct),
      cloud: safeScalar(source.cloud_cover_mean_pct),
      precip_mm: safeScalar(source.precip_mm),
      precip_prob_pct: safeScalar(source.precip_prob_pct),
      wind_max_kph: safeScalar(source.wind_max_kph),
      wind_gusts_kph: safeScalar(source.wind_gusts_kph),
      humidity_mean_pct: safeScalar(source.humidity_mean_pct),
      cloud_cover_mean_pct: safeScalar(source.cloud_cover_mean_pct),
      weather_code: safeScalar(source.weather_code),
      fetched_at: safeText(source.fetched_at),
      data_source: safeText(source.data_source),
    };
  };
  const normalizeStatistic = (value) => {
    const source = normalizeObject(value);
    return {
      ...source,
      metric: safeText(source.metric),
      mean: safeScalar(source.mean),
      median: safeScalar(source.median),
      p10: safeScalar(source.p10),
      p25: safeScalar(source.p25),
      p75: safeScalar(source.p75),
      p90: safeScalar(source.p90),
      min: safeScalar(source.min),
      max: safeScalar(source.max),
      sample_count: safeScalar(source.sample_count),
      stddev: safeScalar(source.stddev),
      period_start: safeText(source.period_start),
      period_end: safeText(source.period_end),
      window_days: safeScalar(source.window_days),
    };
  };
  const normalizeFrequency = (value) => {
    const source = normalizeObject(value);
    return {
      ...source,
      metric: safeText(source.metric),
      threshold_desc_ar: safeText(source.threshold_desc_ar),
      threshold_value: safeScalar(source.threshold_value),
      threshold_unit: safeText(source.threshold_unit),
      qualifying_count: safeScalar(source.qualifying_count),
      total_count: safeScalar(source.total_count),
      frequency_pct: safeScalar(source.frequency_pct),
    };
  };
  const normalizeSnapshot = (value) => ({
    ...normalizeForecast(value),
    id: safeScalar(value?.id),
    location_id: safeScalar(value?.location_id),
  });
  const groupAssessmentData = (assessments, snapshots, statistics, frequencies) => {
    const assessmentList = normalizeArray(assessments)
      .map(normalizeAssessment)
      .filter(Boolean);
    const locationIds = new Set(assessmentList.map((assessment) => String(assessment.location_id)));
    const byLocation = new Map();
    const getGroup = (locationId) => {
      const key = String(locationId);
      if (!byLocation.has(key)) {
        byLocation.set(key, { location_id: locationId, forecast: null, statistics: [], frequencies: [] });
      }
      return byLocation.get(key);
    };

    assessmentList.forEach((assessment) => {
      Object.assign(getGroup(assessment.location_id), assessment);
    });
    normalizeArray(snapshots).forEach((rawSnapshot) => {
      const snapshot = normalizeSnapshot(rawSnapshot);
      if (
        locationIds.has(String(snapshot.location_id)) &&
        snapshot.location_id !== undefined &&
        snapshot.location_id !== ''
      ) {
        getGroup(snapshot.location_id).forecast = snapshot;
      }
    });
    normalizeArray(statistics).forEach((rawStatistic) => {
      const statistic = normalizeStatistic(rawStatistic);
      if (
        locationIds.has(String(statistic.location_id)) &&
        statistic.location_id !== undefined &&
        statistic.location_id !== ''
      ) {
        getGroup(statistic.location_id).statistics.push(statistic);
      }
    });
    normalizeArray(frequencies).forEach((rawFrequency) => {
      const frequency = normalizeFrequency(rawFrequency);
      if (
        locationIds.has(String(frequency.location_id)) &&
        frequency.location_id !== undefined &&
        frequency.location_id !== ''
      ) {
        getGroup(frequency.location_id).frequencies.push(frequency);
      }
    });

    return assessmentList;
  };
  const normalizeAiAssessmentJson = (value) => {
    let source = normalizeObject(value);
    if (!isObject(value) && typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        source = normalizeObject(parsed);
      } catch {
        source = {};
      }
    }
    return {
      weather_summary: safeText(source.weather_summary),
      historical_comparison: safeText(source.historical_comparison),
      significant_anomalies: safeText(source.significant_anomalies),
      operational_implications: safeText(source.operational_implications),
      recommended_monitoring: safeText(source.recommended_monitoring),
    };
  };
  const normalizeHazard = (value) => {
    if (!isObject(value)) return null;
    return {
      ...value,
      code: safeText(value.code),
      level: safeText(value.level),
      title_ar: safeText(value.title_ar),
      title_en: safeText(value.title_en),
      detail_ar: safeText(value.detail_ar),
      detail_en: safeText(value.detail_en),
      unit: safeText(value.unit),
    };
  };
  const normalizeAssessment = (assessment) => {
    if (!isObject(assessment)) return null;
    return {
      ...assessment,
      id: safeScalar(assessment.id),
      location_id: safeScalar(assessment.location_id),
      location_name_ar: safeText(assessment.location_name_ar),
      location_name_en: safeText(assessment.location_name_en),
      region: safeText(assessment.region),
      latitude: safeScalar(assessment.latitude),
      longitude: safeScalar(assessment.longitude),
      target_date: safeText(assessment.target_date),
      forecast: normalizeForecast(assessment.forecast),
      statistics: normalizeArray(assessment.statistics).map(normalizeStatistic).filter(isObject),
      frequencies: normalizeArray(assessment.frequencies).map(normalizeFrequency).filter(isObject),
      hazards: normalizeArray(assessment.hazards).map(normalizeHazard).filter(isObject),
      anomalies: normalizeAnomalies(assessment.anomalies),
      ai_model: safeText(assessment.ai_model),
      ai_provider: safeText(assessment.ai_provider),
      ai_status: safeText(assessment.ai_status),
      ai_error: safeText(assessment.ai_error),
      ai_assessment: safeText(assessment.ai_assessment),
      ai_assessment_json: normalizeAiAssessmentJson(assessment.ai_assessment_json),
    };
  };
  const normalizeAssessments = (value) => normalizeArray(value).map(normalizeAssessment).filter(Boolean);
  const normalizeSourceMeta = (value) => {
    const source = normalizeObject(value);
    return {
      ...source,
      ai_provider: safeText(source.ai_provider),
      ai_model: safeText(source.ai_model),
    };
  };
  const normalizeRun = (run) => ({
    ...run,
    id: safeScalar(run.id),
    target_date: safeText(run.target_date),
    forecast_date: safeText(run.forecast_date),
    latest_observed_date: safeText(run.latest_observed_date),
    run_date: safeText(run.run_date),
    status: safeText(run.status),
    successful_locations: safeScalar(run.successful_locations),
    total_locations: safeScalar(run.total_locations),
    source_meta: normalizeSourceMeta(run.source_meta),
  });
  const normalizeRuns = (value) => normalizeArray(value).filter(isObject).map(normalizeRun);
  const formatAiProvider = (provider) => {
    const rawProvider = safeText(provider).trim();
    const providerNames = {
      anthropic: 'Anthropic',
      gemini: 'Gemini',
      omniroute: 'OmniRoute',
    };
    return providerNames[rawProvider.toLowerCase()] || rawProvider;
  };
  const getAnalystLabel = (sourceMeta, fallbackModel = '', status = 'success') => {
    if (status !== 'success') return '';
    const provider = formatAiProvider(sourceMeta?.ai_provider);
    const model = safeText(sourceMeta?.ai_model || fallbackModel).trim();
    return provider && model ? `${provider} — ${model}` : '';
  };
  const normalizeLocations = (value) => normalizeArray(value).filter(isObject).map((location) => ({
    ...location,
    id: safeScalar(location.id),
    name_ar: safeText(location.name_ar),
    name_en: safeText(location.name_en),
    region: safeText(location.region),
    latitude: safeScalar(location.latitude),
    longitude: safeScalar(location.longitude),
  }));
  const normalizeConfig = (value) => {
    const source = normalizeObject(value);
    return Object.entries(source).reduce((result, [key, item]) => {
      const configItem = normalizeObject(item);
      result[key] = {
        ...configItem,
        value: safeScalar(configItem.value),
        unit: safeText(configItem.unit),
        description_ar: safeText(configItem.description_ar),
        source: safeText(configItem.source),
        updated_at: safeText(configItem.updated_at),
      };
      return result;
    }, {});
  };
  const formatCoordinate = (value) => {
    const numberValue = safeNumber(value, NaN);
    return Number.isFinite(numberValue) ? numberValue.toFixed(4) : '—';
  };
  const readJsonObject = async (response, endpoint) => {
    const data = await response.json().catch(() => null);
    if (!isObject(data) && !Array.isArray(data)) {
      throw new Error(T(`استجابة غير صالحة من ${endpoint}.`, `Invalid response from ${endpoint}.`));
    }
    return data;
  };

  // حساب تاريخ الغد وفق تقويم القاهرة المحلي، بعيدًا عن UTC.
  const getDefaultTargetDate = () => {
    let year;
    let month;
    let day;
    for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())) {
      if (type === 'year') year = Number(value);
      if (type === 'month') month = Number(value);
      if (type === 'day') day = Number(value);
    }

    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    return tomorrow.toISOString().slice(0, 10);
  };

  const [targetDate, setTargetDate] = useState(getDefaultTargetDate());
  const [selectedLocationId, setSelectedLocationId] = useState('all');
  const [activeFilterTab, setActiveFilterTab] = useState('all'); // all | hazards | anomalies | ai
  const [assessmentsData, setAssessmentsData] = useState([]);
  const [currentRun, setCurrentRun] = useState(null);
  const [runsHistory, setRunsHistory] = useState([]);
  const [locationsList, setLocationsList] = useState([]);
  const [intelConfig, setIntelConfig] = useState({});
  const [apiError, setApiError] = useState(null);
  const [apiPartial, setApiPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [showRunsModal, setShowRunsModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [expandedSections, setExpandedSections] = useState({}); // { [locId]: { summary: true, comp: true, anom: true, ops: true, rec: true } }
  const successfulAssessments = assessmentsData.filter((assessment) => assessment.ai_status === 'success');
  const analystLabel = assessmentsData.length > 0 && successfulAssessments.length === assessmentsData.length
    ? getAnalystLabel({
      ai_provider: successfulAssessments[0]?.ai_provider || currentRun?.source_meta?.ai_provider,
      ai_model: successfulAssessments[0]?.ai_model || currentRun?.source_meta?.ai_model,
    }, '', 'success')
    : '';

  // جلب البيانات الأساسية مع الاحتفاظ بأي بيانات نجحت قبل حدوث خطأ
  const fetchWeatherIntelData = async () => {
    setIsLoading(true);
    setApiError(null);
    const token = getStoredAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let successfulEndpoints = 0;
    let hasFailure = false;
    const recordFailure = () => {
      hasFailure = true;
    };

    try {
      // 1. جلب التقييمات للتاريخ المحدد
      const params = new URLSearchParams();
      if (targetDate) params.append('target_date', targetDate);
      if (selectedLocationId && selectedLocationId !== 'all') params.append('location_id', selectedLocationId);

      try {
        const resAssessments = await fetch(`${BASE}/api/weather-intel/assessments?${params.toString()}`, { headers });
        if (!resAssessments.ok) {
          throw new Error(T("تعذر تحميل بيانات التقييمات.", "Assessment data could not be loaded."));
        }
        const data = await readJsonObject(resAssessments, 'assessments');
        setAssessmentsData(
          groupAssessmentData(
            data.assessments,
            data.snapshots,
            data.statistics,
            data.frequencies
          )
        );
        setCurrentRun(isObject(data.run) ? normalizeRun(data.run) : null);
        setLocationsList(normalizeLocations(data.locations));
        successfulEndpoints += 1;
      } catch (err) {
        recordFailure();
      }

      // 2. جلب سجل التشغيلات الأخيرة
      try {
        const resRuns = await fetch(`${BASE}/api/weather-intel/runs?limit=10`, { headers });
        if (!resRuns.ok) {
          throw new Error(T("تعذر تحميل سجل التشغيلات.", "Weather intelligence run history could not be loaded."));
        }
        const data = await readJsonObject(resRuns, 'runs');
        setRunsHistory(normalizeRuns(data));
        successfulEndpoints += 1;
      } catch {
        recordFailure();
      }

      // 3. جلب الإعدادات والعتبات
      try {
        const resConfig = await fetch(`${BASE}/api/weather-intel/config`, { headers });
        if (!resConfig.ok) {
          throw new Error(T("تعذر تحميل إعدادات استخبارات الطقس.", "Weather intelligence configuration could not be loaded."));
        }
        const data = await readJsonObject(resConfig, 'config');
        setIntelConfig(normalizeConfig(data.config ?? data));
        successfulEndpoints += 1;
      } catch {
        recordFailure();
      }

      // 4. جلب المواقع إن لم تكن محملة
      if (locationsList.length === 0) {
        try {
          const resLocs = await fetch(`${BASE}/api/weather-intel/locations?active=1`, { headers });
          if (!resLocs.ok) {
            throw new Error(T("تعذر تحميل المواقع.", "Weather intelligence locations could not be loaded."));
          }
          const data = await readJsonObject(resLocs, 'locations');
          setLocationsList(normalizeLocations(data.locations || data));
          successfulEndpoints += 1;
        } catch {
          recordFailure();
        }
      }
    } finally {
      if (successfulEndpoints === 0) {
        setApiError(T("تعذر الاتصال بخدمة استخبارات الطقس.", "Weather intelligence service is unavailable."));
        setApiPartial(false);
        if (setCustomAlert) setCustomAlert(T("تعذر جلب بيانات استخبارات الطقس.", "Failed to fetch weather intelligence data."));
      } else if (hasFailure) {
        setApiError(T("تم جلب جزء من البيانات، لكن بعض نقاط النهاية فشلت.", "Some Weather Intelligence data could not be loaded."));
        setApiPartial(true);
      } else {
        setApiError(null);
        setApiPartial(false);
      }
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWeatherIntelData();
  }, [targetDate, selectedLocationId]);

  // تشغيل التحليل اليومي يدويًا (Owner Only)
  const handleTriggerRun = async () => {
    if (!isOwner) return;
    setIsTriggering(true);
    const token = getStoredAccessToken();
    try {
      const res = await fetch(`${BASE}/api/weather-intel/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && isObject(data) && data.status === 'success') {
        if (setCustomAlert) setCustomAlert(T("🚀 تم إطلاق مهمة استخبارات الطقس بنجاح عبر GitHub Actions. ستظهر النتائج خلال دقيقة إلى دقيقتين.", "Weather intelligence workflow triggered successfully. Results will appear in 1-2 minutes."));
      } else {
        if (setCustomAlert) setCustomAlert(T("تعذر تشغيل مهمة استخبارات الطقس.", "Weather intelligence analysis could not be started."));
      }
    } catch {
      if (setCustomAlert) setCustomAlert(T("حدث خطأ أثناء الاتصال لتشغيل التحليل.", "Network error while triggering analysis."));
    } finally {
      setIsTriggering(false);
    }
  };

  // تصدير التقرير إلى Excel
  const handleExportExcel = async () => {
    if (!assessmentsData || assessmentsData.length === 0) {
      if (setCustomAlert) setCustomAlert(T("لا توجد بيانات متاحة للتصدير.", "No data available to export."));
      return;
    }

    try {
      const locationName = (a) => isAr
        ? safeText(a.location_name_ar)
        : safeText(a.location_name_en || a.location_name_ar);
      const formatHazard = (h) => {
        const title = isAr
          ? safeText(h.title_ar)
          : safeText(h.title_en || h.title_ar);
        const detail = isAr
          ? safeText(h.detail_ar)
          : safeText(h.detail_en || h.detail_ar);
        return [title, detail].filter(Boolean).join(' — ');
      };
      // 1. ورقة التوقعات الميدانية
      const forecastRows = assessmentsData.map(a => {
        const fc = a.forecast || {};
        const hazards = a.hazards || [];
        return {
          [T('الموقع', 'Location')]: locationName(a),
          [T('التاريخ المستهدف', 'Target Date')]: a.target_date,
          [T('تاريخ التنبؤ', 'Forecast Date')]: fc.forecast_date || '',
          [T('آخر تاريخ مرصود', 'Latest Observed Date')]: currentRun?.latest_observed_date || '',
          [T('معرف لقطة التوقع', 'Forecast Snapshot ID')]: fc.id ?? a.forecast_snapshot_id ?? '',
          [T('الحرارة العظمى (°م)', 'Max Temp (°C)')]: fc.tmax ?? '',
          [T('الحرارة الصغرى (°م)', 'Min Temp (°C)')]: fc.tmin ?? '',
          [T('الهطول المطري (مم)', 'Precipitation (mm)')]: fc.precip_mm ?? '',
          [T('احتمالية الهطول (%)', 'Precip Probability (%)')]: fc.precip_prob_pct ?? '',
          [T('سرعة الرياح القصوى (كم/س)', 'Max Wind Speed (km/h)')]: fc.wind_max_kph ?? '',
          [T('هبات الرياح القصوى (كم/س)', 'Wind Gusts (km/h)')]: fc.wind_gusts_kph ?? '',
          [T('متوسط الرطوبة (%)', 'Mean Humidity (%)')]: fc.humidity_mean_pct ?? '',
          [T('الغطاء السحابي (%)', 'Cloud Cover (%)')]: fc.cloud_cover_mean_pct ?? '',
          [T('كود الطقس WMO', 'WMO Weather Code')]: fc.weather_code ?? '',
          [T('أكواد المخاطر', 'Hazard Codes')]: hazards.map(h => safeText(h.code)).filter(Boolean).join(' | '),
          [T('مستويات المخاطر', 'Hazard Levels')]: hazards.map(h => safeText(h.level)).filter(Boolean).join(' | '),
          [T('المخاطر المرصودة', 'Detected Hazards')]: hazards.map(formatHazard).filter(Boolean).join(' | '),
          [T('مصدر التوقعات', 'Forecast Source')]: fc.data_source || 'open-meteo-forecast'
        };
      });

      // 2. ورقة الخط المرجعي التاريخي (ERA5)
      const statsRows = [];
      assessmentsData.forEach(a => {
        (a.statistics || []).forEach(s => {
          const anomaly = a.anomalies?.[s.metric] || {};
          statsRows.push({
            [T('الموقع', 'Location')]: locationName(a),
            [T('التاريخ المستهدف', 'Target Date')]: a.target_date,
            [T('تاريخ التنبؤ', 'Forecast Date')]: a.forecast?.forecast_date || '',
            [T('المتغير', 'Metric')]: s.metric,
            [T('المتوسط التاريخي', 'Historical Mean')]: s.mean,
            [T('الوسيط التاريخي', 'Historical Median')]: s.median,
            [T('المئين 10 (P10)', '10th Percentile')]: s.p10,
            [T('المئين 25 (P25)', '25th Percentile')]: s.p25,
            [T('المئين 75 (P75)', '75th Percentile')]: s.p75,
            [T('المئين 90 (P90)', '90th Percentile')]: s.p90,
            [T('الحد الأدنى المسجل', 'Historical Min')]: s.min,
            [T('الحد الأقصى المسجل', 'Historical Max')]: s.max,
            [T('الانحراف المعياري', 'Std Dev')]: s.stddev,
            [T('عدد المشاهدات الصالحة (N)', 'Valid Samples (N)')]: s.sample_count,
            [T('فترة السجل', 'History Period')]: `${s.period_start} → ${s.period_end}`,
            [T('نافذة الأيام', 'Window Days')]: `±${s.window_days}d`,
            [T('فئة الشذوذ', 'Anomaly Category')]: safeText(anomaly.category || 'normal'),
            [T('سبب الشذوذ', 'Anomaly Reason')]: safeText(anomaly.reason),
            [T('قيمة الشذوذ', 'Anomaly Value')]: anomaly.value ?? '',
            [T('الحد التاريخي الأدنى', 'Historical Min for Anomaly')]: anomaly.min_hist ?? '',
            [T('الحد التاريخي الأقصى', 'Historical Max for Anomaly')]: anomaly.max_hist ?? '',
            [T('السجل المرتبط', 'Anomaly Record')]: isObject(anomaly.record) ? JSON.stringify(anomaly.record) : safeText(anomaly.record)
          });
        });
      });

      // 3. ورقة تكرارات العتبات
      const freqRows = [];
      assessmentsData.forEach(a => {
        (a.frequencies || []).forEach(f => {
          freqRows.push({
            [T('الموقع', 'Location')]: locationName(a),
            [T('التاريخ المستهدف', 'Target Date')]: a.target_date,
            [T('تاريخ التنبؤ', 'Forecast Date')]: a.forecast?.forecast_date || '',
            [T('المتغير', 'Metric')]: f.metric,
            [T('وصف العتبة', 'Threshold Description')]: f.threshold_desc_ar,
            [T('قيمة العتبة', 'Threshold Value')]: `${f.threshold_value} ${f.threshold_unit}`,
            [T('عدد مرات التحقق', 'Qualifying Count')]: f.qualifying_count,
            [T('إجمالي المشاهدات الصالحة', 'Total Valid Count')]: f.total_count,
            [T('نسبة التكرار التاريخي (%)', 'Historical Frequency (%)')]: `${f.frequency_pct}%`
          });
        });
      });

      // 4. ورقة تقييمات الذكاء الاصطناعي التشغيلية
      const aiRows = assessmentsData.map(a => {
        const json = a.ai_assessment_json || {};
        return {
          [T('الموقع', 'Location')]: locationName(a),
          [T('التاريخ المستهدف', 'Target Date')]: a.target_date,
          [T('تاريخ التنبؤ', 'Forecast Date')]: a.forecast?.forecast_date || '',
          [T('آخر تاريخ مرصود', 'Latest Observed Date')]: currentRun?.latest_observed_date || '',
          [T('معرف لقطة التوقع', 'Forecast Snapshot ID')]: a.forecast?.id ?? a.forecast_snapshot_id ?? '',
          [T('مزود الذكاء الاصطناعي', 'AI Provider')]: formatAiProvider(a.ai_provider || currentRun?.source_meta?.ai_provider),
          [T('نموذج الذكاء الاصطناعي', 'AI Model')]: a.ai_model || currentRun?.source_meta?.ai_model || '',
          [T('حالة التقييم', 'AI Status')]: a.ai_status || 'skipped',
          [T('خطأ التقييم', 'AI Error')]: a.ai_error || '',
          [T('ملخص الأحوال الجوية', 'Weather Summary')]: json.weather_summary || '',
          [T('المقارنة بالسياق التاريخي', 'Historical Comparison')]: json.historical_comparison || '',
          [T('الشذوذ الإحصائي', 'Significant Anomalies')]: json.significant_anomalies || '',
          [T('الآثار التشغيلية', 'Operational Implications')]: json.operational_implications || '',
          [T('توصيات المراقبة والمتابعة', 'Recommended Monitoring')]: json.recommended_monitoring || '',
          [T('التقرير الكامل الخام', 'Full Raw Text')]: a.ai_assessment || ''
        };
      });

      const sheets = [
        { name: T('توقعات الطقس', 'Forecasts'), ...gridFromRows(forecastRows) },
        { name: T('الخط المرجعي التاريخي', 'Historical Baseline'), ...gridFromRows(statsRows) },
        { name: T('تكرار العتبات', 'Threshold Frequencies'), ...gridFromRows(freqRows) },
        { name: T('تقييم الذكاء الاصطناعي', 'AI Operational Assessment'), ...gridFromRows(aiRows) }
      ];

      await exportWorkbook(sheets, `تقرير_استخبارات_الطقس_${targetDate}.xlsx`);
      if (setCustomAlert) setCustomAlert(T("تم تصدير تقرير استخبارات الطقس الشامل بنجاح!", "Weather intelligence report exported successfully!"));
    } catch (err) {
      console.error("Export error:", err);
      if (setCustomAlert) setCustomAlert(T("حدث خطأ أثناء تصدير التقرير.", "Error exporting report."));
    }
  };

  // ترجمة وتفسير الأكواد
  const METRIC_DICT = {
    tmax: { ar: 'الحرارة العظمى', en: 'Max Temp', unit: '°C' },
    tmin: { ar: 'الحرارة الصغرى', en: 'Min Temp', unit: '°C' },
    precip: { ar: 'الهطول المطري', en: 'Precipitation', unit: isAr ? 'مم' : 'mm' },
    precip_mm: { ar: 'الهطول المطري', en: 'Precipitation', unit: isAr ? 'مم' : 'mm' },
    wind: { ar: 'سرعة الرياح', en: 'Max Wind', unit: isAr ? 'كم/س' : 'km/h' },
    wind_max_kph: { ar: 'سرعة الرياح', en: 'Max Wind', unit: isAr ? 'كم/س' : 'km/h' },
    gusts: { ar: 'هبات الرياح', en: 'Wind Gusts', unit: isAr ? 'كم/س' : 'km/h' },
    wind_gusts_kph: { ar: 'هبات الرياح', en: 'Wind Gusts', unit: isAr ? 'كم/س' : 'km/h' },
    humidity: { ar: 'الرطوبة النسبية', en: 'Relative Humidity', unit: '%' },
    humidity_mean_pct: { ar: 'الرطوبة النسبية', en: 'Relative Humidity', unit: '%' },
    cloud: { ar: 'الغطاء السحابي', en: 'Cloud Cover', unit: '%' },
    cloud_cover_mean_pct: { ar: 'الغطاء السحابي', en: 'Cloud Cover', unit: '%' }
  };

  const ANOMALY_DICT = {
    extreme_high: { ar: 'مرتفع جداً (>P90)', en: 'Extreme High (>P90)', style: 'bg-red-500/20 text-red-300 border-red-500/40' },
    high: { ar: 'أعلى من الطبيعي (P75-P90)', en: 'Above Normal (P75-P90)', style: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    normal: { ar: 'ضمن النطاق المعتاد (P25-P75)', en: 'Normal (P25-P75)', style: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    low: { ar: 'أدنى من الطبيعي (P10-P25)', en: 'Below Normal (P10-P25)', style: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
    extreme_low: { ar: 'منخفض جداً (<P10)', en: 'Extreme Low (<P10)', style: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
    insufficient_data: { ar: 'بيانات غير كافية', en: 'Insufficient Data', style: 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40' }
  };

  const HAZARD_DICT = {
    heat: { ar: '🔥 موجة حرارة مرتفعة', en: '🔥 High Heat Risk', color: 'bg-red-950/60 text-red-300 border-red-700/60' },
    cold: { ar: '❄️ موجة صقيع وبرودة شديدة', en: '❄️ Extreme Cold Risk', color: 'bg-blue-950/60 text-blue-300 border-blue-700/60' },
    heavy_rain: { ar: '🌧️ هطول أمطار غزيرة', en: '🌧️ Heavy Rain Alert', color: 'bg-cyan-950/60 text-cyan-300 border-cyan-700/60' },
    strong_wind: { ar: '💨 رياح نشطة وقوية', en: '💨 Strong Wind Warning', color: 'bg-amber-950/60 text-amber-300 border-amber-700/60' },
    thunderstorm: { ar: '⚡ عواصف رعدية متوقعة', en: '⚡ Thunderstorm Alert', color: 'bg-purple-950/60 text-purple-300 border-purple-700/60' },
    fog: { ar: '🌫️ ضباب ورؤية أفقية منخفضة', en: '🌫️ Fog & Low Visibility', color: 'bg-zinc-800/80 text-zinc-300 border-zinc-600/60' }
  };

  const getWmoDescription = (code) => {
    if (code === 0) return T('سماء صافية', 'Clear Sky');
    if ([1, 2, 3].includes(code)) return T('غائم جزئياً / غائم', 'Partly Cloudy');
    if ([45, 48].includes(code)) return T('ضباب كثيف', 'Fog');
    if ([51, 53, 55].includes(code)) return T('رذاذ مطري خفيف', 'Drizzle');
    if ([61, 63, 65].includes(code)) return T('أمطار متفرقة إلى غزيرة', 'Rain');
    if ([71, 73, 75].includes(code)) return T('ثلوج متفرقة', 'Snowfall');
    if ([80, 81, 82].includes(code)) return T('زخات مطرية', 'Rain Showers');
    if ([95, 96, 99].includes(code)) return T('عواصف رعدية نشطة', 'Thunderstorm');
    return T(`حالة جوية (WMO ${code})`, `Weather code (${code})`);
  };

  // فلترة البطاقات
  const filteredAssessments = useMemo(() => {
    if (!assessmentsData) return [];
    return assessmentsData.filter(a => {
      if (activeFilterTab === 'hazards') {
        return (a.hazards || []).length > 0;
      }
      if (activeFilterTab === 'anomalies') {
        const anomValues = Object.values(a.anomalies || {});
        return anomValues.some(v => ['extreme_high', 'extreme_low', 'high', 'low'].includes(v?.category || v?.class));
      }
      if (activeFilterTab === 'ai') {
        return a.ai_status === 'success' && a.ai_assessment_json;
      }
      return true;
    });
  }, [assessmentsData, activeFilterTab]);

  // إحصاءات ملخصة للكروت العلوية
  const kpiTotalLocations = assessmentsData.length;
  const kpiHazardsCount = assessmentsData.reduce((acc, a) => acc + (a.hazards || []).length, 0);
  const kpiAnomaliesCount = assessmentsData.reduce((acc, a) => {
    const anomValues = Object.values(a.anomalies || {});
    return acc + anomValues.filter(v => ['extreme_high', 'extreme_low', 'high', 'low'].includes(v?.category || v?.class)).length;
  }, 0);
  const kpiAiSuccessCount = assessmentsData.filter(a => a.ai_status === 'success').length;

  // تنسيق نصوص الذكاء الاصطناعي لتلوين وسوم الأدلة
  const renderFormattedAIText = (text) => {
    const safeTextValue = safeText(text);
    if (!safeTextValue) return null;
    const parts = safeTextValue.split(/(\[(?:توقعات|تاريخي|إحصائي|تشغيلي)\])/g);
    return parts.map((part, idx) => {
      if (part === '[توقعات]') return <span key={idx} className="inline-block px-1.5 py-0.5 mx-1 text-[10px] font-bold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono">[توقعات]</span>;
      if (part === '[تاريخي]') return <span key={idx} className="inline-block px-1.5 py-0.5 mx-1 text-[10px] font-bold rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">[تاريخي]</span>;
      if (part === '[إحصائي]') return <span key={idx} className="inline-block px-1.5 py-0.5 mx-1 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">[إحصائي]</span>;
      if (part === '[تشغيلي]') return <span key={idx} className="inline-block px-1.5 py-0.5 mx-1 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">[تشغيلي]</span>;
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* 1. لوحة التحكم والخيارات العلوية */}
      <div className="card-surface p-4 md:p-6 rounded-3xl border border-[var(--border)] shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)]">
                <WeatherIntelIcon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-black text-[var(--ink)] flex items-center gap-2">
                  {T('استخبارات الطقس اليومية والتحليل المتقدم', 'Daily Weather Intelligence & Advanced Analysis')}
                </h2>
                <p className="text-xs md:text-sm text-[var(--muted)] mt-0.5">
                  {T('تحليل آلي شامل لطقس الغد مقارنة بالسجل التاريخي لـ 30 عاماً عبر Open-Meteo و ERA5', 'Automated next-day weather intelligence vs 30-year ERA5 baseline with Open-Meteo')}
                </p>
              </div>
            </div>
          </div>

          {/* أزرار الإجراءات */}
          <div className="flex items-center gap-2 flex-wrap">
            {isOwner && (
              <button
                type="button"
                onClick={handleTriggerRun}
                disabled={isTriggering}
                className="ops-btn bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 px-4 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <span className={isTriggering ? "animate-spin" : ""}>⚡</span>
                {isTriggering ? T('جارٍ إطلاق التحليل...', 'Triggering...') : T('تشغيل التحليل الآن', 'Run Analysis Now')}
              </button>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={handleExportExcel}
                className="ops-btn bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--ink)] border border-[var(--border)] px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2"
              >
                <span>📊</span>
                {T('تصدير التقرير (Excel)', 'Export Excel')}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRunsModal(true)}
              className="ops-btn bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--ink)] border border-[var(--border)] px-3.5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2"
              title={T('سجل التشغيلات', 'Runs History')}
            >
              <span>📜</span>
              {T('سجل التشغيلات', 'Runs History')}
            </button>

            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="ops-btn bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--ink)] border border-[var(--border)] px-3 py-2.5 rounded-xl font-bold text-sm transition-all"
              title={T('العتبات والإعدادات الفنية', 'Technical Config')}
            >
              <span>⚙️</span>
            </button>

            <button
              type="button"
              onClick={fetchWeatherIntelData}
              className="ops-btn bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)] px-3 py-2.5 rounded-xl font-bold text-sm transition-all"
              title={T('تحديث البيانات', 'Refresh')}
            >
              <span>🔄</span>
            </button>
          </div>
        </div>

        {/* شريط الفلاتر والاختيارات */}
        <div className="mt-6 pt-5 border-t border-[var(--border)] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* اختيار التاريخ */}
            <div className="flex items-center gap-2 bg-[var(--surface-2)] px-3 py-1.5 rounded-xl border border-[var(--border)]">
              <span className="text-xs font-bold text-[var(--muted)]">{T('التاريخ المستهدف:', 'Target Date:')}</span>
              <SegDateField
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="bg-transparent border-0 text-sm font-bold text-[var(--ink)] focus:outline-none cursor-pointer"
              />
            </div>

            {/* اختيار الموقع */}
            <div className="flex items-center gap-2 bg-[var(--surface-2)] px-3 py-1.5 rounded-xl border border-[var(--border)]">
              <span className="text-xs font-bold text-[var(--muted)]">{T('الموقع:', 'Location:')}</span>
              <EocSelect
                variant="toolbar"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
              >
                <option value="all" className="bg-[var(--surface-2)] text-[var(--ink)]">
                  {T('كل المواقع', 'All locations')} ({locationsList.length})
                </option>
                {locationsList.map(loc => (
                  <option key={loc.id} value={loc.id} className="bg-[var(--surface-2)] text-[var(--ink)]">
                    {isAr ? loc.name_ar : (loc.name_en || loc.name_ar)}
                  </option>
                ))}
              </EocSelect>
            </div>
          </div>

          {/* تبويبات الفلترة السريعة */}
          <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-2xl border border-[var(--border)] self-start md:self-auto overflow-x-auto max-w-full">
            <button type="button" onClick={() => setActiveFilterTab('all')} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeFilterTab === 'all' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
              {T('الكل', 'All')} ({assessmentsData.length})
            </button>
            <button type="button" onClick={() => setActiveFilterTab('hazards')} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${activeFilterTab === 'hazards' ? 'bg-red-600 text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
              ⚠️ {T('المخاطر المرصودة', 'Hazards')} ({kpiHazardsCount})
            </button>
            <button type="button" onClick={() => setActiveFilterTab('anomalies')} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${activeFilterTab === 'anomalies' ? 'bg-amber-600 text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
              📈 {T('الشذوذ الإحصائي', 'Anomalies')} ({kpiAnomaliesCount})
            </button>
            <button type="button" onClick={() => setActiveFilterTab('ai')} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${activeFilterTab === 'ai' ? 'bg-purple-600 text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
              🤖 {T('تقييم الذكاء الاصطناعي', 'AI Assessment')} ({kpiAiSuccessCount})
            </button>
          </div>
        </div>
      </div>

      {/* 2. شريط المصادر والمنهجية المعتمدة */}
      <div className="bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 border border-blue-800/40 rounded-2xl p-4 text-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-zinc-300">
          <div className="flex items-center gap-2">
            <span className="text-base">ℹ️</span>
            <span className="font-bold text-white">{T('المصادر والمنهجية المعتمدة:', 'Sources & Methodology:')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 bg-blue-900/40 px-2.5 py-1 rounded-lg border border-blue-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              {T('التوقعات: Open-Meteo Forecast (ECMWF IFS 0.25°)', 'Forecast: Open-Meteo Forecast (ECMWF IFS 0.25°)')}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-purple-900/40 px-2.5 py-1 rounded-lg border border-purple-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              {T('السجل التاريخي: ERA5 reanalysis (1996–2026)', 'Baseline: ERA5 reanalysis (1996–2026)')}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-indigo-900/40 px-2.5 py-1 rounded-lg border border-indigo-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              {T('المنهجية: استيفاء خطي للمئينات (P10/P25/P75/P90) · نافذة ±3 أيام · حد أدنى N=20', 'Methodology: Linear percentiles (P10/P25/P75/P90) · ±3d window · min N=20')}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-emerald-900/40 px-2.5 py-1 rounded-lg border border-emerald-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {T(`المحلل: ${analystLabel} (استرشادي لغرفة العمليات)`, `AI Analyst: ${analystLabel} (Advisory)`)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. كروت الإحصاءات السريعة (KPIs) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-surface p-4 rounded-2xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">{T('المواقع المغطاة', 'Monitored Locations')}</p>
            <h4 className="text-2xl font-black text-[var(--ink)] mt-1">{kpiTotalLocations}</h4>
            <p className="text-[10px] text-[var(--faint)] mt-0.5">{T('جميع المواقع النشطة', 'All active locations')}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center text-xl font-black">📍</div>
        </div>
        <div className="card-surface p-4 rounded-2xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">{T('إشارات المخاطر المرصودة', 'Detected Hazard Alerts')}</p>
            <h4 className={`text-2xl font-black mt-1 ${kpiHazardsCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{kpiHazardsCount}</h4>
            <p className="text-[10px] text-[var(--faint)] mt-0.5">{kpiHazardsCount > 0 ? T('تتطلب متابعة تشغيلية', 'Requires monitoring') : T('لا توجد مخاطر استثنائية', 'No extreme hazards')}</p>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl font-black ${kpiHazardsCount > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>⚠️</div>
        </div>
        <div className="card-surface p-4 rounded-2xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">{T('حالات الشذوذ الإحصائي', 'Statistical Anomalies')}</p>
            <h4 className={`text-2xl font-black mt-1 ${kpiAnomaliesCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{kpiAnomaliesCount}</h4>
            <p className="text-[10px] text-[var(--faint)] mt-0.5">{T('انحراف عن النطاق المعتاد (P25-P75)', 'Deviation from P25-P75')}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center text-xl font-black">📈</div>
        </div>
        <div className="card-surface p-4 rounded-2xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">{T('حالة التحليل الذكي', 'AI Assessment Status')}</p>
            <h4 className="text-2xl font-black text-purple-400 mt-1">{kpiAiSuccessCount}/{kpiTotalLocations}</h4>
            <p className="text-[10px] text-[var(--faint)] mt-0.5">{analystLabel}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center text-xl font-black">🤖</div>
        </div>
      </div>

      {/* 4. حالة API المرئية مع الاحتفاظ بالبيانات التي تم جلبها بنجاح */}
      {apiError && !isLoading && (
        <div role="alert" className="card-surface rounded-3xl border border-red-500/40 bg-red-950/20 p-4 md:p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-9 h-9 shrink-0 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 flex items-center justify-center font-bold">!</div>
              <div className="min-w-0">
                <h3 className="text-sm md:text-base font-extrabold text-red-300">
                  {apiPartial
                    ? T('تم تحميل جزء من البيانات', 'Some data loaded')
                    : T('تعذر تحميل بيانات استخبارات الطقس', 'Weather Intelligence data could not be loaded')}
                </h3>
                <p className="text-xs text-red-200/90 mt-1 break-words" dir={isAr ? 'rtl' : 'ltr'}>{apiError}</p>
                {apiPartial && (
                  <p className="text-[11px] text-[var(--muted)] mt-1.5">
                    {T('تظل البطاقات والبيانات التي تم جلبها بنجاح ظاهرة أدناه.', 'Data loaded from successful endpoints remains visible below.')}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={fetchWeatherIntelData}
              disabled={isLoading}
              className="ops-btn shrink-0 bg-red-600 text-white hover:bg-red-500 px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              {T('إعادة المحاولة', 'Retry')}
            </button>
          </div>
        </div>
      )}

      {/* 5. كروت المواقع التفصيلية */}
      {isLoading ? (
        <div className="card-surface p-12 text-center rounded-3xl border border-[var(--border)]">
          <div className="inline-block w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
          <h3 className="text-lg font-bold text-[var(--ink)]">{T('جارٍ استرجاع وتحليل استخبارات الطقس...', 'Loading Weather Intelligence Data...')}</h3>
          <p className="text-xs text-[var(--muted)] mt-1">{T('جلب التوقعات والخط المرجعي والتقييمات التشغيلية', 'Fetching forecasts, historical baselines & operational assessments')}</p>
        </div>
      ) : apiError && !apiPartial ? null : filteredAssessments.length === 0 ? (
        <div className="card-surface p-12 text-center rounded-3xl border border-[var(--border)]">
          <div className="text-4xl mb-3">🌤️</div>
          <h3 className="text-lg font-bold text-[var(--ink)]">{T('لا توجد بيانات استخبارات طقس مسجلة لهذا التاريخ', 'No Weather Intelligence Data for this Date')}</h3>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-md mx-auto">
            {T('لم يتم العثور على تشغيل يومي مسجل لهذا التاريخ. يمكنك تشغيل التحليل يدويًا عبر زر "تشغيل التحليل الآن" أو اختيار تاريخ آخر.', 'No daily run found for this date. You can manually trigger an analysis or select another date.')}
          </p>
          {isOwner && (
            <button type="button" onClick={handleTriggerRun} disabled={isTriggering} className="mt-5 ops-btn bg-[var(--accent)] text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md inline-flex items-center gap-2">
              ⚡ {T('تشغيل التحليل الآن', 'Run Analysis Now')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {filteredAssessments.map(item => {
            const locId = item.location_id;
            const fc = item.forecast || {};
            const stats = item.statistics || [];
            const freqs = item.frequencies || [];
            const latestObservedDate = currentRun?.latest_observed_date || '';
            const assessmentAnalystLabel = getAnalystLabel({
              ai_provider: item.ai_provider || currentRun?.source_meta?.ai_provider,
              ai_model: item.ai_model || currentRun?.source_meta?.ai_model,
            }, '', item.ai_status);
            const hazards = item.hazards || [];
            const anomalies = item.anomalies || {};
            const aiJson = item.ai_assessment_json;

            return (
              <div key={item.id || locId} className="card-surface rounded-3xl border border-[var(--border)] overflow-hidden shadow-sm transition-all hover:shadow-md">
                {/* رأس كارت الموقع */}
                <div className="bg-gradient-to-r from-[var(--surface-2)] via-[var(--surface-3)] to-[var(--surface-2)] p-4 md:p-6 border-b border-[var(--border)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] flex items-center justify-center text-xl font-bold shadow-inner">📍</div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xl font-extrabold text-[var(--ink)]">{isAr ? item.location_name_ar : (item.location_name_en || item.location_name_ar)}</h3>
                        {item.region && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--muted)] border border-[var(--border)]">{item.region}</span>}
                        <span className="text-[11px] font-mono text-[var(--faint)]" dir="ltr">[{formatCoordinate(item.latitude)}°, {formatCoordinate(item.longitude)}°]</span>
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{T('التاريخ المستهدف:', 'Target Date:')} <strong className="text-[var(--ink)]">{item.target_date}</strong></span>
                        <span>{T('تاريخ التنبؤ:', 'Forecast Date:')} <strong className="text-[var(--ink)]">{fc.forecast_date || '—'}</strong></span>
                        <span>{T('آخر تاريخ مرصود:', 'Latest Observed Date:')} <strong className="text-[var(--ink)]">{latestObservedDate || '—'}</strong></span>
                        {fc.fetched_at && <span className="text-[11px] text-[var(--faint)]">({T('تم الجلب:', 'Fetched:')} {new Date(fc.fetched_at).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })})</span>}
                      </p>
                    </div>
                  </div>

                  {/* شارات المخاطر إن وُجدت */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {hazards.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-emerald-950/40 text-emerald-300 border border-emerald-800/60">✅ {T('المؤشرات ضمن الحدود الآمنة', 'Safe Weather Range')}</span>
                    ) : (
                      hazards.map((hz, hzIndex) => {
                        const hazardCode = safeText(hz.code).trim();
                        const hzInfo = HAZARD_DICT[hazardCode.toLowerCase()] || null;
                        const hazardTitle = safeText(isAr ? hz.title_ar : (hz.title_en || hz.title_ar))
                          || (isAr ? hzInfo?.ar : hzInfo?.en)
                          || hazardCode
                          || (isAr ? 'مؤشر طقس' : 'Weather indicator');
                        const hazardDetail = safeText(isAr ? hz.detail_ar : (hz.detail_en || hz.detail_ar));
                        const hazardLevel = safeText(hz.level);
                        const hazardUnit = safeText(hz.unit);
                        const levelClass = ['high', 'critical', 'extreme'].includes(hazardLevel.toLowerCase())
                          ? 'bg-red-950/60 text-red-300 border-red-700/60'
                          : ['medium', 'moderate'].includes(hazardLevel.toLowerCase())
                            ? 'bg-amber-950/50 text-amber-300 border-amber-700/50'
                            : 'bg-cyan-950/50 text-cyan-300 border-cyan-700/50';
                        return (
                          <span key={`${hazardCode || 'hazard'}-${hzIndex}`} className={`inline-flex max-w-xs flex-col items-start gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-bold border shadow-sm ${hzInfo?.color || levelClass}`} title={hazardDetail || undefined}>
                            <span className="flex items-center gap-1.5">
                              <span className="truncate">{hazardTitle}</span>
                              {(hazardLevel || hazardUnit) && (
                                <span className="shrink-0 font-mono opacity-85">{[hazardLevel, hazardUnit].filter(Boolean).join(' ')}</span>
                              )}
                            </span>
                            {hazardDetail && <span className="w-full truncate font-normal opacity-80">{hazardDetail}</span>}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="p-4 md:p-6 space-y-6">
                  {/* أ) بلاطات التوقعات المرصودة (Forecast Tiles) */}
                  <div>
                    <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-3 flex items-center gap-1.5">🌤️ {T('التوقعات المرصودة ليوم الغد (Open-Meteo Forecast)', 'Next-Day Forecast Observations (Open-Meteo)')}</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      <div className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)]">
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1"><span>{T('درجة الحرارة', 'Temperature')}</span><span>🌡️</span></div>
                        <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-red-400">{fc.tmax ?? '—'}°</span><span className="text-xs font-bold text-blue-400">/ {fc.tmin ?? '—'}°C</span></div>
                        <p className="text-[10px] text-[var(--faint)] mt-1">{T('عظمى / صغرى', 'Max / Min')}</p>
                      </div>
                      <div className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)]">
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1"><span>{T('الهطول المطري', 'Precipitation')}</span><span>🌧️</span></div>
                        <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-cyan-400">{fc.precip_mm ?? 0}</span><span className="text-xs font-bold text-[var(--muted)]">{isAr ? 'مم' : 'mm'}</span></div>
                        <p className="text-[10px] text-[var(--faint)] mt-1">{T('الاحتمالية:', 'Probability:')} {fc.precip_prob_pct ?? 0}%</p>
                      </div>
                      <div className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)]">
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1"><span>{T('سرعة الرياح', 'Wind Speed')}</span><span>💨</span></div>
                        <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-amber-400">{fc.wind_max_kph ?? '—'}</span><span className="text-xs font-bold text-[var(--muted)]">{isAr ? 'كم/س' : 'km/h'}</span></div>
                        <p className="text-[10px] text-[var(--faint)] mt-1">{T('الهبات:', 'Gusts:')} {fc.wind_gusts_kph ?? '—'} {isAr ? 'كم/س' : 'km/h'}</p>
                      </div>
                      <div className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)]">
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1"><span>{T('الرطوبة النسبية', 'Humidity')}</span><span>💧</span></div>
                        <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-indigo-400">{fc.humidity_mean_pct ?? '—'}%</span></div>
                        <p className="text-[10px] text-[var(--faint)] mt-1">{fc.humidity_mean_pct >= 75 ? <span className="text-amber-400 font-bold">{T('رطوبة جوية مرتفعة', 'High Humidity')}</span> : T('متوسط اليوم', 'Daily mean')}</p>
                      </div>
                      <div className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)] col-span-2 sm:col-span-1">
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1"><span>{T('حالة السماء', 'Sky Condition')}</span><span>☁️</span></div>
                        <div className="text-sm font-black text-[var(--ink)] truncate">{getWmoDescription(fc.weather_code)}</div>
                        <p className="text-[10px] text-[var(--faint)] mt-1">{T('الغيوم:', 'Clouds:')} {fc.cloud_cover_mean_pct ?? 0}%</p>
                      </div>
                    </div>
                  </div>

                  {/* ب) الخط المرجعي التاريخي وتحليل الشذوذ (ERA5 Baseline & Statistics) */}
                  <div>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-1.5">📊 {T('الخط المرجعي التاريخي لـ 30 عاماً وشذوذ التوقعات (ERA5 Reanalysis)', '30-Year Historical Baseline & Anomalies (ERA5)')}</h4>
                      <span className="text-[11px] text-[var(--faint)] bg-[var(--surface-2)] px-2.5 py-0.5 rounded-full border border-[var(--border)]">{T('نافذة ±3 أيام حول التاريخ عبر 1996–2026', '±3-day window across 1996–2026')}</span>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
                      <table className="w-full text-right text-xs whitespace-nowrap">
                        <thead className="bg-[var(--surface-2)] text-[var(--muted)] font-bold border-b border-[var(--border)]">
                          <tr>
                            <th className="p-3">{T('المتغير', 'Metric')}</th>
                            <th className="p-3 text-center">{T('قيمة الغد', 'Forecast')}</th>
                            <th className="p-3 text-center">{T('المتوسط ± σ', 'Mean ± σ')}</th>
                            <th className="p-3 text-center">{T('الوسيط', 'Median')}</th>
                            <th className="p-3 text-center">{T('P25 – P75', 'P25 – P75')}</th>
                            <th className="p-3 text-center">{T('P10 / P90', 'P10 / P90')}</th>
                            <th className="p-3 text-center">{T('Min / Max', 'Min / Max')}</th>
                            <th className="p-3 text-center">{T('N', 'N')}</th>
                            <th className="p-3 text-center">{T('تصنيف الشذوذ', 'Anomaly')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {stats.length === 0 ? (
                            <tr><td colSpan={9} className="p-4 text-center text-[var(--muted)]">{T('لا توجد بيانات خط مرجعي تاريخي مسجلة.', 'No baseline stats available.')}</td></tr>
                          ) : (
                            stats.map(s => {
                              const metricInfo = METRIC_DICT[s.metric] || { ar: s.metric, en: s.metric, unit: '' };
                              const forecastVal = fc[s.metric];
                              const anomClass = anomalies[s.metric]?.category || anomalies[s.metric]?.class || 'normal';
                              const anomBadge = ANOMALY_DICT[anomClass] || ANOMALY_DICT.normal;
                              const isRecordBreak = (s.max !== null && forecastVal != null && forecastVal > s.max) || (s.min !== null && forecastVal != null && forecastVal < s.min);

                              return (
                                <tr key={s.metric} className="hover:bg-[var(--surface-2)]/50 transition-colors">
                                  <td className="p-3 font-bold text-[var(--ink)]">{isAr ? metricInfo.ar : metricInfo.en}</td>
                                  <td className="p-3 text-center font-black text-sm text-[var(--accent)]">{forecastVal != null ? `${forecastVal} ${metricInfo.unit}` : '—'}</td>
                                  <td className="p-3 text-center font-mono text-[var(--ink)]" dir="ltr">{s.mean ?? '—'} {s.stddev ? `± ${s.stddev}` : ''}</td>
                                  <td className="p-3 text-center font-mono text-[var(--muted)]" dir="ltr">{s.median ?? '—'}</td>
                                  <td className="p-3 text-center font-mono text-emerald-400" dir="ltr">{s.p25 != null && s.p75 != null ? `[${s.p25} – ${s.p75}]` : '—'}</td>
                                  <td className="p-3 text-center font-mono text-amber-400" dir="ltr">{s.p10 != null && s.p90 != null ? `${s.p10} / ${s.p90}` : '—'}</td>
                                  <td className="p-3 text-center font-mono text-blue-300" dir="ltr">{s.min != null && s.max != null ? `${s.min} .. ${s.max}` : '—'}</td>
                                  <td className="p-3 text-center font-mono text-[var(--muted)]">{s.sample_count < 20 ? <span className="text-red-400 font-bold">{s.sample_count} ⚠️</span> : <span className="text-zinc-400">{s.sample_count}</span>}</td>
                                  <td className="p-3 text-center">
                                    <div className="flex items-center justify-center gap-1 flex-wrap">
                                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${anomBadge.style}`}>{isAr ? anomBadge.ar : anomBadge.en}</span>
                                      {isRecordBreak && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-600 text-white animate-pulse">{T('رقم قياسي!', 'Record!')}</span>}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ج) تكرارات العتبات التاريخية (Threshold Frequencies) */}
                  {freqs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">🎯 {T('احتماليات وتكرار العتبات التاريخية (Historical Frequencies)', 'Historical Threshold Frequencies')}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                        {freqs.map((f, fIdx) => (
                          <div key={fIdx} className="bg-[var(--surface-2)] p-3 rounded-2xl border border-[var(--border)] flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                              <span className="font-bold text-[var(--ink)]">{f.threshold_desc_ar}</span>
                              <span className="font-mono text-[11px] bg-[var(--surface-3)] px-1.5 py-0.5 rounded text-[var(--faint)]">{f.threshold_value} {f.threshold_unit}</span>
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-base font-black text-[var(--accent)] font-mono">{f.frequency_pct}%</span>
                              <span className="text-[11px] text-[var(--muted)] font-mono" dir="ltr">({f.qualifying_count} / {f.total_count})</span>
                            </div>
                            <div className="w-full bg-[var(--surface-3)] h-1.5 rounded-full mt-2 overflow-hidden">
                              <div className="bg-[var(--accent)] h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(f.frequency_pct, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* د) التقييم التشغيلي للذكاء الاصطناعي (AI Operational Assessment) */}
                  <div className="bg-gradient-to-br from-purple-950/20 via-[var(--surface-2)] to-indigo-950/20 rounded-2xl border border-purple-800/40 p-4 md:p-6 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2 border-b border-purple-800/30 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center justify-center font-black">🤖</div>
                        <div>
                          <h4 className="text-sm font-extrabold text-[var(--ink)] flex items-center gap-2">{T('التقييم التشغيلي لغرفة العمليات', 'EOC Operational Weather Assessment')}</h4>
                          <p className="text-[10px] text-[var(--muted)]">{T('تحليل آلي استرشادي مبني على الأدلة دون تكهنات', 'Evidence-based AI assessment with strict operational guidance')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono bg-purple-900/40 text-purple-300 border border-purple-700/50 px-2.5 py-0.5 rounded-full">{assessmentAnalystLabel}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.ai_status === 'success' ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50' : item.ai_status === 'skipped' ? 'bg-amber-950/40 text-amber-300 border border-amber-700/50' : 'bg-red-900/40 text-red-300 border border-red-700/50'}`}>
                          {item.ai_status === 'success' ? T('مكتمل بنجاح', 'Generated') : item.ai_status === 'skipped' ? T('مُتخطى', 'Skipped') : T('تعذر التوليد', 'Failed')}
                        </span>
                      </div>
                    </div>

                    {item.ai_status === 'error' ? (
                      <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-4 text-xs text-red-300 flex items-start gap-2.5">
                        <span className="text-base">⚠️</span>
                        <div>
                          <p className="font-bold">{T('تعذر توليد التقييم الذكي لهذا الموقع في هذا التشغيل.', 'AI operational assessment could not be generated for this location.')}</p>
                          <p className="text-[11px] text-red-400 mt-0.5">{item.ai_error || T('يرجى الاعتماد على الإحصاءات والجداول الرقمية المباشرة أعلاه.', 'Please rely on the numerical statistics and baseline tables above.')}</p>
                        </div>
                      </div>
                    ) : item.ai_status === 'skipped' ? (
                      <div className="bg-amber-950/25 border border-amber-800/35 rounded-xl p-4 text-xs text-amber-300 flex items-start gap-2.5">
                        <span className="text-base">ℹ️</span>
                        <div>
                          <p className="font-bold">{T('لم يُطلب توليد تقييم ذكي لهذا الموقع في هذا التشغيل.', 'AI operational assessment was not requested for this location.')}</p>
                          <p className="text-[11px] text-amber-400 mt-0.5">{T('النتائج الحتمية والإحصاءات الرقمية المباشرة أعلاه مكتملة.', 'Deterministic results and direct numerical statistics above remain available.')}</p>
                        </div>
                      </div>
                    ) : !aiJson ? (
                      <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-4 text-xs text-red-300 flex items-start gap-2.5">
                        <span className="text-base">⚠️</span>
                        <div>
                          <p className="font-bold">{T('تعذر توليد التقييم الذكي لهذا الموقع في هذا التشغيل.', 'AI operational assessment could not be generated for this location.')}</p>
                          <p className="text-[11px] text-red-400 mt-0.5">{item.ai_error || T('يرجى الاعتماد على الإحصاءات والجداول الرقمية المباشرة أعلاه.', 'Please rely on the numerical statistics and baseline tables above.')}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="bg-[var(--surface-1)]/70 p-3.5 rounded-xl border border-purple-800/20">
                          <h5 className="font-bold text-purple-300 mb-1.5 flex items-center gap-1.5 text-xs">🌤️ {T('1. ملخص الأحوال الجوية المتوقعة', '1. Weather Summary')}</h5>
                          <p className="text-[var(--ink)] leading-relaxed text-[11px]">{renderFormattedAIText(aiJson.weather_summary)}</p>
                        </div>
                        <div className="bg-[var(--surface-1)]/70 p-3.5 rounded-xl border border-purple-800/20">
                          <h5 className="font-bold text-blue-300 mb-1.5 flex items-center gap-1.5 text-xs">🏛️ {T('2. المقارنة بالسياق التاريخي', '2. Historical Context Comparison')}</h5>
                          <p className="text-[var(--ink)] leading-relaxed text-[11px]">{renderFormattedAIText(aiJson.historical_comparison)}</p>
                        </div>
                        <div className="bg-[var(--surface-1)]/70 p-3.5 rounded-xl border border-purple-800/20">
                          <h5 className="font-bold text-amber-300 mb-1.5 flex items-center gap-1.5 text-xs">📈 {T('3. الشذوذ الإحصائي البارز', '3. Significant Statistical Anomalies')}</h5>
                          <p className="text-[var(--ink)] leading-relaxed text-[11px]">{renderFormattedAIText(aiJson.significant_anomalies)}</p>
                        </div>
                        <div className="bg-[var(--surface-1)]/70 p-3.5 rounded-xl border border-purple-800/20">
                          <h5 className="font-bold text-red-300 mb-1.5 flex items-center gap-1.5 text-xs">🚨 {T('4. الآثار والتبعات التشغيلية', '4. Operational Implications')}</h5>
                          <p className="text-[var(--ink)] leading-relaxed text-[11px]">{renderFormattedAIText(aiJson.operational_implications)}</p>
                        </div>
                        <div className="bg-[var(--surface-1)]/70 p-3.5 rounded-xl border border-purple-800/20 md:col-span-2">
                          <h5 className="font-bold text-emerald-300 mb-1.5 flex items-center gap-1.5 text-xs">📋 {T('5. توصيات المتابعة الميدانية', '5. Recommended Field Monitoring')}</h5>
                          <p className="text-[var(--ink)] leading-relaxed text-[11px]">{renderFormattedAIText(aiJson.recommended_monitoring)}</p>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 text-[10px] text-[var(--faint)] border-t border-purple-800/20">
                      {T('إخلاء مسؤولية: هذا التحليل أداة مساعدة رقمية لغرفة العمليات ولا يحل محل التحذيرات الرسمية للهيئة العامة للأرصاد الجوية.', 'Disclaimer: This analysis is an operational advisory tool and does not replace official meteorological warnings.')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. نافذة سجل التشغيلات التاريخية (Runs History Modal) */}
      {showRunsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-3xl rounded-3xl border border-[var(--border)] overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <div className="p-4 md:p-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
              <div className="flex items-center gap-2.5"><span className="text-xl">📜</span><h3 className="text-lg font-bold text-[var(--ink)]">{T('سجل تشغيلات استخبارات الطقس الأخيرة', 'Recent Weather Intelligence Runs')}</h3></div>
              <button type="button" onClick={() => setShowRunsModal(false)} className="w-8 h-8 rounded-full bg-[var(--surface-3)] text-[var(--muted)] hover:text-[var(--ink)] flex items-center justify-center font-bold">✕</button>
            </div>
            <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-3">
              {runsHistory.length === 0 ? (
                <p className="text-center text-xs text-[var(--muted)] py-8">{T('لا توجد تشغيلات مسجلة.', 'No past runs recorded.')}</p>
              ) : runsHistory.map(r => (
                <div key={r.id} className="p-3.5 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-[var(--ink)]">{T('التاريخ المستهدف:', 'Target:')} {r.target_date}</strong>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'success' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/60' : r.status === 'partial' ? 'bg-amber-950/60 text-amber-300 border border-amber-700/60' : 'bg-red-950/60 text-red-300 border border-red-700/60'}`}>{r.status}</span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] mt-1">{T('تاريخ التشغيل:', 'Run at:')} {r.run_date}</p>
                    <p className="text-[11px] text-[var(--muted)]">{T('تاريخ التنبؤ:', 'Forecast Date:')} {r.forecast_date || '—'} | {T('آخر تاريخ مرصود:', 'Latest Observed Date:')} {r.latest_observed_date || '—'}</p>
                    <p className="text-[11px] text-[var(--muted)]">{T('الناجحة:', 'OK:')} {r.successful_locations}/{r.total_locations}</p>
                  </div>
                  <button type="button" onClick={() => { setTargetDate(r.target_date); setShowRunsModal(false); }} className="ops-btn bg-[var(--accent)] text-white px-3 py-1.5 rounded-xl font-bold text-xs">{T('عرض التقرير', 'View Report')}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. نافذة العتبات الفنية والإعدادات (Config Modal) */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-surface w-full max-w-2xl rounded-3xl border border-[var(--border)] overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <div className="p-4 md:p-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚙️</span>
                <div>
                  <h3 className="text-lg font-bold text-[var(--ink)]">{T('العتبات الفنية وإعدادات المخاطر', 'Technical Hazard Thresholds')}</h3>
                  <p className="text-xs text-[var(--muted)]">{T('قيم فنية افتراضية قابلة للتعديل — ليست عتبات رسمية ملزمة', 'Configurable defaults — not official thresholds')}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowConfigModal(false)} className="w-8 h-8 rounded-full bg-[var(--surface-3)] text-[var(--muted)] hover:text-[var(--ink)] flex items-center justify-center font-bold">✕</button>
            </div>
            <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-3">
              {Object.keys(intelConfig).length === 0 ? (
                <p className="text-center text-xs text-[var(--muted)] py-8">{T('جاري تحميل الإعدادات...', 'Loading config...')}</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(intelConfig).map(([key, item]) => (
                    <div key={key} className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-mono text-purple-300 font-bold">{key}</div>
                        <div className="text-[11px] text-[var(--muted)] mt-0.5">{item.description_ar}</div>
                      </div>
                      <span className="font-mono text-base font-black text-amber-400 bg-[var(--surface-3)] px-2.5 py-1 rounded-lg border border-[var(--border)]">{item.value} {item.unit || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
const WeatherIcon = (props) => <svg {...props} className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-2.4-8.3 5.5 5.5 0 0 0-10.2 2.6A3.7 3.7 0 0 0 7 19h10.5Z"/><path d="M12 3v2M5 6l1.4 1.4M19 6l-1.4 1.4"/></svg>;
const WeatherIntelIcon = (props) => <svg {...props} className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-2.4-8.3 5.5 5.5 0 0 0-10.2 2.6A3.7 3.7 0 0 0 7 19h10.5Z"/><path d="M12 3v2M5 6l1.4 1.4M19 6l-1.4 1.4"/><circle cx="18" cy="18" r="3" fill="currentColor" fillOpacity="0.25"/><path d="M18 16.5v3M16.5 18h3"/></svg>;
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
function AINewsMonitorView({ branches, isOwner, lang = 'ar', focusTarget = null }) {
  const getLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const getMonthName = (dateStr) => {
    if (!dateStr) return '';
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const iso = String(dateStr).split('T')[0].split('-');
    if (iso.length === 3 && iso[0].length === 4) return months[Number(iso[1]) - 1] || '';
    const dmy = String(dateStr).split('/');
    if (dmy.length === 3) return months[Number(dmy[1]) - 1] || '';
    return months[new Date(dateStr).getMonth()] || '';
  };

  const [aiNewsList, setAiNewsList] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterDate, setFilterDate] = useState(getLocalDate());
  const [customAlert, setCustomAlert] = useState(null);
  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);
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
            const formattedTime = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            const dayStr = isToday ? 'اليوم' : formatDateTime(`${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`);
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
        const token = sessionStorage.getItem('access_token');
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

  const [focusedRowId, setFocusedRowId] = useState(null);
  useEffect(() => {
    if (!focusTarget || focusTarget.tab !== 'ai_news' || focusTarget.id == null) return;
    const id = focusTarget.id;
    const start = Date.now();
    const iv = window.setInterval(() => {
      const el = document.getElementById(`focus-row-${id}`);
      if (el) {
        window.requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        setFocusedRowId(id);
        window.setTimeout(() => setFocusedRowId(null), 2600);
        window.clearInterval(iv);
      } else if (Date.now() - start > 8000) { window.clearInterval(iv); }
    }, 100);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  const handleEdit = (n) => { setForm({...n}); setIsModalOpen(true); };

  const handleExportAllExcel = async () => {
    if (aiNewsList.length === 0) return setCustomAlert("لا يوجد داتا لتصديرها.");
    const aiNewsRows = aiNewsList.map(n => ({
      "التاريخ": formatDateTime(n.incident_date), "الشهر": getMonthName(n.incident_date) || '', "وصف الحادث": n.incident_description || '', "نوع الخبر": n.news_type || '', "ناشر الخبر": n.news_publisher || '',
      "المحافظة": n.governorate || '', "اسم المستشفى": n.hospital_name || '', "عدد المصابين": n.injured_count || 0, "عدد الوفيات": n.deaths_count || 0,
      "تطورات الخبر (التقرير)": n.news_updates || '', "لينك الخبر": n.news_link || ''
    }));
    try { await exportWorkbook([{ name: 'سجل الرصد الآلي', ...gridFromRows(aiNewsRows) }], `سجل_الذكاء_الاصطناعي_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
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
      const token = sessionStorage.getItem('access_token');
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
      const token = sessionStorage.getItem('access_token');
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
      const token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");

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
      <div className="bg-[var(--surface-4)] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)] animate-fade-in-up flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><AIIcon className="text-purple-500 animate-pulse"/> استخبارات الذكاء الاصطناعي (OSINT God-Mode)</h3>
          <p className="text-[var(--muted-2)] text-sm mt-2">رصد تكتيكي حي وتحليل استراتيجي من السوشيال ميديا والمواقع الإخبارية.</p>
        </div>
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3 flex items-center gap-4 shadow-inner shrink-0 flex-wrap md:flex-nowrap w-full md:w-auto">
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ok)] opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--ok)]"></span></span>
              <span className="text-xs font-bold text-green-400">الروبوت نشط (دوريات المسح تعمل)</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 border-t border-[var(--border)] pt-1">
              <svg className="w-3 h-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-[10px] text-[var(--muted-2)] font-mono font-bold tracking-wider">آخر فحص: {lastRunTime}</span>
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
        <div className="bg-[var(--surface-2)] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between">

            <div>
              <p className="text-[var(--muted-2)] text-sm font-bold">
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
        <div className="bg-[var(--surface-2)] border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between">

            <div>
              <p className="text-[var(--muted-2)] text-sm font-bold">
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

      <div className="bg-[var(--surface-2)] border border-purple-500/30 rounded-3xl p-4 md:p-6 shadow-[0_0_20px_rgba(168,85,247,0.1)] relative z-0 h-auto md:h-[450px] animate-fade-in-up">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><MapIcon/> خريطة الرصد اللحظي للذكاء الاصطناعي</h3>
          {selectedAiNewsId && (
            <button onClick={() => setSelectedAiNewsId(null)} className="bg-[var(--surface-4)] hover:bg-purple-600 text-purple-400 hover:text-white border border-purple-500/30 px-3 py-1 rounded-lg text-xs font-bold transition-all">
              إلغاء الفلترة (عرض كل الأخبار)
            </button>
          )}
        </div>
        <div className="h-[300px] md:h-[350px] w-full rounded-2xl overflow-hidden border border-[var(--border)] relative">
          <MapContainer center={[26.8206, 30.8025]} zoom={5} scrollWheelZoom={true} keyboard={false} style={{ height: '100%', width: '100%' }}>
            <ThemedTileLayer />
            
            {filteredNews.map(news => {
              const aiData = extractAiData(news.news_updates);
              if (!aiData) return null; // لو مفيش إحداثيات، مش هيترسم

              return (
                <Marker keyboard={false} key={`ai-map-${news.id}`} position={[aiData.lat, aiData.lng]} icon={aiIncidentIcon} eventHandlers={{ click: () => { setSelectedAiNewsId(prev => prev === news.id ? null : news.id); const container = document.getElementById('main-scroll-container'); const target = document.getElementById('ai-table-section'); if (container && target) container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' }); } }}>
                  <Tooltip direction="top">
                    <div className="text-center w-48">
                      {aiData.severity && <strong className="text-red-600 block mb-1">🔥 خطورة: {aiData.severity}/10</strong>}
                      <strong className="text-purple-700 block mb-1">{news.news_type}</strong>
                      <span className="text-xs text-[var(--ink-2)] font-bold line-clamp-2">{news.incident_description}</span>
                      {aiData.img && aiData.img !== 'لا توجد صورة' && <img src={aiData.img} alt="حادث" className="w-full h-20 object-cover mt-2 rounded border border-[var(--border)]" />}
                      <span className="text-[10px] text-blue-600 block mt-2 font-bold">انقر لفلترة الجدول</span>
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div id="ai-table-section" className="bg-[var(--surface-2)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-lg flex flex-col h-[600px] scroll-mt-6">
        <div className="p-6 border-b border-[var(--border)] bg-[var(--surface-4)] flex flex-col lg:flex-row justify-between items-center gap-4 z-10">
          <div className="flex items-center gap-2">
            <SegDateField value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="bg-[var(--surface-3)] border border-purple-500/30 rounded-xl px-3 py-1.5 text-sm text-white outline-none cursor-pointer" />
            {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-purple-400 hover:text-white bg-purple-500/10 px-2 py-2 rounded-lg">الكل</button>}
          </div>
          <div className="flex flex-wrap gap-3">
            {isOwner && (
              <>
                <button onClick={handleExportAllExcel} className="bg-[var(--surface-3)] text-purple-400 border border-purple-500/30 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-4)] shrink-0 justify-center"><ExcelIcon /> تصدير السجل</button>
                <button onClick={handleManualScanTrigger} disabled={isScanning} className={`px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0 justify-center transition-all ${isScanning ? 'bg-purple-600/50 text-white cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'}`}>
                  {isScanning ? <><svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> جاري المسح...</> : <><AIIcon className="w-4 h-4"/> إطلاق الرادار</>}
                </button>
              </>
            )}
          </div>
        </div>

        {isOwner && (
          <button
            type="button"
            onClick={handleClearAllAINews}
            data-tip={lang === 'ar' ? 'مسح جميع أخبار الرادار نهائيًا' : 'Clear all radar news — irreversible'}
            className="action-btn action-btn--danger shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            <span className="hidden md:inline">{lang === 'ar' ? 'مسح الكل' : 'Clear all'}</span>
          </button>
        )}

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap min-w-[760px] text-sm">
            <thead className="sticky top-0 z-20 bg-[var(--surface-3)] text-[var(--muted-2)] border-b border-purple-500/30">
              <tr>
                <th className="p-4 font-semibold border-l border-[var(--border)]">التاريخ</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-purple-400">نوع الخبر</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">المحافظة</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] max-w-[250px]">وصف الحادث</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">الناشر</th>
                <th className="px-2 py-3 font-bold whitespace-nowrap sticky-end-col z-30 text-center bg-[var(--surface-3)] border-b-2 border-b-[var(--accent)]/50">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tableNews.length > 0 ? tableNews.map(n => {
                 const aiData = extractAiData(n.news_updates);
                 return (
                <tr key={n.id} id={`focus-row-${n.id}`} className={`group hover:bg-[var(--surface-hover)]${String(focusedRowId) === String(n.id) ? ' focus-row' : ''}`}>
                  <td data-label="التاريخ" className="p-4 text-white border-l border-[var(--border)] font-mono">{formatDateTime(n.incident_date)}</td>
                  <td data-label="نوع الخبر" className="p-4 text-purple-400 border-l border-[var(--border)] font-bold">
                    {n.news_type}
                    {aiData && aiData.severity && <span className="block mt-1 bg-[var(--danger-soft)] text-[var(--accent)] px-2 py-0.5 rounded text-[10px] w-max">خطورة: {aiData.severity}/10</span>}
                  </td>
                  <td data-label="المحافظة" className="p-4 text-[var(--ink-2)] border-l border-[var(--border)]">{n.governorate}</td>
                  <td data-label="وصف الحادث" className="p-4 text-[var(--muted-2)] border-l border-[var(--border)] min-w-[200px] max-w-[400px] whitespace-normal leading-7">
                      {n.incident_description || 'لا يوجد وصف'}
                  </td>
                  <td data-label="الناشر" className="p-4 text-[var(--faint)] border-l border-[var(--border)] text-xs">{n.news_publisher}</td>
                  <td data-label="الإجراءات" className="px-2 py-3 sticky end-0 z-10 sticky-end-col align-middle border-b border-[var(--border)]/60 bg-[var(--surface)] group-hover:bg-[var(--surface-2)]">
                    <div className="flex justify-center gap-1.5">
                      {n.news_link && (
                        <a href={n.news_link} target="_blank" rel="noreferrer" className="icon-btn" title="فتح مصدر الخبر">
                          <GlobalWorldIcon />
                        </a>
                      )}
                      <button onClick={() => handleEdit(n)} className="icon-btn" title="قراءة التقرير الاستخباراتي">
                        <EyeIcon />
                      </button>
                      {isOwner && (
                        <button onClick={() => handleDeleteAiNews(n.id)} className="icon-btn icon-btn-danger" title="حذف السجل">
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
              }) : <tr><td colSpan="6" className="p-8 text-center text-[var(--faint)] font-bold">لا توجد أخبار مطابقة...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* مودال قراءة التقرير والتعديل */}
      {isModalOpen && (
        <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="bg-[var(--surface)] border border-purple-500/30 rounded-3xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col shadow-[0_0_50px_rgba(168,85,247,0.15)] animate-fade-in-up">
            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2"><AIIcon className="text-purple-500"/> التقرير الاستخباراتي (OSINT)</h2>
              <button
  onClick={() => setIsModalOpen(false)}
  className="touch-close bg-[var(--surface-4)] text-[var(--muted-2)] hover:text-[var(--accent)] p-2 rounded-xl"
  title="إغلاق الخبر"
  aria-label="إغلاق الخبر"
>
  <svg
    className="w-5 h-5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
</button>

            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              
              {/* عرض التقرير التكتيكي والصورة فوق */}
              <div className="bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface-3)] border border-purple-500/50 p-6 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.1)] flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                   <h3 className="text-purple-400 font-bold flex items-center gap-2 border-b border-[var(--border)] pb-2"><ShieldIcon/> التقرير الاستراتيجي الميداني</h3>
                   <div className="text-[var(--ink-2)] text-sm leading-loose whitespace-pre-wrap font-mono">
                     {form.news_updates || 'لا يوجد تقرير متاح لهذا الحدث.'}
                   </div>
                </div>
                {/* استخراج الصورة لعرضها */}
                {extractAiData(form.news_updates)?.img && extractAiData(form.news_updates)?.img !== 'لا توجد صورة' && (
                  <div className="w-full md:w-1/3 shrink-0">
                    <img src={extractAiData(form.news_updates).img} alt="صورة الحدث" className="w-full h-auto rounded-xl border border-[var(--border)] object-cover shadow-lg" />
                  </div>
                )}
              </div>

              <SectionCard title="تفاصيل الرصد" icon={<NewsIcon />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormGroup label="نوع الخبر"><StyledInput disabled value={form.news_type} className="text-purple-400 font-bold" /></FormGroup>
                  <FormGroup label="المحافظة (الفرع)"><StyledInput disabled value={form.governorate} /></FormGroup>
                  <FormGroup label="ناشر الخبر"><StyledInput disabled value={form.news_publisher} /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="وصف الحادث (الملخص)"><textarea readOnly value={form.incident_description} className="w-full bg-[var(--surface-4)] border border-[var(--border)] rounded-xl p-3 text-sm outline-none text-[var(--ink-2)]" rows="2"></textarea></FormGroup></div>
                  <FormGroup label="اسم المستشفى"><StyledInput readOnly value={form.hospital_name} /></FormGroup>
                  <FormGroup label="عدد المصابين"><StyledInput readOnly value={form.injured_count} className="text-[var(--data)] font-bold" /></FormGroup>
                  <FormGroup label="عدد الوفيات"><StyledInput readOnly value={form.deaths_count} className="text-[var(--accent)] font-bold" /></FormGroup>
                  <div className="md:col-span-3"><FormGroup label="لينك الخبر الأصلي"><a href={form.news_link} target="_blank" rel="noreferrer" className="block w-full bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-sm text-blue-400 hover:text-blue-300 truncate" dir="ltr">{form.news_link}</a></FormGroup></div>
                </div>
              </SectionCard>
            </div>
            
            <div className="p-4 md:p-5 border-t border-[var(--border)] bg-[var(--surface-2)] flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 shrink-0 rounded-b-3xl [&>button]:w-full md:[&>button]:w-auto [&_button]:justify-center">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 md:py-2.5 rounded-xl text-sm font-bold text-[var(--muted-2)] hover:bg-[var(--surface-hover)]">إغلاق التقرير</button>
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

      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
    </div>
  );
}

// 💡 نافذة تأكيد موحّدة لعمليات الحذف
// 📥 مُؤكِّد تنزيل سجل فردي — نافذة تأكيد محايدة وودّية بإطار وزر أخضر (var(--ok) — لون فعل التحميل):
//   زر «نعم» ينفّذ التنزيل فوراً، وزر «إلغاء» يُغلق النافذة فقط.
// 🍡 مودال تأكيد التنزيل — حبة عائمة موحّدة بالتصميم (بدون خلفية معتمة)
function DownloadConfirmModal({
  show,
  title = 'تنزيل السجل',
  message = 'هل تود تحميل هذا السجل الفردي ؟',
  onCancel,
  onConfirm,
  confirmLabel = 'نعم',
  cancelLabel = 'إلغاء',
}) {
  if (!show) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg bg-[var(--surface-3)] border border-[var(--accent)]/50 rounded-2xl p-5 shadow-xl animate-fade-in-up" style={{ boxShadow: '0 0 0 1px var(--accent-soft), 0 0 20px var(--accent-soft)' }}>
        {/* Header: checkmark + title + close ✕ */}
        <div className="flex items-center gap-3 mb-2">
          <svg className="w-6 h-6 shrink-0 text-[var(--ok)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          <span className="flex-1 text-base font-bold text-white">{title}</span>
          <button onClick={onCancel} className="shrink-0 text-[var(--muted)] hover:text-white text-lg leading-none font-bold" aria-label="إغلاق">✕</button>
        </div>
        {/* Message */}
        <p className="text-sm text-[var(--muted-2)] mb-4 pe-9 leading-relaxed">{message}</p>
        {/* Buttons row */}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--ink-2)] hover:bg-[var(--surface-hover)] border border-[var(--border)] transition-colors">{cancelLabel}</button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-[var(--ok)] hover:brightness-110 active:scale-[0.97] shadow-[0_8px_28px_-6px_color-mix(in_srgb,_var(--ok)_55%,_transparent)] transition-all">{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 🍡 مودال التأكيد الخطير — حبة عائمة موحّدة بالتصميم (بدون خلفية معتمة)
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
    const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    if (isProcessing) return;

    setIsProcessing(true);

    try {
      await onConfirm();
    } finally {
      setIsProcessing(false);
    }
  };

  if (!show) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg bg-[var(--surface-3)] border border-[var(--accent)]/50 rounded-2xl p-5 shadow-xl animate-fade-in-up" style={{ boxShadow: '0 0 0 1px var(--accent-soft), 0 0 20px var(--accent-soft)' }}>
        {/* Header: checkmark + title + close ✕ */}
        <div className="flex items-center gap-3 mb-2">
          <svg className="w-6 h-6 shrink-0 text-[var(--ok)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          <span className="flex-1 text-base font-bold text-white">{title}</span>
          <button
  onClick={() => !isProcessing && onCancel()}
  disabled={isProcessing}
  className="shrink-0 text-[var(--muted)] hover:text-white text-lg leading-none font-bold disabled:opacity-40 disabled:cursor-not-allowed"
  aria-label="إغلاق"
>
  ✕
</button>

        </div>
        {/* Message */}
        <p className="text-sm text-[var(--muted-2)] mb-4 pe-9 leading-relaxed">{message}</p>
        {/* Code input (if needed) */}
        {showConfirmationInput && (
          <div className="mb-4">
            <input
              type="password"
              value={confirmationCode}
              onChange={(e) => onConfirmationCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (
  e.key === 'Enter' &&
  !isProcessing &&
  !(showConfirmationInput && confirmationCode !== '301014')
) {
  handleConfirm();
}

              }}
              placeholder="أدخل رمز التأكيد"
              autoComplete="new-password"
              name="clear_all_confirmation"
              className="w-full bg-[var(--surface-4)] border border-[var(--border)] focus:border-[var(--accent)]/50 rounded-xl px-4 py-2.5 text-white text-center tracking-[0.35em] text-sm outline-none transition-colors"
            />
          </div>
        )}
        {/* Buttons row */}
        <div className="flex gap-3">
          <button
  onClick={() => !isProcessing && onCancel()}
  disabled={isProcessing}
  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--ink-2)] hover:bg-[var(--surface-hover)] border border-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
>
  إلغاء
</button>
          <button
  onClick={handleConfirm}
  disabled={
    isProcessing ||
    (showConfirmationInput && confirmationCode !== "301014")
  }
  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
    isProcessing ||
    (showConfirmationInput && confirmationCode !== "301014")
      ? "bg-[var(--surface-3)] text-[var(--muted-2)] cursor-not-allowed"
      : "btn-accent text-white shadow-[var(--shadow-accent)]"
  }`}
>
  {isProcessing ? 'جاري الحذف...' : confirmLabel}
</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 🌌 تنبيه الإجراءات الفضائي — (Glowing Edge & Pulse Burst) - الحجم الأكبر والأكثر تفاعلية
function ActionToast({ message, onClose }) {
  if (!message) return null;

  // الذكاء الاصطناعي لحساب وقت القراءة
  const wordCount = message.split(/\s+/).length;
  const smartDuration = Math.min(Math.max(wordCount * 350 + 3500, 3500), 8000); 

  // التعرف التلقائي
  const isError = /تعذر|فشل|خطأ|غير صحيح|لا يمكن|مرفوض|ممنوع|not found|failed|error/i.test(message);
  
  // ألوان مشعة (Cyber/Neon Vibes)
  const themeColor = isError ? '#ff2a2a' : '#00e676'; 
  const themeSoft = isError ? 'rgba(255, 42, 42, 0.2)' : 'rgba(0, 230, 118, 0.2)';

  return createPortal(
    <>
      <style>{`
        /* 1. دخول 3D عميق مع بلور */
        @keyframes ultra-enter {
          0% { opacity: 0; transform: translateY(-40px) scale(0.85) rotateX(-20deg); filter: blur(20px); }
          70% { transform: translateY(4px) scale(1.02) rotateX(5deg); filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1) rotateX(0deg); filter: blur(0); }
        }

        /* 2. دوران الضوء على الإطار */
        @keyframes border-spin {
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }

        /* 3. رسم الأيقونة */
        @keyframes draw-path {
          to { stroke-dashoffset: 0; }
        }

        /* 4. انفجار النور حوالين الأيقونة أول ما تظهر */
        @keyframes ring-burst {
          0% { transform: scale(0.5); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(2.5); opacity: 0; border-width: 0px; }
        }

        /* 5. دخول النص (Slide & Fade) */
        @keyframes text-slide-up {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* 6. شريط الوقت الذكي */
        @keyframes smart-progress {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }

        .ultra-toast-wrapper {
          animation: ultra-enter 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          perspective: 1200px;
          --toast-theme: ${themeColor};
        }

        .border-spinner {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 300%;
          height: 300%;
          background: conic-gradient(from 0deg, transparent 0%, transparent 70%, var(--toast-theme) 100%);
          transform: translate(-50%, -50%) rotate(0deg);
          animation: border-spin 3s linear infinite;
        }

        .svg-draw-path {
          stroke-dasharray: 40;
          stroke-dashoffset: 40;
          animation: draw-path 0.7s cubic-bezier(0.65, 0, 0.35, 1) 0.3s forwards;
        }

        .burst-ring {
          animation: ring-burst 0.8s cubic-bezier(0.1, 0.8, 0.3, 1) 0.3s forwards;
        }

        .text-reveal {
          opacity: 0;
          animation: text-slide-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.4s forwards;
        }

        .ultra-toast-wrapper:hover .smart-bar,
        .ultra-toast-wrapper:hover .border-spinner {
          animation-play-state: paused;
        }
        
        .ultra-toast-wrapper:hover .inner-capsule {
          transform: scale(1.01);
          box-shadow: 0 20px 40px -10px rgba(0,0,0,0.7), 0 0 30px ${themeSoft};
        }
      `}</style>

      <div className="pointer-events-none fixed inset-x-0 top-8 z-[9999] flex justify-center px-4">
        <div className="ultra-toast-wrapper">
          
          {/* الكبسولة الخارجية (للإطار المضيء) - زودنا الـ Padding هنا سنة */}
          <div className="pointer-events-auto relative rounded-full p-[1.5px] overflow-hidden shadow-2xl">
            
            {/* الضوء اللي بيلف */}
            <div className="border-spinner pointer-events-none" />

            {/* الكبسولة الداخلية (الخلفية الداكنة) - كبرنا الـ Padding العمودي والأفقي */}
            <div
              className="inner-capsule relative flex items-center gap-4 rounded-full pl-2 pr-5 py-2.5 transition-all duration-300"
              style={{
                background: 'rgba(12, 12, 15, 0.95)',
                backdropFilter: 'blur(20px)',
                minWidth: '320px',
                maxWidth: 'calc(100vw - 2rem)',
              }}
            >
              {/* الأيقونة بحركاتها المبهرة */}
              <div className="relative flex shrink-0 items-center justify-center w-11 h-11 rounded-full">
                {/* هالة النور اللي بتنفجر للخارج */}
                <div 
                  className="burst-ring absolute inset-0 rounded-full border-solid pointer-events-none"
                  style={{ borderColor: themeColor }}
                />
                
                {/* خلفية الأيقونة الخفيفة */}
                <div 
                  className="absolute inset-0 rounded-full opacity-20"
                  style={{ background: `radial-gradient(circle, ${themeColor} 0%, transparent 70%)` }}
                />

                {/* رسم الـ SVG */}
                {isError ? (
                  <svg className="w-6 h-6 relative z-10" style={{ color: themeColor, filter: `drop-shadow(0 0 6px ${themeColor})` }} fill="none" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" />
                    <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" className="svg-draw-path" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7 relative z-10" style={{ color: themeColor, filter: `drop-shadow(0 0 6px ${themeColor})` }} fill="none" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" />
                    <path d="M8 12.5l3 3 5-6" stroke="currentColor" className="svg-draw-path" />
                  </svg>
                )}
              </div>

              {/* النص - حجمه كبر سنة وبقى بيدخل من تحت لفوق بنعومة */}
              <div className="text-reveal relative flex-1 py-1.5 text-[15.5px] font-semibold tracking-wide text-zinc-100 whitespace-pre-wrap leading-relaxed">
                {message}
              </div>

              {/* زر الإغلاق */}
              <button
                onClick={onClose}
                className="text-reveal relative shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="إغلاق"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* شريط الوقت الذكي المدمج في الكيرف السفلي */}
              <div className="absolute bottom-0 inset-x-6 h-[2px] bg-transparent pointer-events-none overflow-hidden rounded-t-full">
                <div
                  className="smart-bar h-full w-full"
                  style={{ 
                    backgroundColor: themeColor,
                    boxShadow: `0 0 10px ${themeColor}, 0 0 20px ${themeColor}`,
                    transformOrigin: 'right',
                    animation: `smart-progress ${smartDuration}ms linear forwards`
                  }}
                />
              </div>

            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// 💡 أيقونات
const AIIcon = ({ className = "", ...props }) => <svg {...props} className={`w-5 h-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h.01M15 9h.01" /></svg>;

// ==========================================
// 9. شاشة القوة البشرية (للمالك فقط - تجميع من المهام بدون تكرار)
// ==========================================
function HumanResourcesView({ branches, isOwner, liveUpdateVersion = 0, lang = 'ar' }) {
  const [hrList, setHrList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterActive, setFilterActive] = useState('all'); // الكل / في مهمة حاليًا / ليس في مهمة حاليًا
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [customAlert, setCustomAlert] = useState(null);
  const fetchInFlight = useRef(false);

  const fetchHR = useCallback(async (silent = false) => {
    if (fetchInFlight.current) return; // منع التداخل / الطلبات المكررة
    fetchInFlight.current = true;
    if (silent) setIsRefreshing(true);
    const token = sessionStorage.getItem('access_token');
    try {
      // fix #10 (live-HR): نفس إطار ساعات كل استعلام حي — ساعة العميل المحلية (مصر).
      // غيابها يجعل خلفية HR تُحسب بـLOCALTIMESTAMP (GMT على خادم Neon) فينقلب الفرق
      // مع التواريخ المحلية المخزنة (naive مصر) ويعرض ساعات مهمة نشطة ≈ 0.
      const res = await fetch(`https://eoc-system-b12f.vercel.app/api/human-resources?client_now=${encodeURIComponent(clientNowLocal())}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        // حسب #13: الفلتر يعتمد على حقيقة الـ Backend (active_mission مش محسوبة في الـ UI)
        setHrList(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch HR");
    } finally {
      fetchInFlight.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchHR(); }, [fetchHR]);

  // 🍡 إخفاء تلقائي لتنبيه الإجراءات بعد 4 ثوانٍ
  useEffect(() => { if (!customAlert) return; const t = setTimeout(() => setCustomAlert(null), 4000); return () => clearTimeout(t); }, [customAlert]);

  // تحديث لحظي صامت: لو أي مهمة اتغيرت في النظام، ينعكس في "في مهمة حاليًا" فوراً
  useEffect(() => {
    if (liveUpdateVersion > 0) fetchHR(true);
  }, [liveUpdateVersion, fetchHR]);

  // 💡 وميض الصف عند تغيّر حالة "في مهمة حاليًا" لحظياً — يخبر المستخدم "إيه اللي اتغير"
  const prevActiveRef = useRef({});
  const [flashActive, setFlashActive] = useState({});
  useEffect(() => {
    const cur = {};
    hrList.forEach(p => {
      const k = `${p.branch_id}::${p.membership_number}`;
      cur[k] = !!p.active_mission;
    });
    const flipped = Object.keys(cur).filter(k => k in prevActiveRef.current && prevActiveRef.current[k] !== cur[k]);
    prevActiveRef.current = cur;
    if (flipped.length === 0) return undefined;
    const t = Date.now();
    setFlashActive(m => { const n = { ...m }; flipped.forEach(k => { n[k] = t; }); return n; });
    const tid = setTimeout(() => {
      setFlashActive(m => { const n = { ...m }; flipped.forEach(k => delete n[k]); return n; });
    }, 2400);
    return () => clearTimeout(tid);
  }, [hrList]);

  const filteredHR = useMemo(() => hrList.filter(p => {
    const matchBranch = filterBranch === 'all' ? true : p.branch_name === filterBranch;
    const matchType = filterType === 'all' ? true : p.participant_type === filterType;
    const matchActive = filterActive === 'all' ? true : filterActive === 'active' ? !!p.active_mission : !p.active_mission;
    const matchSearch = p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || p.membership_number.toLowerCase().includes(searchTerm.toLowerCase());
    return matchBranch && matchType && matchActive && matchSearch;
  }), [hrList, filterBranch, filterType, filterActive, searchTerm]);

  // مقياس نسبي لشريط الساعات (بالنسبة لصاحب أعلى ساعات في العرض الحالي)
  const maxHours = useMemo(() => filteredHR.reduce((mx, p) => Math.max(mx, p.total_hours || 0), 0), [filteredHR]);

  const countActive = hrList.filter(p => p.active_mission).length;
  const countInactive = hrList.length - countActive;

  const handleExportExcel = async () => {
    if (filteredHR.length === 0) { setCustomAlert("لا توجد بيانات لتصديرها."); return; }
    const hrRows = filteredHR.map((p, i) => ({
      "م": i + 1,
      "الاسم الرباعي": p.full_name,
      "رقم العضوية / الصفة": p.membership_number,
      "صفة المشارك": p.participant_position || '',
      "الفرع التابع له": p.branch_name === 'القاهرة' ? 'المركز العام' : p.branch_name,
      "النوع": p.participant_type === 'volunteer' ? 'متطوع' : 'غير متطوع',
      "حالة المشاركة": p.active_mission ? 'في مهمة حاليًا' : 'ليس في مهمة حاليًا',
      "إجمالي المهام الميدانية": p.missions_count,
      "عدد ساعات آخر مهمة": fmtHours(p.last_mission_hours, lang),
      "إجمالي الساعات": fmtHours(p.total_hours, lang)
    }));
    try { await exportWorkbook([{ name: 'القوة البشرية', ...gridFromRows(hrRows) }], `سجل_القوة_البشرية_${todayFileDate()}.xlsx`); setCustomAlert("تم تصدير السجل بنجاح!"); } catch { setCustomAlert("حدث خطأ أثناء التصدير."); }
  };

  const branchNames = [...new Set(branches.map(b => b.name === 'المركز العام' ? 'القاهرة' : b.name))];

  // الفلاتر الثلاثية حسب حقيقة الـ Backend مباشرة
  const activeFilterOptions = [
    { key: 'all', label: 'الكل', count: hrList.length },
    { key: 'active', label: 'في مهمة حاليًا', count: countActive },
    { key: 'inactive', label: 'ليس في مهمة حاليًا', count: countInactive },
  ];

  return (
    <div className="space-y-6 pb-10 animate-fade-in-up">
      <div className="card-surface p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-bold flex items-center gap-2"><UsersIcon className="text-[var(--accent)]"/> سجل القوة البشرية الفعالة (إدارة المتطوعين)</h3>
          {isRefreshing && <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]"><span className="w-3 h-3 rounded-full bg-[var(--accent)] animate-pulse"/> تحديث لحظي...</span>}
        </div>
        <p className="text-sm text-[var(--muted)] mt-2">يتم استخراج البيانات تلقائياً من المهام الميدانية بدون تكرار، وربط المتطوع بعدد مشاركاته وساعاته الفعلية ووضعه الحالي لحظياً.</p>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="ops-chip text-[var(--ok)] border-[var(--ok-soft)] bg-[var(--ok-soft)]"><span className="live-dot" /> {lang === 'ar' ? 'متصل بقاعدة البيانات لحظياً' : 'Live database sync'}</span>
          <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" /> {lang === 'ar' ? 'في مهمة حاليًا' : 'Active'}: <b className="text-[var(--ink)] tabular-nums">{countActive}</b></span>
          <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)]" /> {lang === 'ar' ? 'ليس في مهمة حاليًا' : 'Inactive'}: <b className="text-[var(--ink)] tabular-nums">{countInactive}</b></span>
          <span className="ops-chip"><span className="w-1.5 h-1.5 rounded-full bg-[var(--data)]" /> {lang === 'ar' ? 'حالات 0 قيد الحصر' : 'Pending (0) '}: <b className="text-[var(--ink)] tabular-nums">{hrList.filter(p => p.missions_count > 0 && !(p.total_hours > 0)).length}</b></span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي القوة (بدون تكرار)" value={filteredHR.length} color="text-white" borderHighlight />
        <StatCard title="في مهمة حاليًا" value={countActive} color="text-[var(--accent)]" borderHighlight />
        <StatCard title="ليس في مهمة حاليًا" value={countInactive} color="text-[var(--muted-2)]" />
        <StatCard title="إجمالي المتطوعين" value={hrList.filter(p => p.participant_type === 'volunteer').length} color="text-blue-400" />
      </div>

      <div className="card-surface overflow-hidden flex flex-col h-[660px]">
        <div className="p-6 border-b border-[var(--border)] flex flex-col lg:flex-row justify-between items-center gap-4 z-10 bg-[var(--surface-2)]">

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <input type="text" placeholder="بحث بالاسم أو الكود..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="field w-full md:w-56" />

            <EocSelect variant="field" className="cursor-pointer w-full md:w-auto" value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="all">كل الفروع والتمركزات</option>
              <option value="المركز العام">المركز العام</option>
              {branchNames.filter(n => n !== 'القاهرة').map(g => <option key={g} value={g}>{g}</option>)}
            </EocSelect>

            <EocSelect variant="field" className="cursor-pointer w-full md:w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">الكل (متطوع وغير متطوع)</option>
              <option value="volunteer">متطوعين فقط</option>
              <option value="non_volunteer">غير متطوعين</option>
            </EocSelect>
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={handleExportExcel}
              data-tip="تصدير السجل إلى Excel"
              className="action-btn action-btn--ok shrink-0"
            >
              <ExcelIcon />
              <span className="hidden md:inline">تصدير سجل القوة البشرية</span>
            </button>
          )}
        </div>

        {/* #13: فلتر المشاركين حسب حقيقة الـ Backend — يظهر لحظياً مع الـ Realtime */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)]">
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[var(--surface-week)] border border-[var(--border)]">
            {activeFilterOptions.map(opt => (
              <button
                key={opt.key}
                onClick={() => setFilterActive(opt.key)}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 active:scale-[0.97] ${
                  filterActive === opt.key
                    ? 'bg-[var(--accent)] text-white shadow-[0_4px_16px_rgba(199,0,0,0.35)] eoc-frame'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {opt.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-md font-mono ${filterActive === opt.key ? 'bg-white/20 text-white' : 'bg-[var(--surface-week)] text-[var(--muted)] border border-[var(--border)]'}`}>{opt.count}</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--muted)] inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"/> يعتمد على حالة الـ Database لحظياً
          </span>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar relative">
          <table className="w-full text-right whitespace-nowrap min-w-[1000px] text-sm">
            <thead className="sticky top-0 z-20 bg-[var(--surface-2)] text-[var(--muted)]">
              <tr>
                <th className="p-4 font-semibold border-l border-[var(--border)] w-16 text-center">م</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">الاسم</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--accent)]">رقم العضوية / الصفة</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-[var(--accent)]">صفة المشارك</th>
                <th className="p-4 font-semibold border-l border-[var(--border)]">الفرع التابع له</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-center">النوع</th>
                <th className="p-4 font-semibold border-l border-[var(--border)] text-center">الحالة الآن</th>
                <th className="p-4 font-semibold text-center text-[var(--ok)] border-l border-[var(--border)]">عدد المهام</th>
                <th className="p-4 font-semibold text-center text-[var(--warn)] border-l border-[var(--border)]">عدد ساعات آخر مهمة</th>
                <th className="p-4 font-semibold text-center text-[var(--data)]">إجمالي الساعات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                <TableLoadingRow colSpan={10} label="جاري حصر وتحليل الأفراد من المهام السابقة..." />
              ) : filteredHR.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-[var(--muted)]">لا توجد بيانات مطابقة.</td></tr>
              ) : filteredHR.map((person, index) => (
                <tr key={person.id || person.membership_number || index} className={`transition-colors duration-300 ${person.active_mission ? 'hr-active-row' : ''} hover:bg-[var(--surface-2)]`}>
                  <td data-label="م" className="p-4 text-center">{index + 1}</td>
                  <td data-label="الاسم" className="p-4 font-semibold">{person.full_name}</td>
                  <td data-label="رقم العضوية / الصفة" className="p-4">{person.membership_number}</td>
                  <td data-label="صفة المشارك" className="p-4">{person.participant_position || '—'}</td>
                  <td data-label="الفرع التابع له" className="p-4">{person.branch_name === 'القاهرة' ? 'المركز العام' : person.branch_name}</td>
                  <td data-label="النوع" className="p-4 text-center">{person.participant_type === 'volunteer' ? 'متطوع' : 'غير متطوع'}</td>
                  <td data-label="الحالة الآن" className="p-4 text-center">{person.active_mission ? 'في مهمة حاليًا' : 'ليس في مهمة حاليًا'}</td>
                  <td data-label="عدد المهام" className="p-4 text-center">{person.missions_count}</td>
                  <td data-label="عدد ساعات آخر مهمة" className="p-4 text-center">{fmtHours(person.last_mission_hours, lang)}</td>
                  <td data-label="إجمالي الساعات" className="p-4 text-center">{fmtHours(person.total_hours, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {customAlert && <ActionToast message={customAlert} onClose={() => setCustomAlert(null)} />}
    </div>
)}
