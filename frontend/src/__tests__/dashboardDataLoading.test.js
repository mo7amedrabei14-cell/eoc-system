import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const dashboard = read('../Dashboard.jsx');
const selectSource = read('../components/EocSelect.jsx');
const backend = read('../../../main.py');

test('controlled EocSelect fields provide the native select change handler', () => {
  const nativeSelect = selectSource.match(/<select\s+ref=\{nativeRef\}[\s\S]*?>/);
  assert.ok(nativeSelect, 'the native select element must exist');
  assert.match(nativeSelect[0], /value=\{isControlled \? value : undefined\}/);
  assert.match(nativeSelect[0], /onChange=\{onChange\}/);
});

test('daily dashboard bundle runs endpoint reads concurrently with bounded worker count', () => {
  assert.match(backend, /ThreadPoolExecutor\(max_workers=min\(5, len\(tasks\)\), thread_name_prefix="dashboard-bundle"\)/);
  assert.match(backend, /for future in as_completed\(future_names\):/);
  assert.match(backend, /return \{name: sections\.get\(name\) for name, _ in tasks\}/);
  for (const key of [
    'missions', 'local_news', 'global_disasters', 'earthquakes_global',
    'earthquakes_egypt', 'ai_news', 'weather_daily', 'earthquake_intel',
    'earthquake_intel_status',
  ]) {
    assert.ok(backend.includes(`("${key}", lambda:`), `bundle must retain ${key}`);
  }
});

test('daily dashboard does not wait indefinitely for the bundle before loading indicators', () => {
  assert.match(dashboard, /const DASHBOARD_BUNDLE_TIMEOUT_MS = 4500/);
  assert.match(dashboard, /const HOME_SECTION_TIMEOUT_MS = 9000/);
  assert.match(dashboard, /signal: bundleController\.signal/);
  assert.match(dashboard, /if \(isCurrentScope\(\) && missingSections\.size > 0\)/);
  assert.match(dashboard, /Promise\.allSettled\(Array\.from\(missingSections, async \(sectionKey\) =>/);
  assert.match(dashboard, /if \(section\.isValid\(value\) && isCurrentScope\(\)\) section\.apply\(value\)/);
});

test('date changes abort old dashboard requests and an in-flight load queues the latest date', () => {
  assert.match(dashboard, /homeRequestControllersRef\.current\.forEach\(\(controller\) => controller\.abort\(\)\)/);
  assert.match(dashboard, /homeLoadPendingDateRef\.current = requestedFilterDate/);
  assert.match(dashboard, /const nextFilterDate = homeLoadPendingDateRef\.current/);
  assert.match(dashboard, /loadHomeIndicators\(nextFilterDate\)/);
  assert.match(dashboard, /requestedFilterDate === latestHomeFilterDateRef\.current/);
});
