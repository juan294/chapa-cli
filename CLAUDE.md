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

### CRITICAL: Run verification commands sequentially, NEVER in parallel
Never run typecheck, lint, or test as parallel sibling Bash tool calls.
Chain with `&&` or `;`: `pnpm run typecheck 2>&1; pnpm test 2>&1`

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

## RPI Workflow

This project follows the Research-Plan-Implement (RPI) pattern.
All significant changes go through four phases:
1. /research — Understand the codebase as-is
2. /plan — Create a phased implementation spec
3. /implement — Execute one phase at a time with review gates
4. /validate — Verify implementation against the plan

### Context Management

- Each RPI phase should be its own conversation. Don't run research + plan + implement in one session.
- Use `/clear` between unrelated tasks. Use `/compact` when context is heavy but the task continues.
- Subagents are context control mechanisms — they search/read in their window and return only distilled results.
- Research and planning happen on the default branch. Implementation happens in worktrees or feature branches.
- If research comes back wrong, throw it out and restart with more specific steering.

### Rules for All Phases

- Read all mentioned files COMPLETELY before doing anything else.
- Never suggest improvements during research — only document what exists.
- Every code reference must include file:line.
- Spawn parallel subagents for independent research tasks.
- Wait for ALL subagents before synthesizing.
- Never write documents with placeholder values.

### Rules for Implementation

- Follow the atomic loop: implement → review (plan compliance) → fix → approve → `/simplify` (code quality) → verify.
- Run `/simplify` after reviewer approval — it handles code reuse, quality, and efficiency in one native pass.
- Check for `[batch-eligible]` phases in the plan — use `/batch` to execute independent phases in parallel.
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
- Don't use Claude for linting/formatting — use automated tools and hooks instead.

## Agent Operational Rules

### Shell & Tools
- Chain verification commands sequentially, never as parallel Bash calls
- In worktrees: prefix every command with `cd /absolute/path && `
- Never use `~` in file tool paths — use full absolute paths starting with `/`
- Always pass `{ encoding: 'utf-8' }` to `execSync`/`spawnSync`

### Git Recipes (use these exact sequences — hooks enforce critical steps)
```bash
# Push sequence — ALWAYS commit before pulling (Error #33, hook enforced)
git add <files> && git commit -m "msg" && git pull --rebase && git push

# First push — set upstream tracking
git add <files> && git commit -m "msg" && git push -u origin <branch>

# Push with tag — NEVER use --tags (Error #44, hook enforced)
git push origin main && git push origin v1.0.0
# Or: git push origin main --follow-tags

# Worktree cleanup
git worktree remove --force <path>; git branch -D <branch>
```

### Git Operations
- Run typecheck/lint BEFORE committing (pre-commit hooks run the same checks)
- Remove worktrees BEFORE merging PRs with `--delete-branch`
- Never fabricate filesystem paths — use the working directory or discover with `ls`

### GitHub CLI
- Don't guess `gh --json` field names — query available fields first
- Check CI per-PR with `--json`, not chained human-readable output
- `review: fail` means "needs approval", NOT a CI failure

### Sub-agents & Agent Teams
- Verify tool permissions before spawning sub-agents for write operations
- If a sub-agent fails due to permissions, take over manually immediately
- Monitor context size when running many parallel agents
- Agent Teams are enabled via `.claude/settings.json` — use them for complex parallel work
- When creating a team: break work so each teammate owns different files (avoid conflicts)
- Teammates don't inherit conversation history — include full context in spawn prompts
- Use subagents for focused tasks (result is all that matters); use teams for collaborative work requiring discussion
- **Only the main agent handles git commit/push.** Sub-agents and teammates write changes to their working directories. The main agent reviews the changes, runs tests, and commits centrally. This prevents wrong-branch pushes and merge conflicts from parallel agents.

## Push Accountability

Every push to the development branch requires CI verification. After pushing:
1. Spawn a background agent to monitor CI: `gh run list --branch develop --limit 1`
2. If CI passes — log and move on
3. If CI fails — background agent investigates with `gh run view <id> --log-failed`, fixes, and re-pushes
4. Main terminal continues working — push verification is non-blocking
5. Never push to production from a background fix

## TDD Protocol

All code changes follow Red-Green-Refactor:
1. **Red** — Write a failing test FIRST
2. **Green** — Minimum code to pass
3. **Refactor** — Clean up with green tests

No exceptions. Bug fixes need a regression test. Refactors need existing coverage. No "tests later."

## Agent Autonomy

Before asking the user to do anything manually:
1. Exhaust CLI tools (`gh`, `git`, project CLIs)
2. Exhaust shell commands (curl, build scripts)
3. Exhaust file tools (Read/Edit/Write for config changes)
4. Only then ask for human help — with a clear explanation of what you tried

Autonomy applies to development work. Production-affecting actions always need explicit human authorization.

## Memory Management

When you discover an operational lesson during any session — CI failure pattern, permission issue, workaround, tooling quirk, environment-specific behavior — save it to auto memory immediately. Don't wait to be asked.

What to save proactively:
- CI/CD pipeline behaviors and failure patterns specific to this project
- Environment quirks (build flags, platform issues, dependency conflicts)
- Project-specific conventions confirmed by the user
- Workarounds for tools, APIs, or libraries used in this project
- Permission configurations that required adjustment

After completing `/bootstrap`, `/adopt`, or any significant configuration change, save the key decisions and project context to auto memory so future sessions start with full awareness.

## Project File Locations

Go directly to these paths — never search the codebase for them.

| Topic | Path | Notes |
|-------|------|-------|
| Agent reports | `docs/agents/*-report.md` | Flag YELLOW/RED items. Cross-agent context in `shared-context.md` |
| Agent logs | `logs/<name>.log`, `<name>.error.log` | Read alongside reports to diagnose failures |
| Agent scripts | `scripts/agents/` | Standalone bash files invoking Claude CLI headless |
| ADRs | `docs/decisions/` | Architecture decision records |
| PR descriptions | `docs/prs/{number}_description.md` | |
| Research docs | `docs/research/YYYY-MM-DD-description.md` | |
| Plans | `docs/plans/YYYY-MM-DD-description.md` | Phase files in `-phases/phase-N.md` |
