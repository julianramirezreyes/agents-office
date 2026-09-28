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

## Next step
Feature complete (T1–T3). Open gap to flag to the owner: `node --test test/` fails to discover tests on this Node build; use `node --test` or `node --test test/*.test.mjs` instead.
