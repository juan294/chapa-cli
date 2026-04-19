# Server Contract: `POST /api/telemetry`

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
  sourceHandle?: string;      // EMU handle for merge, personal handle for insights
  success: boolean;
  errorCategory?: "auth" | "network" | "graphql" | "server" | "unknown";
  stats: {
    commitsTotal: number;     // Merge-only metric; zero for login
    reposContributed: number; // Merge-only metric; zero for login
    prsMergedCount: number;   // Merge-only metric; zero for login
    activeDays: number;       // Used by merge and insights
    reviewsSubmittedCount: number;
  };
  timing: {
    totalMs: number;          // Total CLI operation duration
    authMs?: number;          // Login approval / polling duration
    fetchMs?: number;         // GitHub GraphQL fetch duration
    parseMs?: number;         // Insights HTML parse duration
    uploadMs?: number;        // Chapa server upload duration
  };
  cliVersion: string;         // e.g. "0.4.0"
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
