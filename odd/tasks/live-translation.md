# Live UI translation (EN/ES)

## Objective
Let the owner switch the whole office UI between English and Spanish with an EN/ES toggle, without hand-extracting ~200 strings from `src/`, so future upstream releases translate themselves.

## Problem / why
There is no i18n mechanism. UI text lives in `src/shell.html` plus JS template strings across `src/*.js` and ~60 server sentences. Editing each string would conflict with every upstream `git pull`.

## Approach
A client-side live translator: a `MutationObserver` walks text nodes and `placeholder`/`title` attributes, swaps them from a cached dictionary, and batches unknown strings to a new server endpoint that asks Claude once and caches the result under `data/` (gitignored). Footprint in upstream files: one import in `src/main.js`, one route in `serve.mjs`.

## Scope
- In: page chrome, labels, buttons, hints, tooltips, feed/status lines, demo task titles, server messages as they appear on the page.
- Out: user-typed content, agent deliverables and chat message bodies, brain note contents, input values, canvas-drawn text, agent output language (separate: a house-style skill).

## Constraints
- Write translations with `nodeValue`/`setAttribute` only; never `innerHTML`.
- Never re-translate our own writes (loop guard); keep the original to restore EN.
- Skip numbers, times, percentages, money, single symbols, and very long strings.
- Batch and debounce requests; dedupe in-flight strings; cap batch size.
- Demo mode (`file://`, no server): toggle hidden or inert, no errors.
- Do not commit `dist/`, `src/braingraph.js` or `package-lock.json` (pre-existing local build artifacts; braingraph bakes the owner's brain).

## TDD
- Mode: strict, on. Source: user global CLAUDE.md ("Strict TDD Mode: enabled").
- Runner: `node --test test/` (Node built-in; the repo had no unit runner, only `npm run check`).

## Tasks
- [x] T1 Server: `translate.mjs` (dictionary cache in `data/i18n/<lang>.json`, text filter, batching prompt, response validation) + `POST /api/translate` in `serve.mjs`, with unit tests. Route: delegated writer (2+ non-trivial files).
- [x] T2 Client: `src/i18n.js` (observer, text/attribute walker, exclusions, loop guard, debounce/batch, localStorage lang, EN/ES toggle in the top bar, `<html lang>`), wired from `src/main.js`, with unit tests for the pure parts; `npm run build`. Route: delegated writer.
- [x] T3 Docs: README section on the language toggle. Route: delegated writer.
- [x] T4 Top bar fit (owner report 2026-09-28): 26 needs-auth/failed connector tiles overflow the top bar and push SESSION/WEEK, CALENDAR and the EN/ES toggle off-screen; the brand wraps. Collapse non-connected tiles into one grey "+N" chip (tooltip lists them with their reason), keep connected tiles as they are, and make the connector strip shrink instead of pushing the right-hand controls. Route: delegated writer (src/mcp.js + src/shell.html).

## Acceptance criteria
- Toggling ES translates visible chrome within a few seconds on first use and instantly afterwards (cache hit); toggling EN restores the original text.
- New text added by the app later is translated automatically.
- Excluded areas stay untouched.
- `node --test test/` green; `npm run check` shows no new failures (baseline: 2 known demo smoke failures, TEAM demo and a flaky command-bar demo; `/api/brain` empty while the brain has no notes).

## Checks
`node --test test/` · `npm run build` · `npm run check`

## Progress
- Branch `feat/live-translation` created from `main`.
- RDD: off (global) — no native review.
- T1 done (commit `7c350a0`): `src/i18n-core.js` (pure `shouldTranslate`, `wrapTranslation`, `nextI18nState`) + `translate.mjs` (`createTranslator`, `validateTranslationResponse`, `isSupportedLang`) + `POST`/`GET /api/translate` wired in `serve.mjs`. `node --test test/i18n-core.test.mjs test/translate.test.mjs`: 25/25 green (11 + 14). Live smoke on `PORT=4599`: `POST /api/translate {lang:es, texts:["TASK STATUS","ADD","12:04"]}` → `{"12:04":"12:04","TASK STATUS":"ESTADO DE LA TAREA","ADD":"AGREGAR"}`, `GET /api/translate?lang=es` → cached dictionary; user's `:4520` server confirmed untouched throughout. Note: `node --test test/` (bare directory positional arg) fails on this Node build (v24.21.0) with a `MODULE_NOT_FOUND`-style error that looks like the directory is being `require`d instead of discovered by the test runner; `node --test` (default cwd discovery) and `node --test test/*.test.mjs` both run all 25 tests green — flagged for T3 verification.

- T2 done (commit `9228678`): `src/i18n.js` (queue/debounce/batch, in-flight piggyback dedupe, TreeWalker over text nodes + `placeholder`/`title`/`aria-label`, `MutationObserver` filtered to those 3 attrs, restore-on-EN, `localStorage` under `ao.lang`) wired from one import + `initI18n()` call in `src/main.js`; `#topLang` toggle button + CSS beside `#topCal` in `src/shell.html`; one `data-no-i18n` mark on the live (`t.live`) task title in `src/tasks.js` so a task the owner typed live is never sent for translation. Exclusion selector: `#mMsgs, #bvPane, script, style, svg, canvas, [contenteditable], [data-no-i18n]` (chat rail + brain note pane fully excluded — see report for rationale). Pure parts (whitespace preservation, loop guard) already covered by T1's `i18n-core.test.mjs`; no new pure logic introduced in T2. `npm run build`: OK (1480 KB). `npm run check`: 44/47 — failures are `smoke: TEAM in the bar … (demo)` (expected baseline) and `server: /api/brain has the live graph — empty` (expected per this task's note); `smoke: department focus opens the chat rail` also failed but was reproduced identically on a stash of the pre-T2 tree, so it is pre-existing/flaky, not caused by this change.

