// Agents Office — REAL ONLY (T7): pure decision logic for the "real work only" switch, no DOM.
// The switch only ever matters for a SERVED, LIVE office; demo (file://) is unaffected.
//
// Seeding the demo "believable morning" (tasks.js) and the demo activity history (main.js) both
// happen SYNCHRONOUSLY at boot, before the async /api/health round trip that confirms we are
// actually live. So the boot-time call below is a best-effort guess (`live` is undefined/null —
// not yet known). Once /api/health answers, the caller re-decides with the confirmed `live` value:
// if the guess turned out wrong (server unreachable or unhealthy), the demo seed runs then instead.
//
// See src/tasks.js and src/main.js for the one-line `// V3.7: real-only` guards built on this.
export const STORAGE_KEY = 'ao.realOnly';

export function readRealOnly(storage) {
  try { return !!storage && storage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; } // private window, blocked storage — default off
}

export function writeRealOnly(storage, on) {
  try { if (storage) storage.setItem(STORAGE_KEY, on ? '1' : '0'); }
  catch { /* private window, blocked storage — the toggle just won't persist */ }
}

/** Should the demo seed (the "believable morning" or the equivalent activity history) run right
 *  now? `live` is undefined/null at boot (not yet known), or the confirmed true/false once
 *  /api/health has answered. Demo mode (not served) always seeds — REAL ONLY isn't offered there,
 *  and a served office with the toggle off keeps exactly the upstream default behavior. */
export function shouldSeedDemo({ realOnly, served, live }) {
  if (!served) return true;
  if (!realOnly) return true;
  return live === false; // skip while unknown or confirmed live; seed only once confirmed NOT live
}

/** The REAL ONLY button is only ever shown for a confirmed-live served office. */
export function shouldShowRealToggle({ served, live }) {
  return !!served && live === true;
}

/* ---------- one shared runtime flag, the "one helper" every suppression guards on ---------- */
// Set exactly once /api/health confirms (or fails) the office is live; see tasks.js's connect().
let active = false;
export function setRealOnlyActive(on) { active = !!on; }
export function realOnly() { return active; }
