# Phase 2: IPv6 Loopback Handling

> **Project**: chapa-cli
> **Prerequisite**: None
> **Files modified**: `src/index.ts`
> **Tests modified**: `src/index.test.ts`
> **Batch**: `[batch-eligible]` with phases 1, 5, 6 (disjoint file set)
> **Status**: Not started

## Objective

Allow `http://[::1]:<port>` as a trusted loopback server. On current Node, `new URL("http://[::1]:3000").hostname` returns `"[::1]"` (with brackets), so the existing `isLoopbackHost` check against the bare `"::1"` string rejects it — blocking a legitimate local-development form.

Reference: `docs/research/2026-04-19-deep-dive-validation.md` item J.

## Changes

### 1. Accept the bracketed IPv6 loopback literal

**File**: `src/index.ts:95-96`

```pseudo
// before
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "::1";
}

// after
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}
```

Rationale: `URL.hostname` returns the bracketed form for IPv6 literals (verified on Node 20+). Keep both `"::1"` and `"[::1]"` to stay safe against future Node behavior changes and direct callers that pass an unbracketed host.

### 2. No other source file changes

`assertTrustedServer` (`src/index.ts:99-118`) calls `isLoopbackHost(parsed.hostname)` — once the helper accepts the bracketed form, `http://[::1]:3000` passes the check.

## Tests

**File**: `src/index.test.ts`

Find the section that exercises `assertTrustedServer` via a CLI dispatch (around `src/index.test.ts:391` / `:971` where `http://insecure.example.com` is used for the rejection path) and add adjacent cases.

```pseudo
it("accepts http://[::1]:<port> as loopback", async () => {
  mockParseArgs.mockReturnValue(defaultArgs({
    command: "merge",
    emuHandle: "foo",
    server: "http://[::1]:3000",
    serverExplicit: true,
  }));
  mockResolveToken.mockReturnValue("ghp_emu");
  mockLoadConfig.mockReturnValue({ handle: "me", token: "t", server: "http://[::1]:3000" });
  mockFetchEmuStats.mockResolvedValue(successFetchResult());
  mockUploadSupplementalStats.mockResolvedValue({ success: true });

  await runMain();

  // must NOT have printed the "Refusing to send credentials…" error
  expect(spyOutput(errorSpy)).not.toContain("Refusing to send credentials");
});

it("accepts http://127.0.0.1:<port> (reaffirm existing behavior)", async () => {
  // same shape as above, with server "http://127.0.0.1:3000"
});

it("still rejects non-loopback http:// URLs", async () => {
  mockParseArgs.mockReturnValue(defaultArgs({
    command: "merge",
    emuHandle: "foo",
    server: "http://insecure.example.com",
    serverExplicit: true,
  }));
  await runMain();
  expect(spyOutput(errorSpy)).toContain("Refusing to send credentials");
});
```

If the existing test layout already covers the rejection path, reuse that structure and add only the two new positive cases.

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test src/index.test.ts` passes, including the new loopback acceptance cases.
- Full `pnpm test` passes.

### Manual

- `chapa login --server http://[::1]:3000` prints the authorize URL instead of the "Refusing to send credentials…" error.