- T3 done (commit `11a2063`): README.md gained a "Language (EN/ES)" section (between "Which model…" and "Make it yours") describing the toggle, the first-use cache-then-instant behavior, what is never translated, and that deleting `data/i18n/es.json` resets it. Final verification: `node --test test/*.test.mjs` → 25/25 green; `npm run build` → OK (1480 KB); `npm run check` → 43/47, same four failures as the pre-T2 baseline (`smoke: command bar adds a task in demo mode` flaky, `smoke: TEAM in the bar … (demo)`, `smoke: department focus opens the chat rail` — reproduced on a stash of the pre-change tree, pre-existing/flaky — and `server: /api/brain has the live graph — empty`, flagged per this task's note); live smoke on `PORT=4599` (`POST`/cache-hit) confirmed working, test server killed by exact PID, `:4520` confirmed untouched throughout every run in this task. Known gap: `node --test test/` (the exact runner command named in this doc's Checks/TDD sections) fails on this Node build (v24.21.0) with a `MODULE_NOT_FOUND`-style error on the bare directory positional argument — `node --test` (default discovery) and `node --test test/*.test.mjs` both pass all 25 tests; not something this task's changes can fix, reported as an environment gap.

- T4 done (commit `<pending>`, filled in below): `src/connectors-split.js` — a pure, DOM-free `splitConnectors(servers)` (servers: `{key, name, status}[]`) → `{shown, collapsed}`; a server is `shown` when `status` is `'connected'` or absent (demo mode), or when its key is `'chrome'` (always rendered individually, even `pending`, per the existing "not wired to a pod until it works" rule); everything else (`needs-auth`, `failed`, `denied`, …) goes to `collapsed`, order preserved within each group. Unit tests first in `test/connectors-split.test.mjs` (7 cases: connected shown, demo/no-status shown, needs-auth+failed+denied collapse, chrome always shown even pending, empty collapsed when nothing is unusable, order preservation, empty input) — RED (module missing) confirmed, then GREEN.
  `src/mcp.js`: wired `splitConnectors` into the top-bar render — `shown` renders one `<img>` each exactly as before (same click handler, pop-in stagger, off/status styling for the still-individually-shown Chrome tile); when `collapsed.length`, ONE `<span class="tc-more">+N</span>` chip is appended, `title` = one `"name — reason"` line per collapsed server (reused the existing per-status reason text via a small `reasonFor(k)` helper factored out of the old inline ternary, so wording is unchanged). Verified nothing else keys off "every uniqKey has a topconn img": `BY_DEPT`/wire lookups only ever contain connected keys (the `off` list was already excluded from `byDept` upstream in `connectors.js`), so collapsing non-connected tiles touches no dock/wire code. Pop-in stagger timing (`volleyAt`, `startReveal`) now uses the actual rendered tile count (`shown.length + (collapsed.length?1:0)`) instead of the full `uniqKeys.length`, and `startReveal()` also re-pops the chip.
  `src/shell.html`: `.tc-more` CSS (27×27 chip, grey background/text, same `tcin` pop-in as a logo tile, `body.dark` variant). Layout fit: `.brand` gained `white-space: nowrap; flex-shrink: 0`; `#topconn` gained `min-width: 0; overflow: hidden` (shrinks/clips instead of forcing the bar wider); `#topmodels`, `#topCal`, `#topLang`, `#topAppr`, `#clock` gained `flex-shrink: 0` so the connector strip is the only thing that ever gives up space.
  Verification: `node --test test/*.test.mjs` → 39/39 green (32 pre-existing + 7 new). `npm run build` → OK (1482 KB). `npm run check` → 45/47, same two pre-existing baseline failures as T2/T3 (`smoke: TEAM in the bar … (demo)` and `server: /api/brain has the live graph — empty`); `smoke: command bar adds a task in demo mode` and `smoke: department focus opens the chat rail` passed this run (the flaky ones named in this task's baseline). Visual check via `playwright-core` against a `PORT=4599` test server (killed by exact PID afterward; owner's `:4520` server confirmed untouched, responding `200` before and after): at 1920×930 — `#topCal` right edge 1717px, `#topLang` right edge 1777px (both < 1920 innerWidth), brand box height 25px (single line), 10 connected/Chrome tiles shown + one `"+27"` chip (37 servers total, matching `/api/mcp`'s "37 servers · 10 connected"); at 1366×768 — `#topCal` right edge 1163px, `#topLang` right edge 1223px (both < 1366), brand still single-line, connector strip now visibly clips (only a few tiles show, `+27` chip and Chrome tile clipped out of view) while every right-hand control stays fully on-screen. Dark mode confirmed: `body.dark #topconn .tc-more` computed to `background: rgba(236,234,227,.16)`, `color: rgba(236,234,227,.6)`. Screenshots: `/tmp/claude-1000/-home-julian-proyectos-agents-office/2d6bc799-4924-4ba7-bff1-76ebff14ff11/scratchpad/topbar-1920x930.png`, `topbar-1366x768.png`, `topbar-dark-1920x930.png`.

## Next step
Feature complete (T1–T4). Open gaps to flag to the owner: `node --test test/` fails to discover tests on this Node build (v24.21.0) with a `MODULE_NOT_FOUND`-style error on the bare directory positional argument — use `node --test` (default discovery) or `node --test test/*.test.mjs` instead; the two pre-existing `npm run check` failures (`TEAM in the bar … (demo)`, `/api/brain has the live graph — empty`) remain, unrelated to this feature.
