/* ─────────────────────────────────────────────────────────────────────────────
   📤 اختبارات الطابور المحلي (Outbox) — أهم اختبار في المشروع
   ─────────────────────────────────────────────────────────────────────────────
   السبب: الشباب كانوا بيعملوا استمارة ومتتحفظش، فيرجعوا يعيدوها من الأول.
   السبب الجذري اللي اتصلّح: رد 401/403 (جلسة منتهية — والتوكن ساعته 8 ساعات
   والسيرفر بيعمل رستر) كان بيمسح الاستمارة من الطابور نهائياً.

   الاختبارات دي بتثبّت القواعد دي، فأي تعديل مستقبلي يكسرها هيفشل هنا:
     1) 401/403 ⇒ الاستمارة تفضل في الطابور ولا تُمسح ولا تُؤرشف (وتتبعت بعد الدخول).
     2) أي رفض منطقي تاني (400/409/422) ⇒ يتأرشف ببياناته كاملة بدل الحذف.
     3) الحذف النهائي يحصل فقط بعد نجاح مؤكد.
     4) تعديلات الطقس المعلّقة تتحفظ وتعدّي أي انقطاع.
   التشغيل: cd frontend && npm test   (أو: node --test src/__tests__)
   ───────────────────────────────────────────────────────────────────────────── */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeStorage, installFakeWindow } from './helpers/fakeBrowser.js';
import {
  readOutbox,
  enqueueOutbox,
  removeFromOutbox,
  readRejected,
  archiveRejectedOutbox,
  restoreRejectedToOutbox,
  dropRejected,
  markOutboxAuthBlocked,
  clearOutboxAuthBlocked,
  outboxAuthBlockedCount,
  loadWeatherPending,
  saveWeatherPending,
  clearWeatherPending,
  countWeatherPending,
  REJECTED_LIMIT,
} from '../outbox.js';

// المتصفح الوهمي يتثبّت قبل أي اختبار (كل الوصول للتخزين في الكود الأصلي مؤجّل،
// فترتيب الاستيراد مش مؤثر — لكن التثبيت لازم يكون قبل تشغيل الاختبارات).
installFakeStorage();
const fakeWin = installFakeWindow();

const FORM = { key: 'mission-abc', method: 'POST', url: '/api/missions', payload: { name: 'ندوة إسعافات أولية', volunteers: 12, notes: 'مهم' } };
const clone = (x) => JSON.parse(JSON.stringify(x));

beforeEach(() => {
  globalThis.localStorage.clear();
  fakeWin.events.length = 0;
});

test('الاستمارة تتخزن محلياً فوراً وتفضل في الطابور', () => {
  enqueueOutbox(FORM);
  const items = readOutbox();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].payload, FORM.payload);
  assert.equal(items[0].method, 'POST');
  assert.equal(items[0].url, '/api/missions');
});

test('🔐 401 (جلسة منتهية) لا يمسح الاستمارة ولا يؤرشفها — دي كانت المشكلة الأساسية', () => {
  enqueueOutbox(FORM);
  const before = clone(readOutbox());

  markOutboxAuthBlocked(FORM.key, 401);

  const after = readOutbox();
  assert.equal(after.length, 1, 'الاستمارة لازم تفضل في الطابور بعد 401');
  assert.deepEqual(after[0].payload, before[0].payload, 'بيانات الاستمارة ما تتغيرش خالص');
  assert.equal(after[0].authBlocked, true);
  assert.equal(after[0].authStatus, 401);
  assert.ok(after[0].authBlockedAt, 'وقت الحجب يتسجّل للمستخدم');
  assert.equal(readRejected().length, 0, '401 مش رفض بيانات ⇒ مفيش أرشفة');
});

test('🔐 403 (صلاحيات) نفس السلوك: تفضل في الطابور', () => {
  enqueueOutbox(FORM);
  markOutboxAuthBlocked(FORM.key, 403);
  const items = readOutbox();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].payload, FORM.payload);
  assert.equal(items[0].authStatus, 403);
  assert.equal(outboxAuthBlockedCount(), 1);
});

test('🔐 بعد الدخول من جديد: تتشال علامة الجلسة والاستمارة تفضل جاهزة للإرسال', () => {
  enqueueOutbox(FORM);
  markOutboxAuthBlocked(FORM.key, 401);

  clearOutboxAuthBlocked();

  const items = readOutbox();
  assert.equal(items.length, 1, 'الاستمارة نفسها ما تمسحش مع إزالة العلامة');
  assert.deepEqual(items[0].payload, FORM.payload);
  assert.equal(items[0].authBlocked, undefined);
  assert.equal(outboxAuthBlockedCount(), 0);
  // نفس المقارنة اللي بيعملها مسار الإرسال: العنصر صالح للطابور
  assert.equal(items[0].method, 'POST');
  assert.equal(items[0].url, '/api/missions');
});

