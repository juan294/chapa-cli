# CLAUDE.md — Internal Ways of Working

## Project Overview

chapa-cli is an open-source CLI tool that merges GitHub Enterprise Managed User (EMU) contributions into [Chapa](https://chapa.thecreativetoken.com) developer impact badges. It connects to the Chapa server via HTTP and uses GitHub's GraphQL API to fetch EMU contribution data.

## Architecture

```
src/
├── index.ts       # CLI entry point, command dispatch, error boundary
├── cli.ts         # Argument parsing (Node parseArgs, strict mode)
├── shared.ts      # Types, GraphQL query, stats aggregation, shared utilities
├── login.ts       # OAuth device flow (browser auto-open)
├── fetch-emu.ts   # GitHub GraphQL integration
├── upload.ts      # Chapa server upload (merge stats)
├── insights.ts    # Claude Code HTML report parsing + upload
├── config.ts      # Credential storage (~/.chapa/credentials.json)
├── auth.ts        # Token resolution
├── telemetry.ts   # Fire-and-forget operation telemetry
└── logger.ts      # Structured logging (verbose/JSON modes)
```

Six API endpoints connect the CLI to the Chapa server: device flow auth, token exchange poll, stats upload, insights upload, badge recalculate, and telemetry.

## Tech Stack

- **Language**: TypeScript (ES2022, ESM)
- **Build**: tsup (bundles to `dist/`, adds shebang)
- **Test**: Vitest + v8 coverage
- **CI**: GitHub Actions (Node 20/22/24 matrix)
- **Package manager**: pnpm

## Branching Strategy

- `develop` — default working branch; all feature branches merge here
- `main` — release branch; publish to npm is done manually with 2FA

## Deployment

- Production deploys from `main` only. Changes pushed to `develop` must be merged to `main` via PR before they go live.
- Always confirm the target branch before pushing — if the goal is production deployment, ensure the PR targets `main`.

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) with scope:

```
feat(scope): description (#issue)
fix(scope): description (#issue)
test(scope): description
refactor(scope): description
chore: description
docs: description
```

## PR Workflow

1. Create a feature branch from `develop`
2. Make changes, write/update tests
3. Open a PR targeting `develop`
4. CI must pass (test + typecheck + build across Node 20/22/24)
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

### CRITICAL: Run verification commands sequentially, NEVER in parallel
Never run typecheck, lint, or test as parallel sibling Bash tool calls.
Chain with `&&` or `;`: `pnpm run typecheck 2>&1; pnpm test 2>&1`

## Release Process

1. Bump `version` in `package.json` on `develop`
2. Merge `develop` → `main` via PR
3. Create a GitHub Release — the `publish.yml` workflow publishes to npm automatically
4. If automated publish fails (strict 2FA), publish manually: `npm publish --otp=<code>`

## Code Style

- ESM imports (`import`/`export`, no `require`)
- Prefer explicit types over `any`
- Keep modules focused — one responsibility per file
- Use Node.js built-in APIs where possible (no unnecessary dependencies)
- Zero npm runtime dependencies (linkedom is bundled into the build via tsup `noExternal`)

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

## RPI Workflow

This project follows the Research-Plan-Implement (RPI) pattern.
All significant changes go through four phases:
1. /research -- Understand the codebase as-is
2. /plan -- Create a phased implementation spec
3. /implement -- Execute one phase at a time with review gates
4. /validate -- Verify implementation against the plan

### Context Management

- Each RPI phase should be its own conversation. Don't run research + plan + implement in one session.
- Use `/clear` between unrelated tasks. Use `/compact` when context is heavy but the task continues.
- Subagents are context control mechanisms -- they search/read in their window and return only distilled results.
- Research and planning happen on the default branch. Implementation happens in worktrees or feature branches.
- If research comes back wrong, throw it out and restart with more specific steering.

### Rules for All Phases

