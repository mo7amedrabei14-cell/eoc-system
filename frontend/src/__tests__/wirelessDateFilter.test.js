import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wirelessDeliveryDateMatchesFilter,
  wirelessDeliveryStatusAtFilterDate,
  wirelessDeliveryReturnDate,
  wirelessDeliveryDailyActivity,
} from '../wirelessDateFilter.js';

const delivery = (overrides = {}) => ({
  delivery_id: 1,
  received_date: '2026-10-10',
  status: 'مسلَّم',
  returned_at: '',
  return_notes: '',
  devices: [{ device_type: 'MOTOROLA' }, { device_type: 'HUAWEI' }],
  ...overrides,
});

test('بدون فلتر تاريخ يعرض السجل كاملاً', () => {
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), ''), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery({ received_date: '2026-10-20' }), ''), true);
});

test('السجل اليومي لا يجمع التسليمات المفتوحة من الأيام السابقة', () => {
  const oldOpen = delivery({ received_date: '2026-10-10' });
  assert.equal(wirelessDeliveryDateMatchesFilter(oldOpen, '2026-10-11'), false);
  assert.equal(wirelessDeliveryDateMatchesFilter(oldOpen, '2026-10-18'), false);
  assert.equal(wirelessDeliveryDateMatchesFilter(oldOpen, '2026-10-18', true), true);
});

test('التسليم يظهر في يوم تسليمه حتى لو أُرجع في يوم لاحق', () => {
  const returned = delivery({ status: 'مُرجَع', returned_at: '2026-10-18 14:32' });
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-10'), true);
  assert.equal(wirelessDeliveryStatusAtFilterDate(returned, '2026-10-10'), 'مسلَّم');
});

test('التسليم المُرجع يظهر مرة أخرى في سجل يوم الاستلام فقط', () => {
  const returned = delivery({ status: 'مُرجَع', returned_at: '2026-10-18 14:32' });
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-17'), false);
  assert.equal(wirelessDeliveryStatusAtFilterDate(returned, '2026-10-17'), 'مسلَّم');
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-18'), true);
  assert.equal(wirelessDeliveryStatusAtFilterDate(returned, '2026-10-18'), 'مُرجَع');
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-19'), false);
});

test('يستخرج تاريخ الاستلام فقط من الطابع الزمني ويحمي القيم الفارغة والتالفة', () => {
  assert.equal(wirelessDeliveryReturnDate(delivery({ returned_at: '2026-10-18 14:32' })), '2026-10-18');
  assert.equal(wirelessDeliveryReturnDate(delivery({ returned_at: '' })), '');
  assert.equal(wirelessDeliveryReturnDate(delivery({ returned_at: null })), '');
  assert.equal(wirelessDeliveryReturnDate(delivery({ returned_at: 'not a date' })), '');
});

test('السجل القديم دون تاريخ استلام موثوق لا يظهر كحركة في أيام لاحقة', () => {
  const legacyReturned = delivery({ status: 'مُرجَع', returned_at: '' });
  assert.equal(wirelessDeliveryDateMatchesFilter(legacyReturned, '2026-10-10'), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(legacyReturned, '2026-10-11'), false);
});

test('عدّاد التسليم اليومي يبدأ من صفر في التاريخ الجديد ولا يحتسب تواريخ سابقة', () => {
  const history = [delivery({received_date:'2026-10-10',status:'مسلَّم',devices:[{device_type:'MOTOROLA'},{device_type:'MOTOROLA'}]})];
  assert.deepEqual(wirelessDeliveryDailyActivity(history,'2026-10-10','TETRA'), {issued:2,returned:0});
  assert.deepEqual(wirelessDeliveryDailyActivity(history,'2026-10-11','TETRA'), {issued:0,returned:0});
});

test('عداد الاستلام يحسب الأجهزة المُرجعة في يوم الإرجاع حسب النوع', () => {
  const history=[delivery({received_date:'2026-10-10',status:'مُرجَع',returned_at:'2026-10-18 14:32',devices:[{device_type:'MOTOROLA'},{device_type:'MOTOROLA'},{device_type:'HUAWEI'}]})];
  assert.deepEqual(wirelessDeliveryDailyActivity(history,'2026-10-18','TETRA'), {issued:0,returned:2});
  assert.deepEqual(wirelessDeliveryDailyActivity(history,'2026-10-18','HUAWEI'), {issued:0,returned:1});
});

test('العهدة المفتوحة من الأمس لا تُعتبر مُرجعة لمجرد بدء يوم جديد', () => {
  const history=[delivery({received_date:'2026-10-10',status:'مسلَّم'})];
  assert.deepEqual(wirelessDeliveryDailyActivity(history,'2026-10-11','TETRA'), {issued:0,returned:0});
  assert.equal(history[0].status,'مسلَّم');
});
