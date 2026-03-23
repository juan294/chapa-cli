# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/juan294/chapa-cli/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/juan294/chapa-cli/compare/v0.2.8...v0.3.1
[0.2.8]: https://github.com/juan294/chapa-cli/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/juan294/chapa-cli/releases/tag/v0.2.7
