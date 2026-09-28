/* ─────────────────────────────────────────────────────────────────────────────
   📤 الطابور (Outbox) + أرشيف المرفوضات + مخزن الطقس المعلّق
   ─────────────────────────────────────────────────────────────────────────────
   ده الملف اللي فيه «منطق عدم فقد البيانات» — مطلوع من Dashboard.jsx عشان
   يبقى نقي وقابل للاختبار (frontend/src/__tests__/outbox.test.js).

   القواعد المثبّتة بالاختبارات:
     1) 401/403 (جلسة منتهية/صلاحيات) ⇒ الاستمارة تفضل في الطابور ومتتمسحش أبداً.
     2) أي رفض منطقي تاني (400/409/422…) ⇒ يتأرشف ببياناته كاملة بدل الحذف.
     3) الحذف من الطابور يحصل فقط بعد نجاح مؤكد (أو بعد وضع المرفوض في الأرشيف).
     4) تعديلات الطقس تتحفظ هنا فور الكتابة، وتتنضف بعد تأكيد السيرفر فقط.

   ☁️ الطابور ده بقى *مرآة* لحالة على السيرفر (user_workspace_items / pending_save):
      كل استمارة تتحفظ محلياً وبترفع للسيرفر، وأي جهاز لنفس الحساب بيسحب الطابور
      منها وبيحاول يرسله — فضياع جهاز أو متصفح مش معناه ضياع شغل غير مُرسَل.
      المخزن المحلي بيفضل شغال عند انقطاع الشبكة (localStorage) كآخر خط دفاع.
   ───────────────────────────────────────────────────────────────────────────── */

// لاحقة .js مقصودة: الملف ده بيتحمّل في اختبارات Node (node --test)
import { fetchWorkspace, saveWorkspace, deleteWorkspace } from './workspace.js';

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
export const enqueueOutbox = (item) => {
  writeOutbox([...readOutbox().filter(x => x.key !== item.key), item]);
  // ☁️ نفس الاستمارة تتحفظ على السيرفر (أي جهاز يقدر يكمّل إرسالها)
  pushOutboxToServer(item);
  notifyOutboxChanged();
  return true;
};
export const removeFromOutbox = (key) => {
  writeOutbox(readOutbox().filter(x => x.key !== key));
  deleteWorkspace({ kind: 'pending_save', scope: String(key) });   // ☁️ إزالة من مرآة السيرفر
};

/** رفع عنصر طابور للسيرفر: {method,url} في meta والباقي في payload. */
export const pushOutboxToServer = (item) => {
  if (!item || !item.key) return false;
  saveWorkspace({
    kind: 'pending_save',
    scope: String(item.key),
    payload: item.payload || {},
    meta: { method: item.method || null, url: item.url || null, authBlocked: !!item.authBlocked },
  });
  return true;
};

/**\n * ⬇️ دمج طابور السيرفر في المخزن المحلي: أي جهاز يسجّل بنفس الحساب بيستلم
 * شغل الأجهزة الأخرى غير المُرسَل ويحاول تسليمه (وحتى لو جهاز صاحبه ضاع).
 * ترتيب المفاتيح: الرفع أولاً (لضمان ألا يمسح السيرفر شيئاً محلياً لم يُرفع بعد)
 * ثم السحب. ترجع قائمة الطابور المدمجة.
 */
