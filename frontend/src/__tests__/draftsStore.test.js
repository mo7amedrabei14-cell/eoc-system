/* ─────────────────────────────────────────────────────────────────────────────
   💾 اختبارات مخزن المسودات المحلية
   ─────────────────────────────────────────────────────────────────────────────
   الغرض: نضمن إن أي استمارة مفتوحة بتتخزن على الجهاز فعلاً، وإن الاسترجاع
   بيرجّع القيم كاملة، وإن الحقول الحساسة (كلمة المرور) ما تتخزنش أبداً.
   التشغيل: cd frontend && npm test
   ───────────────────────────────────────────────────────────────────────────── */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeStorage, fakeNode, fakeRoot } from './helpers/fakeBrowser.js';
import {
  draftKey,
  hasContent,
  readDraft,
  saveDraft,
  clearDraft,
  listDrafts,
  pruneDrafts,
  captureFields,
  applyFields,
  applyFieldsWhenReady,
  DRAFT_RETENTION_MS,
  MAX_DRAFTS_COUNT,
} from '../draftsStore.js';

installFakeStorage();

beforeEach(() => { globalThis.localStorage.clear(); });

test('مفتاح المسودة منفصل لكل استمارة ونطاق', () => {
  assert.equal(draftKey('mission'), 'eoc_draft_v1:mission');
  assert.equal(draftKey('mission', 'task-77'), 'eoc_draft_v1:mission:task-77');
});

test('الاستمارة الفارغة مالهاش مسودة (ما نزعجش المستخدم بمسودة ملهاش قيمة)', () => {
  assert.equal(hasContent({}), false);
  assert.equal(hasContent(null), false);
  assert.equal(hasContent(undefined), false);
  assert.equal(hasContent({ name: '' }), false);
  assert.equal(hasContent({ name: '   ' }), false);
  assert.equal(hasContent({ done: false }), false);
  assert.equal(hasContent({ active: { checked: false } }), false);
  assert.equal(hasContent([]), false);
  assert.equal(hasContent([{ name: '' }]), false);
});

test('أي محتوى حقيقي يتحسب (نص/رقم/اختيار/صفوف متداخلة)', () => {
  assert.equal(hasContent({ name: 'ندوة' }), true);
  assert.equal(hasContent({ count: 0 }), true, 'الصفر قيمة حقيقية (مش فاضي)');
  assert.equal(hasContent({ count: NaN }), false);
  assert.equal(hasContent({ active: { checked: true } }), true);
  assert.equal(hasContent({ rows: [{ name: 'محمد' }] }), true);
  assert.equal(hasContent({ a: { b: { c: [{ d: 'قيمة' }] } } }), true);
});

test('حماية من التداخل العميق (ما نغرقش في كائنات لا نهائية)', () => {
  let deep = 'قيمة';
  for (let i = 0; i < 9; i += 1) deep = { v: deep };
  assert.equal(hasContent(deep), false, 'أعمق من الحد المسموح ⇒ يترفض بدل ما يعلّق');
});

test('حفظ وقراءة المسودة بيرجّعوا القيم كاملة', () => {
  const payload = { name: 'قافلة طبية', volunteers: 8, rows: [{ name: 'أحمد' }] };
  assert.equal(saveDraft(draftKey('mission', '5'), payload), true);
  const found = readDraft(draftKey('mission', '5'));
  assert.deepEqual(found.payload, payload);
  assert.ok(Math.abs(Date.now() - found.savedAt) < 5000, 'وقت الحفظ مسجّل');
  assert.equal(readDraft(draftKey('mission', '6')), null, 'مافيش خلط بين المهام');
});

test('المسودة الأقدم من أسبوع بتتنضف لوحدها (ما تفضلش تخمّم التخزين)', () => {
  const key = draftKey('news');
  const old = Date.now() - DRAFT_RETENTION_MS - 60 * 1000;
  globalThis.localStorage.setItem(key, JSON.stringify({ payload: { title: 'خبر قديم' }, savedAt: old }));
  assert.equal(readDraft(key), null);
  assert.equal(globalThis.localStorage.getItem(key), null, 'واتشالت من التخزين فعلاً');
});

test('مسودة تالفة لا تكسر الواجهة ولا تُعرض كأنها محتوى', () => {
  const key = draftKey('weather', 'x');
  globalThis.localStorage.setItem(key, '{{{ تالف');
  assert.equal(readDraft(key), null);
  const r = readDraft(key);
  assert.ok(!r || !hasContent(r.payload));
});

test('clearDraft بتمسح مسودة واحدة بس', () => {
  saveDraft(draftKey('a'), { v: '1' });
  saveDraft(draftKey('b'), { v: '2' });
  clearDraft(draftKey('a'));
  assert.equal(readDraft(draftKey('a')), null);
  assert.deepEqual(readDraft(draftKey('b')).payload, { v: '2' });
});

