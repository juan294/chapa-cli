# chapa-cli

Merge GitHub Enterprise Managed User (EMU) contributions into your [Chapa](https://chapa.thecreativetoken.com) developer impact badge.

## Why?

If you use a GitHub EMU account at work, your contributions live on a separate identity from your personal GitHub. Chapa badges only see your personal account. This CLI bridges the gap by fetching your EMU stats and merging them into your Chapa badge.

## Install

```bash
npm install -g chapa-cli
```

Requires Node.js 18+.

## Quick start

```bash
# 1. Log in with your personal GitHub (opens browser)
chapa login

# 2. Merge your EMU contributions
chapa merge --emu-handle your-emu-handle --emu-token ghp_your_emu_token
```

## Commands

### `chapa login`

Authenticate with the Chapa server. Opens a browser window where you approve the CLI with your **personal** GitHub account.

```bash
chapa login
chapa login --server http://localhost:3001  # local dev
chapa login --insecure                       # corporate TLS interception
chapa login --verbose                        # debug polling
```

### `chapa logout`

Clear stored credentials from `~/.chapa/credentials.json`.

```bash
chapa logout
```

### `chapa merge`

Fetch stats from your EMU account and upload them to Chapa.

```bash
chapa merge --emu-handle your-emu-handle
```

The EMU token can be provided via `--emu-token` flag or `GITHUB_EMU_TOKEN` environment variable. The token needs `read:user` scope.

## Options

| Flag | Description |
|------|-------------|
| `--emu-handle <handle>` | Your EMU GitHub handle (required for merge) |
| `--emu-token <token>` | EMU GitHub token (or set `GITHUB_EMU_TOKEN`) |
| `--handle <handle>` | Override personal handle (auto-detected from login) |
| `--token <token>` | Override auth token (auto-detected from login) |
| `--server <url>` | Chapa server URL (default: production) |
| `--verbose` | Show detailed polling logs during login |
| `--insecure` | Skip TLS certificate verification |
| `--version`, `-v` | Show version number |
| `--help`, `-h` | Show help message |

## Corporate networks

Many corporate networks use TLS interception (MITM proxies). If you see errors like:

- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- `SELF_SIGNED_CERT_IN_CHAIN`
- `self-signed certificate in certificate chain`

Use the `--insecure` flag:

```bash
chapa login --insecure
chapa merge --emu-handle your-emu --insecure
```

This disables TLS certificate verification for the CLI session only.

## How it works

1. **Login**: The CLI generates a session ID, displays an authorization URL, and polls the Chapa server until you approve in the browser. Credentials are saved to `~/.chapa/credentials.json`.

2. **Merge**: The CLI fetches your EMU account's contribution data via GitHub's GraphQL API (using your EMU token), then uploads the aggregated stats to the Chapa server. Your badge will reflect the combined data on next refresh.

## Contributing

Contributions are welcome! This project was extracted from the main Chapa monorepo specifically so the community can help improve compatibility across different corporate environments.

### Common contributions we'd love

- Fixes for specific corporate proxy/TLS configurations
- Windows compatibility improvements
- Better error messages for edge cases
- Support for additional authentication methods

### Development

```bash
git clone https://github.com/juan294/chapa-cli.git
cd chapa-cli
pnpm install
pnpm test        # run tests
pnpm run build   # build dist
```

### Testing against a local server

```bash
pnpm run build
node dist/index.js login --server http://localhost:3001
node dist/index.js merge --emu-handle your-emu --server http://localhost:3001
```

## License

MIT
