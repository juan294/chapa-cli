# Phase 3: Per-Request `insecure` Scoping

> **Project**: chapa-cli
> **Prerequisite**: None (recommended after phases 1 and 2, but no file overlap)
> **Files modified**: `src/http.ts`, `src/index.ts`, `src/login.ts`, `src/upload.ts`, `src/insights.ts`, `src/telemetry.ts`, `src/background.ts`
> **Files created**: `src/http.test.ts`
> **Tests modified**: `src/index.test.ts`, `src/login.test.ts`, `src/upload.test.ts`, `src/insights.test.ts`, `src/telemetry.test.ts`, `src/fetch-emu.test.ts`
> **Batch**: Not batch-eligible (blocks phase 4 via `src/background.ts`)
> **Status**: Not started

## Objective

Stop setting `NODE_TLS_REJECT_UNAUTHORIZED = "0"` globally when `--insecure` is used. Instead, pass an `insecure` flag down the call chain to every Chapa-bound request, and save/restore the env var for the lifetime of only that fetch. GitHub API calls must always validate TLS, and the env var must be unset after the command exits.

Design confirmed with project lead: **Option A** (per-request scope, zero-dep). See main plan for trade-off table.

## Changes

### 1. Add a scoped TLS-bypass helper in `http.ts`

**File**: `src/http.ts`

```pseudo
async function withInsecureTls<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
}
```

### 2. Extend `RequestOptions` with `insecure`

**File**: `src/http.ts`

```pseudo
interface RequestOptions<TFallback> {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  token?: string;
  body?: BodyInit | object;
  timeoutMs?: number;
  fallbackData?: TFallback;
  insecure?: boolean;   // NEW — when true, bypass TLS verification for this fetch only
}
```

In `makeRequest`, wrap the `fetch(...)` call in `withInsecureTls` when `opts.insecure === true`:

```pseudo
async function makeRequest(opts) {
  const doFetch = () => fetch(opts.url, { ... });
  try {
    const response = opts.insecure
      ? await withInsecureTls(doFetch)
      : await doFetch();
    // ... existing ok/non-ok handling unchanged
  } catch (error) {
    return toRequestFailure(error, timeoutMs);
  }
}
```

`requestJson` and `requestText` need no signature changes beyond type-forwarding — they already pass `opts` through to `makeRequest` (existing behavior at `src/http.ts:138-203`).

### 3. Remove the global env mutation from `index.ts`

**File**: `src/index.ts:571-575`

```pseudo
// before
if (args.insecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn("\n⚠ TLS certificate verification disabled (--insecure).");
  console.warn("  Use only on corporate networks with TLS interception.\n");
}

// after
if (args.insecure) {
  console.warn("\n⚠ TLS certificate verification disabled for the Chapa server (--insecure).");
  console.warn("  GitHub API calls still validate TLS.");
  console.warn("  Use only on corporate networks with TLS interception.\n");
}
```

No env manipulation at the dispatcher level. The flag now only influences per-request transport calls downstream.

### 4. Forward `insecure` through every Chapa-bound caller

Each Chapa request call site receives `insecure` and forwards it. GitHub-bound calls in `fetch-emu.ts` do **not** forward it.

**File**: `src/login.ts`

```pseudo
// login() already takes opts.insecure — plumb it into the poll:
const res = await requestJson<PollResponse>({
  url: `${baseUrl}/api/cli/auth/poll?session=${sessionId}`,
  timeoutMs: 10_000,
  insecure,
});
```

**File**: `src/upload.ts`

Add `insecure?: boolean` to `UploadOptions`. Forward in the `requestJson` call:

```pseudo
const res = await requestJson<...>({
  url,
  method: "POST",
  token: opts.token,
  timeoutMs: 30_000,
  headers: { "Content-Type": "application/json" },
  body: payload,
  insecure: opts.insecure,
});
```

**File**: `src/insights.ts`

Add `insecure?: boolean` to `InsightsUploadOptions`. Forward in `uploadInsights`. For `queueRecalculate`, extend the call to accept an `insecure` boolean and propagate it to `spawnDetachedPost`.

```pseudo
export function queueRecalculate(serverUrl, token, opts?: { insecure?: boolean }): void {
  spawnDetachedPost({
    url: `${baseUrl}/api/recalculate`,
    timeoutMs: 30_000,
    token,
    insecure: opts?.insecure,
  });
}
```

The unused `triggerRecalculate` export stays as-is (dead-code removal deferred).

**File**: `src/telemetry.ts`

