# Phase 3: Lazy-Load Insights Path and Verify Build/Runtime Impact

> **Project**: chapa-cli
> **Prerequisite**: Phase 2
> **Files modified**: `src/index.ts`, `tsup.config.ts` if needed, `src/index.test.ts`
> **Files created**: None
> **Tests modified**: `src/index.test.ts`
> **Batch**: Not batch-eligible
> **Status**: Complete on 2026-04-17

## Objective

Ensure `login` and `merge` do not eagerly pay the `insights` parser cost, while preserving the existing `insights` command behavior.

## Changes

### 1. Replace eager insights import with lazy command loading

**File**: `src/index.ts`

Remove the top-level `insights` imports and load them only inside the `insights` command branch.

```pseudo
if (args.command === "insights") {
  const {
    parseInsightsHtml,
    uploadInsights,
    triggerRecalculate,
  } = await import("./insights.js");

  await handleInsights(args, {
    parseInsightsHtml,
    uploadInsights,
    triggerRecalculate,
  });
  return;
}
```

If the existing `handleInsights()` shape makes that awkward, split it into a command-local helper that accepts the lazily loaded functions explicitly.

### 2. Verify tsup output behavior

**File**: `tsup.config.ts` if needed

Start with the smallest possible change. If dynamic import alone is enough, keep config unchanged.

If tsup still bundles everything eagerly:

```pseudo
enable ESM splitting or adjust entry/build settings
verify generated artifacts remain usable as the published CLI bin
```

Do not introduce a second public CLI command or binary unless dynamic import plus tsup config cannot achieve the goal.

### 3. Verify behavior, not just code shape

Inspect the build output after the change.

```pseudo
pnpm run build
inspect dist artifact names / chunking
confirm insights parser code is no longer loaded on startup path for merge/login
```

Acceptable outcomes:

- separate chunk for `insights`, or
- preserved runtime dynamic import boundary that avoids eager evaluation

Unacceptable outcome:

- same eager path with no measurable or structural change

## Tests

### `src/index.test.ts`

Add or update tests to verify:

```pseudo
it("does not import insights module for login command")
it("does not import insights module for merge command")
it("loads insights module when insights command runs")
```

The tests can use a mocked dynamic import seam or a refactored injectable loader if direct module import assertions are awkward.

## Success Criteria

### Automated

- `src/index.ts` no longer eagerly imports `src/insights.ts`.
- `pnpm run build` passes.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

### Manual

- `chapa login` and `chapa merge` behave exactly as before from the user’s perspective.
- `chapa insights --file ...` still parses and uploads successfully.
- Build inspection confirms the `insights` path is no longer eagerly loaded for non-insights commands.
