# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- README contributing section now links to CONTRIBUTING.md

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

[Unreleased]: https://github.com/juan294/chapa-cli/compare/v0.2.7...HEAD
[0.2.7]: https://github.com/juan294/chapa-cli/releases/tag/v0.2.7
