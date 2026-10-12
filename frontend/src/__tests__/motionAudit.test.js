import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runVisualTransition } from '../motion/visualTransitions.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const cssKeyframeCount = (css, name) => (
  [...css.matchAll(new RegExp(`@keyframes\\s+${name}\\s*\\{`, 'g'))].length
);

function installBrowserMock({ reducedMotion = false, supportsTransitions = true } = {}) {
  const saved = {};
  for (const key of ['document', 'window', 'CustomEvent']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }

  const frames = [];
  const events = [];
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const root = { dataset: {} };
  const documentMock = { documentElement: root };
  if (supportsTransitions) {
    documentMock.startViewTransition = (update) => {
      update();
      return { finished };
    };
  }
  const windowMock = {
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  class CustomEventMock {
    constructor(type) { this.type = type; }
  }

  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: documentMock });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: windowMock });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, writable: true, value: CustomEventMock });

  return {
    root,
    frames,
    events,
    resolveFinished,
    rejectFinished,
    restore() {
      for (const key of Object.keys(saved)) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

test('native route snapshots use one spatial-motion owner and fade-only snapshot keyframes', () => {
  const css = read('../motion/premiumPageTransitions.css');
  assert.match(css, /::view-transition-group\(eoc-primary-surface\)\s*\{[^}]*animation-duration:\s*440ms/s);
  for (const name of ['eoc-surface-exit', 'eoc-surface-enter']) {
    const keyframe = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([^}]*)\\}`));
    assert.ok(keyframe, `missing ${name}`);
    assert.match(keyframe[1], /opacity/);
    assert.doesNotMatch(keyframe[1], /transform|translate|scale/);
  }
  assert.match(css, /\.lx\.eoc-route-fallback-enter\s*\{\s*animation:\s*eoc-route-fallback-fade/);
});

test('login scene keyframes do not collide when their intended motion differs', () => {
  const css = read('../login/loginScene.css');
  for (const name of ['lx-crest-breathe', 'lx-crest-glow-breathe', 'lx-spin-r', 'lx-cord-sway', 'lx-cord-pull']) {
    assert.equal(cssKeyframeCount(css, name), 1, `${name} should have one active definition`);
  }
  assert.match(css, /animation:\s*lx-crest-breathe 3\.8s ease-in-out infinite/);
  assert.match(css, /\.lx-crest-glow\s*\{[^}]*animation:\s*lx-crest-glow-breathe/s);
});

test('tab motion ignores language/direction-only heading changes and observes active navigation', () => {
  const app = read('../App.jsx');
  assert.match(app, /const localeChanged = nextLanguage !== activeLanguage \|\| nextDirection !== activeDirection/);
  assert.match(app, /if \(localeChanged \|\| \(!pageChanged && !navigationChanged\)\) return/);
  assert.match(app, /observer\.observe\(navShell, \{ attributes: true, subtree: true, attributeFilter: \['class'\] \}\)/);
});

test('manual sign-out uses the sidebar crest transition; forced and 401 exits keep their shared fallback', () => {
  const dashboard = read('../Dashboard.jsx');
  assert.ok(dashboard.includes("import { runVisualTransition } from './motion/visualTransitions';"));
  assert.ok(dashboard.includes("import { useAuthEntryTransition } from './motion/AuthEntryTransition';"));
  const calls = dashboard.split("runVisualTransition(() => {").length - 1;
  assert.equal(calls, 2, 'only forced logout and explicit 401 routes use the generic fallback');

  const logoutStart = dashboard.indexOf('const handleLogout = async () => {');
  const logoutEnd = dashboard.indexOf('const renderContent = () => {', logoutStart);
  assert.ok(logoutStart >= 0 && logoutEnd > logoutStart, 'manual logout handler should be present');
  const logout = dashboard.slice(logoutStart, logoutEnd);
  assert.ok(logout.includes("sourceSelector: '.sidebar-brand .erc-vector-logo'"));
  assert.ok(logout.includes("sourceMode: 'logout'"));
  assert.ok(logout.includes('const motionResult = await beginEntryTransition('));
  assert.ok(logout.includes('if (motionResult?.cancelled) return;'));
  assert.ok(logout.includes('clearStoredAuth();'));
  assert.ok(logout.includes("navigate('/');"));
});

test('crest travel starts from the existing login or sidebar logo and preserves route timings', () => {
  const transition = read('../motion/AuthEntryTransition.jsx');
  const css = read('../motion/authEntryTransition.css');
  assert.ok(transition.includes("DEFAULT_LOGIN_LOGO = '.lx-login-brand-mark .erc-vector-logo'"));
  assert.ok(transition.includes('sourceSelector = DEFAULT_LOGIN_LOGO'));
  assert.ok(transition.includes('ENTRY_START_DELAY_MS = 1000'));
  assert.ok(transition.includes('DASHBOARD_COVER_HOLD_MS = 2000'));
  assert.ok(transition.includes('rect.left + rect.width / 2 - window.innerWidth / 2'));
  assert.ok(css.includes('html[data-eoc-crest-motion="login"] .lx-login-brand-mark .erc-vector-logo'));
  assert.ok(css.includes('html[data-eoc-crest-motion="logout"] .sidebar-brand .erc-vector-logo'));
});
test('unsupported browser transition API executes the update once', () => {
  const mock = installBrowserMock({ supportsTransitions: false });
  try {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(Object.keys(mock.root.dataset).length, 0);
    assert.equal(mock.events.length, 0);
  } finally {
    mock.restore();
  }
});

test('reduced-motion preference avoids native snapshots while preserving the route update', () => {
  const mock = installBrowserMock({ reducedMotion: true });
  try {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(Object.keys(mock.root.dataset).length, 0);
  } finally {
    mock.restore();
  }
});

test('successful native transition clears only its own marker and does not request fallback', async () => {
  const mock = installBrowserMock();
  try {
    let updates = 0;
    runVisualTransition(() => { updates += 1; });
    assert.equal(updates, 1);
    assert.equal(mock.root.dataset.eocViewTransition, '1');
    mock.resolveFinished();
    await Promise.resolve();
    assert.equal(mock.root.dataset.eocViewTransition, undefined);
    assert.equal(mock.events.length, 0);
  } finally {
    mock.restore();
  }
});

test('cancelled native transition requests one CSS fallback without replaying navigation', async () => {
  const mock = installBrowserMock();
  try {
    let updates = 0;
    runVisualTransition(() => { updates += 1; });
    mock.rejectFinished(new Error('transition cancelled'));
    await Promise.resolve();
    assert.equal(mock.root.dataset.eocViewTransition, undefined);
    assert.equal(mock.frames.length, 1);
    mock.frames.shift()();
    assert.equal(updates, 1);
    assert.equal(mock.events.length, 1);
    assert.equal(mock.events[0].type, 'eoc:route-transition-fallback');
  } finally {
    mock.restore();
  }
});

test('a cancelled stale transition cannot clear a newer marker or replay fallback', async () => {
  const mock = installBrowserMock();
  try {
    runVisualTransition(() => {});
    mock.root.dataset.eocViewTransition = 'newer-transition';
    mock.rejectFinished(new Error('superseded'));
    await Promise.resolve();
    assert.equal(mock.root.dataset.eocViewTransition, 'newer-transition');
    assert.equal(mock.frames.length, 0);
    assert.equal(mock.events.length, 0);
  } finally {
    mock.restore();
  }
});
