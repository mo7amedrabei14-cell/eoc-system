// اختبارات محرّك الإشعارات اللحظية — node --test (بدون أي حزم إضافية)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_TONES,
  LIVE_FALLBACK,
  notifyVisual,
  notifyLabel,
  formatEventAge,
  pauseToastClock,
  resumeToastClock,
  shouldExpireToast,
  shouldPurgeToast,
  logicalEventKey,
  normalizeActionText,
  shouldSuppressDuplicate,
  rememberEventKey,
  initialsFrom,
  DUPLICATE_WINDOW_MS,
} from '../liveToast.js';

const TOKEN_TONES = ['accent', 'info', 'warn', 'ok', 'data', 'ai', 'quake'];

test('كل نوع حدث معروف له نبرة لونية من توكنات الثيم', () => {
  for (const [type, v] of Object.entries(LIVE_TONES)) {
    assert.ok(TOKEN_TONES.includes(v.tone), `${type} → نبرة غير معروفة: ${v.tone}`);
    assert.ok(typeof v.kind === 'string' && v.kind.length > 0, `${type} بدون أيقونة`);
  }
});

test('نوع حدث مجهول يسقط على الاحتياطي بدون انهيار', () => {
  for (const weird of [undefined, null, '', 'brand_new_type', 123, {}]) {
    assert.deepEqual(notifyVisual(weird), LIVE_FALLBACK);
  }
});

test('الأخبار معلومة، الزلزال انتباه، الطقس قياس، التسليم اكتمال، الرصد الآلي ذكاء، استخبارات الزلازل أصفر مميز', () => {
  assert.equal(notifyVisual('local_news').tone, 'info');
  assert.equal(notifyVisual('earthquake').tone, 'warn');
  assert.equal(notifyVisual('weather').tone, 'data');
  assert.equal(notifyVisual('handover').tone, 'ok');
  assert.equal(notifyVisual('ai_news').tone, 'ai');
  assert.equal(notifyVisual('eq_intel').tone, 'quake');
});

test('التسميات عربية/إنجليزية وكل نوع له الاثنتان', () => {
  for (const type of Object.keys(LIVE_TONES)) {
    const ar = notifyLabel(type, 'ar');
    const en = notifyLabel(type, 'en');
    assert.ok(ar && en && ar !== en, `${type}: تسمية ناقصة`);
    assert.ok(!/undefined/.test(ar + en));
  }
  assert.equal(notifyLabel('mission', 'ar'), 'مهمة');
  assert.equal(notifyLabel('mission', 'en'), 'Mission');
});

test('نوع مجهول يرجع نصًّا عامًّا واضحًا في اللغتين', () => {
  assert.equal(notifyLabel('whatever', 'ar'), 'تحديث لحظي');
  assert.equal(notifyLabel('whatever', 'en'), 'Live update');
});

test('عمر الحدث: الآن ثم ثوانٍ ثم دقائق ثم ساعات', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  const at = (secsAgo) => new Date(now - secsAgo * 1000).toISOString();

  assert.equal(formatEventAge(at(0), 'ar', now), 'الآن');
  assert.equal(formatEventAge(at(4), 'ar', now), 'الآن');
  assert.equal(formatEventAge(at(12), 'ar', now), 'منذ 12 ث');
  assert.equal(formatEventAge(at(90), 'ar', now), 'منذ 1 د');
  assert.equal(formatEventAge(at(3600 * 3), 'ar', now), 'منذ 3 س');

  assert.equal(formatEventAge(at(0), 'en', now), 'now');
  assert.equal(formatEventAge(at(12), 'en', now), '12s ago');
  assert.equal(formatEventAge(at(90), 'en', now), '1m ago');
});

test('عمر الحدث: مدخلات تالفة لا تكسر الواجهة (نص فاضي بدل NaN)', () => {
  for (const bad of [null, undefined, '', 'مش تاريخ', {}, NaN]) {
    assert.equal(formatEventAge(bad, 'ar'), '');
  }
});

test('تاريخ في المستقبل (فرق ساعات الأجهزة) لا يطلع «منذ -30 ث»', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  const future = new Date(now + 30000).toISOString();
  assert.equal(formatEventAge(future, 'ar', now), 'الآن');
});

