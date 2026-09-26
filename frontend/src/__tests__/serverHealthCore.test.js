/* ─────────────────────────────────────────────────────────────────────────────
   🩺 اختبارات قلب حارس السيرفر
   ─────────────────────────────────────────────────────────────────────────────
   الغرض: نضمن إن النظام ما يقولش «شغال» وهو مش شغال، وإن السبب بيتحدد صح
   (النت عند المستخدم / السيرفر مش مردود / الداتا واقعة) لأن كل حالة ليها خطوة
   مختلفة على المستخدم — وده اللي كان غلط في الأول: `navigator.onLine` بس.
   التشغيل: cd frontend && npm test
   ───────────────────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkServerHealth,
  classifyHealth,
  resolveRecovery,
  FAIL_THRESHOLD,
  HEALTH_PATH,
  RECOVERY_BANNER_MS,
} from '../serverHealthCore.js';

const okResult = (info = {}) => ({ reachable: true, ok: true, dbOk: info?.database?.ok !== false, info, latencyMs: 120 });

/* ── القاعدة الأساسية: نبضتين فاشلتين = وقوع حقيقي ── */
test('نبضة واحدة فاشلة = تعثّر مش وقوع (ما نطيّرش المستخدم من الشاشة على أول كذبة)', () => {
  const v = classifyHealth({ result: { reachable: false, ok: false, error: 'خطأ شبكة' }, failCount: 0 });
  assert.equal(v.blocked, false);
  assert.equal(v.failCount, 1);
  assert.equal(v.reason, 'unreachable');
});

test('نبضتين فاشلتين متتاليتين = وقوع حقيقي والسبب «السيرفر مش مردود»', () => {
  const v = classifyHealth({ result: { reachable: false, ok: false }, failCount: FAIL_THRESHOLD - 1 });
  assert.equal(v.blocked, true);
  assert.equal(v.failCount, FAIL_THRESHOLD);
  assert.equal(v.reason, 'unreachable');
});

test('نبضة سليمة بتصفّر العدّاد وبترفع الوقوع فوراً', () => {
  const v = classifyHealth({ result: okResult({ boot_id: 'b1' }), failCount: 7 });
  assert.equal(v.ok, true);
  assert.equal(v.failCount, 0);
  assert.equal(v.blocked, false);
  assert.equal(v.reason, null);
});

/* ── تلات حالات مختلفة تماماً ليهم تلات رسائل مختلفة ── */
test('النت مقطوع عند المستخدم ≠ السيرفر واقع', () => {
  const v = classifyHealth({ result: { reachable: false, ok: false }, browserOnline: false, failCount: 1 });
  assert.equal(v.reason, 'offline', 'المشكلة عند المستخدم مش عند السيرفر');
  assert.equal(v.blocked, true);
});

test('السيرفر مردود بس قاعدة البيانات واقعة = أخطر حالة (كل حفظ هيفشل في الصمت)', () => {
  const info = { boot_id: 'b1', database: { ok: false, error: 'timeout' } };
  const v = classifyHealth({ result: { reachable: true, ok: true, dbOk: false, info }, failCount: 0 });
  assert.equal(v.reason, 'database');
  assert.equal(v.blocked, false);
  const v2 = classifyHealth({ result: { reachable: true, ok: true, dbOk: false, info }, failCount: 1 });
  assert.equal(v2.blocked, true, 'بعد نبضتين تطلع الشاشة الحاجبة');
});

test('غياب حقل قاعدة البيانات يتحسب «سليم» (توافق مع سيرفرات أقدم)', () => {
  const v = classifyHealth({ result: { reachable: true, ok: true, dbOk: true, info: { boot_id: 'b1' } }, failCount: 0 });
  assert.equal(v.ok, true);
});

/* ── الرستر: boot_id بيكشف إن السيرفر قام من جديد ── */
test('boot_id اتغير بعد انقطاع ⇒ السيرفر عمل رستر ⇒ نطلب تحديث كامل للصفحة', () => {
  const rec = resolveRecovery({ prevBootId: 'old', info: { boot_id: 'new', revision: 'v2' }, wasBlocked: true, outageMs: 45000, now: 1000 });
  assert.equal(rec.incident.kind, 'restarted');
  assert.equal(rec.incident.bootChanged, true);
  assert.equal(rec.incident.outageMs, 45000);
  assert.equal(rec.bootId, 'new');
  assert.equal(rec.incident.expiresAt, 1000 + RECOVERY_BANNER_MS);
});

