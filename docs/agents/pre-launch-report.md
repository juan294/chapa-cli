# Pre-Launch Audit Report
> Generated on 2026-03-23 | Branch: `develop` | Version: 0.3.1 | 6 parallel specialists

## Verdict: CONDITIONAL

Two blockers must be resolved before release: the `linkedom` runtime dependency contradicts the zero-dependency policy (either bundle it or update the policy), and the CHANGELOG is stale (versions 0.2.9–0.3.1 undocumented). No blockers in application logic — all 226 tests pass with 95.6% statement coverage.

## Blockers (must fix before release)

| # | Issue | Found by | Fix |
|---|-------|----------|-----|
| B1 | **`linkedom` is a runtime dependency but not bundled into `dist/index.js`** — tsup externalizes it, requiring `npm install` to fetch it. CLAUDE.md claims "zero runtime dependencies." Either bundle it via `noExternal: ["linkedom"]` in tsup config, or explicitly document the exception. | architect, devops, performance | Bundle `linkedom` into the build OR update zero-dep policy |
| B2 | **CHANGELOG.md is stale** — `[Unreleased]` section is empty, last documented version is `0.2.8` but package.json is at `0.3.1`. Versions 0.2.9–0.3.1 are entirely undocumented (11 commits including new `insights` command, login improvements, Node 18 EOL). | devops | Document all changes from 0.2.9 through upcoming release |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `rollup` 4.x has arbitrary file write vulnerability (GHSA-mw96-cpmx-2vgc), transitive via `tsup` | High | security | Dev-only — not shipped to users. Awaiting tsup update. |
| W2 | `openBrowser()` uses `shell: true` on Windows (`login.ts:46`) — potential command injection via malicious `--server` URL | Medium | security | Self-attack vector (user controls own CLI flags). Low real-world risk. |
| W3 | `strict: false` in `parseArgs` (`cli.ts:47`) — unknown flags silently ignored, typos cause confusing failures | Medium | security, ux | Users may think they passed a flag when they didn't. |
| W4 | Duplicated URL base-stripping `serverUrl.replace(/\/+$/, "")` in 5 files | Medium | architect | Maintenance burden; risk of inconsistent handling. |
| W5 | Duplicated error-cause-chain-walking in `login.ts` and `fetch-emu.ts` | Low | architect | Three similar functions could be consolidated. |
| W6 | `index.ts` is 374 lines with inlined command handlers | Low | architect | Single-responsibility violation; extract `handleInsights()`, `handleMerge()`. |
| W7 | Knip: 2 unused function exports (`openBrowser`, `waitForEnter`) + 6 unused type exports | Low | architect, performance | Functions exported for DI testing; types are public API surface. |
| W8 | 17 `process.exit()` calls in `index.ts` + 2 in `login.ts` | Low | architect | Hard to test in integration; consider returning exit codes. |
| W9 | 4 untested error paths: MAX_POLL timeout, parseInsightsHtml throw, non-ENOENT file error, response body parse fallbacks | Medium | qa | Edge cases in login polling, insights parsing, and network resilience. |
| W10 | Eager `import { parseHTML } from "linkedom"` penalizes startup for all commands (login, logout, merge, help) | Medium | performance | Only `insights` uses linkedom; lazy-load would fix. |
| W11 | `linkedom` brings ~5 MB of transitive dependencies (13+ packages) | Medium | performance | Significant install footprint for a CLI tool. |
| W12 | No top-level `.catch()` on `main()` call (`index.ts:374`) | Medium | ux | Unexpected errors show raw Node.js stack traces. |
| W13 | Login polling has no visual feedback for first 10 seconds | Low | ux | Users may think CLI is frozen before dots appear. |
| W14 | Dirty working tree on `develop` (modified CLAUDE.md, untracked agent files) | Low | devops | Must be clean before release PR. |
| W15 | 6 open Dependabot PRs (actions/checkout, setup-node, codeql-action, pnpm/action-setup, npm deps) | Low | devops | Target `main` — require user review. |
| W16 | NPM token expires 2026-05-16 (54 days) | Low | devops | 14-day warning will fire 2026-05-02. |
| W17 | No automated npm publish workflow | Low | devops | Manual publishing is documented policy; workflow would formalize it. |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN

- **Tests**: 226 passed, 0 failed, 11 test files
- **Typecheck**: Clean (0 errors)
- **Coverage**:
  - Statements: 95.61%
  - Branches: 86.08%
  - Functions: 87.17%
  - Lines: 96.64%
- **Critical paths covered**: auth (100%), config (100%), CLI parsing (100%), shared/scoring (100%), telemetry (100%), logger (100%)
- **Lower coverage files**:
  - `login.ts`: 83.5% statements, 78.6% branches, 58.3% functions — `openBrowser`/`waitForEnter` implementations untested (DI mocks used), MAX_POLL timeout untested
  - `upload.ts`: 87.5% statements, 33.3% functions — logger parameter branch not tested
  - `insights.ts`: 98.4% statements, 82.7% branches — multi-clauding parsing edge cases and response body fallback untested
- **Untested error paths** (W9):
  - `login.ts:188-189` — MAX_POLL_ATTEMPTS exhaustion (150 polls timeout)
  - `index.ts:132-134` — `parseInsightsHtml` exception handler
  - `index.ts:121` — Non-ENOENT file read error (e.g., EACCES)
  - `fetch-emu.ts:130`, `upload.ts:45/53`, `insights.ts:293/300` — `.json().catch()` / `.text().catch()` fallbacks

