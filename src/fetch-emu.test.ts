import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEmuStats } from "./fetch-emu";

// Mock global fetch
const mockFetch = vi.fn();

describe("fetchEmuStats", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns StatsData on successful GraphQL response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          user: {
            login: "Juan_corp",
            name: "Juan Corp",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 42,
                weeks: [
                  {
                    contributionDays: [
                      { date: "2025-01-01", contributionCount: 5 },
                      { date: "2025-01-02", contributionCount: 0 },
                    ],
                  },
                ],
              },
              pullRequestContributions: {
                totalCount: 3,
                nodes: [
                  {
                    pullRequest: {
                      additions: 100,
                      deletions: 50,
                      changedFiles: 3,
                      merged: true,
                    },
                  },
                  {
                    pullRequest: {
                      additions: 20,
                      deletions: 5,
                      changedFiles: 1,
                      merged: false,
                    },
                  },
                ],
              },
              pullRequestReviewContributions: { totalCount: 5 },
              issueContributions: { totalCount: 2 },
            },
            repositories: {
              totalCount: 3,
              nodes: [
                {
                  nameWithOwner: "org/repo1",
                  defaultBranchRef: {
                    target: { history: { totalCount: 30 } },
                  },
                },
                {
                  nameWithOwner: "org/repo2",
                  defaultBranchRef: {
                    target: { history: { totalCount: 10 } },
                  },
                },
              ],
            },
            ownedRepos: { nodes: [{ stargazerCount: 25, forkCount: 5, watchers: { totalCount: 10 } }] },
          },
        },
      }),
    });

    const result = await fetchEmuStats("Juan_corp", "ghp_emu_token");
    expect(result).not.toBeNull();
    expect(result!.handle).toBe("Juan_corp");
    expect(result!.commitsTotal).toBe(42);
    expect(result!.prsMergedCount).toBe(1); // only merged
    expect(result!.reviewsSubmittedCount).toBe(5);
    expect(result!.issuesClosedCount).toBe(2);
    expect(result!.reposContributed).toBe(2);
    expect(result!.heatmapData).toHaveLength(2);
    expect(result!.activeDays).toBe(1); // only Jan 1 has count > 0
  });

  it("sends Authorization header with EMU token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: null } }),
    });

    await fetchEmuStats("corp_user", "ghp_test_token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_test_token",
        }),
      }),
    );
  });

  it("returns null when API returns HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const result = await fetchEmuStats("corp_user", "bad_token");
    expect(result).toBeNull();
  });

  it("returns null when user is not found", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: null } }),
    });

    const result = await fetchEmuStats("nonexistent_user", "ghp_token");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).toBeNull();
  });

  it("logs GraphQL errors when present alongside valid data", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const graphqlErrors = [{ message: "Could not resolve to a User", type: "NOT_FOUND" }];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: graphqlErrors,
        data: {
          user: {
            login: "corp_user",
            name: null,
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 10,
                weeks: [],
              },
              pullRequestContributions: {
                totalCount: 0,
                nodes: [],
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }),
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[cli] GraphQL errors"),
      graphqlErrors,
    );

    errorSpy.mockRestore();
  });

  it("filters out null PR nodes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          user: {
            login: "corp_user",
            name: null,
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 10,
                weeks: [],
              },
              pullRequestContributions: {
                totalCount: 2,
                nodes: [
                  null,
                  { pullRequest: null },
                  {
                    pullRequest: {
                      additions: 10,
                      deletions: 5,
                      changedFiles: 1,
                      merged: true,
                    },
                  },
                ],
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }),
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).not.toBeNull();
    expect(result!.prsMergedCount).toBe(1);
  });
});