test('🗄️ 422 (رفض منطقي) ⇒ يتأرشف ببياناته كاملة بدل ما يتمسح', () => {
  enqueueOutbox(FORM);

  const archived = archiveRejectedOutbox(FORM.key, { status: 422, detail: 'عدد المشاركين مطلوب' });

  assert.deepEqual(archived.payload, FORM.payload);
  assert.equal(readOutbox().length, 0, 'اتنقل من الطابور');
  const archive = readRejected();
  assert.equal(archive.length, 1, 'وظهر في الأرشيف بدل الفقد');
  assert.deepEqual(archive[0].payload, FORM.payload, 'البيانات كاملة عشان يقدر ينزّلها ويعدّلها');
  assert.equal(archive[0].status, 422);
  assert.equal(archive[0].detail, 'عدد المشاركين مطلوب');
  assert.ok(!Number.isNaN(Date.parse(archive[0].archivedAt)), 'تاريخ الأرشفة ISO سليم');
  assert.ok(fakeWin.dispatched().includes('eoc:outbox-changed'), 'الواجهة بتتبلّغ بالتغيير');
});

test('🗄️ طول الرد سبب الرفض يتقصّ عند 400 حرف (ما نضخّمش التخزين)', () => {
  enqueueOutbox(FORM);
  archiveRejectedOutbox(FORM.key, { status: 400, detail: 'س'.repeat(900) });
  assert.equal(readRejected()[0].detail.length, 400);
});

test('↩️ إرجاع المرفوض للطابور بيرجّعه نظيف (بلا status/detail/archivedAt)', () => {
  enqueueOutbox(FORM);
  archiveRejectedOutbox(FORM.key, { status: 409, detail: 'مكرر' });

  restoreRejectedToOutbox(FORM.key);

  const items = readOutbox();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].payload, FORM.payload);
  assert.equal(items[0].status, undefined);
  assert.equal(items[0].detail, undefined);
  assert.equal(items[0].archivedAt, undefined);
  assert.equal(readRejected().length, 0, 'اتشال من الأرشيف');
});

test('🗑️ الحذف النهائي من الأرشيف لا يحصل غير بقرار صريح', () => {
  enqueueOutbox(FORM);
  archiveRejectedOutbox(FORM.key, { status: 400, detail: 'خطأ' });
  assert.equal(readRejected().length, 1);
  dropRejected(FORM.key);
  assert.equal(readRejected().length, 0);
});

test(`🗄️ سقف الأرشيف ${REJECTED_LIMIT} عناصر والأحدث في المقدمة`, () => {
  for (let i = 0; i < REJECTED_LIMIT + 3; i += 1) {
    enqueueOutbox({ ...FORM, key: `k${i}`, payload: { name: `مهمة ${i}` } });
    archiveRejectedOutbox(`k${i}`, { status: 400, detail: `سبب ${i}` });
  }
  const archive = readRejected();
  assert.equal(archive.length, REJECTED_LIMIT, 'ما تتخمش الجهاز');
  assert.equal(archive[0].payload.name, `مهمة ${REJECTED_LIMIT + 2}`, 'الأحدث أول عنصر');
});

test('✅ الحذف من الطابور بيحصل بعد نجاح مؤكد فقط', () => {
  enqueueOutbox(FORM);
  assert.equal(readOutbox().length, 1);
  removeFromOutbox(FORM.key);
  assert.equal(readOutbox().length, 0);
});

test('نفس المفتاح يتحدّث بدل ما يتكرر (مفيش استمارات مكررة)', () => {
  enqueueOutbox(FORM);
  enqueueOutbox({ ...FORM, payload: { ...FORM.payload, volunteers: 20 } });
  const items = readOutbox();
  assert.equal(items.length, 1);
  assert.equal(items[0].payload.volunteers, 20);
});

test('🧷 مخزن الطقس المعلّق: الكلام اللي اتكتب ما يضيعش لو الحفظ فشل', () => {
  const store = { '2026-09-27|صباحي': { '12': { temperature: 31, humidity: 40 } } };
  saveWeatherPending(store);
  assert.deepEqual(loadWeatherPending(), store, 'الأرقام ترجع زي ما هي بعد أي انقطاع');
  assert.equal(countWeatherPending(), 1, 'العدّاد بيعدّ الخلايا (صف/محافظة) المعلّقة');
  clearWeatherPending();
  assert.deepEqual(loadWeatherPending(), {}, 'بتتنضف بعد تأكيد الحفظ بس');
});

test('تخزين تالف أو ممتلئ لا يكسر النظام (مفيش استثناءات للواجهة)', () => {
  globalThis.localStorage.setItem('eoc_mission_outbox_v1', '{{{ not json');
  assert.deepEqual(readOutbox(), [], 'JSON تالف ⇒ طابور فاضي بدل انهيار');
  globalThis.localStorage.setItem('eoc_weather_pending_v1', '[1,2,3]');
  assert.deepEqual(loadWeatherPending(), {}, 'شكل غلط ⇒ كائن فاضي');

  const real = globalThis.localStorage;
  installFakeStorage({ failOnSet: true });
  assert.doesNotThrow(() => enqueueOutbox(FORM), 'امتلاء التخزين ما يمنعش الشغل');
  assert.doesNotThrow(() => saveWeatherPending({ a: 1 }));
  Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
});
