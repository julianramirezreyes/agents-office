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
import { shouldTranslate, toTemplate, fromTemplate } from './src/i18n-core.js';

export const SUPPORTED_LANGS = ['es']; // real target languages; 'en' is identity, handled separately
export const BATCH_SIZE = 80;

export function isSupportedLang(lang) {
  return SUPPORTED_LANGS.includes(lang);
}

/** The sorted list of `{{n}}` placeholder tokens in a string (as they appear, e.g. from
 *  toTemplate). Two strings with the same placeholder set may still differ in order — a
 *  translation is free to reorder them for grammar — so callers compare these, not raw indexOf. */
function placeholderTokens(s) {
  return [...String(s).matchAll(/\{\{\d+\}\}/g)].map(m => m[0]).sort();
}

/** Parses Claude's reply as a JSON object and keeps only the entries worth trusting: the key was
 *  actually requested, the value is a non-empty string, it is not wildly longer than the source
 *  (2x + 50 chars — generous for Spanish, which runs a little longer than English), and it carries
 *  exactly the same set of `{{n}}` placeholders as the source (a dropped, added or renumbered
 *  placeholder means the restored number would land in the wrong place, or not at all — reject
 *  rather than cache it wrong). */
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
    const need = placeholderTokens(k), got = placeholderTokens(v);
    if (need.length !== got.length || need.some((t, i) => t !== got[i])) continue;
    out[k] = v;
  }
  return out;
}

const SYSTEM_PROMPT = 'You translate the user interface text of "Agents Office", a business app that shows an office of AI agents, from English into neutral Spanish. Rules: keep placeholders exactly as given and in the same count — both the app\'s own `{co}`/`{n}`-style vars and the doubled-brace `{{0}}`, `{{1}}`, … used for numbers, times and amounts (never drop, add or renumber one, though you may reorder them if Spanish grammar asks for it); keep emoji and symbols exactly as given; never translate brand or product names (Claude, Sonnet, Opus, Fable, Gmail, Canva and similar) — but DO translate job titles and role labels such as "MARKETING LEAD", "SALES LEAD" or "OPERATIONS LEAD" like any other UI phrase (e.g. "LÍDER DE MARKETING"), even in all caps or written next to a department name; preserve the casing style of each source string (for example, keep an all-uppercase string all-uppercase). Reply with ONLY a JSON object mapping each source string exactly to its Spanish translation — no other text.';

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

  async function translateBatch(lang, batch) { // batch: templates (see toTemplate), not raw strings
    const text = await ask(SYSTEM_PROMPT, JSON.stringify(batch));
    return validateTranslationResponse(text, batch);
  }

  /** `strings` → { source: translation }, one entry per string as given. Strings `shouldTranslate`
   *  rejects are echoed back unchanged. Everything else is normalized to a template first (see
   *  toTemplate in i18n-core.js) — so "Reply to 14 DMs" and "Reply to 9 DMs" are the same request —
   *  served from the dictionary when that template is cached, otherwise batched to `ask` by
   *  template; concurrent calls for the same still-missing template (whatever the numbers in the
   *  original strings) share one in-flight request. The dictionary itself is keyed by template, so
   *  it stays shared across every numeric variant seen so far. */
  async function translate(lang, strings) {
    if (lang === 'en') { const out = {}; for (const s of strings || []) out[s] = s; return out; }
    if (!isSupportedLang(lang)) throw new Error(`translate: unsupported language "${lang}"`);

    const dict = loadDict(lang);
    const wanted = [...new Set((strings || []).filter(s => typeof s === 'string'))];
    const result = {};
    const byTemplate = new Map(); // template -> [{ source, nums }, …] still missing from the dict
    for (const s of wanted) {
      if (!shouldTranslate(s)) { result[s] = s; continue; }
      const { template, nums } = toTemplate(s);
      if (dict.has(template)) { result[s] = fromTemplate(dict.get(template), nums); continue; }
      let list = byTemplate.get(template);
      if (!list) { list = []; byTemplate.set(template, list); }
      list.push({ source: s, nums });
    }
    const missTemplates = [...byTemplate.keys()];
    if (!missTemplates.length) return result;

    let table = inflight.get(lang);
    if (!table) { table = new Map(); inflight.set(lang, table); }

    const toFetch = missTemplates.filter(t => !table.has(t));
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const batchPromise = translateBatch(lang, batch)
        .then(map => {
          const d = loadDict(lang);
          let wrote = false;
          for (const t of batch) if (map[t]) { d.set(t, map[t]); wrote = true; }
          if (wrote) saveDict(lang, d);
          return map;
        })
        .catch(() => ({}));
      batchPromise.finally(() => { for (const t of batch) table.delete(t); }); // stop dedupe-ing once this batch is settled, whatever the outcome
      for (const t of batch) table.set(t, batchPromise.then(map => map[t]));
    }

    await Promise.all(missTemplates.map(t => table.get(t)));
    const finalDict = loadDict(lang);
    for (const [template, list] of byTemplate) {
      const translatedTemplate = finalDict.get(template);
      for (const { source, nums } of list) result[source] = translatedTemplate ? fromTemplate(translatedTemplate, nums) : source;
    }
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
