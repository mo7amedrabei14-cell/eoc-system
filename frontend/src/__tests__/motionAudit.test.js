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

test('all SPA logout-to-login paths use the shared route transition helper without changing auth operations', () => {
  const dashboard = read('../Dashboard.jsx');
  assert.match(dashboard, /import \{ runVisualTransition \} from ['"]\.\/motion\/visualTransitions['"]/);
  const calls = dashboard.match(/runVisualTransition\(\(\) => \{/g) ?? [];
  assert.equal(calls.length, 3, 'manual logout, forced logout, and the explicit 401 route should be animated');
  assert.match(dashboard, /const handleLogout = \(\) => \{\s*clearStoredAuth\(\);\s*runVisualTransition\(\(\) => \{\s*setUserData\(null\);\s*navigate\('\/'\);\s*\}\);\s*\}/);
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