- Read all mentioned files COMPLETELY before doing anything else.
- Never suggest improvements during research -- only document what exists.
- Every code reference must include file:line.
- Spawn parallel subagents for independent research tasks.
- Wait for ALL subagents before synthesizing.
- Never write documents with placeholder values.

### Rules for Implementation

- Follow the atomic loop: implement -> review (plan compliance) -> fix -> approve -> `/simplify` (code quality) -> verify.
- Run `/simplify` after reviewer approval -- it handles code reuse, quality, and efficiency in one native pass.
- Check for `[batch-eligible]` phases in the plan -- use `/batch` to execute independent phases in parallel.
- Run ALL automated verification after each phase.
- STOP after each phase and wait for human confirmation.
- Never auto-proceed to the next phase.
- If the plan doesn't match reality, STOP and explain the mismatch.

### Pre-Release Workflow

```
/pre-launch -> /remediate -> /update-docs -> /release
```

- `/remediate` -- resolve all pre-launch findings with parallel TDD agents, CI verification
- `/update-docs` -- refreshes all documentation, diagrams, version references, and inline code docs
- `/release` -- version bump, CHANGELOG, tag, GitHub release, registry publish advisory

### Testing Philosophy

- Prefer automated verification over manual testing.
- Manual testing is ONLY for: sudo, hardware, new installs, truly visual-only validation.
- If you can verify it with a command or tool, do so automatically.
- Don't use Claude for linting/formatting -- use automated tools and hooks instead.

## Working Patterns

<examples>
<example name="push-sequence">
Commit before pulling -- hook blocks dirty pulls.

```bash
git add src/feature.ts && git commit -m "feat: add feature"
git pull --rebase && git push
```

</example>

<example name="verification">
Run checks sequentially, never as parallel tool calls.

```bash
pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1
```

</example>

<example name="worktree-cleanup">
Remove worktrees before merging PRs. Use -D (uppercase) for branches.

```bash
git worktree remove --force ../feature-branch; git branch -D feature-branch
```

</example>

<example name="file-paths">
Use absolute paths in all file tools and worktree commands. Never use ~.

```bash
cd /Users/dev/project && pnpm run test
```

</example>
</examples>

Domain-specific rules (git, CI, deployment, Python, macOS, Supabase, GitHub CLI, multi-agent) are in `.claude/skills/` -- loaded automatically when relevant.

<important if="you are pushing code to a remote">
### Push Accountability

After pushing to the development branch, spawn a background agent to monitor CI.
If CI fails, the background agent investigates, fixes, and re-pushes.
Main terminal continues working -- push verification is non-blocking.
</important>

## TDD Protocol

All code changes follow Red-Green-Refactor:
1. **Red** -- Write a failing test FIRST
2. **Green** -- Minimum code to pass
3. **Refactor** -- Clean up with green tests

No exceptions. Bug fixes need a regression test. Refactors need existing coverage. No "tests later."

## Agent Autonomy

Exhaust CLI tools, shell commands, and file tools before asking the user. Only escalate when genuinely impossible. Production-affecting actions need explicit human authorization.

## Memory Management

Save operational lessons to auto memory immediately -- CI failure patterns, environment quirks, project conventions, permission issues. Don't wait to be asked.

## Project File Locations

Go directly to these paths -- never search the codebase for them.

| Topic | Path | Notes |
|-------|------|-------|
| Agent reports | `docs/agents/*-report.md` | Gitignored. Local-only operational history. Never committed (Rule #70) |
| Agent logs | `logs/<name>.log`, `<name>.error.log` | Gitignored. Read alongside reports to diagnose failures |
| Agent scripts | `scripts/agents/` | Gitignored. Standalone bash files invoking Claude CLI headless |
| ADRs | `docs/decisions/` | Architecture decision records |
| PR descriptions | `docs/prs/{number}_description.md` | |
| Research docs | `docs/research/YYYY-MM-DD-description.md` | |
| Plans | `docs/plans/YYYY-MM-DD-description.md` | Phase files in `-phases/phase-N.md` |
