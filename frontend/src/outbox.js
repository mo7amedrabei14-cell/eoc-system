/* ─────────────────────────────────────────────────────────────────────────────
   📤 الطابور المحلي (Outbox) + أرشيف المرفوضات + مخزن الطقس المعلّق
   ─────────────────────────────────────────────────────────────────────────────
   ده الملف اللي فيه «منطق عدم فقد البيانات» — مطلوع من Dashboard.jsx عشان
   يبقى نقي وقابل للاختبار (frontend/src/__tests__/outbox.test.js).

   القواعد المثبّتة بالاختبارات:
     1) 401/403 (جلسة منتهية/صلاحيات) ⇒ الاستمارة تفضل في الطابور ومتتمسحش أبداً.
     2) أي رفض منطقي تاني (400/409/422…) ⇒ يتأرشف ببياناته كاملة بدل الحذف.
     3) الحذف من الطابور يحصل فقط بعد نجاح مؤكد (أو بعد وضع المرفوض في الأرشيف).
     4) تعديلات الطقس تتحفظ هنا فور الكتابة، وتتنضف بعد تأكيد السيرفر فقط.
   ───────────────────────────────────────────────────────────────────────────── */

// ملاحظة: كل الوصول لـ localStorage داخل دوال (مش في نطاق الملف) — فالدوال
// تفضل صالحة للاختبار وأيضاً آمنة لو المتصفح مانع التخزين.
const STORAGE = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // بعض المتصفحات ترمي استثناء عند الوصول لـ localStorage أًصلاً
  }
};

// 📤 Outbox: أي استمارة بتتحفظ محلياً قبل الإرسال — لو الإرسال فشل تفضل هنا وبتتعاد تلقائياً
export const MISSION_OUTBOX_KEY = 'eoc_mission_outbox_v1';
export const readOutbox = () => {
  try { return JSON.parse(STORAGE()?.getItem(MISSION_OUTBOX_KEY) || '[]'); } catch { return []; }
};
export const writeOutbox = (items) => { try { STORAGE()?.setItem(MISSION_OUTBOX_KEY, JSON.stringify(items)); } catch { /* ignore */ } };
export const enqueueOutbox = (item) => writeOutbox([...readOutbox().filter(x => x.key !== item.key), item]);
export const removeFromOutbox = (key) => writeOutbox(readOutbox().filter(x => x.key !== key));

// 🗄️ أرشيف المرفوضات — إصلاح ثقب فقد البيانات:
//    قبل كده أي رد 4xx كان بيمسح الاستمارة من الطابور نهائياً ⇒ الشباب يعيدوا
//    كتابة الاستمارة من الأول. دلوقتي بتنقل هنا ببياناتها كاملة (وسقف 10 عناصر)
//    وتظهر لصاحبها في اللوحة مع إمكانية التنزيل أو الإرجاع للطابور.
export const MISSION_REJECTED_KEY = 'eoc_mission_rejected_v1';
export const REJECTED_LIMIT = 10;
export const readRejected = () => {
  try { return JSON.parse(STORAGE()?.getItem(MISSION_REJECTED_KEY) || '[]'); } catch { return []; }
};
export const writeRejected = (items) => {
  try { STORAGE()?.setItem(MISSION_REJECTED_KEY, JSON.stringify(items.slice(0, REJECTED_LIMIT))); } catch { /* ignore */ }
};

const notifyOutboxChanged = () => {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('eoc:outbox-changed'));
    }
  } catch { /* ignore */ }
};

export const archiveRejectedOutbox = (key, { status = null, detail = '' } = {}) => {
  const item = readOutbox().find(x => x.key === key);
  if (!item) return null;
  writeRejected([
    { ...item, status, detail: String(detail || '').slice(0, 400), archivedAt: new Date().toISOString() },
    ...readRejected().filter(x => x.key !== key),
  ]);
  removeFromOutbox(key);
  notifyOutboxChanged();
  return item;
};

export const restoreRejectedToOutbox = (key) => {
  const item = readRejected().find(x => x.key === key);
  if (!item) return false;
  // نرجع عناصر الطابور فقط (بلا status/detail/archivedAt الخاصة بالأرشيف)
  enqueueOutbox({ key: item.key, method: item.method, url: item.url, payload: item.payload });
  writeRejected(readRejected().filter(x => x.key !== key));
  notifyOutboxChanged();
  return true;
};

export const dropRejected = (key) => {
  writeRejected(readRejected().filter(x => x.key !== key));
  notifyOutboxChanged();
};

// 🔐 401/403 = جلسة منتهية أو صلاحيات — وليس رفضاً للبيانات:
//    الطابور يفضل كما هو ويتحاول تاني بعد الدخول من جديد (قبل كده كانت
//    الاستمارة تمسح مع انتهاء صلاحية التوكن 8 ساعات أو مع أي رستر للسيرفر).
export const markOutboxAuthBlocked = (key, status) => {
  const items = readOutbox();
  const idx = items.findIndex(x => x.key === key);
  if (idx === -1) return false;
  items[idx] = { ...items[idx], authBlocked: true, authStatus: status, authBlockedAt: new Date().toISOString() };
  writeOutbox(items);
  return true;
};

export const clearOutboxAuthBlocked = () => {
  const items = readOutbox();
  if (!items.some(x => x.authBlocked)) return false;
  // نزيل أعلام «الجلسة منتهية» فقط ونحافظ على كل عناصر الاستمارة كما هي
  writeOutbox(items.map(x => ({ key: x.key, method: x.method, url: x.url, payload: x.payload })));
  return true;
};

export const outboxAuthBlockedCount = () => readOutbox().filter(x => x.authBlocked).length;

/* ── 🧷 تعديلات شبكة الطقس اللي اتكتبت ولسه محصلش لها حفظ مؤكد على السيرفر ──
   كانت زمان بتتصفّر من الذاكرة *قبل* المحاولة، فلو الحفظ فشل (سيرفر واقع/جلسة
   منتهية) الأرقام تفضل على الشاشة بس وتضيع مع أول تبديل وردية أو تحديث صفحة. */
export const WEATHER_PENDING_KEY = 'eoc_weather_pending_v1';
export const loadWeatherPending = () => {
  try {
    const parsed = JSON.parse(STORAGE()?.getItem(WEATHER_PENDING_KEY) || '{}');
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
};
export const saveWeatherPending = (store) => {
  try { STORAGE()?.setItem(WEATHER_PENDING_KEY, JSON.stringify(store || {})); } catch { /* ignore */ }
};
export const clearWeatherPending = () => {
  try { STORAGE()?.removeItem(WEATHER_PENDING_KEY); } catch { /* ignore */ }
};
/** عدد الخلايا (برانش/حقل) اللي لسه معلّقة — بيظهر في مؤشر «🧷 عندك N» */
export const countWeatherPending = (store = loadWeatherPending()) =>
  Object.values(store || {}).reduce((n, group) => n + Object.keys(group || {}).length, 0);