test('listDrafts: بيجيب مسودات النظام فقط، الأحدث الأول، ومش بيتأثر بباقي التخزين', () => {
  const now = Date.now();
  globalThis.localStorage.setItem('some-other-app-key', 'x');
  globalThis.localStorage.setItem(draftKey('old'), JSON.stringify({ payload: { v: 'قديم' }, savedAt: now - 60 * 60 * 1000 }));
  globalThis.localStorage.setItem(draftKey('new'), JSON.stringify({ payload: { v: 'جديد' }, savedAt: now - 60 * 1000 }));
  const all = listDrafts();
  assert.equal(all.length, 2);
  assert.equal(all[0].payload.v, 'جديد', 'الأحدث في المقدمة');
  assert.equal(all[1].payload.v, 'قديم');
});

test(`التنضيف التلقائي بيسيب ${MAX_DRAFTS_COUNT} مسودة كحد أقصى`, () => {
  const total = MAX_DRAFTS_COUNT + 5;
  const now = Date.now();
  for (let i = 0; i < total; i += 1) {
    // الأحدث = الأقرب للوقت الحالي (وكلها جوّه مدة الصلاحية)
    globalThis.localStorage.setItem(draftKey(`f${i}`), JSON.stringify({ payload: { i }, savedAt: now - (total - i) * 1000 }));
  }
  pruneDrafts();
  const kept = listDrafts();
  assert.equal(kept.length, MAX_DRAFTS_COUNT);
  assert.equal(kept[0].payload.i, total - 1, 'أحدث مسودة اتحفظت');
  pruneDrafts(true); // الوضع العنيف (التخزين ممتلئ)
  assert.equal(listDrafts().length, 8);
});

test('التقاط الحقول: بياخد القيم ويتجاهل كلمات المرور والملفات والمعطّلة', () => {
  const root = fakeRoot([
    fakeNode({ id: 'f_name', value: 'ندوة إسعافات أولية' }),
    fakeNode({ id: 'f_volunteers', value: '12' }),
    fakeNode({ id: 'f_active', type: 'checkbox', checked: true }),
    fakeNode({ id: 'f_city', type: 'select-one', value: 'القاهرة' }),
    fakeNode({ id: 'f_pass', type: 'password', value: 'سر123' }),
    fakeNode({ id: 'f_attach', type: 'file', value: 'C:/x.pdf' }),
    fakeNode({ id: 'f_disabled', value: 'لأ', disabled: true }),
    fakeNode({ value: 'بلا id' }),
  ]);
  assert.deepEqual(captureFields(root), {
    f_name: 'ندوة إسعافات أولية',
    f_volunteers: '12',
    f_active: { checked: true },
    f_city: 'القاهرة',
  });
  assert.deepEqual(captureFields(null), {}, 'ما ينهارش لو الاستمارة مش موجودة');
});

test('استرجاع الحقول: بيكتب القيم ويرمي أحداث input/change عشان الاستمارة تحس', () => {
  const name = fakeNode({ id: 'f_name', value: '' });
  const active = fakeNode({ id: 'f_active', type: 'checkbox', checked: false });
  const same = fakeNode({ id: 'f_code', value: 'ABC' });
  const pass = fakeNode({ id: 'f_pass', type: 'password', value: '' });
  const root = fakeRoot([name, active, same, pass]);

  const applied = applyFields(root, {
    f_name: 'قافلة',
    f_active: { checked: true },
    f_code: 'ABC',
    f_pass: 'سر جديد',
    f_missing: 'مش موجود',
  });

  assert.equal(name.value, 'قافلة');
  assert.deepEqual(name.fired, ['input', 'change']);
  assert.equal(active.checked, true);
  assert.deepEqual(active.fired, ['change']);
  assert.equal(same.value, 'ABC');
  assert.deepEqual(same.fired, [], 'القيمة اللي ما اتغيرتش مش بتتبعتش أحداث');
  assert.equal(pass.value, '', 'كلمة المرور ما تترجعش أبداً');
  assert.equal(applied, 2, 'العدّاد بيعدّ الحقول اللي اتغيرت فعلاً');
});

test('applyFieldsWhenReady بستنى صفوف React الديناميكية لحد ما تظهر', async () => {
  const node = fakeNode({ id: 'f_late', value: '' });
  const nodes = [];
  const root = fakeRoot(nodes);
  let lookups = 0;
  const findById = () => { lookups += 1; if (lookups > 2) nodes.push(node); return nodes[0] || null; };

  const applied = await applyFieldsWhenReady(root, { f_late: 'ظهر أخيراً' }, { attempts: 10, intervalMs: 5, findById });

  assert.equal(applied, 1);
  assert.equal(node.value, 'ظهر أخيراً');
  assert.ok(lookups > 2, 'فعلاً استنى وأعاد المحاولة');
});

test('applyFieldsWhenReady ما يعلّقش لو الحقول مش بتظهر خالص', async () => {
  const root = fakeRoot([]);
  const applied = await applyFieldsWhenReady(root, { f_never: 'x' }, { attempts: 3, intervalMs: 2, findById: () => null });
  assert.equal(applied, 0, 'بينتهي بعد عدد المحاولات المحدد ويرجّع صفر');
});
