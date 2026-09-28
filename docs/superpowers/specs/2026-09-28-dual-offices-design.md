# Dual-office architecture: Claude and Codex

**Status: design for user review — implementation is not authorized yet.**

## Decision

Build a home launcher for two simultaneously usable offices: the existing Claude office and a new Codex office. From either office, provide a direct link to the other without returning home. Use two isolated local office-server processes plus a small launcher/home surface, rather than putting both providers into the existing singleton server.

The existing Claude office keeps its current data and configuration paths as-is. The Codex office gets separate app-owned config, data, brain, roster/customizations, routines, skills, and usage state, while reusing the existing local Codex runtime configuration and authentication by default. Both offices may read the same shipped application assets, but neither may write or interpret the other office's app-owned state. Navigation changes the browser destination only; it must not stop or cancel either office's running task.

## Why two processes

The current server loads one config and provider backend at process startup, persists tasks/routine state under one root `data` directory, and serves unscoped API routes. Its roster and skill loaders resolve one brain context. A second panel in the same process would therefore share provider selection, in-memory queues, and persistence rather than isolate them. Separate processes give each office an independent configuration and runtime boundary; separate storage roots complete that boundary. Merely setting `AO_BRAIN` is insufficient because the task and routine state paths remain rooted in shared `data`.

| Choice | Assessment |
|---|---|
| Two office processes + home launcher | **Recommended.** Reuses the existing office lifecycle, lets each process pin one provider and independent paths, and naturally allows concurrent tasks. Costs: a launcher/supervisor, port allocation, and per-instance health/shutdown handling. |
| One multi-tenant server | Not recommended for the first release. It would require provider, task queues, API routes, data access, schedulers, usage, caches, UI state, and authorization to be office-scoped on every request. One missed scope check can leak or mutate cross-office data. It could reduce processes later, after isolation is covered end-to-end by tests. |

The launcher should have its own configurable local port and serve the home screen. Preserve the existing Claude office's current port (`4520`) as its default; use `4519` for the launcher and `4521` for Codex. All three ports remain configurable and validated for uniqueness. Display actual office URLs from runtime configuration, not hard-coded links. A single launcher command should start/check both office processes on startup and report per-office readiness. Port collisions or a failed child process must be reported for that office; do not silently move its state, reuse the other office, or route its requests to the healthy provider.

## Runtime and navigation

```text
Browser
  ├── Home / launcher
  ├── Claude Office UI ── Claude office process ── Claude provider
  └── Codex Office UI  ── Codex office process  ── Codex SDK/local Codex runtime
```

- The launcher starts, health-checks, and stops only office processes it owns. A restart or failure in one process does not terminate the other.
- Home offers one entry for each office and shows each office's readiness separately.
- Each office has a persistent `Switch office` link to the other office. Opening the target in the same or a new tab is a UI detail; the source office stays running either way.
- Office APIs remain local to their own process and state root. The launcher is not a proxy for task/chat APIs and does not merge histories.
- On shutdown, stop accepting new work, let in-flight work finish up to a bounded grace period, then report any interrupted task clearly. Persist its last known state before exit where safe. Do not delete task history or schedule missed work in the other office.

Keep the current Claude URL working by default. If any configured port conflicts with an existing local service, fail with a clear message rather than taking over that port. Starting both offices on launcher startup is the default; readiness remains independent so a failure in either process does not prevent using the other.

## Isolation contract

