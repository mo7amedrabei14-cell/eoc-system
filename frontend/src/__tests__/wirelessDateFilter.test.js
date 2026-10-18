import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wirelessDeliveryDateMatchesFilter,
  wirelessDeliveryStatusAtFilterDate,
  wirelessDeliveryReturnDate,
} from '../wirelessDateFilter.js';

const delivery = (overrides = {}) => ({
  delivery_id: 1,
  received_date: '2026-10-10',
  status: 'مسلَّم',
  returned_at: '',
  return_notes: '',
  ...overrides,
});

test('بدون فلتر تاريخ يعرض السجل كاملاً', () => {
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), ''), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery({ received_date: '2026-10-20' }), ''), true);
});

test('لا يظهر التسليم عند اختيار يوم أقدم من تاريخ التسليم', () => {
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), '2026-10-09'), false);
});

test('التسليم المفتوح يظهر يوم تسليمه وفي الأيام التالية', () => {
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), '2026-10-10'), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), '2026-10-11'), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(delivery(), '2026-10-18'), true);
});

test('التسليم المغلق يظهر كمسلم قبل يوم الاستلام، وفي يوم الاستلام فقط بعده', () => {
  const returned = delivery({ status: 'مُرجَع', returned_at: '2026-10-18 14:32' });
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-09'), false);
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-10'), true);
  assert.equal(wirelessDeliveryStatusAtFilterDate(returned, '2026-10-10'), 'مسلَّم');
  assert.equal(wirelessDeliveryDateMatchesFilter(returned, '2026-10-17'), true);
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

test('السجل القديم دون تاريخ استلام موثوق لا يُعرض كأنه مفتوح في أيام تالية', () => {
  const legacyReturned = delivery({ status: 'مُرجَع', returned_at: '' });
  assert.equal(wirelessDeliveryDateMatchesFilter(legacyReturned, '2026-10-10'), true);
  assert.equal(wirelessDeliveryDateMatchesFilter(legacyReturned, '2026-10-11'), false);
});
