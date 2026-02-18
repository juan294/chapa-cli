# CLAUDE.md — Internal Ways of Working

## Project Overview

chapa-cli is an open-source CLI tool that merges GitHub Enterprise Managed User (EMU) contributions into [Chapa](https://chapa.thecreativetoken.com) developer impact badges. It connects to the Chapa server via HTTP and uses GitHub's GraphQL API to fetch EMU contribution data.

## Architecture

```
src/
├── index.ts       # CLI entry point, command dispatch
├── cli.ts         # Argument parsing (Node parseArgs)
├── shared.ts      # Types, GraphQL query, stats aggregation
├── login.ts       # OAuth device flow
├── fetch-emu.ts   # GitHub GraphQL integration
├── upload.ts      # Chapa server upload
├── config.ts      # Credential storage (~/.chapa/credentials.json)
└── auth.ts        # Token resolution
```

Three API endpoints connect the CLI to the Chapa server: device flow auth, token exchange, and stats upload.

## Tech Stack

- **Language**: TypeScript (ES2022, ESM)
- **Build**: tsup (bundles to `dist/`, adds shebang)
- **Test**: Vitest + v8 coverage
- **CI**: GitHub Actions (Node 18/20/22 matrix)
- **Package manager**: pnpm

## Branching Strategy

- `develop` — default working branch; all feature branches merge here
- `main` — release branch; publish to npm is done manually with 2FA

## Deployment

- Production deploys from `main` only. Changes pushed to `develop` must be merged to `main` via PR before they go live.
- Always confirm the target branch before pushing — if the goal is production deployment, ensure the PR targets `main`.

## Commit Conventions

Use lowercase [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add proxy support
fix: handle expired tokens gracefully
docs: update contributing guide
chore: bump dependencies
test: add coverage for auth module
refactor: simplify GraphQL query builder
```

## PR Workflow

1. Create a feature branch from `develop`
2. Make changes, write/update tests
3. Open a PR targeting `develop`
4. CI must pass (test + typecheck + build across Node 18/20/22)
5. Merge to `develop`; when ready to release, merge `develop` → `main`

## Testing & CI

- This project uses TDD. Always write tests before or alongside implementation.
- All PRs must have CI green before merging. Run the full test suite locally before pushing.
- After merging to develop, if production deployment is the goal, immediately create a PR from develop → main.

Before submitting a PR, ensure all checks pass:

```bash
pnpm test          # unit tests
pnpm run typecheck # TypeScript type checking
pnpm run build     # production build
```

## Release Process

1. Bump `version` in `package.json` on `develop`
2. Merge `develop` → `main` via PR
3. Publish manually: `npm publish --otp=<code>` (2FA required)

## Code Style

- ESM imports (`import`/`export`, no `require`)
- Prefer explicit types over `any`
- Keep modules focused — one responsibility per file
- Use Node.js built-in APIs where possible (no unnecessary dependencies)
- Zero runtime dependencies

## Security Considerations

- Never commit tokens or credentials
- EMU tokens are passed via CLI flags or environment variables, never stored
- Personal auth tokens are stored in `~/.chapa/credentials.json` with user-only permissions
- The `--insecure` flag exists for corporate TLS interception but should not be used outside that context

## Language & Tone

- All user-facing content for the Asturias project must be in Spanish unless explicitly stated otherwise.
- For social media copy: keep tone confident and positive — avoid pitying, resentful, or overly dramatic language. Never mention unreleased/unpublished features.

## Sub-Agent & Background Task Guidelines

- Sub-agents (Task tool) may lack Bash or file-write permissions. If spawning agents for fixes, verify they have the required tool access first.
- If a sub-agent fails due to permissions, take over manually immediately rather than retrying.
- Be aware of context window limits when receiving multiple parallel task notifications.

## Tool & API Awareness

- You CAN set Vercel environment variables via CLI — do not claim otherwise.
- You CANNOT handle credentials (npm tokens, API keys) directly — ask the user to provide/set them.
- Upstash Redis API differs from standard Redis: use `zrange` with options instead of `zrangebyscore`/`zrevrangebyscore`.

## Headless Mode

Use Claude Code in headless/non-interactive mode for CI and batch automation:

```bash
# Run audit fixes in CI with explicit permissions:
claude -p "Fix all TypeScript lint errors and run tests" --allowedTools "Edit,Read,Bash,Write" --output-format json

# Batch process GitHub issues:
claude -p "Read issue #240 and implement the fix with TDD" --allowedTools "Edit,Read,Bash,Write,Grep"
```
