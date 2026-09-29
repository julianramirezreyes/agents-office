# Codex office chat

## Objective
Make the existing agent chat usable in the Codex office through the signed-in local Codex SDK, while preserving the separate Claude office and provider-specific diagnostics.

## Problem and scope
`POST /api/chat` currently returns 501 for Codex before running an agent. The UI wraps that error with a Claude-specific message. Implement Codex chat using the existing agent persona, relevant notes, recent tasks, and bounded per-agent conversation history. Keep the existing Claude route and task runner behavior. Do not send real provider requests in automated tests or modify the user's ignored office state.

## Constraints and decisions
- Authorized source scope: `codex-provider.mjs`, `serve.mjs`, `src/main.js`, focused tests, and minimal relevant documentation.
- Strict TDD: enabled by project instructions; observe RED → GREEN → REFACTOR per behavior. Runner: `node --test <focused test file>` then `npm run check`.
- Codex chat uses a fresh SDK turn with the current agent context and bounded client-supplied history on each request, matching Claude's existing history window. It does not silently resume a hidden thread after a page reload. Chat must use a separate read-only/no-approval policy; task execution keeps its configured workspace/approval policy. Validated application routes own setup and routine writes.
- Automated tests use injected provider/SDK fakes, never the user's login. A real-provider smoke test requires separate explicit authorization for that remote operation.
- Delivery: local feature branch `feat/codex-office-chat`; no push or PR without a later user decision. Forecast: about 250–350 authored changed lines, below the 400-line review heuristic; reassess if scope grows. Strategy: `ask-on-risk`.

## Tasks
- [x] **COC-01 — Codex chat adapter.** Added `runChat()` using a fresh SDK thread per call, caller-composed prompt, and the configured workspace/sandbox/approval policy; policy and workspace violations block before starting the SDK. SDK final responses, absent replies, and thrown failures have explicit results. `runTask()` is unchanged. Route: delegated writer (non-trivial adapter and test files). Check: `node --test test/codex-provider.test.mjs` — 17/17 passed; `npm run check` — 142/143 passed, with the unrelated launcher test failing because port 4519 is already occupied by the active dual-office launcher. No real provider request was sent. Commit: `f981e4d1addc4412ee41c3a24f3cf989ea7c7a36`.
- [x] **COC-02 — HTTP and UI chat integration.** Initial implementation in `9203ee942276e2812483f604223cabd3a957d268` routes Codex chat and preserves provider labeling/history. Correction adds a separate enforced read-only/never-approval SDK policy for chat (task `runTask` policy unchanged), removes each matching thinking entry on success/network/HTTP/invalid-JSON failures, and routes Codex routine and setup commands through app-owned handlers; onboarding generation uses the same read-only provider method. Existing onboarding validation limits generated agent IDs and sanitizes skill paths; test exercised a traversal-like generated name and confirmed writes stay under the Codex brain. Checks: `node --test --test-name-pattern='codexChatRoutes(Routine|Setup)' test/office-server.test.mjs` — 2/2 passed; `node --test test/codex-provider.test.mjs` — 18/18 passed; `node --test test/office-navigation.test.mjs` — 23/23 passed; `npm run check` — 153/154 passed, with only `launcher_twoOfficesRunIndependentTasksAtOnce` failing `EADDRINUSE 127.0.0.1:4519` due to the active launcher; `npm run build` and `git diff --check` passed. RED was observed for the wider SDK options, missing Codex routine/setup dispatch, and missing UI request cleanup helper before each corresponding implementation. No real provider request was sent. Route: delegated writer. Correction commit: `de29846d1d5d0c8cae2af3080bb1a4161a362554`.
- [ ] **COC-03 — Local rollout verification.** Install the declared SDK from local package cache if available, run the full check suite without the live port conflict, restart the monitored dual-office launcher, and verify both office health endpoints. Route: delegated execution (install/build/check). Acceptance: both offices serve the new code; real-provider chat remains untested until explicit authorization for that remote operation. Check: package import, `npm run check`, `npm run build`, HTTP health. Commit: only if tracked files change.

## Progress and evidence
- Diagnosis: `serve.mjs` has a provider guard returning 501; `src/main.js` hard-codes Claude in the catch message. See Engram `diagnostics/codex-chat-501`.
- Official Codex SDK documentation confirms server-side local threads and `run()`/`resumeThread()`. The repository declares `@openai/codex-sdk@0.157.1`, but independent verification found it absent from this checkout's `node_modules`.
- Running dual-office launcher remains active on ports 4519/4520/4521; code changes require a later server restart to take effect.
- COC-01 TDD evidence: four new adapter tests failed RED with `TypeError: provider.runChat is not a function`; after implementation, focused provider tests passed 17/17.
- COC-02 TDD evidence: three Codex HTTP tests first returned 501; two UI tests failed on the missing helper exports. Both focused suites are now green.
- Independent review: COC-02 permission, UI cleanup, and setup/routine parity findings corrected in the work-unit correction commit.
- Next: COC-03 local rollout verification after SDK/package availability and active launcher constraints are resolved.