test('الوقفة تُخزَّن مرة واحدة ولا تُفسد العدّاد بالوقوف المتكرر', () => {
  const t = { id: 'a', shownAt: 1000 };
  const paused = pauseToastClock(t, 5000);
  assert.equal(paused.pausedAt, 5000);
  const again = pauseToastClock(paused, 7000);
  assert.equal(again.pausedAt, 5000, 'الوقفة الثانية يجب ألا تحدّث اللحظة');
  assert.equal(again, paused, 'بدون تغيير ⇒ نفس الكائن (بلا رسم زائد)');
});

test('الرجوع بعد وقفة 4 ثوانٍ يؤجّل الانقضاء 4 ثوانٍ بالظبط', () => {
  const t = { id: 'a', shownAt: 1000, pausedAt: 5000 };
  const resumed = resumeToastClock(t, 9000);
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.shownAt, 5000, '1000 + 4000 من الوقفة');
  // العمر 9 ثوانٍ = 10000؛ عند 9900 لازم يظل ظاهرًا، وعند 10000 ينقضي
  const nowAfter = 5000 + 9000;
  assert.equal(shouldExpireToast(resumed, nowAfter - 100, 9000), false);
  assert.equal(shouldExpireToast(resumed, nowAfter, 9000), true);
});

test('الرجوع بدون وقفة لا يغيّر شيئًا (نفس الكائن)', () => {
  const t = { id: 'a', shownAt: 1000, pausedAt: null };
  assert.equal(resumeToastClock(t, 9999), t);
  assert.equal(resumeToastClock(null), null);
});

test('التوست الموقوف لا ينقضي أبدًا مهما طال الزمن', () => {
  const t = { id: 'a', shownAt: 0, pausedAt: 1 };
  assert.equal(shouldExpireToast(t, 60 * 60 * 1000, 9000), false);
});

test('التوست الذي لم يظهر بعد (في الطابور) لا ينقضي', () => {
  assert.equal(shouldExpireToast({ id: 'q' }, Date.now(), 9000), false);
  assert.equal(shouldExpireToast({ id: 'q', shownAt: null }, Date.now(), 9000), false);
});

// ── 🛡️ تكرار الأحداث (السبب الجذري في الإنتاج) ────────────────────────────

const evt = (over = {}) => ({
  event_id: 1, event_type: 'earthquake', actor_user_id: 7, actor_name: 'أحمد',
  action: 'إضافة زلزال عالمي', entity_id: 41, mission_id: null, created_at: '2026-09-28T01:07:27Z', ...over,
});

test('التطبيع: «إضافة زلزال» و«إضافة زلزال محلي» و«إضافة زلزال عالمي» = نفس النص', () => {
  const a = normalizeActionText('إضافة زلزال محلي');
  assert.equal(a, normalizeActionText('إضافة زلزال عالمي'));
  assert.equal(a, normalizeActionText('إضافة زلزال'));
  assert.equal(normalizeActionText('  إضافة   زلزال   محلى  '), 'اضافه زلزال');
  assert.equal(normalizeActionText('إضافة زلزال محليه'), 'اضافه زلزال');
});

test('التطبيع: الحركات المختلفة فعلاً تفضل مختلفة', () => {
  assert.notEqual(normalizeActionText('إضافة زلزال محلي'), normalizeActionText('حذف زلزال محلي'));
  assert.notEqual(normalizeActionText('انضمام'), normalizeActionText('انفصال'));
  assert.notEqual(normalizeActionText('حفظ توقعات الطقس'), normalizeActionText('تنزيل الطقس اليومي'));
});

test('الزلزال الواحد باسمين مختلفين = نفس المفتاح المنطقي (السبب الحقيقي للتكرار)', () => {
  const global = evt({ event_id: 900, action: 'إضافة زلزال عالمي' });
  const local = evt({ event_id: 901, action: 'إضافة زلزال محلي' });
  assert.equal(logicalEventKey(global), logicalEventKey(local));
});

test('نفس الحركة لسجلين مختلفين = مفتاحان مختلفان (لا يُدمجان)', () => {
  assert.notEqual(logicalEventKey(evt({ entity_id: 41 })), logicalEventKey(evt({ entity_id: 42 })));
});

