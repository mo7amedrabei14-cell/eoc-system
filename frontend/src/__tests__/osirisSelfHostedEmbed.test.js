import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');
const component = readFileSync(new URL('../osiris/OsirisAiView.jsx', import.meta.url), 'utf8');
const devEnv = readFileSync(new URL('../../.env.development', import.meta.url), 'utf8');
const deploymentRoot = new URL('../../../deployment/osiris-embed/', import.meta.url);
const compose = readFileSync(new URL('docker-compose.yml', deploymentRoot), 'utf8');
const proxy = readFileSync(new URL('nginx.conf.template', deploymentRoot), 'utf8');

test('OSIRIS is reachable from dashboard navigation and respects the existing youth exclusion', () => {
  assert.match(dashboard, /import OsirisAiView from '\.\/osiris\/OsirisAiView';/);
  assert.match(dashboard, /const isOsirisExcluded = String\(userData\?\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'yveoc';/);
  assert.match(dashboard, /case 'osiris_ai': return \(!isOsirisExcluded\)/);
  assert.match(dashboard, /id: 'osiris_ai', icon: <GlobalWorldIcon \/>/);
  assert.match(dashboard, /label="Osiris AI" isActive=\{activeTab === 'osiris_ai'\}/);
  assert.match(dashboard, /activeTab === 'osiris_ai' && 'Osiris AI'/);
});

test('local development defaults to the local self-hosted OSIRIS service and diagnoses connection failure', () => {
  assert.ok(devEnv.includes('VITE_OSIRIS_URL=http://localhost:3001'));
  assert.ok(compose.includes('EOC_ALLOWED_ORIGIN: ${EOC_ALLOWED_ORIGIN:-http://localhost:5173}'));
  assert.ok(component.includes("fetch(new URL('/api/health', OSIRIS_EMBED_URL).href"));
  assert.ok(component.includes("setServiceCheckKey(value => value + 1)"));
  assert.match(component, /if \(!OSIRIS_EMBED_URL \|\| serviceStatus !== 'ready'\)/);
  assert.ok(component.includes('local OSIRIS service is not responding on port 3001'));
});

test('the dashboard never embeds the public demo directly when self-hosting is not configured', () => {
  assert.match(component, /VITE_OSIRIS_URL/);
  assert.match(component, /const OSIRIS_EMBED_URL = resolveSelfHostedOsirisUrl\(\)/);
  assert.match(component, /src=\{OSIRIS_EMBED_URL\}/);
  assert.match(component, /href=\{OFFICIAL_OSIRIS_URL\}/);
  assert.match(component, /setFrameKey\(value => value \+ 1\)/);
  assert.match(component, /ResizeObserver/);
  assert.match(component, /requestFullscreen/);
  assert.match(component, /allowFullScreen/);
  assert.match(component, /loading="eager"/);
  assert.doesNotMatch(component, /src=\{OFFICIAL_OSIRIS_URL\}/);
});

test('the self-hosting proxy removes SAMEORIGIN blocking but restricts framing to the configured EOC origin', () => {
  assert.match(compose, /github\.com\/simplifaisoul\/osiris\.git#0aaba3838b550f83eeeaea99e5179d24f85ad65c/);
  assert.ok(proxy.includes('proxy_hide_header X-Frame-Options;'));
  assert.ok(proxy.includes('frame-ancestors ${EOC_ALLOWED_ORIGIN}'));
  assert.ok(proxy.includes('proxy_pass http://osiris-app:3000/'));
});