Add an `insecure?: boolean` parameter to `queueTelemetry` and pass through to `spawnDetachedPost`:

```pseudo
export function queueTelemetry(serverUrl, payload, opts?: { insecure?: boolean }): void {
  spawnDetachedPost({
    url: `${baseUrl}/api/telemetry`,
    timeoutMs: 5000,
    body: payload,
    insecure: opts?.insecure,
  });
}
```

Likewise for `sendTelemetry` — accept `insecure?: boolean`, forward via `insecure` into `requestJson`.

**File**: `src/index.ts`

Every call site that reaches a Chapa endpoint must now forward `args.insecure`:

- `handleLogin` already forwards via `login(args.server, { insecure: args.insecure, verbose: args.verbose })` — no change.
- `handleInsights` — forward `insecure: args.insecure` to `uploadInsights` and `queueRecalculate`.
- `handleMerge` — forward `insecure: args.insecure` to `uploadSupplementalStats`.
- The internal `emitTelemetry(serverUrl, payload)` wrapper grows an `insecure` argument, or we update call sites to pass `{ insecure: args.insecure }`.

`fetch-emu.ts` — **do not** add an `insecure` option. GitHub calls must always validate TLS; this is part of the threat model.

### 5. Extend `spawnDetachedPost` for `insecure` (contract only — env hardening is phase 4)

**File**: `src/background.ts`

Add an `insecure?: boolean` field to `DetachedPostOptions` and forward into the child's environment as a new `CHAPA_BG_INSECURE` var. Update the inline child script to read it before calling `fetch()`:

```pseudo
const DETACHED_POST_SCRIPT = `
  const url = process.env.CHAPA_BG_URL;
  const timeoutMs = Number(process.env.CHAPA_BG_TIMEOUT_MS ?? "0");
  const token = process.env.CHAPA_BG_TOKEN || "";
  const rawBody = process.env.CHAPA_BG_BODY;
  const insecure = process.env.CHAPA_BG_INSECURE === "1";

  if (insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  // ... rest unchanged
`;

env: {
  ...process.env,                         // LEAVE the spread alone in this phase
  CHAPA_BG_BODY: body === undefined ? "" : JSON.stringify(body),
  CHAPA_BG_TIMEOUT_MS: String(timeoutMs),
  CHAPA_BG_TOKEN: token ?? "",
  CHAPA_BG_URL: url,
  CHAPA_BG_INSECURE: insecure ? "1" : "",  // NEW
}
```

**The `...process.env` spread is deliberately left in place in this phase** — phase 4 replaces it with an allow-list. Splitting lets us ship the TLS scoping independently and keeps this phase's regressions bounded to TLS behavior.

## Tests

### New: `src/http.test.ts`

```pseudo
describe("requestJson with insecure: true", () => {
  it("sets NODE_TLS_REJECT_UNAUTHORIZED='0' for the duration of the fetch", async () => {
    let envDuringFetch: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async () => {
      envDuringFetch = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      return new Response("{}", { status: 200 });
    }));

    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    await requestJson({ url: "https://x.test", insecure: true });

    expect(envDuringFetch).toBe("0");
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("restores NODE_TLS_REJECT_UNAUTHORIZED after a fetch that throws", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("boom");
    }));

    await requestJson({ url: "https://x.test", insecure: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("preserves a previously-set NODE_TLS_REJECT_UNAUTHORIZED value", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    await requestJson({ url: "https://x.test", insecure: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("1");
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  it("does not touch the env when insecure is false/undefined", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    vi.stubGlobal("fetch", vi.fn(async () => {
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      return new Response("{}", { status: 200 });
    }));
    await requestJson({ url: "https://x.test" });
  });
});
```

### `src/index.test.ts` — rewrite existing TLS assertions

Remove the test at `src/index.test.ts:319-340` (`"sets NODE_TLS_REJECT_UNAUTHORIZED and warns when --insecure is used"`) and replace with:

```pseudo
it("does not globally set NODE_TLS_REJECT_UNAUTHORIZED when --insecure is used", async () => {
  const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  mockParseArgs.mockReturnValue(defaultArgs({ command: "login", insecure: true }));
  mockLogin.mockResolvedValue(undefined);

  try {
    await runMain();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    const allWarns = spyOutput(warnSpy);
    expect(allWarns).toContain("--insecure");
    expect(allWarns).toContain("Chapa server");
    expect(allWarns).toContain("GitHub API calls still validate TLS");
  } finally {
    if (originalVal === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalVal;
  }
});

it("forwards insecure: true to login()", async () => {
  mockParseArgs.mockReturnValue(defaultArgs({ command: "login", insecure: true }));
  mockLogin.mockResolvedValue(undefined);
  await runMain();
  expect(mockLogin).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ insecure: true }),
  );
});

it("forwards insecure: true to uploadSupplementalStats on merge", async () => {
  // assert the mock was called with { insecure: true }
});

it("forwards insecure: true to uploadInsights and queueRecalculate on insights", async () => {
  // likewise
});

it("does NOT forward insecure to fetchEmuStats (GitHub always validates TLS)", async () => {
  mockParseArgs.mockReturnValue(defaultArgs({
    command: "merge", emuHandle: "foo", insecure: true,
  }));
  mockResolveToken.mockReturnValue("ghp_emu");
  mockLoadConfig.mockReturnValue({ handle: "me", token: "t", server: "https://chapa.example" });
  mockFetchEmuStats.mockResolvedValue(successFetchResult());
  mockUploadSupplementalStats.mockResolvedValue({ success: true });
  await runMain();

  // fetchEmuStats signature is (login, emuToken, opts?) — assert no insecure was passed
  const callArgs = mockFetchEmuStats.mock.calls[0];
  expect(callArgs?.[2]?.insecure).toBeUndefined();
});
```

Keep the existing "does not set NODE_TLS_REJECT_UNAUTHORIZED when --insecure is not used" test at `src/index.test.ts:341-358` — it still holds.

### `src/login.test.ts`

The existing test at `src/login.test.ts:258-284` ("does not set or restore NODE_TLS_REJECT_UNAUTHORIZED (handled by index.ts)") needs its comment and assertions updated. The *behavior* it checks (login itself does not mutate the env var) is still correct, but the rationale changes. Replace the description with:

```pseudo
it("never mutates NODE_TLS_REJECT_UNAUTHORIZED — scoping is per-request in http.ts", async () => {
  // assertions unchanged: env var still undefined after login() finishes
});
```

Add a new test that confirms the poll request forwards `insecure`:

```pseudo
it("forwards insecure: true into the poll request", async () => {
  const requestSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200, data: { status: "pending" } }));
  vi.doMock("./http.js", () => ({ requestJson: requestSpy }));
  // ... drive one poll tick with insecure: true
  expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({ insecure: true }));
});
```

### `src/upload.test.ts`, `src/insights.test.ts`, `src/telemetry.test.ts`

For each module, add one test that verifies `insecure: true` is forwarded into `requestJson`/`spawnDetachedPost`:

```pseudo
it("forwards insecure to the shared transport when set", async () => {
  const requestSpy = /* mock requestJson */;
  await uploadSupplementalStats({ ..., insecure: true });
  expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({ insecure: true }));
});
```

For `queueTelemetry` / `queueRecalculate`, spy on `spawn` (as `insights.test.ts` already does) and assert `CHAPA_BG_INSECURE === "1"` appears in the child's `env`.

### `src/fetch-emu.test.ts`

Add one negative-direction test:

```pseudo
it("never passes insecure to the shared transport", async () => {
  const requestSpy = /* mock requestJson */;
  await fetchEmuStats("login", "ghp_token");
  const call = requestSpy.mock.calls[0]?.[0];
  expect(call.insecure).toBeUndefined();
});
```

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test` passes with all new and rewritten cases.
- The replacement for `src/index.test.ts:319-340` asserts `NODE_TLS_REJECT_UNAUTHORIZED` is undefined after `runMain()` with `--insecure`.
- `src/fetch-emu.test.ts` has a test proving GitHub calls never receive `insecure`.
- `src/background.ts` child script reads `CHAPA_BG_INSECURE` and sets the env var only when `"1"`.

### Manual

- `chapa merge --insecure --emu-handle foo` succeeds against a Chapa server with a corporate MITM cert *and* fails cleanly (TLS error) if `api.github.com` were to present an untrusted cert.
- `echo $NODE_TLS_REJECT_UNAUTHORIZED` in the parent shell is empty after `chapa --insecure` completes.
- The startup warning printed under `--insecure` now explicitly states "GitHub API calls still validate TLS".

## Notes for Phase 4

- Phase 4 narrows the `...process.env` spread in `spawnDetachedPost` to an allow-list. It depends on the `CHAPA_BG_INSECURE` contract being in place.
- Keep `NODE_PATH`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS` in the phase-4 allow-list so the child's TLS stack can still locate CAs when `--insecure` is *not* used.
