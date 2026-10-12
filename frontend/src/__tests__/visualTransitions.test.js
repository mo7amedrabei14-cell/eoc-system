import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getPageTransitionDirection,
  runVisualTransition,
} from '../motion/visualTransitions.js';

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const transitionStyles = readFileSync(new URL('../motion/premiumPageTransitions.css', import.meta.url), 'utf8');

test('route snapshot children fade only; the transition group owns spatial movement', () => {
  const exit = transitionStyles.match(/@keyframes eoc-surface-exit\s*\{([\s\S]*?)\n\}/)?.[1];
  const enter = transitionStyles.match(/@keyframes eoc-surface-enter\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(exit, 'exit keyframe must exist');
  assert.ok(enter, 'enter keyframe must exist');
  assert.doesNotMatch(exit, /transform\s*:/);
  assert.doesNotMatch(enter, /transform\s*:/);
  assert.match(transitionStyles, /::view-transition-group\(eoc-primary-surface\)[\s\S]*?animation-duration:\s*520ms/);
});

test('dashboard entrance replay is keyed to a real sidebar change, not heading text', () => {
  assert.match(appSource, /getPageTransitionDirection\(activeNavigationIndex, nextNavigationIndex\)/);
  assert.doesNotMatch(appSource, /const readActivePage/);
  assert.doesNotMatch(appSource, /if \(nextPage === activePage\) return/);
});

test('initial/unknown sidebar indices do not replay the dashboard entrance', () => {
  assert.equal(getPageTransitionDirection(-1, 0), 0);
  assert.equal(getPageTransitionDirection(0, -1), 0);
  assert.equal(getPageTransitionDirection(-1, -1), 0);
});

test('a title-only mutation or unchanged active navigation does not animate again', () => {
  assert.equal(getPageTransitionDirection(3, 3), 0);
});

test('real sidebar navigation returns one direction for forward/backward movement', () => {
  assert.equal(getPageTransitionDirection(1, 2), 1);
  assert.equal(getPageTransitionDirection(4, 2), -1);
});

test('invalid sidebar indices never start a page transition', () => {
  assert.equal(getPageTransitionDirection(null, 1), 0);
  assert.equal(getPageTransitionDirection(1, undefined), 0);
  assert.equal(getPageTransitionDirection(1.5, 2), 0);
});

function withFakeBrowser({ startViewTransition, reducedMotion = false }, run) {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const root = { dataset: {} };

  globalThis.document = { documentElement: root, startViewTransition };
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };

  return Promise.resolve()
    .then(() => run(root))
    .finally(() => {
      if (hadDocument) globalThis.document = previousDocument;
      else delete globalThis.document;
      if (hadWindow) globalThis.window = previousWindow;
      else delete globalThis.window;
    });
}

test('native route transition invokes the navigation callback once and clears its marker', async () => {
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

test('unsupported/reduced-motion paths run the existing update once without a snapshot', async () => {
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

test('a rejected native transition falls back only if it never called the update', async () => {
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

  await withFakeBrowser({
    startViewTransition(callback) {
      callback();
      throw new Error('transition rejected after starting');
    },
  }, (root) => {
    let updates = 0;
    assert.throws(
      () => runVisualTransition(() => { updates += 1; }),
      /transition rejected after starting/,
    );
    assert.equal(updates, 1, 'must not apply a navigation update twice');
    assert.equal(root.dataset.eocViewTransition, undefined);
  });
});
