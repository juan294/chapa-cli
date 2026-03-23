# chapa-cli

[![npm version](https://img.shields.io/npm/v/chapa-cli)](https://www.npmjs.com/package/chapa-cli)
[![CI](https://github.com/juan294/chapa-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/juan294/chapa-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/chapa-cli)](https://nodejs.org)

![Chapa Badge](https://chapa.thecreativetoken.com/u/juan294/badge.svg)

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

# 2. Create an EMU token with scopes: repo, read:user, read:org, read:discussion
#    Settings > Developer settings > Personal access tokens (on your EMU account)
#    If your org uses SAML SSO, also authorize the token for your org (see below)

# 3. Merge your EMU contributions
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

The EMU token can be provided via `--emu-token` flag or `GITHUB_EMU_TOKEN` environment variable.

**Required token scopes:** `repo`, `read:user`, `read:org`, `read:discussion`

> Without `repo` scope, only the contribution calendar works — PRs, lines, repos contributed, and stars will all show as zero.

See [EMU token setup](#emu-token-setup) for step-by-step instructions.

## Options

| Flag | Description |
|------|-------------|
| `--emu-handle <handle>` | Your EMU GitHub handle (required for merge) |
| `--emu-token <token>` | EMU GitHub token (or set `GITHUB_EMU_TOKEN`) |
| `--handle <handle>` | Override personal handle (auto-detected from login) |
| `--token <token>` | Override auth token (auto-detected from login) |
| `--server <url>` | Chapa server URL (default: production) |
| `--verbose` | Show debug output, timings, and server responses |
| `--json` | Output merge result as structured JSON (for scripting/CI) |
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

## EMU token setup

Your EMU token is a GitHub personal access token created on your **EMU (work) account** — not your personal account.

### Step 1: Create the token

1. Log into GitHub with your **EMU account**
2. Go to **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. Click **Generate new token (classic)**
4. Give it a descriptive name (e.g. `chapa-cli`)
5. Select these scopes:

| Scope | Why |
|-------|-----|
| `repo` | Access repository data, PR details, lines changed, commit history |
| `read:user` | Contribution calendar, profile info |
| `read:org` | Repos in your enterprise org |
| `read:discussion` | Discussion contributions (future-proofing) |

6. Click **Generate token** and copy it

### Step 2: Authorize for SAML SSO (if applicable)

Most enterprise GitHub organizations enforce SAML single sign-on. If yours does, the token must be explicitly authorized for the org — otherwise PR details and repo data will be blocked.

1. Go to **Settings** → **Developer settings** → **Personal access tokens**
2. Find the token you just created
3. Click **Configure SSO**
4. Click **Authorize** next to your enterprise organization

> **How to tell if SAML is blocking you:** Run `chapa merge --verbose`. If you see `saml_failure` in the error output, your token needs SSO authorization. Commits and active days will work, but PRs, lines, and reviews will show as zero.

### Step 3: Store the token

Either pass it directly:

```bash
chapa merge --emu-handle your-emu-handle --emu-token ghp_your_token
```

Or set it as an environment variable (recommended):

```bash
export GITHUB_EMU_TOKEN=ghp_your_token
chapa merge --emu-handle your-emu-handle
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| All metrics zero except commits | Token missing `repo` scope | Regenerate token with `repo` scope |
| PRs/lines/reviews zero, commits work | SAML SSO not authorized | Authorize token for your org (see above) |
| `fetch failed → ENOTFOUND` | DNS/network issue | Check internet connection or proxy settings |
| `fetch failed → ECONNREFUSED` | GitHub API unreachable | Corporate firewall may be blocking `api.github.com` |
| TLS certificate errors | Corporate TLS interception | Use `--insecure` flag |
| `GraphQL HTTP 401` | Token expired or invalid | Regenerate the EMU token |

Run with `--verbose` for detailed debug output including timing, server responses, and error details.

## How it works

1. **Login**: The CLI generates a session ID, displays an authorization URL, and polls the Chapa server until you approve in the browser. Credentials are saved to `~/.chapa/credentials.json`.

2. **Merge**: The CLI fetches your EMU account's contribution data via GitHub's GraphQL API (using your EMU token), then uploads the aggregated stats to the Chapa server. Your badge will reflect the combined data on next refresh.

## Metrics collected

The `merge` command fetches the following data from your EMU account via GitHub's GraphQL API, covering a rolling **365-day window**.

### Contribution metrics

| Metric | Description |
|--------|-------------|
| Total commits | All contributions recorded in GitHub's contribution calendar |
| Active days | Number of days with at least one contribution |
| Merged PRs (count) | Pull requests that were merged |
| Merged PRs (weight) | Complexity-weighted score based on lines changed and files touched |
| Reviews submitted | Pull request reviews authored |
| Issues closed | Issues contributed to |
| Lines added | Sum of additions across merged PRs |
| Lines deleted | Sum of deletions across merged PRs |

### Repository metrics

| Metric | Description |
|--------|-------------|
| Repos contributed to | Repositories with at least one commit in the period (top 20 by last push) |
| Top repo share | Ratio of commits in your most-active repo vs. total — measures focus/spread |
| Total stars | Stargazers across your owned repositories |
| Total forks | Forks across your owned repositories |
| Total watchers | Watchers across your owned repositories |

### Activity data

| Metric | Description |
|--------|-------------|
| Heatmap | Daily contribution count for every day in the 365-day window |

All metrics are aggregated client-side and uploaded to the Chapa server in a single request. The EMU token is used only to query GitHub's API and is never stored or sent to Chapa.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

- [Report a bug](https://github.com/juan294/chapa-cli/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/juan294/chapa-cli/issues/new?template=feature_request.yml)

## License

MIT
