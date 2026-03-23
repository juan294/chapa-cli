# Phase 5: CLI — Integration and E2E Verification

> **Project**: chapa-cli
> **Prerequisite**: Phase 1 (server deployed), Phase 4 (CLI complete)
> **Files modified**: `package.json` (version bump — only if user authorizes)
> **Tests**: Full suite re-run

## Objective

Verify the complete end-to-end flow works, ensure build output is correct, check bundle size impact from `linkedom`, and document the feature.

## Changes

### 1. Build verification

```bash
pnpm run build
```

Verify:
- `dist/index.js` exists and has shebang (`#!/usr/bin/env node`)
- `linkedom` is bundled into the output (tsup bundles all deps by default)
- Check bundle size delta (before/after adding linkedom)
- Run `node dist/index.js --help` and verify insights command appears

### 2. Full test suite

```bash
pnpm test && pnpm run typecheck && pnpm run build
```

All existing tests must pass alongside new tests. No regressions.

### 3. Integration test against staging (manual)

After Phase 1 is deployed to the Chapa staging environment:

```bash
# Generate a real insights report (or use the fixture)
chapa insights --file src/__fixtures__/claude-code-report.html --verbose

# Verify with JSON output
chapa insights --file src/__fixtures__/claude-code-report.html --json

# Verify error cases
chapa insights                                    # missing --file
chapa insights --file nonexistent.html            # file not found
chapa insights --file package.json                # not valid insights HTML
chapa insights --file src/__fixtures__/claude-code-report.html --token bad  # auth failure
```

### 4. Update HELP_TEXT verification

Verify the help output is correct:

```
$ chapa --help
chapa-cli v0.3.1

Merge GitHub EMU (Enterprise Managed User) contributions into your Chapa badge.

Commands:
  chapa login                          Authenticate with Chapa (opens browser)
  chapa logout                         Clear stored credentials
  chapa merge --emu-handle <emu>       Merge EMU stats into your badge
  chapa insights --file <path>         Upload Claude Code insights report

Options:
  --emu-handle <handle>   Your EMU GitHub handle (required for merge)
  --emu-token <token>     EMU GitHub token (or set GITHUB_EMU_TOKEN)
  --handle <handle>       Override personal handle (auto-detected from login)
  --token <token>         Override auth token (auto-detected from login)
  --file <path>           Path to Claude Code insights HTML file (required for insights)
  --server <url>          Chapa server URL (default: https://chapa.thecreativetoken.com)
  --verbose               Show detailed debug output and timings
  --json                  Output result as JSON (for scripting)
  --insecure              Skip TLS certificate verification (corporate networks)
  --version, -v           Show version number
  --help, -h              Show this help message
```

### 5. Check edge cases

- File larger than 10MB (should still work — the 10MB limit is a frontend concern, not server)
- HTML with unusual encoding (UTF-8 BOM, etc.)
- Insights report with all zeros (minimal valid report)
- Running insights command without being logged in
- Running insights command with `--insecure` flag

### 6. Telemetry verification

Verify telemetry fires correctly for both success and failure cases. Check that the telemetry payload has sensible values (not all zeros).

## Success Criteria

### Automated
- `pnpm test` — 100% pass rate
- `pnpm run typecheck` — zero errors
- `pnpm run build` — clean build, reasonable bundle size
- `node dist/index.js --help` — shows insights command

### Manual
- `chapa insights --file <real-report.html>` returns craft score from staging server
- Craft score visible in Chapa badge after upload
- Error messages are clear and actionable for all failure modes
- `--json` output is valid JSON with expected schema
- `--verbose` output shows timing and debug info