| State or capability | Claude office | Codex office | Rule |
|---|---|---|---|
| Config | Existing `office.config.json` / local override | New provider-specific local config | Pin provider at process start; no shared mutable provider selector. |
| Tasks and routine state | Existing `data/` | New Codex-specific data root | Includes tasks, routine run state, interviews, feedback, usage snapshots, and any future persisted UI/server state. No shared JSON/database files. |
| Brain, notes, learning | Existing configured brain | Separate Codex brain | Never point both writable brains at the same directory by default. The user's existing Claude brain is not copied, renamed, migrated, or cleaned. Any future explicit import/export is a separate user-approved feature. |
| Agent roster and skills | Existing resolution order and custom files | Independent roster and custom skills | Shared shipped defaults are read-only inputs; user-edited overlays and generated skills belong to one office. A Codex office must not accidentally inherit Claude-specific connected-tool names or writable customizations. |
| Queues, timers, process cache | Existing Claude process only | Codex process only | No shared queue, scheduler, runtime singleton, or in-memory office context. |
| Browser/UI state | Claude origin/storage namespace | Codex origin/storage namespace | Separate ports provide separate origins; keep office identity explicit in API responses and persisted UI state. Do not rely on display labels as authorization. |
| Provider auth and usage | Claude's existing provider setup | Codex's own local Codex sign-in/configuration | Do not read, copy, expose, or reuse provider credentials across offices. Show usage only when the selected provider reports it; label its source and never present Claude account usage as Codex usage. |
| Runtime config, skills, transcripts and cache | Existing Claude installation state | The existing local Codex runtime home, including explicit `CODEX_HOME` if set | Reuse Codex's normal local config, sign-in, history and runtime state by default. Never read or copy tokens. A separate Codex home is optional only if the user explicitly chooses it; disclose that it may require signing in again. |

Implementation must add explicit configuration for each office's app-owned config path and data root. Process separation alone does not solve the current shared `office.config.local.json` and root-relative `data` paths. Keep repository-shipped assets common and immutable at runtime; create each office's writable app state only after validating that its resolved path is distinct from the other office and does not overwrite existing data. By default, launch Codex against the user's existing local Codex runtime environment: inherit an explicitly set `CODEX_HOME`, or let Codex use its normal default if it is unset. The Codex SDK/local runtime should reuse an existing valid CLI login; the office must not trigger a new login prompt when that login is already available, and must not read, copy, export, or log token contents. If Codex is genuinely not authenticated, report that clearly and let the user choose to sign in using Codex's supported flow. An isolated `CODEX_HOME` is an opt-in privacy boundary, not a default; explain that it will have separate config/cache/history and may require a fresh sign-in. App-owned brain, tasks, routines, office config, roster overlays, and custom office skills remain separate regardless of runtime home. The host repository's `CLAUDE.md`/`AGENTS.md` remains shared read-only project guidance, not office-owned skills or data. By default, keep notes separate; any explicit read-only sharing or import/export is a future user-approved feature.

## Codex backend recommendation

Use the official Node.js Codex SDK (`@openai/codex-sdk`) as the first local Codex integration. OpenAI documents it for controlling local Codex threads and integrating Codex into internal tools; Node.js 18+ is supported, which fits this project's Node 20+ baseline. Keep one SDK thread mapped to an office task/conversation and persist only Codex thread identifiers and office-owned task metadata in the Codex data root. Preserve the user's existing CLI/SDK authentication context, including their selected `CODEX_HOME`; do not inspect or copy credential material. Confirm the SDK's supported per-thread `cwd`, model, sandbox, and approval controls before implementation; pin each task to the Codex office workspace/config and do not assume SDK defaults are safe.

The tradeoff is deliberate: the SDK is the better fit for task automation and straightforward local integration, but the public TypeScript quickstart shown by OpenAI demonstrates start/continue/resume and a final response, not the full rich-client approval/event UI. OpenAI describes app-server as the deeper interface for authentication, conversation history, approvals, and streamed events, but currently labels its command/WebSocket transport experimental and unsupported for production. Do not build against the removed `codex mcp-server` command. Revisit app-server only if richer streaming/approval UX is a hard launch requirement and its maturity contract changes; otherwise use the SDK and make the office's progress/failure reporting honest.

Codex provider behavior must remain distinct from Claude behavior:

- Offer only Codex model identifiers and controls supported by the installed Codex runtime; never map Claude model names (Sonnet/Opus/Fable) to guessed Codex aliases.
- Use Codex's own workspace/sandbox and approval policy. A task requiring a permission the user has not granted remains pending/declined with a visible reason; the app must not broaden permissions or turn on full access as a fallback.
- Treat credentials as owned by the local Codex installation/account flow. The app should not ask users to paste secrets into office configuration, inspect credential stores, or send tokens to the launcher.
- Keep web, MCP, filesystem and network tool availability provider-specific. Expose only the capabilities Codex actually reports/configures; do not imply Claude connectors are available in Codex.
- If Codex is absent, unauthenticated, rate-limited, or returns an error, fail the Codex task visibly and preserve it for retry. Never silently invoke Claude instead. The same no-fallback rule applies in reverse.

Official references:

- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) — local SDK use, Node package, local-thread lifecycle, and recommendation for application integration.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server) — rich-client stream/approval integration and current experimental status.
- [Codex MCP server removal](https://learn.chatgpt.com/docs/mcp-server) — the former Codex-as-MCP-server command was removed; app-server is not a drop-in MCP server.
- [Advanced Codex configuration](https://learn.chatgpt.com/docs/config-file/config-advanced) — `CODEX_HOME` contains local config, auth storage, history, logs, and caches.
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) — Codex CLI `exec` reuses saved CLI authentication by default.
- [Agents runtime comparison](https://developers.openai.com/api/docs/guides/agents) — distinguishes managed Codex harness, Agents SDK, and Responses API. This design uses local Codex, not the hosted Agents API or a newly built model-level coding agent.

## Failure and preservation behavior

- A home-screen health check must identify the office name/provider and whether that specific process is ready. A failed Codex start leaves Claude usable, and vice versa.
- An office process may restart from its own persisted state only. Startup validates that paths and port are unique, reports parse/access errors, and does not “repair” by clearing or importing another office's files.
- Missing provider installation/login, invalid model/configuration, port collision, stale child PID, storage write failure, and provider/network failure are distinct user-visible error states. Preserve unfinished tasks and report whether a retry is safe.
- Task/chat requests include an office identity at the process boundary for diagnostics, but do not use caller-provided identity to select another provider or storage root.
- The first migration must be non-destructive: the current Claude config, `data/`, configured brain, roster overlays and custom skills remain at their exact existing paths and readable by the existing Claude startup path. Do not rename, move, rewrite, deduplicate, or delete these files. Verify before/after file identity and content for an existing fixture/user snapshot.

## Acceptance criteria for implementation planning

- [ ] Home can enter Claude or Codex; each office has a direct link to the other.
- [ ] Both office processes can have independent tasks in progress at once; switching the browser view does not cancel either task.
- [ ] Tasks, chats, routines, notes, rosters, skills, local config, usage and browser state created in one office are not visible or writable in the other.
- [ ] Existing Claude office defaults, data, brain, roster, skills, and its current URL continue to work without migration or destructive startup behavior.
- [ ] A valid existing local Codex login is reused automatically, including an explicitly configured `CODEX_HOME`, without triggering a new login prompt or copying/reading token contents.
- [ ] Codex tasks use Codex models, tools, local auth, sandbox and approvals only; unsupported capabilities and permission requests are surfaced rather than simulated.
- [ ] Provider missing/auth failure, child crash, port conflict, and data-path collision fail closed for that office. No automatic provider fallback occurs.
- [ ] Launcher stop/restart is office-scoped and preserves unfinished task history.
- [ ] Tests cover path separation, port uniqueness, concurrent operation, cross-office API/storage isolation, direct navigation, health failures, provider failure/no fallback, and Claude-state preservation.

## Technical validation before implementation

- Confirm the installed Codex SDK version preserves the current local login context and exposes safe per-thread `cwd`, model, sandbox, and approval controls. If a valid login is unavailable, show a sign-in-needed state rather than prompting unexpectedly or falling back to Claude. If interactive approval cannot be represented safely, keep the task blocked pending explicit user action; do not broaden permissions or select full access as a workaround.
- Confirm the SDK's supported progress/event surface. If it cannot provide reliable intermediate events, show honest queued/running/final/error states rather than simulating tool-level progress. App-server remains a later option if its production maturity changes.

## Self-review

- The chosen boundary addresses both the user's requested simultaneous work and the codebase's process-global provider/configuration and root-scoped data model.
- The existing Claude office's data is preserved by path continuity; a separate brain alone is explicitly insufficient.
- Existing Codex authentication/home is reused by default while app-owned office data and brains remain separate; isolated Codex home is opt-in and discloses re-login cost.
- Resolved defaults are launcher `4519`, existing Claude `4520`, Codex `4521`, both processes started by the launcher, and separate notes unless the user later opts into a sharing feature.
- Codex SDK is recommended with a documented tradeoff; app-server is not presented as production-ready, and the removed MCP server is excluded.
- Permissions, models, tools, usage, errors, and fallback behavior are provider-specific. Unsupported details remain open questions rather than assumed capabilities.
- This document is a design for review only; implementation and implementation planning wait for user review.
