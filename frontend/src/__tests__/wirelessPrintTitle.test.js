import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWirelessPrintTitle } from '../wirelessPrintTitle.js';

test('اسم PDF لتسليم واحد يتضمن المستلم وتاريخ اليوم وعدد الأجهزة', () => {
  assert.equal(
    buildWirelessPrintTitle([
      { full_name: 'محمد ربيع', devices: [{}, {}, {}] },
    ], '2026-10-18'),
    'تسليم لاسلكي إلى محمد ربيع - 2026-10-18 - 3 أجهزة',
  );
});

test('يعتمد عدد الأجهزة على تفاصيل الأجهزة الفعلية عند توفرها', () => {
  const title = buildWirelessPrintTitle([
    { full_name: 'أحمد علي', devices: [{}, {}], device_count: 99 },
  ], '2026-10-18');
  assert.ok(title.endsWith('2 جهازان'));
});

test('يستخدم عدد الأجهزة المحسوب عند عدم وجود مصفوفة التفاصيل', () => {
  const title = buildWirelessPrintTitle([
    { full_name: 'أحمد علي', device_count: 4 },
  ], '2026-10-18');
  assert.ok(title.endsWith('4 أجهزة'));
});

test('عند طباعة أكثر من مستلم يذكر الأول وآخرين مع الإجمالي', () => {
  const title = buildWirelessPrintTitle([
    { full_name: 'أحمد علي', devices: [{}, {}] },
    { full_name: 'منى حسن', devices: [{}, {}] },
  ], '2026-10-18');
  assert.equal(title, 'تسليم لاسلكي إلى أحمد علي وآخرون - 2026-10-18 - 4 أجهزة');
});

test('يعالج الاسم الفارغ والقيم غير الصالحة بدون كسر اسم الملف', () => {
  const title = buildWirelessPrintTitle([
    { full_name: '', devices: null, device_count: -3 },
  ], '2026-10-18');
  assert.equal(title, 'تسليم لاسلكي إلى غير محدد - 2026-10-18 - 0 جهاز');
});

test('يزيل محارف أسماء الملفات غير المسموحة ويحد طول العنوان', () => {
  const title = buildWirelessPrintTitle([
    { full_name: 'أحمد / علي: اختبار؟', device_count: 1 },
  ], '2026-10-18');
  assert.ok(!/[<>:"/\\|?*]/.test(title));
  assert.ok(title.length <= 180);
});
