// translate.mjs: dictionary cache, batching, response validation, in-flight dedupe, lang
// whitelist. `ask` is injected so these run with no network and no real Claude call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTranslator, validateTranslationResponse, isSupportedLang, SUPPORTED_LANGS, BATCH_SIZE } from '../translate.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ao-i18n-test-'));
}

test('isSupportedLang / SUPPORTED_LANGS: only es is a real target language', () => {
  assert.deepEqual(SUPPORTED_LANGS, ['es']);
  assert.equal(isSupportedLang('es'), true);
  assert.equal(isSupportedLang('fr'), false);
  assert.equal(isSupportedLang('en'), false); // en is identity, handled separately, not "supported" as a target
});

test('validateTranslationResponse: keeps only requested keys with non-empty, bounded-length string values', () => {
  const requested = ['ADD', 'CALENDAR'];
  const out = validateTranslationResponse(JSON.stringify({ ADD: 'AÑADIR', CALENDAR: 'CALENDARIO', EXTRA: 'sobra' }), requested);
  assert.deepEqual(out, { ADD: 'AÑADIR', CALENDAR: 'CALENDARIO' });
});

test('validateTranslationResponse: drops empty values and values over 2x+50 the source length', () => {
  const requested = ['ADD', 'x'];
  const tooLong = 'y'.repeat('x'.length * 2 + 51);
  const out = validateTranslationResponse(JSON.stringify({ ADD: '   ', x: tooLong }), requested);
  assert.deepEqual(out, {});
});

test('validateTranslationResponse: non-JSON or malformed text yields no translations', () => {
  assert.deepEqual(validateTranslationResponse('not json at all', ['ADD']), {});
  assert.deepEqual(validateTranslationResponse('[]', ['ADD']), {});
});

test('translate: en is identity and never calls ask', async () => {
  let calls = 0;
  const t = createTranslator({ dataDir: tmpDir(), ask: async () => { calls++; return '{}'; } });
  const out = await t.translate('en', ['ADD', 'CALENDAR']);
  assert.deepEqual(out, { ADD: 'ADD', CALENDAR: 'CALENDAR' });
  assert.equal(calls, 0);
});

test('translate: unknown language rejects', async () => {
  const t = createTranslator({ dataDir: tmpDir(), ask: async () => '{}' });
  await assert.rejects(() => t.translate('fr', ['ADD']));
});

test('translate: strings that fail shouldTranslate are returned unchanged, never sent to ask', async () => {
  let seen = [];
  const t = createTranslator({ dataDir: tmpDir(), ask: async (sys, user) => { seen.push(JSON.parse(user)); return '{}'; } });
  const out = await t.translate('es', ['12:04', '45%', 'ADD']);
  assert.equal(out['12:04'], '12:04');
  assert.equal(out['45%'], '45%');
  assert.deepEqual(seen.flat(), ['ADD']);
});

test('translate: cache miss asks Claude, then writes the dictionary to disk atomically', async () => {
  const dir = tmpDir();
  const t = createTranslator({ dataDir: dir, ask: async () => JSON.stringify({ ADD: 'AÑADIR' }) });
  const out = await t.translate('es', ['ADD']);
  assert.deepEqual(out, { ADD: 'AÑADIR' });
  const file = path.join(dir, 'i18n', 'es.json');
  assert.equal(fs.existsSync(file), true);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk, { ADD: 'AÑADIR' });
  // no leftover temp files from the atomic write
  assert.deepEqual(fs.readdirSync(path.join(dir, 'i18n')).filter(f => f !== 'es.json'), []);
});

test('translate: cache hit returns from the dictionary without calling ask again', async () => {
  const dir = tmpDir();
  let calls = 0;
  const t = createTranslator({ dataDir: dir, ask: async () => { calls++; return JSON.stringify({ ADD: 'AÑADIR' }); } });
  await t.translate('es', ['ADD']);
  assert.equal(calls, 1);
  const out2 = await t.translate('es', ['ADD']);
  assert.deepEqual(out2, { ADD: 'AÑADIR' });
  assert.equal(calls, 1);
});

test('translate: a fresh translator instance reads the dictionary another instance wrote', async () => {
  const dir = tmpDir();
  const t1 = createTranslator({ dataDir: dir, ask: async () => JSON.stringify({ ADD: 'AÑADIR' }) });
  await t1.translate('es', ['ADD']);
  const t2 = createTranslator({ dataDir: dir, ask: async () => { throw new Error('should not be called'); } });
  const out = await t2.translate('es', ['ADD']);
  assert.deepEqual(out, { ADD: 'AÑADIR' });
});

// A base-26 letter suffix, not a digit — so each of these stays its own template after T5's
// number-templating (see toTemplate), keeping this test about batch-size chunking only.
function letterSuffix(i) {
  let s = '';
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

test('translate: batches misses into groups of at most BATCH_SIZE', async () => {
  const dir = tmpDir();
  const strings = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => `Label number ${letterSuffix(i)}`);
  const batchSizes = [];
  const t = createTranslator({
    dataDir: dir,
    ask: async (sys, user) => {
      const batch = JSON.parse(user);
      batchSizes.push(batch.length);
      return JSON.stringify(Object.fromEntries(batch.map(s => [s, s + ' (es)'])));
    },
  });
  await t.translate('es', strings);
  assert.equal(batchSizes.length, 2);
  assert.ok(batchSizes.every(n => n <= BATCH_SIZE));
  assert.equal(batchSizes.reduce((a, b) => a + b, 0), strings.length);
});

