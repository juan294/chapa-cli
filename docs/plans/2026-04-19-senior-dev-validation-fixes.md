# Implementation Plan: Senior-Dev-Validated CLI Fixes

> Created: 2026-04-19 | Branch: `develop` | Research: `docs/research/2026-04-19-deep-dive-validation.md`

## Summary

Implement the six items the senior developer confirmed in the validation report, in priority order:

1. `--server=URL` form silently ignored when saved config exists (routing bug — high impact).
2. IPv6 loopback (`http://[::1]:...`) currently rejected by `assertTrustedServer` (item J — confirmed live regression on current Node).
3. `--insecure` disables TLS validation for the whole process, not just the Chapa server (security bug — high impact).
4. `spawnDetachedPost` copies the entire parent `process.env` into the detached child (item H — hardening).
5. GraphQL PR pagination has no aggregate cap (item #2 — cap only; query split deferred).
6. `parseMultiClauding` is brittle against inline-style formatting changes (item #3 — hardening; no known active regression).

Explicitly deferred (per senior dev): GraphQL query split, telemetry-helper extraction, `readFileSync` → async, `shared.ts` split, retry/backoff, error-body decoding centralization, dead-export removal, non-adjacent dedup in `normalizeErrorCauseChain`.

## Current-State Observations

- `src/cli.ts:103` sets `serverExplicit` with `argv.includes("--server")`, which misses the `--server=URL` form even though Node's `parseArgs` accepts it.
- `src/index.ts:95-96` — `isLoopbackHost` checks `"::1"` but `new URL("http://[::1]:3000").hostname` returns `"[::1]"` on Node 20+; the bracketed form is rejected today.
- `src/index.ts:571-575` — `--insecure` sets `NODE_TLS_REJECT_UNAUTHORIZED = "0"` process-wide, so GitHub API calls and detached telemetry/recalculate also bypass TLS. `src/index.test.ts:319-349` and `src/login.test.ts:258-284` explicitly lock in this behavior and will need to be updated.
- `src/background.ts:55-62` — spawns a detached Node child with `env: { ...process.env, CHAPA_BG_* }`, leaking every caller env var (including `GITHUB_EMU_TOKEN` and any other secrets on the shell) to the child.
- `src/fetch-emu.ts:245-292` — `while (hasNextPage)` trusts GitHub's `pageInfo` with no aggregate cap. Each page also reissues the full `CONTRIBUTION_QUERY` (query split deferred).
- `src/insights.ts:173-204` — `parseMultiClauding` matches inline-style substrings literally (`"font-weight: 700"` / `"font-weight:700"` only) and pairs `labels[i]` with `values[i]` without verifying equal length.

## Design Options

### Option A — Scope `--insecure` via a per-request flag (recommended, zero-dep)

- Add `insecure?: boolean` to the `http.ts` request options.
- When true, save `NODE_TLS_REJECT_UNAUTHORIZED`, set it to `"0"` for the lifetime of just that fetch, and restore it on completion (success or failure).
- Callers that talk to Chapa (login poll, upload, insights, telemetry, recalculate) forward `args.insecure`.
- Callers that talk to GitHub (`fetch-emu.ts`) never forward it.
- Detached child opts in via a new `CHAPA_BG_INSECURE=1` env var that the child script inspects before its `fetch()`.

**Pros**
- Zero runtime deps (matches `CLAUDE.md` zero-dep policy).
- Matches the existing `insecure` param plumbing already in `login.ts`.
- GitHub API calls always validate TLS, regardless of `--insecure`.

**Cons**
- The env var is still process-global during the single fetch; safe here because CLI requests are serial (no concurrent Chapa + GitHub fetches in a single command).

### Option B — Add `undici` as a runtime dep with per-request `dispatcher`

**Pros:** Cleanest isolation. **Cons:** Breaks zero-dep policy.

### Option C — `tsup noExternal: ["undici"]` to bundle

**Pros:** No *installed* dep. **Cons:** Significant bundle-size increase for a rarely-used flag.

## Recommended Approach

**Option A.** Confirmed with the project lead.

## Phase Overview

- [x] Phase 1 | `--server=URL` form detection fix
- [x] Phase 2 | IPv6 loopback (`[::1]`) handling in `isLoopbackHost`
- [x] Phase 3 | Per-request `insecure` scoping (remove global `NODE_TLS_REJECT_UNAUTHORIZED`)
- [x] Phase 4 | `spawnDetachedPost` env allow-list + `CHAPA_BG_INSECURE` propagation
- [x] Phase 5 | GraphQL PR pagination hard cap
- [x] Phase 6 | `parseMultiClauding` hardening

| Phase | Description | Files modified | Batch |
|-------|-------------|----------------|-------|
| 1 | `--server=URL` form detection fix | `src/cli.ts`, `src/cli.test.ts` | `[batch-eligible]` |
| 2 | IPv6 loopback `[::1]` handling | `src/index.ts`, `src/index.test.ts` | `[batch-eligible]` |
| 3 | Per-request `insecure` scoping | `src/http.ts`, `src/index.ts`, `src/login.ts`, `src/upload.ts`, `src/insights.ts`, `src/telemetry.ts`, `src/background.ts`, `src/index.test.ts`, `src/login.test.ts`, `src/http.test.ts` (new) | — |
| 4 | `spawnDetachedPost` env allow-list | `src/background.ts`, `src/background.test.ts` (new) | — |
| 5 | GraphQL PR pagination hard cap | `src/fetch-emu.ts`, `src/fetch-emu.test.ts` | `[batch-eligible]` |
| 6 | `parseMultiClauding` hardening | `src/insights.ts`, `src/insights.test.ts` | `[batch-eligible]` |

**Batch groups:**
- Phases 1, 2, 5, 6 touch fully disjoint files and can run in parallel via `/batch`.
- Phases 3 and 4 must run **sequentially in order** — both modify `src/background.ts`, and phase 4 depends on phase 3's `CHAPA_BG_INSECURE` contract already being in place.

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test` passes, with new regression coverage for:
  - `--server=URL` (both space-separated and `=` form) setting `serverExplicit` correctly.
  - `http://[::1]:<port>` accepted by `assertTrustedServer`.
  - `http.ts` `insecure: true` flips and restores `NODE_TLS_REJECT_UNAUTHORIZED` around a single fetch; on exception too.
  - `--insecure` no longer pollutes `process.env.NODE_TLS_REJECT_UNAUTHORIZED` after command completion.
  - GitHub fetch path is *never* called with the insecure flag.
  - `spawnDetachedPost` does not leak `GITHUB_EMU_TOKEN` or other non-allow-listed env vars to the child.
  - GraphQL pagination stops at the hard cap with a clear error and telemetry category.
  - `parseMultiClauding` still extracts the fixture, tolerates whitespace variants, and returns zeros (not wrongly-paired values) on label/value count mismatch.
- `pnpm run build` passes and the built `dist/index.js` still has a shebang, zero runtime deps.

### Manual

- `chapa merge --server=https://staging.example.com --emu-handle foo` uses the staging server, not the saved production one.
- `chapa login --server http://[::1]:3000` no longer prints "Refusing to send credentials…".
- `chapa merge --insecure --emu-handle foo` on a corporate network: Chapa upload/login succeeds with a self-signed cert *but* GitHub API still validates TLS. After the command exits, `NODE_TLS_REJECT_UNAUTHORIZED` is unset in the shell.
- A detached background child cannot read `GITHUB_EMU_TOKEN` from its own `process.env`.
- An EMU account with 2 000+ PRs either paginates normally or fails with `GraphQL pagination exceeded maximum pages` (no infinite loop).
- Existing `chapa insights --file report.html` still returns the correct multi-clauding numbers against the committed fixture.

## Risks and Guardrails

- **Updating existing TLS tests is non-negotiable** — `src/index.test.ts:319-349` and `src/login.test.ts:258-284` currently assert the behavior we are removing. Replace them; do not bypass them.
- Keep the `--insecure` flag's user-facing UX identical (same warning message, same flag name). Only the scope changes.
- `NODE_TLS_REJECT_UNAUTHORIZED` save/restore must use `try/finally` so errors during the fetch still restore the original value.
- Do not change pagination cadence/shape beyond adding the cap; the query split is deferred by design.
- Do not change the multi-clauding schema; only the parser's tolerance to formatting.
- Keep zero runtime dependencies (only `devDependencies` may grow).

## Phase Details

- [Phase 1: `--server=URL` form detection fix](2026-04-19-senior-dev-validation-fixes-phases/phase-1.md)
- [Phase 2: IPv6 loopback handling](2026-04-19-senior-dev-validation-fixes-phases/phase-2.md)
- [Phase 3: Per-request `insecure` scoping](2026-04-19-senior-dev-validation-fixes-phases/phase-3.md)
- [Phase 4: `spawnDetachedPost` env allow-list](2026-04-19-senior-dev-validation-fixes-phases/phase-4.md)
- [Phase 5: GraphQL PR pagination hard cap](2026-04-19-senior-dev-validation-fixes-phases/phase-5.md)
- [Phase 6: `parseMultiClauding` hardening](2026-04-19-senior-dev-validation-fixes-phases/phase-6.md)
