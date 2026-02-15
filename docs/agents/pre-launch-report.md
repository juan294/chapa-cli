# Pre-Launch Audit Report
> Generated on 2026-02-15 | Branch: `develop` | 4 parallel specialists

## Verdict: CONDITIONAL

No blockers found. 7 warnings across specialists, mostly around test coverage gaps and minor configuration issues. Safe to release with the caveats noted below.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | No tests for `src/index.ts` (CLI orchestration) | Medium | qa-lead | Regressions in command dispatch, exit codes, arg validation won't be caught |
| W2 | No tests for `src/shared.ts` (scoring/aggregation) | Medium | qa-lead | Scoring formula changes could silently corrupt badge data |
| W3 | Potential token leakage in `fetch-emu.ts:96` error logging | Low | security-reviewer | Raw error object logged; should use `.message` only |
| W4 | GraphQL error response bodies logged verbatim | Low | security-reviewer | Server errors printed in full to terminal |
| W5 | ~~Missing `dependencies` label for Dependabot~~ **FIXED** | Low | devops | Label created post-audit |
| W6 | Untracked `.claude/` and `.vscode/` in working tree | Low | devops | Should be gitignored |
| W7 | `any` type usage in `fetch-emu.ts:89-90` | Low | architect | Bypasses TypeScript strict mode for GraphQL response |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — YELLOW

**Tests:** 51 passing, 0 failing, 6 test files

**Coverage (v8):**

| Metric | Value |
|--------|-------|
| Statements | 74.05% |
| Branches | 59.5% |
| Functions | 92.5% |
| Lines | 72.72% |

**Test coverage by module:**

| File | Tests | Risk if untested |
|------|-------|------------------|
| `src/auth.ts` | 4 tests | — |
| `src/cli.ts` | 10 tests | — |
| `src/config.ts` | 7 tests | — |
| `src/fetch-emu.ts` | 7 tests | — |
| `src/login.ts` | 18 tests | — |
| `src/upload.ts` | 5 tests | — |
| `src/index.ts` | **None** | **HIGH** — command dispatch, exit codes, arg validation |
| `src/shared.ts` | **None** | **MEDIUM** — scoring formula, stats aggregation |

**Recommendations:**
- Add integration tests for `index.ts` (version, help, merge without args, happy path, logout, --insecure)
- Add unit tests for `shared.ts` (`computePrWeight` edge cases, `buildStatsFromRaw` aggregation)
- Add coverage thresholds to vitest config (suggest 80% lines/functions/statements, 75% branches)

### 2. Security (security-reviewer) — YELLOW

**Hardcoded secrets:** None found. All tokens use dynamic variables.
**Token storage:** Correct. Directory `0o700`, file `0o600`. EMU tokens never written to disk.
**`--insecure` flag:** Correctly scoped to TLS verification only.
**Environment variables:** `GITHUB_EMU_TOKEN` name referenced in errors, never its value.
**Dependency licenses:** All MIT or Apache-2.0. No copyleft.
**`pnpm audit`:** Clean — no known vulnerabilities found.

**Recommendations:**
- Sanitize `fetch-emu.ts:96`: replace `console.error('[cli] fetch error:', err)` with `console.error('[cli] fetch error:', (err as Error).message)` — matches pattern already used in `upload.ts:49`
- Consider truncating server error bodies in `fetch-emu.ts:38` to prevent unexpected data flooding

### 3. Infrastructure (devops) — YELLOW

**Build:** Passes. `dist/index.js` = 16.35 KB, shebang present, executable.
**CI:** All recent runs green on both `develop` and `main`.
**npm config:** Correct — `files: ["dist"]`, `bin` field, `engines: >=18`, `prepublishOnly: tsup`.
**Branch protection:** Correctly configured (main enforces admins, develop does not).
**CHANGELOG:** Has Unreleased section with all governance additions listed.
**Git state:** Clean except untracked `.claude/` and `.vscode/`.

**Recommendations:**
- Create the `dependencies` label: `gh label create "dependencies" --color "0366d6"`
- Add `.claude/` and `.vscode/` to `.gitignore`
- NPM token expires 2026-05-16 (~90 days) — reminder workflow will trigger in ~76 days

### 4. Architecture (architect) — GREEN

**Circular dependencies:** None. Clean DAG from `index.ts` through all modules.
**TypeScript config:** Excellent. `strict: true` + `noUncheckedIndexedAccess`.
**Runtime dependencies:** Zero. Only devDependencies.
**Dead code:** Several exports only used internally or by tests (acceptable for test ergonomics).

**Recommendations:**
- Extract duplicate `serverUrl.replace(/\/+$/, "")` pattern from `login.ts:82` and `upload.ts:19` into shared utility
- Consider adding ESLint with `@typescript-eslint` (currently `lint` script just aliases `typecheck`)
- Type the GraphQL response in `fetch-emu.ts:42` instead of relying on `any`
