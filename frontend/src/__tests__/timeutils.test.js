// ⏰ اختبار وحدة زمن المشروع — أهم شيء هنا: «لصق» الوقت في خلايا النسخ/اللصق.
// السبب: حقول الوقت في المشروع مقسّمة (SegTimeField) ولا تقبل كتابة حرة، فلولا
// parseTimeText ما اشتغل النسخ من خانة واللصق في باقي الخانات.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTimeText, normTime, formatTime12 } from '../timeutils.js';

test('parseTimeText: صيغ 12 ساعة (كما تظهر في الشاشة) تُترجم للآلة', () => {
  assert.equal(parseTimeText('09:26 AM'), '09:26');
  assert.equal(parseTimeText('09:26 am'), '09:26');
  assert.equal(parseTimeText('9:26am'), '09:26');
  assert.equal(parseTimeText('2:19pm'), '14:19');
  assert.equal(parseTimeText('2:19 PM'), '14:19');
  assert.equal(parseTimeText('12:00 AM'), '00:00');
  assert.equal(parseTimeText('12:00 PM'), '12:00');
  assert.equal(parseTimeText('11:15 a.m.'), '11:15');
});

test('parseTimeText: صيغ 24 ساعة (بدون مؤشر) تُحفظ كما هي', () => {
  assert.equal(parseTimeText('14:30'), '14:30');
  assert.equal(parseTimeText('09:26'), '09:26');
  assert.equal(parseTimeText('00:05'), '00:05');
  assert.equal(parseTimeText('9:5'), '09:05');
});

test('parseTimeText: المؤشر العربي + الثواني + مسافات لاصقة', () => {
  assert.equal(parseTimeText('9:26 ص'), '09:26');
  assert.equal(parseTimeText('2:19 م'), '14:19');
  assert.equal(parseTimeText('10:30:00'), '10:30');
  assert.equal(parseTimeText('  09:26   AM  '), '09:26');
  assert.equal(parseTimeText('09:26\u202fAM'), '09:26'); // U+202F كما تنسخه بعض المتصفحات
});

test('parseTimeText: أي نص غير مفهوم يُرفض (لا تغيير صامت للقيمة)', () => {
  assert.equal(parseTimeText(''), '');
  assert.equal(parseTimeText('القاهرة'), '');
  assert.equal(parseTimeText('26:70'), '');
  assert.equal(parseTimeText('09:99'), '');
  assert.equal(parseTimeText('25:00'), '');
  assert.equal(parseTimeText('abc 09:26'), '');
});

test('التوافق مع normTime/formatTime12 (نفس دورة العرض في المشروع)', () => {
  // ما يكتبه المستخدم بالأجزاء (24 ساعة) يُعرض 12 ساعة، ونفس القيمة تُلصق وترجع 24
  assert.equal(formatTime12(parseTimeText('09:26 AM')), '09:26 AM');
  assert.equal(formatTime12(parseTimeText('2:19 PM')), '02:19 PM');
  assert.equal(normTime(parseTimeText('11:15 pm')), '23:15');
  // القيمة اللي بيبعتها حقل الوقت المقسّم (HH:MM) تُقرأ كما هي
  assert.equal(normTime('09:26'), '09:26');
  assert.equal(formatTime12('14:19'), '02:19 PM');
});