### 2. Security (security-reviewer) — YELLOW

- **`pnpm audit`**: 1 high vulnerability in `rollup` (transitive via `tsup`)
  - CVE: GHSA-mw96-cpmx-2vgc (Arbitrary File Write via Path Traversal)
  - Impact: **Dev-only.** Not shipped in published package. Users not affected.
- **Hardcoded secrets**: None in source. All `ghp_`/`gho_` tokens in test files are fake values.
- **Token handling**: EMU tokens transient (CLI flags or env vars, never persisted). Personal tokens stored with `0o700` dir / `0o600` file permissions. No tokens in error messages or telemetry.
- **`--insecure` flag**: Correctly scoped to `NODE_TLS_REJECT_UNAUTHORIZED`. Warning displayed. However, when combined with `merge`, EMU tokens are sent over unverified connections to `api.github.com` (W2 risk area).
- **Dependency licenses**: `linkedom` (ISC) — MIT-compatible. All devDependencies MIT or compatible.
- **Command injection**: `openBrowser()` uses `shell: true` on Windows (`login.ts:46`). URL comes from `--server` flag + `randomUUID()`. Low risk (self-attack) but could be hardened with URL validation.

### 3. Infrastructure (devops) — YELLOW

- **Build**: Clean, 36.5 KB bundle with shebang present
- **CI status**: Most recent run on `develop` is green. One historical failure (Node 18 compat) resolved by dropping Node 18.
- **CI matrix**: `[20, 22, 24]` matches `engines.node: ">=20"` — consistent
- **npm config**: `files: ["dist"]`, dual bin entries (`chapa`, `chapa-cli`), `engines: >=20`, ESM — all correct
- **Git state**: Dirty working tree — uncommitted CLAUDE.md changes, untracked agent artifacts
- **Worktrees**: Clean (only main)
- **Commits ahead of `main`**: 11 (insights feature, login UX, Node 18 EOL, dev deps)
- **CHANGELOG**: Stale — versions 0.2.9–0.3.1 undocumented (B2)
- **Dependabot**: 6 open PRs targeting `main` — require user review
- **NPM token**: Expires 2026-05-16 (54 days)
- **Stale branch**: `origin/chore/health-fixes` should be cleaned up

### 4. Architecture (architect) — YELLOW

- **Circular dependencies**: None (verified with `madge`)
- **Dead code**: `knip` reports 2 unused function exports + 6 unused type exports — all intentional (DI testing + public API)
- **TypeScript strict mode**: Enabled with `noUncheckedIndexedAccess`, `isolatedModules`
- **Outdated dependencies**: None (`pnpm outdated` clean)
- **Code duplication**:
  - URL base-stripping (`serverUrl.replace(/\/+$/, "")`) duplicated in 5 files: `upload.ts:22`, `telemetry.ts:36`, `login.ts:112`, `insights.ts:275`, `insights.ts:319` (W4)
  - Error-cause-chain-walking: `getRootErrorMessage()` + `getFullErrorChain()` in `login.ts`, `extractErrorDetail()` in `fetch-emu.ts` (W5)
- **Module structure**: Generally clean. `index.ts` is oversized at 374 lines with inlined handlers (W6).
- **`linkedom` status**: Listed as runtime dep but NOT bundled by tsup — left as external import at `dist/index.js:332`. Phase-5 plan doc incorrectly states "linkedom is bundled" (B1).

### 5. Performance (performance-eng) — YELLOW

- **Bundle size**: 36,458 bytes (35.6 KB) — single file `dist/index.js`
- **Runtime dependencies**: 1 (`linkedom@^0.18.12`)
  - linkedom on disk: ~2.5 MB
  - Transitive deps: 13+ packages (css-select, cssom, htmlparser2, entities, etc.)
  - Total install footprint: ~5 MB
- **Startup penalty**: `linkedom` imported eagerly at top level — loads for every command including login/logout/merge/help (W10)
- **GraphQL query**: Efficient — uses `first: 1` with `totalCount` for counts, reasonable caps for lists
- **Async patterns**: fetch → upload is correctly sequential (data dependency); telemetry and recalculate are correctly fire-and-forget
- **Sync I/O**: `config.ts` uses sync fs operations — acceptable for single small file reads per invocation

### 6. UX/Accessibility (ux-reviewer) — YELLOW

- **Help text**: Well-structured with Commands + Options sections. All flags documented. Version dynamically injected.
- **Error messages**: Generally clear and actionable with next-step hints. `[cli]` prefix in `fetch-emu.ts` errors looks like internal debug label.
- **Output modes**: `--json` for scripting, `--verbose` for debugging — both work consistently across merge and insights.
- **Login flow**: Good npm-style UX with browser auto-open, TTY detection, non-TTY fallback. Minimal feedback during first 10 seconds of polling (W13).
- **Edge cases**: No arguments shows usage hint. Missing credentials give clear fix instructions. Network errors handled gracefully.
- **Silent flag typos**: `strict: false` in parseArgs means unknown flags are silently discarded (W3).
- **No top-level error boundary**: Uncaught exceptions show raw stack traces (W12).
- **Exit codes**: All failures exit with code 1 — no differentiation by error type.
- **No telemetry opt-out**: CLI sends telemetry on every merge/insights operation with no `--no-telemetry` flag.
