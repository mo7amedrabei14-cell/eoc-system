import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 🧪 بيئة وهمية مصغّرة (window/document) كافية لتشغيل الوحدة في node
const docListeners = new Map();
const fireDoc = (type, target) => { for (const fn of (docListeners.get(type) || [])) fn({ type, target }); };
const seen = [];
globalThis.window = {
  fetch: (...args) => Promise.resolve({ ok: true, url: String(args[0] ?? '') }),
  dispatchEvent: (evt) => { seen.push({ type: evt.type, text: evt.detail?.text }); return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = {
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  },
};
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
}

const { showWorking, hideWorking, withWorking, installWorkingAuto, setWorkingSuppressed, setWorkingHardCap, WORKING_EVENTS } = await import('../workingToast.js?env=1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { seen.length = 0; });

test('العدّ اليدوي: SHOW/HIDE متوازنان حتى مع استدعاءات متعددة', () => {
  showWorking('أ');
  showWorking('ب');
  hideWorking();
  assert.equal(seen.filter(s => s.type === WORKING_EVENTS.SHOW).length, 2);
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.HIDE));
  hideWorking();
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.HIDE));
});

test('withWorking يخفي حتى لو فشل الـ promise', async () => {
  seen.length = 0;
  await assert.rejects(withWorking('فاشل', async () => { throw new Error('x'); }));
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.SHOW));
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.HIDE));
});

test('تحميل بيانات صامت (بلا ضغطة زر) لا يُظهر الحبة — لا 24 ساعة!', async () => {
  seen.length = 0;
  installWorkingAuto();
  await sleep(1700); // خارج نافذة أي ضغطة سابقة
  const p = globalThis.window.fetch('/api/missions'); // تحديث دوري/فتح صفحة
  await sleep(20);
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.SHOW), 'الحبة ظهرت مع تحميل صامت!');
  await p;
  await sleep(100);
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.HIDE));
});

test('⚡ ضغطة زر ⇒ الحبة تظهر بنص «جاري تنفيذ العملية» حرفياً ثم تختفي', async () => {
  seen.length = 0;
  const buttonLike = { closest: () => true };
  for (const fn of (docListeners.get('click') || [])) fn({ type: 'click', target: buttonLike });
  const p = globalThis.window.fetch('/api/missions'); // طلب ناتج عن الضغطة
  await sleep(10);
  const show = seen.find(s => s.type === WORKING_EVENTS.SHOW);
  assert.ok(show, 'الحبة لم تظهر مع ضغطة الزر!');
  assert.equal(show.text, 'جاري تنفيذ العملية…');
  await p;
  await sleep(1200);
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.HIDE));
});

test('🔇 الكتم: صفحة مؤشرات المركز تمنع الحبة كلياً', () => {
  seen.length = 0;
  setWorkingSuppressed(true);
  showWorking('جاري تنفيذ العملية…');
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.SHOW), 'الحبة ظهرت رغم الكتم!');
  setWorkingSuppressed(false);
  showWorking('جاري تنفيذ العملية…');
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.SHOW));
  hideWorking();
});

test('الاستطلاع الخلفي (realtime) لا يُشعل الحبة أبداً — النبضة الحية مستثناة', async () => {
  seen.length = 0;
  await sleep(1700); // خارج نافذة ضغطة الزر السابقة
  const p = globalThis.window.fetch('/api/realtime/events?after_id=5');
  await sleep(20);
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.SHOW), 'الحبة ظهرت مع نبضة الريال تايم!');
  await p;
  await sleep(100);
  assert.ok(!seen.some(s => s.type === WORKING_EVENTS.HIDE));
});

test('🛡️ السقف المطلق: showWorking بلا hide (مسار متسرب) لا يُبقي الحبة أكثر من السقف', async () => {
  seen.length = 0;
  setWorkingHardCap(200);
  showWorking('جاري حفظ سجل التسليم…');   // محاكاة العطل القديم: لا hide أبداً
  await sleep(1600);                        // مؤقت السقف = max(1000, 200) = 1 ثانية
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.HIDE), 'الحبة تعيش بلا نهاية رغم السقف!');
  setWorkingHardCap(0);
});

test('🛡️ تكرار showWorking (دورية معطوبة كل 80ms) لا يعيد تسليح الحبة للأبد', async () => {
  seen.length = 0;
  setWorkingHardCap(150);
  for (let i = 0; i < 6; i++) { showWorking('جاري مزامنة تعديلات التواصل…'); await sleep(80); }
  await sleep(1500); // آخر مؤقت مسلّح ~1 ثانية من آخر استدعاء
  assert.ok(seen.some(s => s.type === WORKING_EVENTS.HIDE), 'التكرار أبقى الحبة حية للأبد!');
  setWorkingHardCap(0);
});
