// Agents Office — live UI translation (T2, client half). Walks the page chrome, swaps English
// for cached Spanish, and never touches the areas that are not ours to translate: chat, brain
// notes, deliverables, form values. The pure decisions (shouldTranslate, wrapTranslation,
// nextI18nState — the loop guard) live in ./i18n-core.js so they are testable without a DOM;
// this file is the DOM glue around them.
//
// Demo mode (file://, no server): initI18n() hides the toggle and does nothing else — there is
// nowhere to ask for a translation and no point pretending otherwise.
import { shouldTranslate, wrapTranslation, nextI18nState } from './i18n-core.js';

const STORAGE_KEY = 'ao.lang';
const API = '/api/translate';
const DEBOUNCE_MS = 400;
const CLIENT_BATCH = 200; // stays under the server's 400-item cap even after a burst of mutations
const ATTRS = ['placeholder', 'title', 'aria-label'];
// Never translated: the chat rail (#mMsgs — user messages, agent replies, deliverables, approval
// asks are all "chat message bodies" / "agent deliverables" per scope) and the brain note pane
// (#bvPane — the owner's own note titles/content, which we also must not ship off to a translate
// call). script/style/svg/canvas draw nothing we can safely rewrite as a text node. [contenteditable]
// and data-no-i18n are explicit escape hatches.
const EXCLUDE_SELECTOR = '#mMsgs, #bvPane, script, style, svg, canvas, [contenteditable], [data-no-i18n]';

let lang = 'en';
let toggleBtn = null;
let observer = null;
let flushTimer = null;
let pending = new Map(); // source string -> Set<applyFn>, queued since the last flush
const inflightAppliers = new Map(); // source string -> Set<applyFn>, sent to the server, awaiting a reply
const cache = new Map(); // source string -> translation, once known (prefilled or fetched)

const textState = new WeakMap(); // Text node -> { original, applied }
const attrState = new WeakMap(); // Element -> { [attr]: { original, applied } }

function readLang() {
  try { return localStorage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en'; } catch { return 'en'; }
}
function writeLang(l) {
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* private window, blocked storage — just don't persist */ }
}

function isExcluded(el) {
  return !!(el && el.closest && el.closest(EXCLUDE_SELECTOR));
}

function updateToggle() {
  if (!toggleBtn) return;
  toggleBtn.textContent = lang === 'es' ? 'EN' : 'ES';
  toggleBtn.title = lang === 'es' ? 'Switch the office to English' : 'Cambiar la oficina a español';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);
}

/* ---------- queue → debounce → batch → apply ---------- */
function queue(source, apply) {
  if (!shouldTranslate(source)) return;
  if (cache.has(source)) { apply(cache.get(source)); return; }
  let set = pending.get(source);
  if (!set) { set = new Set(); pending.set(source, set); }
  set.add(apply);
  if (!flushTimer) flushTimer = setTimeout(flush, DEBOUNCE_MS);
}

function flush() {
  flushTimer = null;
  const table = pending; pending = new Map();
  const toSend = [];
  for (const [source, appliers] of table) {
    const already = inflightAppliers.get(source);
    if (already) { for (const fn of appliers) already.add(fn); continue; } // already asked — piggyback on that request
    inflightAppliers.set(source, appliers);
    toSend.push(source);
  }
  for (let i = 0; i < toSend.length; i += CLIENT_BATCH) sendBatch(toSend.slice(i, i + CLIENT_BATCH));
}

async function sendBatch(batch) {
  let map = null;
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang, texts: batch }) });
    if (res.ok) ({ map } = await res.json());
  } catch { /* offline mid-session — these stay untranslated until something re-queues them */ }
  for (const s of batch) {
    const appliers = inflightAppliers.get(s);
    inflightAppliers.delete(s);
    const translated = map && map[s];
    if (!translated) continue;
    cache.set(s, translated);
    if (appliers) for (const fn of appliers) fn(translated);
  }
}

