import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParticipantRows } from '../participantImport.js';

const branches = [
  { id: 8, name: 'الجيزة' },
  { id: 19, name: 'القاهرة' },
];

test('parses volunteer and non-volunteer rows with conditional fields', () => {
  const result = parseParticipantRows([
    ['النوع', 'الاسم', 'رقم العضوية', 'صفة المشارك', 'الفرع'],
    ['متطوع', 'أحمد علي', '00125', '', 'الجيزة'],
    ['غير متطوع', 'سارة محمد', '', 'مسعفة', 'فرع غير معروف'],
    ['', '', '', '', ''],
  ], branches);

  assert.deepEqual(result.errors, []);
  assert.equal(result.participants.length, 2);
  assert.equal(result.participants[0].participation_role, '00125');
  assert.equal(result.participants[0].branch_id, 8);
  assert.equal(result.participants[0].participant_position, '');
  assert.equal(result.participants[1].participation_role, '');
  assert.equal(result.participants[1].participant_position, 'مسعفة');
  assert.equal(result.participants[1].branch_id, null);
});

test('reports all conditional-field errors and rejects invalid volunteer branches', () => {
  const result = parseParticipantRows([
    ['النوع', 'الاسم', 'رقم العضوية', 'صفة المشارك', 'الفرع'],
    ['متطوع', 'مشارك', '', '', 'فرع غير معروف'],
    ['غير متطوع', 'مشارك آخر', '', '', 'الجيزة'],
  ], branches);

  assert.deepEqual(result.participants, []);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /رقم العضوية مطلوب/);
  assert.match(result.errors[0], /غير موجود في قائمة الفروع/);
  assert.match(result.errors[1], /صفة المشارك مطلوبة/);
});

test('requires the documented header order', () => {
  const result = parseParticipantRows([
    ['الاسم', 'النوع', 'رقم العضوية', 'صفة المشارك', 'الفرع'],
  ], branches);

  assert.deepEqual(result.participants, []);
  assert.match(result.errors[0], /بالترتيب/);
});
