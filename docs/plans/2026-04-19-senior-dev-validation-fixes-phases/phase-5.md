# Phase 5: GraphQL PR Pagination Hard Cap

> **Project**: chapa-cli
> **Prerequisite**: None
> **Files modified**: `src/fetch-emu.ts`
> **Tests modified**: `src/fetch-emu.test.ts`
> **Batch**: `[batch-eligible]` with phases 1, 2, 6 (disjoint file set)
> **Status**: Not started

## Objective

Guard the `while (hasNextPage)` loop in `fetchEmuStats` against runaway pagination. The loop currently trusts GitHub's `pageInfo` unconditionally; a buggy proxy or upstream misbehavior could make the CLI hang for minutes per attempt. Add an aggregate page cap and fail fast with a clear error and classifiable telemetry category.

Query splitting (the other half of the original report's item #2) is deferred by the senior dev; do not implement it here.

## Changes

### 1. Add a page-count cap constant

**File**: `src/fetch-emu.ts` (top of file, near `MAX_ERROR_BODY_LENGTH`)

```pseudo
/** Maximum number of GraphQL pullRequestContributions pages to fetch.
 *  Each page returns up to 100 PRs, so this caps total PRs at 5000.
 *  Protects against runaway pagination if upstream pageInfo misbehaves. */
const MAX_PR_PAGES = 50;
```

Rationale for 50:
- 100 PRs/page × 50 = 5 000 PRs in the 365-day window, which exceeds any realistic single-user volume.
- Keeps the upper bound on total requests at 51 (first page + 50 pagination pages) × 30s timeout each = reasonable worst-case even under severe latency.

### 2. Track page count in the loop

**File**: `src/fetch-emu.ts:245-292`

```pseudo
// before (abridged)
let { hasNextPage, endCursor } = cc.pullRequestContributions.pageInfo ?? {
  hasNextPage: false, endCursor: null,
};

while (hasNextPage) {
  if (!endCursor) { ... return pagination error }
  const pageRes = await requestPage(endCursor);
  if (!pageRes.ok) { ... return transport failure }
  ...
  hasNextPage = pageInfo.hasNextPage;
  endCursor = pageInfo.endCursor;
}

// after
let { hasNextPage, endCursor } = cc.pullRequestContributions.pageInfo ?? {
  hasNextPage: false, endCursor: null,
};

let pagesFetched = 0;  // first page already counted as the initial res
while (hasNextPage) {
  if (pagesFetched >= MAX_PR_PAGES) {
    const msg = `[cli] GraphQL pagination exceeded maximum of ${MAX_PR_PAGES} pages for ${login}`;
    logError(log, msg);
    return {
      ok: false,
      error: `GraphQL pagination exceeded ${MAX_PR_PAGES} pages — aborting to avoid runaway requests`,
      errorCategory: "graphql",
    };
  }

  if (!endCursor) { ... unchanged }
  const pageRes = await requestPage(endCursor);
  if (!pageRes.ok) { ... unchanged }

  // ... unchanged body parsing
  prNodes.push(...normalizePullRequestNodes(pageConnection.nodes));
  hasNextPage = pageInfo.hasNextPage;
  endCursor = pageInfo.endCursor;
  pagesFetched++;
}
```

### 3. No change to error telemetry categorization

The returned `errorCategory: "graphql"` already maps to an existing telemetry bucket in `src/telemetry.ts:7` and flows through `handleMerge` unchanged. No telemetry or public-type changes are needed.

## Tests

**File**: `src/fetch-emu.test.ts`

Add cases adjacent to the existing pagination test (`src/fetch-emu.test.ts:440-527`).

### 1. Hits the cap and returns a clear error

```pseudo
it("stops paginating after MAX_PR_PAGES and returns a graphql errorCategory", async () => {
  // Make every page report hasNextPage: true with a rotating cursor.
  mockFetch.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    const cursor = body.variables.prCursor;
    const next = cursor ? `${cursor}-next` : "cursor-0";
    return jsonResponse({
      data: {
        user: {
          login: "runaway",
          name: null,
          avatarUrl: "",
          contributionsCollection: {
            contributionCalendar: { totalContributions: 0, weeks: [] },
            pullRequestContributions: {
              totalCount: 999999,
              nodes: [],                         // empty nodes to keep payload tiny
              pageInfo: { hasNextPage: true, endCursor: next },
            },
            pullRequestReviewContributions: { totalCount: 0 },
            issueContributions: { totalCount: 0 },
          },
          repositories: { totalCount: 0, nodes: [] },
          ownedRepos: { nodes: [] },
        },
      },
    });
  });

  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await fetchEmuStats("runaway", "ghp_token");

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.errorCategory).toBe("graphql");
  expect(result.error).toMatch(/exceeded/i);

  // Exactly 1 initial + MAX_PR_PAGES (= 50) pagination requests = 51 fetch calls.
  // (If the constant changes, update this expectation.)
  expect(mockFetch).toHaveBeenCalledTimes(51);

  errSpy.mockRestore();
});
```

### 2. Does not regress the normal two-page case

Confirm the existing two-page test at `src/fetch-emu.test.ts:440-527` still passes unchanged.

### 3. Boundary: stops right at the cap with no off-by-one

```pseudo
it("accepts exactly MAX_PR_PAGES pagination pages and then errors on the next", async () => {
  // Similar to the runaway test but we can keep existing two-page as the "safe" case,
  // and rely on the 51-call assertion above to pin the boundary.
});
```

(If the constant is changed, update both test expectations.)

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test src/fetch-emu.test.ts` passes including the runaway-cap test.
- The returned failure uses `errorCategory: "graphql"` so existing telemetry continues to bucket correctly.
- Existing two-page pagination test is unchanged.

### Manual

- A reproducible hostile local server that always returns `hasNextPage: true` causes `chapa merge` to fail in ~51 requests with the new error message, instead of hanging forever.
- For real users with <5 000 PRs/year, behavior is unchanged.
