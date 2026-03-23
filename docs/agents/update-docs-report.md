# Documentation Update Report
> Generated on 2026-03-23 | Branch: `develop` | Changes since `main` (21 commits)

## Summary
- 6 documents updated
- 1 diagram refreshed (CLAUDE.md architecture tree)
- 5 version references corrected
- 0 inline doc blocks updated (no existing JSDoc to refresh)
- 0 items flagged [NEEDS REVIEW]

## Changes by File

### README.md
- Fixed Node.js requirement: "18+" → "20+"
- Added `chapa insights` command section with usage examples
- Added `--file <path>` to Options table
- Added insights step to "How it works" section

### CLAUDE.md
- Updated architecture tree: added `insights.ts`, `telemetry.ts`, `logger.ts`; updated descriptions for `index.ts`, `cli.ts`, `shared.ts`, `upload.ts`, `login.ts`
- Updated endpoint count: "Three" → "Six" (added insights upload, recalculate, telemetry)
- Fixed CI matrix: "Node 18/20/22" → "Node 20/22/24" (2 occurrences)
- Updated release process: added publish workflow step
- Clarified zero-dep policy: "Zero runtime dependencies" → "Zero npm runtime dependencies (linkedom is bundled)"

### SECURITY.md
- Updated supported versions: added 0.3.x, moved 0.2.x to unsupported
- Updated contributor note about zero-dep policy to reflect bundling approach

### CONTRIBUTING.md
- Added `insights` command to local testing examples

### .github/ISSUE_TEMPLATE/bug_report.yml
- Updated version placeholder: "0.2.7" → "0.3.1"

### docs/server-contract.md
- Updated version example in TypeScript interface: "0.2.9" → "0.3.1"

## Flagged for Review
None.
