# Codebase Health Report
> Generated on 2026-02-16 | Branch: `develop` | Commit: `c80c204`

## Overall Verdict: HEALTHY

No critical issues found. One automated fix applied (unused test imports). Two Dependabot PRs pending review.

---

## Findings by Severity

### HIGH — Pending Dependabot PRs (requires human action)

| # | Issue | PR | CI Status |
|---|-------|-----|-----------|
| 1 | `actions/checkout` v4 → v6 (major) | [PR #1](https://github.com/juan294/chapa-cli/pull/1) | All checks pass |
| 2 | `actions/setup-node` v4 → v6 (major) | [PR #3](https://github.com/juan294/chapa-cli/pull/3) | All checks pass |

**Action:** Review and merge these Dependabot PRs. Both target `main` and have green CI. These are GitHub Actions version bumps, not npm dependencies.

### LOW — Coverage gaps (informational)

| Module | Stmts | Branch | Funcs | Lines | Uncovered |
|--------|-------|--------|-------|-------|-----------|
| upload.ts | 90% | 75% | 50% | 100% | line 40 |
| cli.ts | 100% | 68.75% | 100% | 100% | lines 52-56 |
| login.ts | 95.65% | 90.62% | 100% | 95.38% | lines 108, 150-151 |
| config.ts | 100% | 90.9% | 100% | 100% | line 42 |
| fetch-emu.ts | 96.55% | 91.66% | 85.71% | 100% | line 151 |

**Overall coverage:** 97.93% stmts | 90.24% branch | 95.12% funcs | 98.65% lines

### FIXED — Unused test imports (automated fix applied)

| File | Issue | Fix |
|------|-------|-----|
| `src/auth.test.ts` | Unused `vi` import | Removed from import |
| `src/cli.test.ts` | Unused `vi`, `beforeEach`, `afterEach` imports | Removed from import |
| `src/index.test.ts` | Unused `handler` variable (dead browser-event code) | Removed declaration |

---

## Detailed Agent Reports

### Agent 1 — Test Health: GREEN

- **Test suite:** 114/114 tests pass across 8 test files
- **Flaky tests:** None detected (all pass consistently)
- **Duration:** 2.22s total
- **Coverage:** See table above — overall 97.93% statements
- **No recently changed files** between `develop` and `main` (branches are in sync after PR #17 merge)

### Agent 2 — Code Quality: GREEN

- **TypeScript strict mode:** Enabled (`"strict": true` in tsconfig.json)
- **Typecheck:** Clean, zero errors
- **Additional strict options:** `noUnusedLocals` and `noUnusedParameters` not enabled — would catch 5 issues in test files (3 now fixed, 2 remaining are vitest framework patterns)
- **Dead exports (knip):** Zero — cleaned in previous pipeline run
- **Circular dependencies:** None found (madge)
- **TODO/FIXME/HACK comments:** None in any source or test file
- **Build:** Clean, 16.57 KB output

### Agent 3 — CI & Deploy Health: GREEN

- **Last 10 CI runs:** All SUCCESS (no failures)
- **Workflow breakdown:** CI, CodeQL, Dependency Review — all passing
- **Dependabot activity:** 2 open PRs for GitHub Actions upgrades (checkout v4→v6, setup-node v4→v6), both with green CI
- **Deploy note:** This is an npm CLI package published via CI on merge to `main`. No Vercel deployment to monitor.
- **Cron jobs:** CodeQL weekly scan (Monday 06:00 UTC) running successfully

### Agent 4 — Dependency Health: GREEN

- **pnpm audit:** No known vulnerabilities
- **Outdated deps:** None (all up to date after `@types/node` v25 upgrade)
- **Lockfile integrity:** Verified (`pnpm install --frozen-lockfile` succeeds)
- **Runtime dependencies:** Zero (all dependencies are devDependencies)

---

## Recommendations

1. **Merge Dependabot PRs** — Both #1 and #3 have green CI and are low-risk GitHub Actions upgrades
2. **Consider enabling `noUnusedLocals`/`noUnusedParameters`** in tsconfig.json for stricter compile-time checks
3. **Improve upload.ts coverage** — 50% function coverage is the weakest point in the codebase
4. **Schedule regular health checks** — Run this report weekly or before each release
