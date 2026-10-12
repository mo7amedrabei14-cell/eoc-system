import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getPageTransitionDirection,
  runVisualTransition,
} from '../motion/visualTransitions.js';

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const loginSource = readFileSync(new URL('../Login.jsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');
const routeStyles = readFileSync(new URL('../motion/premiumPageTransitions.css', import.meta.url), 'utf8');

function keyframeBody(name) {
  if (name === 'eoc-route-exit') {
    return routeStyles.match(/@keyframes eoc-route-exit\s*\{([\s\S]*?)\n\}/)?.[1];
  }
  if (name === 'eoc-route-enter') {
    return routeStyles.match(/@keyframes eoc-route-enter\s*\{([\s\S]*?)\n\}/)?.[1];
  }
  if (name === 'eoc-route-fallback-arrive') {
    return routeStyles.match(/@keyframes eoc-route-fallback-arrive\s*\{([\s\S]*?)\n\}/)?.[1];
  }
  return undefined;
}

test('login and dashboard share one named route shell; nested content snapshots are absent', () => {
  assert.match(routeStyles, /\.lx,\s*\.app-shell\s*\{\s*view-transition-name:\s*eoc-route-surface/);
  assert.doesNotMatch(routeStyles, /view-transition-name:\s*eoc-primary-surface/);
  assert.doesNotMatch(routeStyles, /\.lx-deck\s+\.p-7\s*>\s*\.grid/);
  assert.match(routeStyles, /::view-transition-group\(eoc-route-surface\)[\s\S]*?animation-duration:\s*1ms/);
});

test('only the incoming route moves; the outgoing route fades without a second transform', () => {
  const exit = keyframeBody('eoc-route-exit');
  const enter = keyframeBody('eoc-route-enter');
  const fallback = keyframeBody('eoc-route-fallback-arrive');
  assert.ok(exit, 'route exit animation must exist');
  assert.ok(enter, 'route enter animation must exist');
  assert.ok(fallback, 'CSS route fallback must exist');
  assert.doesNotMatch(exit, /transform\s*:/);
  assert.match(exit, /opacity:\s*0/);
  assert.match(enter, /transform:\s*translate3d/);
  assert.match(fallback, /transform:\s*translate3d/);
});

test('CSS fallback resolves both login and dashboard routes', () => {
  assert.match(appSource, /ROUTE_SURFACE_SELECTORS\s*=\s*\{\s*['"]\/['"]:\s*['"]\.lx['"],\s*['"]\/dashboard['"]:\s*['"]\.app-shell['"]/);
  assert.match(appSource, /triggerRouteFallback\(document\.querySelector\(surfaceSelector\)\)/);
  assert.match(appSource, /eocViewTransitionFallback/);
});

test('dashboard page entrance is driven by an actual sidebar index change, not heading text', () => {
  assert.match(appSource, /getPageTransitionDirection\(activeNavigationIndex, nextNavigationIndex\)/);
  assert.doesNotMatch(appSource, /const readActivePage/);
  assert.doesNotMatch(appSource, /if \(nextPage === activePage\) return/);
});

test('login and logout both call the shared route transition helper', () => {
  assert.equal((loginSource.match(/runVisualTransition\(\(\) => navigate\('\/dashboard'\)\)/g) || []).length, 2);
  assert.match(dashboardSource, /const handleLogout = \(\) => \{[\s\S]*?runVisualTransition\(\(\) => \{[\s\S]*?navigate\('\/'\)/);
  assert.match(dashboardSource, /clearStoredAuth\(\);[\s\S]*?runVisualTransition/);
});

test('initial, unavailable and unchanged sidebar indices do not replay a page entrance', () => {
  assert.equal(getPageTransitionDirection(-1, 0), 0);
  assert.equal(getPageTransitionDirection(0, -1), 0);
  assert.equal(getPageTransitionDirection(-1, -1), 0);
  assert.equal(getPageTransitionDirection(3, 3), 0);
});

test('real sidebar navigation returns a consistent direction in either direction', () => {
  assert.equal(getPageTransitionDirection(1, 2), 1);
  assert.equal(getPageTransitionDirection(4, 2), -1);
});

test('invalid sidebar index values never trigger page motion', () => {
  assert.equal(getPageTransitionDirection(null, 1), 0);
  assert.equal(getPageTransitionDirection(1, undefined), 0);
  assert.equal(getPageTransitionDirection(1.5, 2), 0);
});

async function withFakeBrowser({ startViewTransition, reducedMotion = false }, run) {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const root = { dataset: {} };

  globalThis.document = { documentElement: root, startViewTransition };
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };

  try {
    return await run(root);
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

test('supported native route transition runs its update exactly once and clears its marker', async () => {
  await withFakeBrowser({
    startViewTransition(callback) {
      callback();
      return { finished: Promise.resolve() };
    },
  }, async (root) => {
    let updates = 0;
    const transition = runVisualTransition(() => { updates += 1; });
    assert.equal(updates, 1);
    assert.equal(typeof root.dataset.eocViewTransition, 'string');
    await transition.finished;
    await Promise.resolve();
    assert.equal(root.dataset.eocViewTransition, undefined);
  });
});

test('unsupported and reduced-motion paths apply the existing update once', async () => {
  await withFakeBrowser({ reducedMotion: false }, (root) => {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(root.dataset.eocViewTransition, undefined);
  });

  await withFakeBrowser({
    reducedMotion: true,
    startViewTransition(callback) {
      callback();
      return { finished: Promise.resolve() };
    },
  }, (root) => {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(root.dataset.eocViewTransition, undefined);
  });
});

test('failure before a native transition callback falls back without duplicating updates', async () => {
  await withFakeBrowser({
    startViewTransition() {
      throw new Error('native transition unavailable');
    },
  }, (root) => {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(root.dataset.eocViewTransition, undefined);
  });
});

test('failure after the route update marks a visual fallback instead of replaying navigation', async () => {
  await withFakeBrowser({
    startViewTransition(callback) {
      callback();
      throw new Error('native transition rejected after update');
    },
  }, (root) => {
    let updates = 0;
    assert.equal(runVisualTransition(() => { updates += 1; }), undefined);
    assert.equal(updates, 1);
    assert.equal(root.dataset.eocViewTransition, undefined);
    assert.equal(typeof root.dataset.eocViewTransitionFallback, 'string');
  });
});


test('a skipped native transition falls back when it still owns the route marker', async () => {
  let rejectFinished;
  await withFakeBrowser({
    startViewTransition(callback) {
      callback();
      return {
        finished: new Promise((_, reject) => { rejectFinished = reject; }),
      };
    },
  }, async (root) => {
    let updates = 0;
    const transition = runVisualTransition(() => { updates += 1; });
    const token = root.dataset.eocViewTransition;
    rejectFinished(new Error('native transition skipped'));
    await transition.finished.catch(() => {});
    await Promise.resolve();

    assert.equal(updates, 1, 'a skipped snapshot must never replay navigation');
    assert.equal(root.dataset.eocViewTransition, undefined);
    assert.equal(root.dataset.eocViewTransitionFallback, token);
  });
});

test('a stale cancelled transition cannot replace a newer route transition', async () => {
  let rejectFirst;
  let starts = 0;
  await withFakeBrowser({
    startViewTransition(callback) {
      callback();
      starts += 1;
      if (starts === 1) {
        return { finished: new Promise((_, reject) => { rejectFirst = reject; }) };
      }
      return { finished: new Promise(() => {}) };
    },
  }, async (root) => {
    let updates = 0;
    const first = runVisualTransition(() => { updates += 1; });
    const firstToken = root.dataset.eocViewTransition;
    const second = runVisualTransition(() => { updates += 1; });
    const secondToken = root.dataset.eocViewTransition;

    assert.notEqual(firstToken, secondToken);
    rejectFirst(new Error('superseded'));
    await first.finished.catch(() => {});
    await Promise.resolve();

    assert.equal(updates, 2);
    assert.equal(root.dataset.eocViewTransition, secondToken);
    assert.equal(root.dataset.eocViewTransitionFallback, undefined);
    // The second transition intentionally remains pending in this controlled test.
    assert.equal(typeof second.finished.then, 'function');
  });
});
