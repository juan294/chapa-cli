# Implementation Plan: CLI Reliability and Architecture Improvements

> Created: 2026-04-17 | Branch: `develop` | Research: local codebase analysis on 2026-04-17

## Summary

Implement four focused improvements without broad rewrites:

1. Replace duplicated raw `fetch()` handling with a shared transport layer that applies consistent timeouts, auth/header wiring, JSON parsing, and error mapping.
2. Replace the `StatsData | null` merge fetch contract with a typed result so merge operations can always emit telemetry, including GitHub fetch failures.
3. Centralize process termination in `src/index.ts` so helper modules return typed failures instead of calling `process.exit()`.
4. Lazy-load the `insights` command path so `linkedom` is not eagerly loaded for `login` and `merge`.

The codebase is already compact and healthy. The goal is to remove real reliability gaps and unnecessary startup/bundle cost, not to reorganize files for their own sake.

## Current-State Observations

- Merge telemetry is documented as always sent, but fetch failures exit before telemetry is emitted.
- Network calls are implemented independently across login, GitHub fetch, upload, insights upload, recalculate, and telemetry.
- Only telemetry uses `AbortSignal.timeout()`. Other user-facing requests can hang indefinitely.
- `login()` owns process termination even though the CLI already has a top-level error boundary.
- `index.ts` eagerly imports `insights.ts`, which eagerly imports `linkedom`, so all commands pay the `insights` parsing cost.

## Design Options

### Option A: Thin shared transport helper + typed operation results

- Add a small `src/http.ts` helper with timeout support, normalized errors, JSON/text parsing helpers, and optional auth headers.
- Convert `fetch-emu`, `upload`, `insights`, `login`, and `telemetry` to use it.
- Change merge orchestration to consume typed results instead of `null` sentinels.
- Use dynamic import for `insights`.

**Pros**

- Solves the real reliability issues directly.
- Keeps the repo small and dependency-free.
- Minimizes conceptual overhead for a CLI this size.

**Cons**

- Requires touching several networked modules in one pass.
- Introduces a small shared abstraction that must stay intentionally narrow.

### Option B: Full service/client class split

- Create separate GitHub client, Chapa client, auth polling client, and command service layers.
- Move command handlers out of `index.ts` into dedicated orchestrators.

**Pros**

- Stronger long-term separation if the CLI grows into many more commands.

**Cons**

- Too much structural churn for the current size of the codebase.
- Higher regression risk with limited immediate payoff.

### Option C: Minimal patching only

- Add telemetry in one extra branch, add timeouts ad hoc, and dynamic-import `insights` without shared transport work.

**Pros**

- Lowest code churn.

**Cons**

- Preserves duplicated request logic and inconsistent error behavior.
- Fixes symptoms rather than the architectural cause.

## Recommended Approach

Use **Option A**.

This keeps the architecture proportionate to the repo while addressing the clear issues found in the analysis. The implementation should stay intentionally small:

- one shared transport helper
- one typed merge-fetch result
- one centralized error/exit boundary
- one lazy-loaded `insights` path

No broader file/folder reorganization is needed.

## Phase Overview

- [x] Phase 1 | Shared transport layer and request normalization
- [x] Phase 2 | Merge orchestration, guaranteed telemetry, centralized exits
- [x] Phase 3 | Lazy-load `insights` path and verify runtime/build impact

| Phase | Description | Files | Batch |
|-------|-------------|-------|-------|
| 1 | Shared transport layer and request normalization | `src/http.ts`, `src/fetch-emu.ts`, `src/upload.ts`, `src/insights.ts`, `src/login.ts`, `src/telemetry.ts`, related tests | - |
| 2 | Merge orchestration, guaranteed telemetry, centralized exits | `src/index.ts`, `src/fetch-emu.ts`, `src/login.ts`, `src/telemetry.ts`, related tests | - |
| 3 | Lazy-load `insights` path and verify runtime/build impact | `src/index.ts`, `tsup.config.ts` if needed, `src/index.test.ts`, build verification | - |

No phases are marked `[batch-eligible]`.

Reason: the phases are intentionally sequential and share `src/index.ts`, request behavior, and command execution paths.

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test` passes with new coverage for:
  - GitHub fetch failure telemetry emission
  - shared request timeout/error normalization
  - login returning typed failures instead of exiting internally
  - lazy `insights` loading behavior at the command boundary
- `pnpm run build` passes.
- Build output no longer eagerly wires `insights` logic into non-insights execution paths, verified by artifact inspection and/or chunk output depending on tsup behavior.

### Manual

- `chapa login` still shows the same user-facing login flow and exits with code `1` on timeout/expired session through the top-level boundary.
- `chapa merge --emu-handle ...` reports fetch failures cleanly and still emits telemetry for that failed operation.
- `chapa insights --file ...` still parses and uploads successfully after lazy-loading.
- Network failures across commands fail within bounded time instead of hanging indefinitely.

## Risks and Guardrails

- Keep the shared HTTP helper narrow. Do not turn it into a generic framework layer.
- Preserve existing user-facing messages unless a change improves correctness or consistency.
- Keep telemetry fire-and-forget semantics intact even after transport unification.
- Verify tsup’s dynamic import behavior before assuming bundle splitting; if the initial lazy-load does not reduce eager loading, adjust the build config in Phase 3 rather than overcomplicating Phase 1.

## Phase Details

- [Phase 1: Shared transport layer and request normalization](2026-04-17-cli-reliability-architecture-improvements-phases/phase-1.md)
- [Phase 2: Merge orchestration, guaranteed telemetry, centralized exits](2026-04-17-cli-reliability-architecture-improvements-phases/phase-2.md)
- [Phase 3: Lazy-load insights path and verify build/runtime impact](2026-04-17-cli-reliability-architecture-improvements-phases/phase-3.md)