test('انقطاع من غير تغيّر boot_id ⇒ «تمت الاستعادة» مش «رستر»', () => {
  const rec = resolveRecovery({ prevBootId: 'same', info: { boot_id: 'same', revision: 'v1' }, wasBlocked: true, outageMs: 8000, now: 500 });
  assert.equal(rec.incident.kind, 'recovered');
  assert.equal(rec.incident.bootChanged, false);
});

test('مافيش إشعار رجوع لو ماكانش في وقوع أصلاً (نبضة عادية)', () => {
  const rec = resolveRecovery({ prevBootId: 'same', info: { boot_id: 'same' }, wasBlocked: false });
  assert.equal(rec.incident, null);
});

test('أول نبضة في حياة الصفحة مش «رستر» (مافيش boot_id سابق)', () => {
  const rec = resolveRecovery({ prevBootId: null, info: { boot_id: 'first' }, wasBlocked: true, outageMs: 100 });
  assert.equal(rec.incident.bootChanged, false);
  assert.equal(rec.bootId, 'first');
});

test('رد ناقص من السيرفر ما يمسحش معلومة قديمة (احتفاظ بآخر boot_id/revision)', () => {
  const rec = resolveRecovery({ prevBootId: 'keep', prevRevision: 'v9', info: null, wasBlocked: false });
  assert.equal(rec.bootId, 'keep');
  assert.equal(rec.revision, 'v9');
});

test('تغيّر الإصدار (revision) بيتحسب رستر برضه — أما "dev" فما بيتحسبش', () => {
  const changed = resolveRecovery({ prevRevision: 'v1', info: { revision: 'v2' }, wasBlocked: true });
  assert.equal(changed.incident.revisionChanged, true);
  const dev = resolveRecovery({ prevRevision: 'dev', info: { revision: 'dev' }, wasBlocked: true });
  assert.equal(dev.incident.revisionChanged, false);
});

/* ── النبضة نفسها (الـ fetch) ── */
const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('النبضة بتقرا /api/health بدون أي توكن مصادقة', async () => {
  let seen = null;
  const res = await withFetch(async (url, opts) => {
    seen = { url: String(url), opts };
    return { ok: true, status: 200, json: async () => ({ status: 'online', boot_id: 'b1', database: { ok: true } }) };
  }, () => checkServerHealth());
  assert.ok(seen.url.includes(HEALTH_PATH), 'بتضرب المسار الصح');
  assert.ok(seen.url.includes('t='), 'بكاش-breaker لتجنب رد قديم');
  assert.equal(seen.opts.headers.Authorization, undefined, 'مفيش توكن — الحارس لازم يشتغل والجلسة منتهية');
  assert.equal(res.ok, true);
  assert.equal(res.info.boot_id, 'b1');
});

test('رد 503 من بوابة الاستضافة = السيرفر مش مردود (مش مشكلة داتا)', async () => {
  const res = await withFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }), () => checkServerHealth());
  assert.equal(res.ok, false);
  assert.equal(res.reachable, false);
  assert.equal(res.status, 503);
  assert.match(res.error, /503/);
});

test('رد 200 بمحتوى مش JSON = رد غير مفهوم (ما نعتبرهوش سليم)', async () => {
  const res = await withFetch(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), () => checkServerHealth());
  assert.equal(res.ok, false);
  assert.equal(res.reachable, true);
  assert.match(res.error, /غير مفهوم/);
});

test('انتهاء المهلة (AbortError) بيتقال بصراحة ومدته', async () => {
  const err = new Error('aborted'); err.name = 'AbortError';
  const res = await withFetch(async () => { throw err; }, () => checkServerHealth({ timeoutMs: 3000 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /3 ثانية/);
});

test('فشل الشبكة العادي بيرجّع رسالة الخطأ نفسها', async () => {
  const res = await withFetch(async () => { throw new Error('Failed to fetch'); }, () => checkServerHealth());
  assert.equal(res.ok, false);
  assert.equal(res.reachable, false);
  assert.match(res.error, /Failed to fetch/);
});
