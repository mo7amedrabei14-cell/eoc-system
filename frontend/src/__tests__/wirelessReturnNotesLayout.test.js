import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');

test('حقل ملاحظات الاستلام يتجاوز الهامش الافتراضي لعناصر نافذة التأكيد', () => {
  const start = dashboardSource.indexOf("ملاحظات الاستلام (تُطبَّق على كل الأجهزة)");
  assert.notEqual(start, -1, 'return-notes field label should exist');

  const end = dashboardSource.indexOf('</ApertureDialog>', start);
  assert.ok(end > start, 'return-notes field should belong to the confirmation dialog');

  const fieldBlock = dashboardSource.slice(start, end);
  assert.match(fieldBlock, /className="block w-full min-w-0 max-w-full box-border field text-sm"/);
  assert.match(fieldBlock, /width: '100%'/);
  assert.match(fieldBlock, /marginInline: 0/);
});
