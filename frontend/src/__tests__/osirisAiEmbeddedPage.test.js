import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');

test('Osiris AI uses the exact requested URL and existing responsive embedded-browser surface', () => {
  assert.match(dashboard, /const OSIRIS_AI_EMBED_URL = 'https:\/\/osirisai\.live\/'/);
  assert.match(dashboard, /<iframe\s+title="Osiris AI"\s+src=\{OSIRIS_AI_EMBED_URL\}/);
  assert.match(dashboard, /className="absolute inset-0 w-full h-full border-0"/);
  assert.match(dashboard, /style=\{\{ height: frameH \? String\(frameH\) \+ 'px' : '70vh' \}\}/);
  assert.match(dashboard, /href=\{OSIRIS_AI_EMBED_URL\}[\s\S]{0,180}target="_blank"[\s\S]{0,120}rel="noopener noreferrer"/);
});

test('Osiris AI follows Earthquake Intelligence and keeps the adjacent page access rule', () => {
  const sidebarEarthquake = dashboard.indexOf("onClick={() => handleNavigation('eq_intel')}");
  const sidebarOsiris = dashboard.indexOf("onClick={() => handleNavigation('osiris_ai')}");
  const operationalHeading = dashboard.indexOf('{/* 🛠️ القسم التشغيلي', sidebarEarthquake);
  assert.ok(sidebarEarthquake >= 0 && sidebarOsiris > sidebarEarthquake);
  assert.ok(operationalHeading > sidebarOsiris, 'Osiris AI should remain before the next existing navigation section');

  const paletteEarthquake = dashboard.indexOf("{ id: 'eq_intel', icon: <EarthquakeIcon />");
  const paletteOsiris = dashboard.indexOf("{ id: 'osiris_ai', icon: <PowerBiIcon />");
  assert.ok(paletteEarthquake >= 0 && paletteOsiris > paletteEarthquake, 'command palette order should mirror the sidebar order');
  assert.match(dashboard, /case 'osiris_ai': return \(!isYouth && weatherEligible\)/);
  assert.match(dashboard, /!isYouth && weatherEligible && <NavItem icon=\{<PowerBiIcon \/>} label="Osiris AI"/);
});

test('Osiris AI uses the standard dashboard title and has a direct external fallback without changing Power BI', () => {
  assert.ok(dashboard.includes("{activeTab === 'osiris_ai' && 'Osiris AI'}"));
  assert.ok(dashboard.includes('title={externalLabel}'));
  assert.ok(dashboard.includes('rel="noopener noreferrer"'));
  assert.ok(dashboard.includes('const POWERBI_EMBED_URL ='));
  assert.ok(dashboard.includes('title="Power BI Dashboard"'));
});
