# Phase 2: Merge Orchestration, Guaranteed Telemetry, Centralized Exits

> **Project**: chapa-cli
> **Prerequisite**: Phase 1
> **Files modified**: `src/index.ts`, `src/fetch-emu.ts`, `src/login.ts`, `src/telemetry.ts`
> **Files created**: None
> **Tests modified**: `src/index.test.ts`, `src/login.test.ts`, `src/fetch-emu.test.ts`
> **Batch**: Not batch-eligible
> **Status**: Complete on 2026-04-17

## Objective

Remove `null` and internal `process.exit()` control flow from core command helpers so the CLI has one owner for exits and one reliable place to emit merge telemetry.

## Changes

### 1. Replace `StatsData | null` with a typed fetch result

**File**: `src/fetch-emu.ts`

```pseudo
export type FetchEmuResult =
  | { ok: true; stats: StatsData }
  | {
      ok: false;
      error: string;
      errorCategory: TelemetryPayload["errorCategory"];
    };

export async function fetchEmuStats(...): Promise<FetchEmuResult> {
  if (request failed) return { ok: false, error, errorCategory };
  if (user missing) return { ok: false, error: "...", errorCategory: "graphql" | "unknown" };
  return { ok: true, stats };
}
```

The calling code should no longer infer failure intent from `null`.

### 2. Collapse merge telemetry into a single terminal path

**File**: `src/index.ts`

Refactor merge handling so fetch, upload, output, and telemetry are orchestrated from one place.

```pseudo
async function handleMerge(args): Promise<void> {
  // validate inputs
  // start timers

  const fetchResult = await fetchEmuStats(...);
  if (!fetchResult.ok) {
    emit failure telemetry using fetchResult.errorCategory
    throw new CliError(fetchResult.error);
  }

  const uploadResult = await uploadSupplementalStats(...);
  if (!uploadResult.success) {
    emit failure telemetry
    throw new CliError(uploadResult.error);
  }

  emit success telemetry
}
```

Goal: every merge path emits telemetry once and only once.

### 3. Remove direct `process.exit()` from login

**File**: `src/login.ts`

Change timeout and expired-session paths to return typed failures by throwing errors that the CLI boundary owns.

```pseudo
if (data.status === "expired") {
  throw new Error("Session expired. Please try again.");
}

after max attempts:
throw new Error("Timed out waiting for approval. Please try again.");
```

Then wrap or translate them in `index.ts` as `CliError` so the final exit remains centralized.

### 4. Keep `index.ts` as the only exit owner

**File**: `src/index.ts`

Preserve the current top-level catch/`process.exit(1)` boundary, but ensure helpers feed into it instead of bypassing it.

```pseudo
main().catch((err) => {
  if (!(err instanceof CliError)) print once
  process.exit(1);
});
```

No helper module should call `process.exit()` after this phase.

## Tests

### `src/index.test.ts`

Add or update tests to verify:

```pseudo
it("sends failure telemetry when GitHub fetch fails before upload")
it("sends exactly one telemetry event for upload failures")
it("sends exactly one telemetry event for success")
it("still exits with code 1 through the top-level boundary")
```

### `src/login.test.ts`

Add or update tests to verify:

```pseudo
it("rejects with timeout error instead of calling process.exit")
it("rejects with expired-session error instead of calling process.exit")
```

### `src/fetch-emu.test.ts`

Add or update tests to verify:

```pseudo
it("returns a typed failure with an error category on HTTP failure")
it("returns a typed failure with an error category on network failure")
```

## Success Criteria

### Automated

- No helper module calls `process.exit()`.
- Merge fetch failures emit telemetry with a stable category.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

### Manual

- `chapa login` still exits non-zero on expired or timed-out sessions.
- `chapa merge` reports fetch failures cleanly and still records telemetry for that failed operation.