test('نفس الحركة من فاعلين مختلفين = مفتاحان مختلفان', () => {
  assert.notEqual(logicalEventKey(evt({ actor_user_id: 7 })), logicalEventKey(evt({ actor_user_id: 8 })));
});

test('نوعان مختلفان لنفس السجل = مفتاحان مختلفان', () => {
  assert.notEqual(logicalEventKey(evt({ event_type: 'earthquake' })), logicalEventKey(evt({ event_type: 'local_news' })));
});

test('رصد الذكاء الاصطناعي: الفاعل غير مهم (كله actor_user_id = null)', () => {
  const a = evt({ event_type: 'ai_news', actor_user_id: null, entity_id: 5, action: 'رصد خبر' });
  const b = evt({ event_type: 'ai_news', actor_user_id: null, entity_id: 5, action: 'رصد خبر' });
  assert.equal(logicalEventKey(a), logicalEventKey(b));
  assert.ok(logicalEventKey(a).includes('auto'));
});

test('الحارس يمنع التكرار داخل النافذة ويسمح به بعدها', () => {
  const recent = new Map();
  const key = logicalEventKey(evt());
  const t0 = 1_000_000;
  assert.equal(shouldSuppressDuplicate(recent, key, t0), false, 'أول مرة: يظهر');
  rememberEventKey(recent, key, t0);
  assert.equal(shouldSuppressDuplicate(recent, key, t0 + 5_000), true, 'بعد 5 ثوان: مكرر');
  assert.equal(shouldSuppressDuplicate(recent, key, t0 + DUPLICATE_WINDOW_MS - 1), true);
  assert.equal(shouldSuppressDuplicate(recent, key, t0 + DUPLICATE_WINDOW_MS + 1), false, 'بعد النافذة: حركة جديدة تظهر');
});

test('الذاكرة تُنظَّف: مفاتيح منتهية تُحذف ولا تتراكم', () => {
  const recent = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i += 1) rememberEventKey(recent, `k${i}`, t0 + i);
  assert.equal(recent.size, 30);
  rememberEventKey(recent, 'later', t0 + DUPLICATE_WINDOW_MS + 100);
  assert.equal(recent.size, 1, 'كل المفاتيح القديمة اتشالت');
});

test('مفتاح فاضي أو خريطة غير صالحة لا يكسران النظام', () => {
  assert.equal(shouldSuppressDuplicate(null, 'x'), false);
  assert.equal(shouldSuppressDuplicate(new Map(), ''), false);
  const empty = new Map();
  assert.equal(rememberEventKey(empty, ''), empty, 'المفتاح الفاضي لا يُسجّل');
  assert.equal(empty.size, 0);
  assert.equal(logicalEventKey(null), '');
  assert.equal(normalizeActionText(undefined), '');
});

test('مونوجرام الفاعل: حرفان مفيدان من الاسم (عربي/إنجليزي)', () => {
  assert.equal(initialsFrom('أحمد محمود'), 'أم');
  assert.equal(initialsFrom('Ahmed Ali'), 'AA');
  assert.equal(initialsFrom('Sara'), 'Sa');
  assert.equal(initialsFrom('  '), '');
  assert.equal(initialsFrom(null), '');
  assert.equal(initialsFrom(undefined), '');
});

test('مونوجرام الفاعل يتخطّى الرتبة/اللقب في البداية', () => {
  // بدون تخطّي الرتبة كان هيرجّع «مم» / «ده» — يعني حرف مالوش معنى
  assert.equal(initialsFrom('م. محمد أحمد'), 'مأ');
  assert.equal(initialsFrom('د. هالة سمير'), 'هس');
  assert.equal(initialsFrom('Eng. Omar Nabil'), 'ON');
});

test('المنقضي/الخارج لا ينقضي مرتين ولا يُحذف قبل أن تكتمل حركته', () => {
  const closing = { id: 'a', shownAt: 0, closing: true, closingAt: 1000 };
  assert.equal(shouldExpireToast(closing, 999999, 9000), false);
  assert.equal(shouldPurgeToast(closing, 1000 + 319, 320), false);
  assert.equal(shouldPurgeToast(closing, 1000 + 320, 320), true);
  assert.equal(shouldPurgeToast({ id: 'b' }, 999999, 320), false, 'غير مغلق لا يُحذف');
});
