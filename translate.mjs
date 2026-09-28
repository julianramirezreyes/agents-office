// Agents Office — live UI translation (T1). Pure logic + an injectable `ask` fn (Claude), so the
// server route (serve.mjs) and the tests can both drive it without touching the network.
//
// A dictionary per language lives at <dataDir>/i18n/<lang>.json (gitignored, like the rest of
// data/): { "TASK STATUS": "ESTADO DE LA TAREA", ... }. It is read lazily and written atomically
// (tmp file + rename), so a crash mid-write never corrupts it. Unknown strings are batched (at
// most BATCH_SIZE per Claude call) and validated before they are trusted or cached; anything that
// does not validate falls back to the untranslated source and is not cached, so it is retried
// next time rather than baked in wrong.
import fs from 'node:fs';
import path from 'node:path';
import { shouldTranslate } from './src/i18n-core.js';

export const SUPPORTED_LANGS = ['es']; // real target languages; 'en' is identity, handled separately
export const BATCH_SIZE = 80;

export function isSupportedLang(lang) {
  return SUPPORTED_LANGS.includes(lang);
}

/** Parses Claude's reply as a JSON object and keeps only the entries worth trusting: the key was
 *  actually requested, the value is a non-empty string, and it is not wildly longer than the
 *  source (2x + 50 chars — generous for Spanish, which runs a little longer than English). */
export function validateTranslationResponse(text, requested) {
  let obj;
  try {
    const s = String(text).replace(/```json|```/g, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) return {};
    obj = JSON.parse(s.slice(a, b + 1));
  } catch { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const requestedSet = new Set(requested);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!requestedSet.has(k)) continue;
    if (typeof v !== 'string') continue;
    if (!v.trim()) continue;
    if (v.length > k.length * 2 + 50) continue;
    out[k] = v;
  }
  return out;
}

const SYSTEM_PROMPT = 'You translate the user interface text of "Agents Office", a business app that shows an office of AI agents, from English into neutral Spanish. Rules: keep placeholders (like {co} or %s), emoji, symbols and numbers exactly as given; never translate brand or product names (Claude, Sonnet, Opus, Fable, Gmail, Canva and similar); preserve the casing style of each source string (for example, keep an all-uppercase string all-uppercase). Reply with ONLY a JSON object mapping each source string exactly to its Spanish translation — no other text.';

/** `dataDir`: the office's data/ folder (dictionaries live under <dataDir>/i18n/).
 *  `ask(system, user)`: async → the model's raw text reply (e.g. serve.mjs's `ask`). */
export function createTranslator({ dataDir, ask }) {
  const dicts = new Map(); // lang -> Map(source -> translation)
  const inflight = new Map(); // lang -> Map(source -> Promise<string|undefined>)

  const i18nDir = () => path.join(dataDir, 'i18n');
  const dictFile = lang => path.join(i18nDir(), `${lang}.json`);

  function loadDict(lang) {
    if (dicts.has(lang)) return dicts.get(lang);
    const map = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(dictFile(lang), 'utf8'));
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') map.set(k, v);
    } catch { /* no dictionary yet, or unreadable — start empty */ }
    dicts.set(lang, map);
    return map;
  }

  function saveDict(lang, map) {
    fs.mkdirSync(i18nDir(), { recursive: true });
    const file = dictFile(lang);
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map), null, 2));
    fs.renameSync(tmp, file);
  }

  async function translateBatch(lang, batch) {
    const text = await ask(SYSTEM_PROMPT, JSON.stringify(batch));
    return validateTranslationResponse(text, batch);
  }

  /** `strings` → { source: translation }. Strings `shouldTranslate` rejects are echoed back
   *  unchanged. Everything else is served from the dictionary when cached, otherwise batched to
   *  `ask`; concurrent calls for the same still-missing string share one in-flight request. */
  async function translate(lang, strings) {
    if (lang === 'en') { const out = {}; for (const s of strings || []) out[s] = s; return out; }
    if (!isSupportedLang(lang)) throw new Error(`translate: unsupported language "${lang}"`);

    const dict = loadDict(lang);
    const wanted = [...new Set((strings || []).filter(s => typeof s === 'string'))];
    const result = {};
    const misses = [];
    for (const s of wanted) {
      if (!shouldTranslate(s)) { result[s] = s; continue; }
      if (dict.has(s)) { result[s] = dict.get(s); continue; }
      misses.push(s);
    }
    if (!misses.length) return result;

    let table = inflight.get(lang);
    if (!table) { table = new Map(); inflight.set(lang, table); }

    const toFetch = misses.filter(s => !table.has(s));
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const batchPromise = translateBatch(lang, batch)
        .then(map => {
          const d = loadDict(lang);
          let wrote = false;
          for (const s of batch) if (map[s]) { d.set(s, map[s]); wrote = true; }
          if (wrote) saveDict(lang, d);
          return map;
        })
        .catch(() => ({}));
      batchPromise.finally(() => { for (const s of batch) table.delete(s); }); // stop dedupe-ing once this batch is settled, whatever the outcome
      for (const s of batch) table.set(s, batchPromise.then(map => map[s]));
    }

    await Promise.all(misses.map(s => table.get(s)));
    const finalDict = loadDict(lang);
    for (const s of misses) result[s] = finalDict.get(s) || s;
    return result;
  }

  /** The whole cached dictionary for `lang` (so the page can prefill instantly), `{}` for `en`,
   *  or `null` for a language this office does not translate to. */
  function dictionary(lang) {
    if (lang === 'en') return {};
    if (!isSupportedLang(lang)) return null;
    return Object.fromEntries(loadDict(lang));
  }

  return { translate, dictionary };
}
