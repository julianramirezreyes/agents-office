// T7: pure decision logic for the "REAL ONLY" switch — no DOM. Shared by src/tasks.js (boot-time
// seed guard + timer guard) and src/main.js (history seed guard, ambient bubbles, fake feed lines,
// #topReal visibility/wiring). See real-only.js for why `live` can be undefined/null (not yet known,
// at boot) as well as true/false (confirmed by /api/health).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRealOnly, writeRealOnly, shouldSeedDemo, shouldShowRealToggle, realOnly, setRealOnlyActive, STORAGE_KEY } from '../src/real-only.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('readRealOnly: off by default', () => {
  assert.equal(readRealOnly(fakeStorage()), false);
});
test('readRealOnly: on when the stored value is exactly "1"', () => {
  assert.equal(readRealOnly(fakeStorage({ [STORAGE_KEY]: '1' })), true);
});
test('readRealOnly: off for any other stored value', () => {
  assert.equal(readRealOnly(fakeStorage({ [STORAGE_KEY]: '0' })), false);
  assert.equal(readRealOnly(fakeStorage({ [STORAGE_KEY]: 'true' })), false);
});
test('readRealOnly: never throws when storage is unavailable or blocked', () => {
  assert.equal(readRealOnly(null), false);
  assert.equal(readRealOnly(undefined), false);
  assert.equal(readRealOnly({ getItem() { throw new Error('blocked'); } }), false);
});

test('writeRealOnly: persists "1" and "0"', () => {
  const s = fakeStorage();
  writeRealOnly(s, true);
  assert.equal(s.getItem(STORAGE_KEY), '1');
  writeRealOnly(s, false);
  assert.equal(s.getItem(STORAGE_KEY), '0');
});
test('writeRealOnly: never throws when storage is unavailable or blocked', () => {
  assert.doesNotThrow(() => writeRealOnly(null, true));
  assert.doesNotThrow(() => writeRealOnly({ setItem() { throw new Error('blocked'); } }, true));
});

test('shouldSeedDemo: file:// demo always seeds, regardless of the toggle', () => {
  assert.equal(shouldSeedDemo({ realOnly: true, served: false, live: undefined }), true);
  assert.equal(shouldSeedDemo({ realOnly: true, served: false, live: true }), true);
});
test('shouldSeedDemo: served with the toggle off seeds regardless of live (upstream unchanged, default)', () => {
  assert.equal(shouldSeedDemo({ realOnly: false, served: true, live: undefined }), true);
  assert.equal(shouldSeedDemo({ realOnly: false, served: true, live: true }), true);
  assert.equal(shouldSeedDemo({ realOnly: false, served: true, live: false }), true);
});
test('shouldSeedDemo: served with the toggle on skips optimistically before /api/health answers', () => {
  assert.equal(shouldSeedDemo({ realOnly: true, served: true, live: undefined }), false);
});
test('shouldSeedDemo: served with the toggle on stays skipped once live is confirmed', () => {
  assert.equal(shouldSeedDemo({ realOnly: true, served: true, live: true }), false);
});
test('shouldSeedDemo: served with the toggle on falls back to seeding once confirmed NOT live', () => {
  assert.equal(shouldSeedDemo({ realOnly: true, served: true, live: false }), true);
});

test('shouldShowRealToggle: hidden in demo (not served)', () => {
  assert.equal(shouldShowRealToggle({ served: false, live: true }), false);
});
test('shouldShowRealToggle: hidden until live is confirmed', () => {
  assert.equal(shouldShowRealToggle({ served: true, live: undefined }), false);
  assert.equal(shouldShowRealToggle({ served: true, live: false }), false);
});
test('shouldShowRealToggle: shown once served and confirmed live', () => {
  assert.equal(shouldShowRealToggle({ served: true, live: true }), true);
});

test('realOnly/setRealOnlyActive: off by default, reflects the last value set', () => {
  setRealOnlyActive(false); // reset in case another test file order left it on
  assert.equal(realOnly(), false);
  setRealOnlyActive(true);
  assert.equal(realOnly(), true);
  setRealOnlyActive(false);
  assert.equal(realOnly(), false);
});
