# Phase 1: Shared Transport Layer and Request Normalization

> **Project**: chapa-cli
> **Prerequisite**: None
> **Files modified**: `src/fetch-emu.ts`, `src/upload.ts`, `src/insights.ts`, `src/login.ts`, `src/telemetry.ts`
> **Files created**: `src/http.ts`
> **Tests modified**: `src/fetch-emu.test.ts`, `src/upload.test.ts`, `src/insights.test.ts`, `src/login.test.ts`, `src/telemetry.test.ts`
> **Batch**: Not batch-eligible
> **Status**: Complete on 2026-04-17

## Objective

Introduce a single narrow transport helper so every networked module gets consistent timeout behavior, response parsing, and error normalization without adding unnecessary abstraction.

## Changes

### 1. Add a shared HTTP helper

**File**: `src/http.ts`

Create a small transport module with only the behaviors this CLI needs.

```pseudo
export type RequestFailureCategory =
  | "timeout"
  | "network"
  | "http"
  | "parse";

export interface RequestFailure {
  ok: false;
  category: RequestFailureCategory;
  status?: number;
  message: string;
  cause?: unknown;
}

export interface RequestSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type RequestResult<T> = RequestSuccess<T> | RequestFailure;

export async function requestJson<T>(opts): Promise<RequestResult<T>> {
  // apply AbortSignal.timeout(default or per-call timeout)
  // merge standard headers
  // attach Authorization header when token exists
  // parse JSON with safe fallback
  // normalize fetch, timeout, http, and parse failures
}

export async function requestText(opts): Promise<RequestResult<string>> {
  // same timeout/error behavior for rare text consumers
}
```

Implementation constraints:

- Keep it function-based, not class-based.
- Keep error objects serializable and testable.
- Do not introduce dependencies.

### 2. Convert GitHub fetch to the shared helper

**File**: `src/fetch-emu.ts`

```pseudo
const res = await requestJson<GraphQLResponse>({
  url: "https://api.github.com/graphql",
  method: "POST",
  token: emuToken,
  timeoutMs: 30000,
  body: { query: CONTRIBUTION_QUERY, variables: ... },
});

if (!res.ok) {
  log.error(formatRequestFailure("GraphQL", res));
  return failure_result;
}
```

Preserve the current GraphQL response normalization and truncation behavior where it still adds value.

### 3. Convert upload and insights requests to the shared helper

**Files**: `src/upload.ts`, `src/insights.ts`

```pseudo
const res = await requestJson<ServerResponse>({
  url,
  method: "POST",
  token,
  timeoutMs: 30000,
  body: payload,
});

if (!res.ok) {
  return { success: false, error: normalizedMessage(res) };
}
```

Keep upload result shapes stable unless a later phase explicitly replaces them.

### 4. Convert login polling to bounded requests

**File**: `src/login.ts`

```pseudo
const res = await requestJson<PollResponse>({
  url: `${baseUrl}/api/cli/auth/poll?session=${sessionId}`,
  timeoutMs: 10000,
});

if (!res.ok) {
  // keep retry semantics
  // keep TLS detection guidance
  // log normalized status/error once or per verbose mode
  continue;
}
```

Do not change polling cadence or approval semantics in this phase.

### 5. Keep telemetry fire-and-forget on top of the shared helper

**File**: `src/telemetry.ts`

```pseudo
await requestJson({
  url: `${baseUrl}/api/telemetry`,
  method: "POST",
  timeoutMs: 5000,
  body: payload,
});

// swallow all failures
```

Telemetry must remain non-blocking and must never surface new user-facing errors.

## Tests

### `src/fetch-emu.test.ts`

Add or update tests to verify:

```pseudo
it("maps timeout failures into a stable error path")
it("does not lose GraphQL error logging when using requestJson")
it("still avoids logging token-bearing error objects")
```

### `src/upload.test.ts` and `src/insights.test.ts`

Add or update tests to verify:

```pseudo
it("returns normalized errors for timeout/network/http failures")
it("preserves successful JSON parsing and auth headers")
```

### `src/login.test.ts`

Add or update tests to verify:

```pseudo
it("retries when a poll request times out")
it("still suggests --insecure on TLS-related request failures")
```

### `src/telemetry.test.ts`

Add or update tests to verify:

```pseudo
it("still swallows timeout and network failures")
it("continues using a 5s timeout")
```

## Success Criteria

### Automated

- Request modules use `src/http.ts` instead of open-coded `fetch()` logic.
- Timeout coverage exists for user-facing requests and telemetry.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

### Manual

- A disconnected network no longer leaves `login`, `merge`, or `insights` hanging indefinitely.
- Existing user-facing success messages remain intact.
