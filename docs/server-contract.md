# Server Contract: `POST /api/telemetry`

The CLI sends telemetry after every merge operation (success or failure).
The Chapa server stores this data for debugging and operational dashboarding.

## Endpoint

```
POST /api/telemetry
Content-Type: application/json
```

No authentication required — the payload contains no sensitive data.

## Request Body

```typescript
interface TelemetryPayload {
  operationId: string;        // UUID v4 — unique per merge operation
  targetHandle: string;       // Personal GitHub handle
  sourceHandle: string;       // EMU GitHub handle
  success: boolean;
  errorCategory?: "auth" | "network" | "graphql" | "server" | "unknown";
  stats: {
    commitsTotal: number;
    reposContributed: number;
    prsMergedCount: number;
    activeDays: number;
    reviewsSubmittedCount: number;
  };
  timing: {
    fetchMs: number;          // GitHub GraphQL fetch duration
    uploadMs: number;         // Chapa server upload duration
    totalMs: number;          // Total merge operation duration
  };
  cliVersion: string;         // e.g. "0.2.9"
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
- **Non-blocking**: the user sees "Success!" before telemetry completes
- **No sensitive data**: no tokens, no stack traces, no full StatsData
- **Always sent**: on both success and failure paths

## Supabase Schema

```sql
CREATE TABLE merge_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE,
  target_handle TEXT NOT NULL,
  source_handle TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error_category TEXT,
  commits_total INTEGER NOT NULL,
  repos_contributed INTEGER NOT NULL,
  prs_merged_count INTEGER NOT NULL,
  active_days INTEGER NOT NULL,
  reviews_submitted_count INTEGER NOT NULL,
  fetch_ms REAL NOT NULL,
  upload_ms REAL NOT NULL,
  total_ms REAL NOT NULL,
  cli_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common dashboard queries
CREATE INDEX idx_merge_ops_created_at ON merge_operations (created_at DESC);
CREATE INDEX idx_merge_ops_target ON merge_operations (target_handle);
CREATE INDEX idx_merge_ops_success ON merge_operations (success);
CREATE INDEX idx_merge_ops_error ON merge_operations (error_category) WHERE error_category IS NOT NULL;
```

## Example Dashboard Queries

### Success rate (last 7 days)

```sql
SELECT
  COUNT(*) FILTER (WHERE success) AS successes,
  COUNT(*) FILTER (WHERE NOT success) AS failures,
  ROUND(100.0 * COUNT(*) FILTER (WHERE success) / COUNT(*), 1) AS success_rate
FROM merge_operations
WHERE created_at > now() - INTERVAL '7 days';
```

### Average timing by day

```sql
SELECT
  DATE(created_at) AS day,
  ROUND(AVG(fetch_ms)) AS avg_fetch_ms,
  ROUND(AVG(upload_ms)) AS avg_upload_ms,
  ROUND(AVG(total_ms)) AS avg_total_ms
FROM merge_operations
WHERE success = true
GROUP BY day
ORDER BY day DESC
LIMIT 14;
```

### Error distribution

```sql
SELECT
  error_category,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM merge_operations
WHERE NOT success
  AND created_at > now() - INTERVAL '30 days'
GROUP BY error_category
ORDER BY count DESC;
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
FROM merge_operations
WHERE target_handle = 'juan294'
ORDER BY created_at DESC
LIMIT 20;
```
