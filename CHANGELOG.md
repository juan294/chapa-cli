# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-10-08

### Changed

- `chapa merge` now links the second GitHub account to your Chapa profile
  instead of uploading stats. It sends the handle and token once, in the
  JSON body of `POST /api/github-linked`. The Chapa server verifies the
  token, stores it encrypted and collects the account's activity daily, so
  the work counts in the badge (juan294/chapa#1401)
- `chapa merge` prints the server's reason on every refusal. For a refused
  token it also prints the required scopes (`repo`, `read:user`,
  `read:org`), the token setup link and the recovery command
- `chapa merge --json` output describes the link (`linked`,
  `alsoRegistered`, `collection`, `linkStatus`) instead of uploaded stats.
  Failures include the HTTP `status` and the server error `code`
- Merge telemetry keeps `command: "merge"` with zero stats and
  `fetchMs: 0`; it never contains the token
- The recovery command includes `--emu-token <token>`, the link message
  names the profile the server linked to, `chapa unlink` says when nothing
  was linked, and a server without the link routes is reported as such

### Added

- `chapa unlink` removes the linked GitHub account and its stored token
  (`POST /api/github-linked/disconnect`)

### Removed

- The local EMU stats fetch and the legacy `POST /api/supplemental` upload.
  Chapa no longer scores self-reported stats, and the server now answers
  the legacy upload with 410
- The `read:discussion` scope from the token instructions; it is not needed

## [0.5.0] - 2026-08-10

### Security

- Remove a shell injection risk in the Windows browser launch during
  login (#103, #104)
- Enforce HTTPS in the login device flow and reject non-loopback
  redirect hosts (#91, #95, #96, #97, #98)
- Enforce HTTPS and strict 2xx parsing in the shared request
  transport (#94, #95, #99)

### Fixed

- Paginate EMU pull request contributions beyond the 100-node GraphQL
  cap, which silently truncated stats for high-volume accounts (#92)
- Emit telemetry failure events on insights and login early-exit
  paths, and add command context to payloads (#101)
- Correct server-selection intent, config corruption handling, and
  command UX in the CLI (#91, #95, #96, #97, #98)

### Performance

- Cache DOM lookups in insights parsing to avoid redundant
  rescans (#102)

### Changed

- Publish to npm via OIDC trusted publishing with SLSA provenance
  instead of a stored `NPM_TOKEN` secret (#123)

### Removed

- `token-expiry-reminder` workflow — there is no longer a token to rotate

## [0.4.1] - 2026-04-18

### Added

- Shared request transport in `src/http.ts` with normalized timeout,
  HTTP, network, and parse failure handling
- Non-blocking background dispatch module (`src/background.ts`) for
  fire-and-forget telemetry and badge recalculate calls
- `command` and `stage` context fields in telemetry payloads for
  richer operation tracking

### Changed

- Route merge uploads, login polling, telemetry, and insights
  network calls through the shared transport layer
- Guarantee merge telemetry on both fetch and upload failures,
  not just successful uploads
- Centralize CLI exits in `index.ts`; `login()` now throws timeout
  and expired-session errors instead of exiting directly
- Lazy-load the `insights` command path so non-insights commands
  do not eagerly load the `linkedom` parser bundle
- Cache chart card parsing in insights to avoid redundant DOM traversal

### Fixed

- EMU PR aggregation now paginates across all pages — previously only
  the first page of pull requests was counted (#55, #61)
- Enforce upload write response contract — validate server write
  acknowledgements instead of assuming success (#56, #57, #59)
- Handle server routing and config errors gracefully with clear user
  messages instead of unhandled rejections (#53, #62, #64)
- Normalize browser launch and network error reporting across login
  and transport flows (#71, #72)
- Normalize network error reporting across merge, login, insights,
  upload, and telemetry flows
- Bound user-facing network calls with consistent request timeouts
  instead of allowing indefinite hangs
- Patch vite transitive dependency to 7.3.2 (security)

### Documentation

- Refresh architecture docs and diagrams for the shared transport
  layer and lazy-loaded insights module
- Update supported-version and example CLI version references to `0.4.1`

### Infrastructure

- Gate automated npm publish to releases targeting `main` with
  verified provenance (#54)

## [0.4.0] - 2026-03-23

### Added

- Automated npm publish workflow — `gh release create` triggers CI publish (no manual OTP)
- Top-level error boundary with `CliError` sentinel pattern
- Extracted command handlers: `handleLogin`, `handleLogout`, `handleInsights`, `handleMerge`
- Shared utilities in `shared.ts`: `stripTrailingSlashes`, `getRootErrorMessage`, `getFullErrorChain`, `extractErrorDetail`
- 27 new tests (226 → 253): error boundary, MAX_POLL timeout, response fallbacks, strict parsing

### Changed

- **Breaking:** Strict CLI argument parsing — unknown flags now error instead of being silently ignored
- Bundle `linkedom` into dist output via tsup `noExternal` — zero npm runtime dependencies restored
- Reduced `process.exit()` calls from 17 to 1 (error boundary only)
- Deduplicated URL stripping and error chain walking across modules
- Removed unused type exports (`UploadOptions`, `UploadResult`, `FetchEmuOptions`, `LoggerOptions`)
- Login polling dots now print every 2s instead of every 10s
- Anchored telemetry error classification regexes to prevent false matches
- Eliminated TOCTOU `existsSync` checks in config.ts

### Fixed

- Login timer tests use fake timers with DI injection (fixes CI timeout on Node 20/22/24)

### Documentation

- Updated README: added `insights` command, `--file` flag, Node 20+ requirement
- Updated CLAUDE.md: architecture tree (+3 files), CI matrix, endpoint count, release process
- Updated SECURITY.md: supported versions (0.3.x), bundling policy
- Updated CONTRIBUTING.md: insights command in testing examples

## [0.3.1] - 2026-03-23

### Added

- `chapa insights` command for uploading Claude Code reports to Chapa
- Auto-open browser on ENTER during `chapa login` (like `npm login`)

### Changed

- Drop Node 18 (EOL), require Node >=20, add Node 24 to CI matrix
- Update dev dependencies (types, vitest, coverage)
- Simplify insights file handling and remove DRY violations

### Fixed

- Login: use dependency injection for browser/readline in tests
- Login: flush microtasks before advancing fake timers in tests
- Login: resolve waitForEnter directly for Node 18 compatibility
- Login: detach browser process and handle readline close

### Documentation

- Add EMU token setup guide with SAML SSO instructions and troubleshooting table
- Document `--json` and `--verbose` flags
- Add research and implementation plan for insights feature

## [0.2.8] - 2026-02-15

### Added

- CLAUDE.md with internal ways of working
- CONTRIBUTING.md contributor guide
- CODE_OF_CONDUCT.md (Contributor Covenant v2.1)
- SECURITY.md vulnerability reporting policy
- GitHub issue templates (bug report, feature request)
- Pull request template with testing checklist
- Dependabot configuration for npm and GitHub Actions
- Dependency review workflow for PRs
- CodeQL security scanning workflow
- CHANGELOG.md
- README badges (npm version, CI, license, Node.js)
- Branch protection rules for main and develop
- Integration tests for CLI command dispatch (17 tests)
- Unit tests for scoring and aggregation (42 tests)

### Changed

- README contributing section now links to CONTRIBUTING.md

### Fixed

- Sanitized error logging in fetch-emu.ts to prevent potential token leakage
- Truncated long GraphQL error response bodies to prevent terminal flooding
- Replaced `any` type with proper `GraphQLResponse` interface in fetch-emu.ts

## [0.2.7] - 2025-05-16

### Added

- Initial open-source release
- CLI commands: `login`, `logout`, `merge`
- GitHub EMU contribution fetching via GraphQL API
- OAuth device flow authentication
- Chapa server upload integration
- Corporate TLS interception support (`--insecure` flag)
- CI/CD pipeline with Node 18/20/22 matrix testing
- Automated npm publishing on version bump

[Unreleased]: https://github.com/juan294/chapa-cli/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/juan294/chapa-cli/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/juan294/chapa-cli/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/juan294/chapa-cli/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/juan294/chapa-cli/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/juan294/chapa-cli/compare/v0.2.8...v0.3.1
[0.2.8]: https://github.com/juan294/chapa-cli/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/juan294/chapa-cli/releases/tag/v0.2.7
