// Pure i18n helpers — no DOM, no Node-only APIs. Shared between the server (translate.mjs,
// which decides what is worth sending to Claude) and the client (src/i18n.js, which walks the
// page). Keeping this file free of environment APIs is what makes it importable from both sides
// and testable without a browser.

/** True when a string is worth translating: has real words, is not a number/time/date/percent/
 *  money/id, and is not absurdly long. Anything this returns false for is left exactly as is. */
export function shouldTranslate(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;
  if (s.length > 300) return false;
  const letters = s.match(/[A-Za-z]/g);
  if (!letters || letters.length < 2) return false;

  // time: 12:04 · 3:45 PM · 09:00:30
  if (/^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(s)) return false;
  // date: 2026-09-27 · 27/09/2026
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return false;
  // percent: 45% · -3.5 %
  if (/^[+-]?\d+(\.\d+)?\s?%$/.test(s)) return false;
  // money: $12.00 · €1,200 · 1.200,50€
  if (/^[$€£¥]\s?[+-]?[\d.,]+[kKmMbB]?$/.test(s)) return false;
  if (/^[+-]?[\d.,]+\s?[$€£¥]$/.test(s)) return false;
  // pure number, with separators: 42 · 1,234.50
  if (/^[+-]?[\d.,]+$/.test(s)) return false;
  // id-like single token mixing letters and digits, no whitespace: k3x9a1b2 · t-0913
  if (/^[a-z0-9_-]+$/i.test(s) && /\d/.test(s) && s.length <= 24) return false;

  return true;
}

/** Re-wraps a translation with the original's leading/trailing whitespace, so a text node's
 *  surrounding layout (a space before an icon, a newline in a template literal) survives. */
export function wrapTranslation(original, translated) {
  const lead = original.match(/^\s*/)[0];
  const trail = original.match(/\s*$/)[0];
  return lead + translated + trail;
}

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

/** Normalizes a string for cache/request purposes by replacing every run of digits (a plain
 *  number, a time like 11:00 or 4:5, a money amount like $50, …) with an indexed `{{n}}`
 *  placeholder, so "Reply to 14 DMs" and "Reply to 9 DMs" collapse to the same template and are
 *  translated — and cached — once. The double-brace syntax is deliberately different from the
 *  app's own single-brace `{co}`/`{n}` template vars (see profile.js/tasks.js), which are always
 *  substituted with real values before the text ever reaches the DOM, so there is no risk of
 *  colliding with real UI text. Returns the template and the digit runs it pulled out, in order. */
export function toTemplate(str) {
  const nums = [];
  const template = String(str).replace(/\d+/g, m => { nums.push(m); return `{{${nums.length - 1}}}`; });
  return { template, nums };
}

/** The inverse of toTemplate: puts each captured digit run back where its placeholder is.
 *  Placeholders may appear in a different order than they were captured (a translation is free
 *  to reorder them for grammar); each `{{n}}` is simply replaced with `nums[n]`. A placeholder
 *  with no matching number (should not happen once validated) is left as-is rather than dropped. */
export function fromTemplate(template, nums) {
  return String(template).replace(PLACEHOLDER_RE, (whole, i) => {
    const n = nums && nums[+i];
    return n === undefined ? whole : n;
  });
}

/** The loop-guard decision: given the DOM's current text/attribute value and what we remember
 *  ({ original, applied } from the last time we translated this node), decide whether this
 *  change is our own write (skip — it already equals what we applied) or a change made by the
 *  app itself (translate again, treating the current value as the new original). With no prior
 *  state, translate from the current value. */
export function nextI18nState(current, state) {
  if (!state) return { action: 'translate', original: current };
  if (current === state.applied) return { action: 'skip', original: state.original };
  return { action: 'translate', original: current };
}
