import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');
const osirisStart = dashboard.indexOf("const OSIRIS_AI_EMBED_URL = 'https://osirisai.live/';");
const osirisEndMarker = 'const MemoOsirisAiView = memo(OsirisAiView);';
const osirisEnd = dashboard.indexOf(osirisEndMarker, osirisStart);
const osirisComponent = dashboard.slice(osirisStart, osirisEnd + osirisEndMarker.length);

test('Osiris AI excludes only the yveoc account through the current username field', () => {
  assert.match(dashboard, /const isOsirisExcluded = String\(userData\?\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'yveoc';/);
  assert.match(dashboard, /!isOsirisExcluded \? \[\{ id: 'osiris_ai'/);
  assert.match(dashboard, /!isOsirisExcluded && <NavItem icon=\{<PowerBiIcon \/>} label="Osiris AI"/);
  assert.match(dashboard, /if \(tabName === 'osiris_ai' && isOsirisExcluded\) tabName = 'missions';/);
  assert.match(dashboard, /case 'osiris_ai': return \(!isOsirisExcluded\)/);
  assert.ok(dashboard.includes("case 'eq_intel': return (!isYouth && weatherEligible)"));
  assert.ok(dashboard.includes("case 'gov_contacts': return (!isYouth && weatherEligible)"));
});

test('Osiris AI preserves the external link and reloads only its iframe', () => {
  assert.match(osirisComponent, /const OSIRIS_AI_EMBED_URL = 'https:\/\/osirisai\.live\/'/);
  assert.match(osirisComponent, /<iframe\s+key=\{frameKey\}\s+title="Osiris AI"\s+src=\{OSIRIS_AI_EMBED_URL\}/);
  assert.match(osirisComponent, /loading="eager"/);
  assert.match(osirisComponent, /setFrameKey\(value => value \+ 1\)/);
  assert.match(osirisComponent, /if \(refreshLockRef\.current\) return/);
  assert.match(osirisComponent, /disabled=\{refreshing\}/);
  assert.match(osirisComponent, /href=\{OSIRIS_AI_EMBED_URL\}[\s\S]{0,180}target="_blank"[\s\S]{0,120}rel="noopener noreferrer"/);
  assert.match(osirisComponent, /aria-label=\{externalLabel\}/);
  assert.doesNotMatch(osirisComponent, /window\.location\.reload\(/);
});

test('Osiris AI fullscreen enters/exits through the browser API and has a CSS fallback', () => {
  assert.match(osirisComponent, /card\.requestFullscreen\(\)/);
  assert.match(osirisComponent, /document\.exitFullscreen\(\)/);
  assert.match(osirisComponent, /fullscreenchange/);
  assert.match(osirisComponent, /fallbackFullscreen \? 'fixed inset-0 z-\[9999\] h-screen w-screen/);
  assert.match(osirisComponent, /aria-pressed=\{isFullscreen\}/);
  assert.match(osirisComponent, /absolute top-3 right-3 z-10/);
  assert.match(osirisComponent, /lang === 'ar'\s+\? \(isFullscreen \? 'الخروج من ملء الشاشة' : 'ملء الشاشة'\)/);
});

test('Osiris AI retains responsive sizing without a perpetual measurement timer', () => {
  assert.match(osirisComponent, /new ResizeObserver\(measure\)/);
  assert.match(osirisComponent, /window\.addEventListener\('resize', measure\)/);
  assert.doesNotMatch(osirisComponent, /setInterval\(/);
  assert.ok(dashboard.includes("const POWERBI_EMBED_URL ="));
  assert.ok(dashboard.includes('title="Power BI Dashboard"'));
});