/* ---------- text nodes + the three attributes ---------- */
function applyToTextNode(node, original) {
  return translated => {
    if (node.nodeValue !== original) return; // the app rewrote it again before this reply landed
    const out = wrapTranslation(original, translated);
    textState.set(node, { original, applied: out });
    node.nodeValue = out;
  };
}
function applyToAttr(el, attr, original) {
  return translated => {
    if (el.getAttribute(attr) !== original) return;
    const out = wrapTranslation(original, translated);
    let rec = attrState.get(el); if (!rec) { rec = {}; attrState.set(el, rec); }
    rec[attr] = { original, applied: out };
    el.setAttribute(attr, out);
  };
}

function processTextNode(node) {
  const p = node.parentElement;
  if (!p || isExcluded(p) || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return;
  const current = node.nodeValue;
  if (!current) return;
  const decision = nextI18nState(current, textState.get(node));
  if (decision.action === 'skip') return;
  queue(decision.original, applyToTextNode(node, decision.original));
}
function processAttr(el, attr) {
  if (isExcluded(el)) return;
  const current = el.getAttribute(attr);
  if (!current) return;
  const rec = attrState.get(el);
  const decision = nextI18nState(current, rec && rec[attr]);
  if (decision.action === 'skip') return;
  queue(decision.original, applyToAttr(el, attr, decision.original));
}

function walkForText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || isExcluded(p) || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n; while ((n = walker.nextNode())) processTextNode(n);
}
function walkForAttrs(root) {
  if (root.nodeType === 1 && !isExcluded(root)) for (const attr of ATTRS) if (root.hasAttribute(attr)) processAttr(root, attr);
  if (!root.querySelectorAll) return;
  for (const el of root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))) {
    if (isExcluded(el)) continue;
    for (const attr of ATTRS) if (el.hasAttribute(attr)) processAttr(el, attr);
  }
}
function walkAll(root) { walkForText(root); walkForAttrs(root); }

function restoreAll(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const st = textState.get(n);
    if (st) { n.nodeValue = st.original; textState.delete(n); }
  }
  if (root.querySelectorAll) for (const el of root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))) {
    const rec = attrState.get(el);
    if (!rec) continue;
    for (const attr of ATTRS) if (rec[attr]) el.setAttribute(attr, rec[attr].original);
    attrState.delete(el);
  }
}

/* ---------- mutation observer ---------- */
function onMutations(records) {
  for (const m of records) {
    if (m.type === 'characterData') { processTextNode(m.target); continue; }
    if (m.type === 'attributes') { if (ATTRS.includes(m.attributeName)) processAttr(m.target, m.attributeName); continue; }
    for (const node of m.addedNodes) {
      if (node.nodeType === 3) processTextNode(node);
      else if (node.nodeType === 1) walkAll(node);
    }
  }
}

/* ---------- activate / deactivate ---------- */
async function prefill() {
  try {
    const res = await fetch(`${API}?lang=es`);
    if (!res.ok) return;
    const { map } = await res.json();
    if (map) for (const [k, v] of Object.entries(map)) cache.set(k, v);
  } catch { /* first run, or offline — the batch path fills the cache instead */ }
}

async function activate() {
  document.documentElement.lang = 'es';
  await prefill();
  walkAll(document.body);
  if (!observer) observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

function deactivate() {
  if (observer) observer.disconnect();
  restoreAll(document.body);
  pending = new Map();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  document.documentElement.lang = 'en';
}

function setLang(l) {
  if (l === lang) return;
  lang = l;
  writeLang(l);
  updateToggle();
  if (l === 'es') activate(); else deactivate();
}

/** Wire the EN/ES toggle and, if the office was left in Spanish, restore it. Call once after the
 *  page has rendered. Does nothing in demo mode (file://) beyond hiding the button — there is no
 *  server to ask, and nothing here should ever throw for it. */
export function initI18n() {
  toggleBtn = document.getElementById('topLang');
  if (!location.protocol.startsWith('http')) { if (toggleBtn) toggleBtn.hidden = true; return; }
  lang = readLang();
  document.documentElement.lang = lang;
  if (toggleBtn) {
    toggleBtn.hidden = false;
    updateToggle();
    toggleBtn.addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));
  }
  if (lang === 'es') activate();
}
