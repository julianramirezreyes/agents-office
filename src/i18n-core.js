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