test('translate: a bad response falls back to the untranslated string, and does not cache it', async () => {
  const dir = tmpDir();
  const t = createTranslator({ dataDir: dir, ask: async () => 'garbage, not json' });
  const out = await t.translate('es', ['Some label']);
  assert.equal(out['Some label'], 'Some label');
  const file = path.join(dir, 'i18n', 'es.json');
  const onDisk = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  assert.equal(onDisk['Some label'], undefined);
});

test('translate: concurrent requests for the same missing string dedupe into one ask call', async () => {
  const dir = tmpDir();
  let calls = 0;
  const t = createTranslator({
    dataDir: dir,
    ask: async (sys, user) => {
      calls++;
      await new Promise(r => setTimeout(r, 20));
      return JSON.stringify(Object.fromEntries(JSON.parse(user).map(s => [s, s + ' (es)'])));
    },
  });
  const [a, b] = await Promise.all([t.translate('es', ['Shared label']), t.translate('es', ['Shared label'])]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { 'Shared label': 'Shared label (es)' });
  assert.deepEqual(b, { 'Shared label': 'Shared label (es)' });
});

test('validateTranslationResponse: rejects a translation whose placeholder set differs from the source', () => {
  const requested = ['Reply to {{0}} DMs', 'Hi {{0}} and {{1}}'];
  const out = validateTranslationResponse(JSON.stringify({
    'Reply to {{0}} DMs': 'Responder a {{0}} DMs', // placeholders match — kept
    'Hi {{0}} and {{1}}': 'Hola {{0}}', // {{1}} dropped — rejected
  }), requested);
  assert.deepEqual(out, { 'Reply to {{0}} DMs': 'Responder a {{0}} DMs' });
});

test('validateTranslationResponse: accepts a translation that reorders placeholders', () => {
  const requested = ['{{0}} de {{1}}'];
  const out = validateTranslationResponse(JSON.stringify({ '{{0}} de {{1}}': '{{1}} of {{0}}' }), requested);
  assert.deepEqual(out, { '{{0}} de {{1}}': '{{1}} of {{0}}' });
});

test('translate: two numeric variants of the same template share one ask call, each restored with its own number', async () => {
  const dir = tmpDir();
  let calls = 0, seenBatch = null;
  const t = createTranslator({
    dataDir: dir,
    ask: async (sys, user) => {
      calls++;
      seenBatch = JSON.parse(user);
      return JSON.stringify(Object.fromEntries(seenBatch.map(tpl => [tpl, tpl.replace('Reply to', 'Responder a')])));
    },
  });
  const out = await t.translate('es', ['Reply to 14 DMs', 'Reply to 9 DMs']);
  assert.equal(calls, 1);
  assert.deepEqual(seenBatch, ['Reply to {{0}} DMs']);
  assert.deepEqual(out, { 'Reply to 14 DMs': 'Responder a 14 DMs', 'Reply to 9 DMs': 'Responder a 9 DMs' });
});

test('translate: a later request for a new numeric variant of an already-cached template hits the cache, no new ask call', async () => {
  const dir = tmpDir();
  let calls = 0;
  const t = createTranslator({
    dataDir: dir,
    ask: async (sys, user) => { calls++; const batch = JSON.parse(user); return JSON.stringify(Object.fromEntries(batch.map(tpl => [tpl, tpl.replace('Reply to', 'Responder a')]))); },
  });
  await t.translate('es', ['Reply to 14 DMs']);
  assert.equal(calls, 1);
  const out = await t.translate('es', ['Reply to 9 DMs']);
  assert.equal(calls, 1);
  assert.deepEqual(out, { 'Reply to 9 DMs': 'Responder a 9 DMs' });
});

test('translate: the on-disk dictionary is keyed by template, not by the literal numeric string', async () => {
  const dir = tmpDir();
  const t = createTranslator({ dataDir: dir, ask: async (sys, user) => { const batch = JSON.parse(user); return JSON.stringify(Object.fromEntries(batch.map(tpl => [tpl, tpl.replace('Reply to', 'Responder a')]))); } });
  await t.translate('es', ['Reply to 14 DMs']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', 'es.json'), 'utf8'));
  assert.deepEqual(onDisk, { 'Reply to {{0}} DMs': 'Responder a {{0}} DMs' });
});

test('dictionary: returns the cached table for es, {} for en, null for an unknown language', async () => {
  const dir = tmpDir();
  const t = createTranslator({ dataDir: dir, ask: async () => JSON.stringify({ ADD: 'AÑADIR' }) });
  await t.translate('es', ['ADD']);
  assert.deepEqual(t.dictionary('es'), { ADD: 'AÑADIR' });
  assert.deepEqual(t.dictionary('en'), {});
  assert.equal(t.dictionary('fr'), null);
});
