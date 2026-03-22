# Implementation Plan: `chapa insights` Command

> Created: 2026-03-22 | Branch: `develop` | Research: `docs/research/2026-03-22-insights-upload-feature.md`

## Summary

Add a `chapa insights --file <path>` command that reads a Claude Code `/insights` HTML report, parses it into structured JSON using `linkedom`, and uploads it to `POST /api/insights` with Bearer token auth. Requires a server-side auth change in the Chapa project first.

## Architecture Decision

- **HTML parsing**: `linkedom` (lightweight DOM implementation for Node.js). Enables near-verbatim port of the existing browser parser from `apps/web/lib/insights/parser.ts`. First runtime dependency for chapa-cli.
- **Server auth**: Add Bearer token support to the existing `POST /api/insights` and `POST /api/recalculate` endpoints using the same `resolveHandle()` pattern from `POST /api/supplemental`.
- **File structure**: New `src/insights.ts` module (parser + upload), new `InsightsUpload` type in `src/shared.ts`, new `--file` flag in `src/cli.ts`, new `insights` command dispatch in `src/index.ts`.

## Phase Overview

| Phase | Description | Files | Batch |
|-------|-------------|-------|-------|
| 1 | Server: Bearer auth for insights + recalculate | chapa project (separate repo) | - |
| 2 | CLI: Types + `--file` flag + command dispatch | `src/shared.ts`, `src/cli.ts`, `src/index.ts` | - |
| 3 | CLI: HTML parser (`linkedom`) | `src/insights.ts` (parser portion) | - |
| 4 | CLI: Upload function + output formatting | `src/insights.ts` (upload portion), `src/index.ts` | - |
| 5 | CLI: Integration + E2E verification | All CLI files, `package.json` | - |

Phases 2-4 are sequential (each builds on the previous). Phase 1 is in a separate repo and must be done first.

## Success Criteria

### Automated
- `pnpm test` — all tests pass (existing + new)
- `pnpm run typecheck` — zero type errors
- `pnpm run build` — clean build with `linkedom` bundled
- New tests cover: HTML parsing (all 14 fields), upload success/failure, CLI dispatch, file-not-found errors, invalid HTML handling, `--json` output mode, `--verbose` output mode

### Manual
- Run `chapa insights --file ./test-report.html` against the staging server after Phase 1 is deployed
- Verify craft score appears in Chapa badge after upload

## Phase Details

- [Phase 1: Server — Bearer auth for insights + recalculate](2026-03-22-insights-upload-phases/phase-1.md)
- [Phase 2: CLI — Types, flag, and command wiring](2026-03-22-insights-upload-phases/phase-2.md)
- [Phase 3: CLI — HTML parser with linkedom](2026-03-22-insights-upload-phases/phase-3.md)
- [Phase 4: CLI — Upload function and output formatting](2026-03-22-insights-upload-phases/phase-4.md)
- [Phase 5: CLI — Integration and E2E verification](2026-03-22-insights-upload-phases/phase-5.md)
