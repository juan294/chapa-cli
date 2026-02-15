# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in chapa-cli, please report it responsibly. **Do not open a public issue.**

### How to Report

1. **Email**: Send details to `support@chapa.thecreativetoken.com`
2. **GitHub**: Use [GitHub's private vulnerability reporting](https://github.com/juan294/chapa-cli/security/advisories/new)

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- Acknowledgment within 48 hours
- Status update within 7 days
- We aim to release a fix within 14 days of confirmed vulnerabilities

## Security Considerations for Users

- **EMU tokens**: Passed via CLI flags or the `GITHUB_EMU_TOKEN` environment variable. They are never stored to disk by the CLI.
- **Personal auth tokens**: Stored in `~/.chapa/credentials.json`. Ensure this file has appropriate permissions (the CLI creates it with user-only access).
- **`--insecure` flag**: Disables TLS certificate verification. Only use this when behind corporate TLS-intercepting proxies. Never use it on untrusted networks.
- **Environment variables**: Prefer `GITHUB_EMU_TOKEN` over `--emu-token` in shared environments to avoid tokens appearing in shell history.

## Security Considerations for Contributors

- Never commit tokens, credentials, or secrets
- Do not add dependencies without careful review — this project maintains zero runtime dependencies
- Be cautious with user input handling in CLI argument parsing
- Ensure any network requests respect the TLS configuration flags

## Disclosure Policy

We follow coordinated disclosure. After a fix is released, we will:

1. Publish a GitHub Security Advisory
2. Release a patched version to npm
3. Credit the reporter (unless they prefer anonymity)
