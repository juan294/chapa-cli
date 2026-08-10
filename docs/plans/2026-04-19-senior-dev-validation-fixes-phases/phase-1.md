# Phase 1: `--server=URL` Form Detection Fix

> **Project**: chapa-cli
> **Prerequisite**: None
> **Files modified**: `src/cli.ts`
> **Tests modified**: `src/cli.test.ts`
> **Batch**: `[batch-eligible]` with phases 2, 5, 6 (fully disjoint file set)
> **Status**: Not started

## Objective

Make `serverExplicit` true for both `--server value` and `--server=value`. Today only the space-separated form is detected, causing `resolveServerUrl` to silently prefer the saved-config server over the user's explicit flag.

## Changes

### 1. Detect both flag forms

**File**: `src/cli.ts:103`

```pseudo
// before
serverExplicit: argv.includes("--server"),

// after
serverExplicit: argv.some(a => a === "--server" || a.startsWith("--server=")),
```

- Do not modify `extractCommand`; Node's `parseArgs` already handles both forms for `args.server` itself.
- Do not introduce any new helper; the expression is one line and local to the `return` in `parseArgs()`.

### 2. No other source file changes

`src/index.ts:47-49` (`resolveServerUrl`) already reads `serverExplicit`; once the detection is correct, downstream behavior follows automatically.

## Tests

**File**: `src/cli.test.ts`

Add regression cases adjacent to the existing `serverExplicit` assertions (`src/cli.test.ts:22-29`):

```pseudo
it("serverExplicit is true for --server=URL form", () => {
  const args = parseArgs([
    "merge",
    "--server=http://localhost:3001",
    "--emu-handle", "foo",
  ]);
  expect(args.server).toBe("http://localhost:3001");
  expect(args.serverExplicit).toBe(true);
});

it("serverExplicit is true for space-separated --server URL form", () => {
  // reaffirms existing behavior to prevent regressions
  const args = parseArgs([
    "merge",
    "--server", "http://localhost:3001",
    "--emu-handle", "foo",
  ]);
  expect(args.serverExplicit).toBe(true);
});

it("serverExplicit is false when --server is absent", () => {
  const args = parseArgs(["merge", "--emu-handle", "foo"]);
  expect(args.serverExplicit).toBe(false);
});

it("serverExplicit is false when a value merely contains '--server' as substring", () => {
  // defensive — ensure we did not accidentally write `.includes("--server")`
  // somewhere that matches positional args containing the word
  const args = parseArgs(["merge", "--emu-handle", "not--server"]);
  expect(args.serverExplicit).toBe(false);
});
```

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test src/cli.test.ts` passes, including the four new cases.
- Full `pnpm test` passes.

### Manual

- `chapa merge --server=https://staging.example.com --emu-handle foo` uploads to `staging.example.com`, not the saved production server.
