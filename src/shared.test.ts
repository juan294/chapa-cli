import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computePrWeight,
  buildStatsFromRaw,
  CONTRIBUTION_QUERY,
  SCORING_WINDOW_DAYS,
  PR_WEIGHT_AGG_CAP,
  type RawContributionData,
} from "./shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid RawContributionData with sensible defaults. */
function makeRawData(
  overrides: Partial<RawContributionData> = {},
): RawContributionData {
  return {
    login: "testuser",
    name: "Test User",
    avatarUrl: "https://example.com/avatar.png",
    contributionCalendar: {
      totalContributions: 0,
      weeks: [],
    },
    pullRequests: {
      totalCount: 0,
      nodes: [],
    },
    reviews: { totalCount: 0 },
    issues: { totalCount: 0 },
    repositories: {
      totalCount: 0,
      nodes: [],
    },
    ownedRepoStars: {
      nodes: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SCORING_WINDOW_DAYS is 365", () => {
    expect(SCORING_WINDOW_DAYS).toBe(365);
  });

  it("PR_WEIGHT_AGG_CAP is 120", () => {
    expect(PR_WEIGHT_AGG_CAP).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// computePrWeight
// ---------------------------------------------------------------------------

describe("computePrWeight", () => {
  it("returns a minimum weight of 0.5 for a PR with zero changes", () => {
    const weight = computePrWeight({ additions: 0, deletions: 0, changedFiles: 0 });
    expect(weight).toBe(0.5);
  });

  it("returns a value greater than 0.5 for a non-trivial PR", () => {
    const weight = computePrWeight({ additions: 50, deletions: 10, changedFiles: 3 });
    expect(weight).toBeGreaterThan(0.5);
  });

  it("produces a higher weight for larger PRs", () => {
    const small = computePrWeight({ additions: 10, deletions: 5, changedFiles: 1 });
    const large = computePrWeight({ additions: 500, deletions: 200, changedFiles: 20 });
    expect(large).toBeGreaterThan(small);
  });

  it("caps weight at 3.0", () => {
    const weight = computePrWeight({
      additions: 100_000,
      deletions: 100_000,
      changedFiles: 5000,
    });
    expect(weight).toBe(3.0);
  });

  it("weights are affected by changedFiles independently of line counts", () => {
    const fewFiles = computePrWeight({ additions: 100, deletions: 50, changedFiles: 1 });
    const manyFiles = computePrWeight({ additions: 100, deletions: 50, changedFiles: 50 });
    expect(manyFiles).toBeGreaterThan(fewFiles);
  });

  it("handles zero additions with non-zero deletions", () => {
    const weight = computePrWeight({ additions: 0, deletions: 100, changedFiles: 5 });
    expect(weight).toBeGreaterThan(0.5);
    expect(weight).toBeLessThanOrEqual(3.0);
  });

  it("handles zero deletions with non-zero additions", () => {
    const weight = computePrWeight({ additions: 200, deletions: 0, changedFiles: 3 });
    expect(weight).toBeGreaterThan(0.5);
    expect(weight).toBeLessThanOrEqual(3.0);
  });

  it("produces deterministic output for the same input", () => {
    const input = { additions: 42, deletions: 17, changedFiles: 4 };
    const w1 = computePrWeight(input);
    const w2 = computePrWeight(input);
    expect(w1).toBe(w2);
  });

  it("matches the expected formula for a known input", () => {
    // Formula: min(0.5 + 0.25*ln(1+changedFiles) + 0.25*ln(1+additions+deletions), 3.0)
    const pr = { additions: 100, deletions: 50, changedFiles: 3 };
    const expected =
      0.5 +
      0.25 * Math.log(1 + 3) +
      0.25 * Math.log(1 + 100 + 50);
    expect(computePrWeight(pr)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// buildStatsFromRaw
// ---------------------------------------------------------------------------

describe("buildStatsFromRaw", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns correct handle and display name", () => {
    const stats = buildStatsFromRaw(
      makeRawData({ login: "myuser", name: "My Name" }),
    );
    expect(stats.handle).toBe("myuser");
    expect(stats.displayName).toBe("My Name");
  });

  it("sets displayName to undefined when name is null", () => {
    const stats = buildStatsFromRaw(makeRawData({ name: null }));
    expect(stats.displayName).toBeUndefined();
  });

  it("sets avatarUrl from raw data", () => {
    const stats = buildStatsFromRaw(
      makeRawData({ avatarUrl: "https://img.example.com/pic.jpg" }),
    );
    expect(stats.avatarUrl).toBe("https://img.example.com/pic.jpg");
  });

  it("includes a fetchedAt ISO timestamp", () => {
    const before = new Date().toISOString();
    const stats = buildStatsFromRaw(makeRawData());
    const after = new Date().toISOString();

    expect(stats.fetchedAt).toBeDefined();
    // fetchedAt should be between before and after
    expect(stats.fetchedAt >= before).toBe(true);
    expect(stats.fetchedAt <= after).toBe(true);
  });

  // --- Empty input ---

  it("handles empty input (no repos, no PRs, no contributions)", () => {
    const stats = buildStatsFromRaw(makeRawData());

    expect(stats.commitsTotal).toBe(0);
    expect(stats.activeDays).toBe(0);
    expect(stats.prsMergedCount).toBe(0);
    expect(stats.prsMergedWeight).toBe(0);
    expect(stats.reviewsSubmittedCount).toBe(0);
    expect(stats.issuesClosedCount).toBe(0);
    expect(stats.linesAdded).toBe(0);
    expect(stats.linesDeleted).toBe(0);
    expect(stats.reposContributed).toBe(0);
    expect(stats.topRepoShare).toBe(0);
    expect(stats.maxCommitsIn10Min).toBe(0);
    expect(stats.totalStars).toBe(0);
    expect(stats.totalForks).toBe(0);
    expect(stats.totalWatchers).toBe(0);
    expect(stats.heatmapData).toEqual([]);
  });

  // --- Heatmap flattening ---

  it("flattens heatmap weeks into a flat HeatmapDay array", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 15,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 5 },
              { date: "2025-01-02", contributionCount: 3 },
            ],
          },
          {
            contributionDays: [
              { date: "2025-01-08", contributionCount: 7 },
            ],
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);

    expect(stats.heatmapData).toEqual([
      { date: "2025-01-01", count: 5 },
      { date: "2025-01-02", count: 3 },
      { date: "2025-01-08", count: 7 },
    ]);
  });

  // --- Active days ---

  it("counts active days correctly (days with count > 0)", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 10,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 5 },
              { date: "2025-01-02", contributionCount: 0 },
              { date: "2025-01-03", contributionCount: 3 },
              { date: "2025-01-04", contributionCount: 0 },
              { date: "2025-01-05", contributionCount: 2 },
            ],
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.activeDays).toBe(3);
  });

  // --- Commits total ---

  it("uses totalContributions from the contribution calendar", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 142,
        weeks: [],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.commitsTotal).toBe(142);
  });

  // --- PR filtering and aggregation ---

  it("only counts merged PRs", () => {
    const raw = makeRawData({
      pullRequests: {
        totalCount: 4,
        nodes: [
          { additions: 10, deletions: 5, changedFiles: 1, merged: true },
          { additions: 20, deletions: 10, changedFiles: 2, merged: false },
          { additions: 30, deletions: 15, changedFiles: 3, merged: true },
          { additions: 5, deletions: 2, changedFiles: 1, merged: false },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.prsMergedCount).toBe(2);
  });

  it("computes prsMergedWeight as the sum of weights for merged PRs", () => {
    const mergedPr1 = { additions: 10, deletions: 5, changedFiles: 1, merged: true };
    const mergedPr2 = { additions: 30, deletions: 15, changedFiles: 3, merged: true };
    const raw = makeRawData({
      pullRequests: {
        totalCount: 3,
        nodes: [
          mergedPr1,
          { additions: 20, deletions: 10, changedFiles: 2, merged: false },
          mergedPr2,
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);

    const expectedWeight =
      computePrWeight(mergedPr1) + computePrWeight(mergedPr2);
    expect(stats.prsMergedWeight).toBeCloseTo(expectedWeight, 10);
  });

  it("caps prsMergedWeight at PR_WEIGHT_AGG_CAP", () => {
    // Create many large merged PRs to exceed the cap
    const largePr = { additions: 10000, deletions: 5000, changedFiles: 100, merged: true };
    const nodes = Array.from({ length: 100 }, () => ({ ...largePr }));
    const raw = makeRawData({
      pullRequests: {
        totalCount: 100,
        nodes,
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.prsMergedWeight).toBe(PR_WEIGHT_AGG_CAP);
  });

  // --- Lines added/deleted ---

  it("sums lines added and deleted from merged PRs only", () => {
    const raw = makeRawData({
      pullRequests: {
        totalCount: 3,
        nodes: [
          { additions: 100, deletions: 50, changedFiles: 5, merged: true },
          { additions: 999, deletions: 888, changedFiles: 10, merged: false }, // excluded
          { additions: 200, deletions: 75, changedFiles: 3, merged: true },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.linesAdded).toBe(300); // 100 + 200
    expect(stats.linesDeleted).toBe(125); // 50 + 75
  });

  // --- Reviews and issues ---

  it("reads reviews and issues counts directly from raw data", () => {
    const raw = makeRawData({
      reviews: { totalCount: 17 },
      issues: { totalCount: 9 },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.reviewsSubmittedCount).toBe(17);
    expect(stats.issuesClosedCount).toBe(9);
  });

  // --- Repos contributed ---

  it("counts repos with non-zero commits in the period", () => {
    const raw = makeRawData({
      repositories: {
        totalCount: 4,
        nodes: [
          {
            nameWithOwner: "org/active-repo",
            defaultBranchRef: { target: { history: { totalCount: 20 } } },
          },
          {
            nameWithOwner: "org/inactive-repo",
            defaultBranchRef: { target: { history: { totalCount: 0 } } },
          },
          {
            nameWithOwner: "org/another-active",
            defaultBranchRef: { target: { history: { totalCount: 5 } } },
          },
          {
            nameWithOwner: "org/no-default-branch",
            defaultBranchRef: null,
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.reposContributed).toBe(2);
  });

  it("handles repos with null defaultBranchRef as zero commits", () => {
    const raw = makeRawData({
      repositories: {
        totalCount: 1,
        nodes: [
          { nameWithOwner: "org/empty-repo", defaultBranchRef: null },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.reposContributed).toBe(0);
  });

  // --- Top repo share ---

  it("computes topRepoShare as the fraction of commits in the most active repo", () => {
    const raw = makeRawData({
      repositories: {
        totalCount: 3,
        nodes: [
          {
            nameWithOwner: "org/top",
            defaultBranchRef: { target: { history: { totalCount: 60 } } },
          },
          {
            nameWithOwner: "org/mid",
            defaultBranchRef: { target: { history: { totalCount: 30 } } },
          },
          {
            nameWithOwner: "org/low",
            defaultBranchRef: { target: { history: { totalCount: 10 } } },
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    // topRepoShare = 60 / (60 + 30 + 10) = 0.6
    expect(stats.topRepoShare).toBe(0.6);
  });

  it("returns topRepoShare of 0 when no repos have commits", () => {
    const raw = makeRawData({
      repositories: {
        totalCount: 2,
        nodes: [
          {
            nameWithOwner: "org/a",
            defaultBranchRef: { target: { history: { totalCount: 0 } } },
          },
          {
            nameWithOwner: "org/b",
            defaultBranchRef: null,
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.topRepoShare).toBe(0);
  });

  it("returns topRepoShare of 1.0 when only one repo has commits", () => {
    const raw = makeRawData({
      repositories: {
        totalCount: 2,
        nodes: [
          {
            nameWithOwner: "org/only-active",
            defaultBranchRef: { target: { history: { totalCount: 25 } } },
          },
          {
            nameWithOwner: "org/inactive",
            defaultBranchRef: { target: { history: { totalCount: 0 } } },
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.topRepoShare).toBe(1.0);
  });

  // --- maxCommitsIn10Min ---

  it("sets maxCommitsIn10Min to maxDailyCount when >= 30", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 50,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 35 },
              { date: "2025-01-02", contributionCount: 10 },
            ],
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.maxCommitsIn10Min).toBe(35);
  });

  it("sets maxCommitsIn10Min to 0 when all daily counts are below 30", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 50,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 29 },
              { date: "2025-01-02", contributionCount: 15 },
            ],
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.maxCommitsIn10Min).toBe(0);
  });

  it("sets maxCommitsIn10Min to 30 when exactly 30 contributions in a day", () => {
    const raw = makeRawData({
      contributionCalendar: {
        totalContributions: 30,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 30 },
            ],
          },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.maxCommitsIn10Min).toBe(30);
  });

  // --- Stars, forks, watchers ---

  it("sums stars, forks, and watchers across owned repos", () => {
    const raw = makeRawData({
      ownedRepoStars: {
        nodes: [
          { stargazerCount: 100, forkCount: 20, watchers: { totalCount: 50 } },
          { stargazerCount: 50, forkCount: 10, watchers: { totalCount: 25 } },
          { stargazerCount: 5, forkCount: 1, watchers: { totalCount: 3 } },
        ],
      },
    });
    const stats = buildStatsFromRaw(raw);
    expect(stats.totalStars).toBe(155);
    expect(stats.totalForks).toBe(31);
    expect(stats.totalWatchers).toBe(78);
  });

  // --- Full integration scenario ---

  it("produces correct stats for a realistic full input", () => {
    const raw = makeRawData({
      login: "juan294",
      name: "Juan",
      avatarUrl: "https://example.com/juan.png",
      contributionCalendar: {
        totalContributions: 250,
        weeks: [
          {
            contributionDays: [
              { date: "2025-01-01", contributionCount: 8 },
              { date: "2025-01-02", contributionCount: 0 },
              { date: "2025-01-03", contributionCount: 12 },
            ],
          },
          {
            contributionDays: [
              { date: "2025-01-08", contributionCount: 0 },
              { date: "2025-01-09", contributionCount: 3 },
            ],
          },
        ],
      },
      pullRequests: {
        totalCount: 5,
        nodes: [
          { additions: 100, deletions: 50, changedFiles: 5, merged: true },
          { additions: 20, deletions: 10, changedFiles: 2, merged: true },
          { additions: 500, deletions: 100, changedFiles: 15, merged: false },
          { additions: 30, deletions: 5, changedFiles: 1, merged: true },
        ],
      },
      reviews: { totalCount: 12 },
      issues: { totalCount: 4 },
      repositories: {
        totalCount: 3,
        nodes: [
          {
            nameWithOwner: "org/main-repo",
            defaultBranchRef: { target: { history: { totalCount: 80 } } },
          },
          {
            nameWithOwner: "org/side-project",
            defaultBranchRef: { target: { history: { totalCount: 20 } } },
          },
          {
            nameWithOwner: "org/archived",
            defaultBranchRef: { target: { history: { totalCount: 0 } } },
          },
        ],
      },
      ownedRepoStars: {
        nodes: [
          { stargazerCount: 50, forkCount: 8, watchers: { totalCount: 20 } },
          { stargazerCount: 10, forkCount: 2, watchers: { totalCount: 5 } },
        ],
      },
    });

    const stats = buildStatsFromRaw(raw);

    expect(stats.handle).toBe("juan294");
    expect(stats.displayName).toBe("Juan");
    expect(stats.avatarUrl).toBe("https://example.com/juan.png");
    expect(stats.commitsTotal).toBe(250);
    expect(stats.activeDays).toBe(3); // Jan 1, 3, 9
    expect(stats.prsMergedCount).toBe(3); // 3 merged out of 4 nodes
    expect(stats.prsMergedWeight).toBeGreaterThan(0);
    expect(stats.prsMergedWeight).toBeLessThanOrEqual(PR_WEIGHT_AGG_CAP);
    expect(stats.reviewsSubmittedCount).toBe(12);
    expect(stats.issuesClosedCount).toBe(4);
    expect(stats.linesAdded).toBe(150); // 100 + 20 + 30
    expect(stats.linesDeleted).toBe(65); // 50 + 10 + 5
    expect(stats.reposContributed).toBe(2); // main-repo + side-project
    expect(stats.topRepoShare).toBe(0.8); // 80 / 100
    expect(stats.maxCommitsIn10Min).toBe(0); // max daily is 12, below 30
    expect(stats.totalStars).toBe(60);
    expect(stats.totalForks).toBe(10);
    expect(stats.totalWatchers).toBe(25);
    expect(stats.heatmapData).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// CONTRIBUTION_QUERY
// ---------------------------------------------------------------------------

describe("CONTRIBUTION_QUERY", () => {
  it("is a non-empty string", () => {
    expect(typeof CONTRIBUTION_QUERY).toBe("string");
    expect(CONTRIBUTION_QUERY.length).toBeGreaterThan(0);
  });

  it("contains the required GraphQL variables", () => {
    expect(CONTRIBUTION_QUERY).toContain("$login: String!");
    expect(CONTRIBUTION_QUERY).toContain("$since: DateTime!");
    expect(CONTRIBUTION_QUERY).toContain("$until: DateTime!");
    expect(CONTRIBUTION_QUERY).toContain("$historySince: GitTimestamp!");
    expect(CONTRIBUTION_QUERY).toContain("$historyUntil: GitTimestamp!");
  });

  it("queries user by login", () => {
    expect(CONTRIBUTION_QUERY).toContain("user(login: $login)");
  });

  it("requests contribution calendar data", () => {
    expect(CONTRIBUTION_QUERY).toContain("contributionCalendar");
    expect(CONTRIBUTION_QUERY).toContain("totalContributions");
    expect(CONTRIBUTION_QUERY).toContain("contributionDays");
    expect(CONTRIBUTION_QUERY).toContain("contributionCount");
  });

  it("requests pull request contribution data", () => {
    expect(CONTRIBUTION_QUERY).toContain("pullRequestContributions");
    expect(CONTRIBUTION_QUERY).toContain("additions");
    expect(CONTRIBUTION_QUERY).toContain("deletions");
    expect(CONTRIBUTION_QUERY).toContain("changedFiles");
    expect(CONTRIBUTION_QUERY).toContain("merged");
  });

  it("requests review and issue contribution counts", () => {
    expect(CONTRIBUTION_QUERY).toContain("pullRequestReviewContributions");
    expect(CONTRIBUTION_QUERY).toContain("issueContributions");
  });

  it("requests repository data with commit history", () => {
    expect(CONTRIBUTION_QUERY).toContain("repositories");
    expect(CONTRIBUTION_QUERY).toContain("nameWithOwner");
    expect(CONTRIBUTION_QUERY).toContain("defaultBranchRef");
    expect(CONTRIBUTION_QUERY).toContain("history");
  });

  it("requests owned repo star/fork/watcher data", () => {
    expect(CONTRIBUTION_QUERY).toContain("stargazerCount");
    expect(CONTRIBUTION_QUERY).toContain("forkCount");
    expect(CONTRIBUTION_QUERY).toContain("watchers");
  });
});
