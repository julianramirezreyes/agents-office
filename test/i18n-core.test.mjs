// Pure i18n helpers: no DOM, no Node-only APIs — shared between the server (translate.mjs)
// and the client (src/i18n.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldTranslate, wrapTranslation, nextI18nState } from '../src/i18n-core.js';

test('shouldTranslate: empty and whitespace-only strings are skipped', () => {
  assert.equal(shouldTranslate(''), false);
  assert.equal(shouldTranslate('   '), false);
  assert.equal(shouldTranslate('\n\t'), false);
});

test('shouldTranslate: fewer than two letters is skipped', () => {
  assert.equal(shouldTranslate('A'), false);
  assert.equal(shouldTranslate('•'), false);
  assert.equal(shouldTranslate('OK'), true);
});

test('shouldTranslate: pure numbers, times, dates, percent and money are skipped', () => {
  assert.equal(shouldTranslate('42'), false);
  assert.equal(shouldTranslate('1,234.50'), false);
  assert.equal(shouldTranslate('12:04'), false);
  assert.equal(shouldTranslate('3:45 PM'), false);
  assert.equal(shouldTranslate('2026-09-27'), false);
  assert.equal(shouldTranslate('27/09/2026'), false);
  assert.equal(shouldTranslate('45%'), false);
  assert.equal(shouldTranslate('$12.00'), false);
  assert.equal(shouldTranslate('€1,200'), false);
});

test('shouldTranslate: id-like single tokens mixing letters and digits are skipped', () => {
  assert.equal(shouldTranslate('k3x9a1b2'), false);
  assert.equal(shouldTranslate('t-0913'), false);
});

test('shouldTranslate: strings longer than 300 chars are skipped', () => {
  assert.equal(shouldTranslate('a'.repeat(301) + ' bb'), false);
});

test('shouldTranslate: strings with no ASCII letters are skipped', () => {
  assert.equal(shouldTranslate('★★★'), false);
  assert.equal(shouldTranslate('✓ 100%'), false);
});

test('shouldTranslate: ordinary UI copy is translated', () => {
  assert.equal(shouldTranslate('TASK STATUS'), true);
  assert.equal(shouldTranslate('Search the Brain…'), true);
  assert.equal(shouldTranslate('ADD'), true);
});

test('wrapTranslation: preserves leading and trailing whitespace of the original', () => {
  assert.equal(wrapTranslation('  Hello  ', 'Hola'), '  Hola  ');
  assert.equal(wrapTranslation('\nADD\n', 'AÑADIR'), '\nAÑADIR\n');
  assert.equal(wrapTranslation('NoSpace', 'Sin espacio'), 'Sin espacio');
});

test('nextI18nState: no prior state means translate from the current text', () => {
  const r = nextI18nState('ADD', undefined);
  assert.equal(r.action, 'translate');
  assert.equal(r.original, 'ADD');
});

test('nextI18nState: current text equals our own last write — skip (loop guard)', () => {
  const r = nextI18nState('AÑADIR', { original: 'ADD', applied: 'AÑADIR' });
  assert.equal(r.action, 'skip');
  assert.equal(r.original, 'ADD');
});

test('nextI18nState: current text differs from our last write — the app changed it, translate again', () => {
  const r = nextI18nState('ADD TASK', { original: 'ADD', applied: 'AÑADIR' });
  assert.equal(r.action, 'translate');
  assert.equal(r.original, 'ADD TASK');
});