export const syncOutboxFromServer = async () => {
  const local = readOutbox();
  // 1) ارفع أي عنصر محلي لسه على السيرفر (آخر خط دفاع للانقطاع)
  for (const item of local) {
    if (!item.remote) pushOutboxToServer(item);
  }
  // 2) اسحب طابور السيرفر (مصدر الحقيقة) وادمجه
  const remote = await fetchWorkspace('pending_save');
  if (!remote) return local;                       // انقطاع ⇒ الطابور المحلي كما هو
  const byKey = new Map(local.map(x => [String(x.key), x]));
  let changed = false;
  for (const row of remote) {
    if (!row || !row.scope) continue;
    const existing = byKey.get(String(row.scope));
    const incoming = {
      key: String(row.scope),
      method: row.meta?.method || 'PUT',
      url: row.meta?.url || '',
      payload: row.payload,
      remote: true,
    };
    if (!existing) {
      byKey.set(incoming.key, incoming);
      changed = true;
    } else if (!existing.remote) {
      byKey.set(incoming.key, incoming);
    } else {
      byKey.set(incoming.key, { ...existing, remote: true });
    }
  }
  // 3) عنصر موجود محلياً ومش على السيرفر: يبقى محلياً (لم يُرفع/انقطاع) ولا يُحذف أبداً
  if (changed) writeOutbox([...byKey.values()]);
  return [...byKey.values()];
};

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
// ☁️ مرآة السيرفر للطقس: كل مجموعة (تاريخ|وردية) تتحفظ كنطاق على السيرفر
//    (`weather:<date>|<shift>`) ⇒ أي جهاز لنفس الحساب يقدر يكمل حفظها لو الجهاز
//    الأصلي قفل/ضاع، والقيمة المعلّقة ما تضيعش أبداً.
let weatherPushTimer = null;
const weatherDirtyGroups = new Set();
let weatherKnownGroups = new Set();
const flushWeatherPendingToServer = () => {
  weatherPushTimer = null;
  const store = loadWeatherPending();
  const groups = new Set(Object.keys(store || {}));
  weatherDirtyGroups.forEach((gk) => {
    if (groups.has(gk)) {
      saveWorkspace({ kind: 'draft', scope: `weather:${gk}`, payload: { rows: store[gk] } });
    }
  });
  // مجموعات اتأكد حفظها/اتنضفت محلياً ⇒ تتنضف من السيرفر كذلك
  weatherKnownGroups.forEach((gk) => {
    if (!groups.has(gk)) deleteWorkspace({ kind: 'draft', scope: `weather:${gk}` });
  });
  weatherDirtyGroups.clear();
  weatherKnownGroups = groups;
};
export const saveWeatherPending = (store) => {
  const s = store || {};
  try { STORAGE()?.setItem(WEATHER_PENDING_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  Object.keys(s).forEach((gk) => weatherDirtyGroups.add(gk));
  if (weatherPushTimer) clearTimeout(weatherPushTimer);
  weatherPushTimer = setTimeout(flushWeatherPendingToServer, 2500);
};
export const clearWeatherPending = () => {
  try { STORAGE()?.removeItem(WEATHER_PENDING_KEY); } catch { /* ignore */ }
  weatherKnownGroups.forEach((gk) => deleteWorkspace({ kind: 'draft', scope: `weather:${gk}` }));
  weatherKnownGroups = new Set();
  weatherDirtyGroups.clear();
};

/**\n * ⬇️ دمج خلايا الطقس المعلّقة من السيرفر (شغل جهاز آخر لنفس الحساب) في المخزن
 * المحلي — المحلي أولاً لكل مجموعة (شغل هذا الجهاز لم يُؤكد بعد)، والسيرفر يملأ
 * المجموعات الناقصة فقط. ترجع المخزن المدمج.
 */
export const syncWeatherPendingFromServer = async () => {
  const local = loadWeatherPending();
  const remote = await fetchWorkspace('draft');
  if (!remote) return local;
  const mine = remote.filter(x => x && typeof x.scope === 'string' && x.scope.startsWith('weather:'));
  weatherKnownGroups = new Set(mine.map(x => x.scope.slice('weather:'.length)));
  const merged = { ...local };
  let added = false;
  mine.forEach((item) => {
    const gk = item.scope.slice('weather:'.length);
    if (merged[gk]) return;
    const rows = item.payload && item.payload.rows;
    if (rows && typeof rows === 'object' && Object.keys(rows).length) { merged[gk] = rows; added = true; }
  });
  if (added) { try { STORAGE()?.setItem(WEATHER_PENDING_KEY, JSON.stringify(merged)); } catch { /* ignore */ } }
  return merged;
};
/** عدد الخلايا (برانش/حقل) اللي لسه معلّقة — بيظهر في مؤشر «🧷 عندك N» */
export const countWeatherPending = (store = loadWeatherPending()) =>
  Object.values(store || {}).reduce((n, group) => n + Object.keys(group || {}).length, 0);
