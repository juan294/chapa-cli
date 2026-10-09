# Server Contract

This document describes the Chapa server endpoints that the CLI calls for
linked GitHub accounts (`merge`, `unlink`) and for telemetry.

# Linked GitHub account (juan294/chapa#1401)

`chapa merge` links a second GitHub account B (for example an EMU account) to
the Chapa profile of the logged-in user. The server verifies that B's token
belongs to B, stores it encrypted, and collects B's activity daily.

All three endpoints use `Authorization: Bearer <Chapa CLI token>`, the token
that `chapa login` saves. B's GitHub token is never sent in a header; it
travels only in the JSON body of `POST /api/github-linked`.

## `POST /api/github-linked`

```
POST /api/github-linked
Authorization: Bearer <Chapa CLI token>
Content-Type: application/json

{ "login": "<B's GitHub handle>", "token": "<B's GitHub token>" }
```

The body has exactly these two keys. The server accepts only a Chapa CLI
token as Bearer (a GitHub token would authenticate as its own account).

| Status | Body | CLI behavior |
|--------|------|--------------|
| 200 | `{ linked: true, owner, login, alsoRegistered: boolean, collection: "queued" \| "deferred" }` | Print the link message, naming `owner` (the CLI token's profile); note a duplicate profile when `alsoRegistered`; note the next daily run when `deferred`. Then read the status once. |
| 400 | `{ error: "invalid_body", message }` | Print the message. |
| 401 | `{ error: "authentication_required" \| "cli_token_required", message }` | Print the message and tell the user to run `chapa login`. |
| 403 | `{ error: "token_identity_mismatch", message }` | Print the message, the token setup link and the required scopes. |
| 409 | `{ error: "linked_elsewhere" \| "same_as_owner", message }` | Print the message. A conflict is about the account, not the token. |
| 422 | `{ error: "token_rejected" \| "insufficient_scope", message, requiredScopes: ["repo","read:user","read:org"], missingScopes?: string[], helpUrl }` | Print the message, the setup link, the required and missing scopes, and the recovery command `npx chapa-cli@latest merge --emu-handle B --emu-token <token>`. |
| 429 | `{ error: "rate_limited", message }` | Print the message. |
| 503 | `{ error: "persist_failed" \| "github_unavailable", message }` | Print the message (try again). |
| 404 | any | The server has no link routes yet: say so. |
| other | any | Print `message`, else `error`, else `Server returned <status>`. A 410 comes only from the legacy `POST /api/supplemental` path. |

`helpUrl` is `https://github.com/juan294/chapa-cli#emu-token-setup`. Every
non-2xx answer makes the CLI exit with code 1.

## `GET /api/github-linked/status`

```
GET /api/github-linked/status
Authorization: Bearer <Chapa CLI token>
```

Answers `{ linked: false }` or
`{ linked: true, login, needsReconnect: boolean, connectedAt }`.
`chapa merge` reads it once after a successful link. When `needsReconnect` is
true it prints the recovery command. A failed status read does not fail the
command; it is reported in `--verbose` output.

## `POST /api/github-linked/disconnect`

```
POST /api/github-linked/disconnect
Authorization: Bearer <Chapa CLI token>
```

Empty body. Used by `chapa unlink`.

| Status | Body |
|--------|------|
| 200 | `{ success: true, linked: false, owner, wasLinked: boolean }`; `wasLinked: false` means nothing was linked |
| 401 | `{ error: "authentication_required" }` |
| 429 | `{ error: "rate_limited" }` |
| 503 | `{ error: "persist_failed", message }` |

## Token handling

- B's token is never written to `~/.chapa/credentials.json`, to logger output
  (including `--verbose`) or to telemetry.
- It is never sent in a request header.

# Telemetry: `POST /api/telemetry`

The CLI sends telemetry after `login`, `merge`, and `insights` operations.
The Chapa server stores this data for debugging and operational dashboarding.

## Endpoint

```
POST /api/telemetry
Content-Type: application/json
```

No authentication required — the payload contains no sensitive data.

## Request Body

```typescript
type TelemetryCommand = "login" | "merge" | "insights";
type TelemetryStage = "auth" | "fetch" | "parse" | "upload" | "complete";

interface TelemetryPayload {
  operationId: string;        // UUID v4 — unique per CLI operation
  command: TelemetryCommand;
  stage: TelemetryStage;
  targetHandle?: string;      // Personal GitHub handle when known
  sourceHandle?: string;      // Linked account handle for merge, personal handle for insights
  success: boolean;
  errorCategory?: "auth" | "network" | "graphql" | "server" | "unknown";
  stats: {
    commitsTotal: number;     // Zero (merge links an account since 0.6.0)
    reposContributed: number; // Zero
    prsMergedCount: number;   // Zero
    activeDays: number;       // Insights report days; zero for login and merge
    reviewsSubmittedCount: number;
  };
  timing: {
    totalMs: number;          // Total CLI operation duration
    authMs?: number;          // Login approval / polling duration
    fetchMs?: number;         // Merge sends 0 since 0.6.0 (the server requires it for merge)
    parseMs?: number;         // Insights HTML parse duration
    uploadMs?: number;        // Chapa server upload or link request duration
  };
  cliVersion: string;         // e.g. "0.6.0"
}
```

## Response

```
200 OK
{ "ok": true }
```

The CLI ignores the response (fire-and-forget with 5s timeout). Non-200 responses and network errors are silently swallowed.

## Client Behavior

- **Fire-and-forget**: 5s timeout via `AbortSignal.timeout()`, all errors caught silently
- **Non-blocking**: command completion is not delayed on telemetry delivery
- **No sensitive data**: no tokens, no stack traces, no full StatsData
- **Command-aware**: every event includes `command` and the last completed or failed `stage`
- **Always sent**: on both success and failure paths for `login`, `merge`, and `insights`

## Example Storage Schema

One generalized table can store all CLI telemetry events:

```sql
CREATE TABLE cli_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE,
  command TEXT NOT NULL,
  stage TEXT NOT NULL,
  target_handle TEXT,
  source_handle TEXT,
  success BOOLEAN NOT NULL,
  error_category TEXT,
  commits_total INTEGER NOT NULL DEFAULT 0,
  repos_contributed INTEGER NOT NULL DEFAULT 0,
  prs_merged_count INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  reviews_submitted_count INTEGER NOT NULL DEFAULT 0,
  auth_ms REAL,
  fetch_ms REAL,
  parse_ms REAL,
  upload_ms REAL,
  total_ms REAL NOT NULL,
  cli_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common dashboard queries
CREATE INDEX idx_cli_ops_created_at ON cli_operations (created_at DESC);
CREATE INDEX idx_cli_ops_command_stage ON cli_operations (command, stage);
CREATE INDEX idx_cli_ops_target ON cli_operations (target_handle) WHERE target_handle IS NOT NULL;
CREATE INDEX idx_cli_ops_success ON cli_operations (success);
CREATE INDEX idx_cli_ops_error ON cli_operations (error_category) WHERE error_category IS NOT NULL;
```

## Example Dashboard Queries

### Success rate (last 7 days)

```sql
SELECT
  COUNT(*) FILTER (WHERE success) AS successes,
  COUNT(*) FILTER (WHERE NOT success) AS failures,
  ROUND(100.0 * COUNT(*) FILTER (WHERE success) / COUNT(*), 1) AS success_rate
FROM cli_operations
WHERE created_at > now() - INTERVAL '7 days';
```

### Failure hotspots by command and stage

```sql
SELECT
  command,
  stage,
  COUNT(*) AS failures
FROM cli_operations
WHERE NOT success
  AND created_at > now() - INTERVAL '30 days'
GROUP BY command, stage
ORDER BY failures DESC, command, stage;
```

### Merge latency by day

```sql
SELECT
  DATE(created_at) AS day,
  ROUND(AVG(fetch_ms)) AS avg_fetch_ms,
  ROUND(AVG(upload_ms)) AS avg_upload_ms,
  ROUND(AVG(total_ms)) AS avg_total_ms
FROM cli_operations
WHERE command = 'merge'
  AND success = true
GROUP BY day
ORDER BY day DESC
LIMIT 14;
```

### Insights parse and upload failures

```sql
SELECT
  operation_id,
  stage,
  error_category,
  total_ms,
  parse_ms,
  upload_ms,
  cli_version,
  created_at
FROM cli_operations
WHERE command = 'insights'
  AND NOT success
ORDER BY created_at DESC
LIMIT 20;
```

### Per-user merge history

```sql
SELECT
  operation_id,
  source_handle,
  success,
  error_category,
  commits_total,
  repos_contributed,
  total_ms,
  cli_version,
  created_at
FROM cli_operations
WHERE command = 'merge'
  AND target_handle = 'juan294'
ORDER BY created_at DESC
LIMIT 20;
```

### Login failures

```sql
SELECT
  operation_id,
  stage,
  error_category,
  auth_ms,
  total_ms,
  cli_version,
  created_at
FROM cli_operations
WHERE command = 'login'
  AND NOT success
ORDER BY created_at DESC
LIMIT 20;
```

### Error distribution

```sql
SELECT
  command,
  stage,
  error_category,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM cli_operations
WHERE NOT success
  AND created_at > now() - INTERVAL '30 days'
GROUP BY command, stage, error_category
ORDER BY count DESC;
```
