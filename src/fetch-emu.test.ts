import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEmuStats } from "./fetch-emu";

// Mock global fetch
const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchEmuStats", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns StatsData on successful GraphQL response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
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
    }));

    const result = await fetchEmuStats("Juan_corp", "ghp_emu_token");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.stats.handle).toBe("Juan_corp");
    expect(result.stats.commitsTotal).toBe(42);
    expect(result.stats.prsMergedCount).toBe(1); // only merged
    expect(result.stats.reviewsSubmittedCount).toBe(5);
    expect(result.stats.issuesClosedCount).toBe(2);
    expect(result.stats.reposContributed).toBe(2);
    expect(result.stats.heatmapData).toHaveLength(2);
    expect(result.stats.activeDays).toBe(1); // only Jan 1 has count > 0
  });

  it("sends Authorization header with EMU token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { user: null } }));

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
    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 401: Unauthorized",
      errorCategory: "auth",
    });
  });

  it("returns null when user is not found", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { user: null } }));

    const result = await fetchEmuStats("nonexistent_user", "ghp_token");
    expect(result).toEqual({
      ok: false,
      error: "GitHub user not found or inaccessible",
      errorCategory: "unknown",
    });
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).toEqual({
      ok: false,
      error: "Network error",
      errorCategory: "network",
    });
  });

  it("logs only error .message when fetch throws, not the full error object (#8)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sensitiveError = new Error("Network error");
    // Simulate an error object that could contain a token in its properties
    (sensitiveError as unknown as Record<string, unknown>).config = {
      headers: { Authorization: "Bearer ghp_secret_token_123" },
    };

    mockFetch.mockRejectedValue(sensitiveError);

    await fetchEmuStats("corp_user", "ghp_token");

    // Should log only the message string, not the full error object
    expect(errorSpy).toHaveBeenCalledWith(
      "[cli] fetch error: Network error",
    );
    // Ensure the full error object (which could contain tokens) is NOT logged
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      sensitiveError,
    );

    errorSpy.mockRestore();
  });

  it("truncates long HTTP error response bodies to 200 characters (#9)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const longBody = "x".repeat(500);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => longBody,
    });

    await fetchEmuStats("corp_user", "ghp_token");

    const loggedMessage = errorSpy.mock.calls[0]![0] as string;
    // The logged body should be truncated — total message should contain at most 200 chars of body
    expect(loggedMessage).toContain("x".repeat(200));
    expect(loggedMessage).not.toContain("x".repeat(201));

    errorSpy.mockRestore();
  });

  it("does not truncate short HTTP error response bodies (#9)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const shortBody = "Unauthorized";

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => shortBody,
    });

    await fetchEmuStats("corp_user", "ghp_token");

    expect(errorSpy).toHaveBeenCalledWith(
      `[cli] GraphQL HTTP 401: ${shortBody}`,
    );

    errorSpy.mockRestore();
  });

  it("logs GraphQL errors when present alongside valid data", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const graphqlErrors = [{ message: "Could not resolve to a User", type: "NOT_FOUND" }];

    mockFetch.mockResolvedValue(jsonResponse({
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
    }));

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result.ok).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[cli] GraphQL errors for corp_user:"),
    );
    // Errors are logged as a stringified (and potentially truncated) representation
    const loggedMessage = errorSpy.mock.calls[0]![0] as string;
    expect(loggedMessage).toContain("Could not resolve to a User");

    errorSpy.mockRestore();
  });

  it("truncates long GraphQL error arrays when logging (#9)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Create a very long error array that will exceed 200 chars when stringified
    const longErrors = Array.from({ length: 50 }, (_, i) => ({
      message: `Error message number ${i} with some additional padding text`,
      type: "SOME_ERROR",
    }));

    mockFetch.mockResolvedValue(jsonResponse({
        errors: longErrors,
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
    }));

    await fetchEmuStats("corp_user", "ghp_token");

    const loggedMessage = errorSpy.mock.calls[0]![0] as string;
    // The prefix is "[cli] GraphQL errors for corp_user: " which is ~37 chars
    // The body portion (after the prefix) should be at most 200 chars + "..."
    const bodyPart = loggedMessage.replace("[cli] GraphQL errors for corp_user: ", "");
    expect(bodyPart.length).toBeLessThanOrEqual(203); // 200 + "..."

    errorSpy.mockRestore();
  });

  it("does not double-log errors when logger is provided", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn().mockReturnValue(0),
      getTimings: vi.fn().mockReturnValue({}),
    };

    mockFetch.mockRejectedValue(new Error("fetch failed"));

    await fetchEmuStats("corp_user", "ghp_token", { logger: mockLogger });

    // Logger should receive the error
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith("[cli] fetch error: fetch failed");
    // console.error should NOT be called — logger handles it
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("does not double-log HTTP errors when logger is provided", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn().mockReturnValue(0),
      getTimings: vi.fn().mockReturnValue({}),
    };

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await fetchEmuStats("corp_user", "bad_token", { logger: mockLogger });

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("includes error.cause in message for better debugging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rootCause = new Error("ECONNREFUSED 140.82.121.3:443");
    const fetchError = new Error("fetch failed", { cause: rootCause });

    mockFetch.mockRejectedValue(fetchError);

    await fetchEmuStats("corp_user", "ghp_token");

    const logged = errorSpy.mock.calls[0]![0] as string;
    expect(logged).toContain("fetch failed");
    expect(logged).toContain("ECONNREFUSED");

    errorSpy.mockRestore();
  });

  it("falls back gracefully when res.text() rejects on HTTP error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => { throw new Error("body stream exhausted"); },
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 500: (unreadable)",
      errorCategory: "server",
    });

    // Should still log something meaningful despite text() failing
    const logged = errorSpy.mock.calls[0]![0] as string;
    expect(logged).toContain("500");
    expect(logged).toContain("(unreadable)");

    errorSpy.mockRestore();
  });

  it("filters out null PR nodes", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
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
    }));

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.stats.prsMergedCount).toBe(1);
  });

  it("aggregates pull request contributions across multiple GraphQL pages", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 101,
                weeks: [],
              },
              pullRequestContributions: {
                totalCount: 101,
                nodes: Array.from({ length: 100 }, () => ({
                  pullRequest: {
                    additions: 1,
                    deletions: 0,
                    changedFiles: 1,
                    merged: true,
                  },
                })),
                pageInfo: {
                  hasNextPage: true,
                  endCursor: "cursor-100",
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 101,
                weeks: [],
              },
              pullRequestContributions: {
                totalCount: 101,
                nodes: [
                  {
                    pullRequest: {
                      additions: 50,
                      deletions: 5,
                      changedFiles: 2,
                      merged: true,
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: "cursor-101",
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }));

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.stats.prsMergedCount).toBe(101);
    expect(result.stats.linesAdded).toBe(150);
    expect(result.stats.linesDeleted).toBe(5);

    const secondRequest = mockFetch.mock.calls[1]?.[1];
    expect(secondRequest).toBeDefined();
    expect(typeof secondRequest?.body).toBe("string");
    const secondRequestBody = JSON.parse(secondRequest!.body as string) as {
      variables: { prCursor?: string | null };
    };
    expect(secondRequestBody.variables.prCursor).toBe("cursor-100");
  });

  it("stops paginating after MAX_PR_PAGES and returns a graphql errorCategory", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Build a response factory that always reports hasNextPage: true
    const makePageResponse = (cursor: string) =>
      jsonResponse({
        data: {
          user: {
            login: "runaway",
            name: null,
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 0, weeks: [] },
              pullRequestContributions: {
                totalCount: 0,
                nodes: [],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: cursor,
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      });

    // mockFetch always returns hasNextPage: true with a rotating cursor
    mockFetch.mockImplementation((_, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { variables: { prCursor?: string | null } };
      const cursor = body.variables.prCursor ?? "cursor-0";
      const nextCursor = `cursor-next-${cursor}`;
      return Promise.resolve(makePageResponse(nextCursor));
    });

    const result = await fetchEmuStats("runaway", "ghp_token");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errorCategory).toBe("graphql");
    expect(result.error).toMatch(/exceeded/i);
    // 1 initial request + 50 pagination requests = 51 total
    expect(mockFetch).toHaveBeenCalledTimes(51);

    errorSpy.mockRestore();
  });

  it("does not silently truncate weight/line metrics when totalCount > 100 (#92)", async () => {
    // Regression: before pagination, users with >100 PRs got understated badge metrics
    // because weight, linesAdded, and linesDeleted were only computed from the ≤100 nodes
    // returned by the first page. This test uses totalCount:150 to represent such a user.
    const page1Nodes = Array.from({ length: 100 }, () => ({
      pullRequest: { additions: 10, deletions: 5, changedFiles: 1, merged: true },
    }));
    const page2Nodes = Array.from({ length: 50 }, () => ({
      pullRequest: { additions: 20, deletions: 8, changedFiles: 2, merged: true },
    }));

    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "heavy_user",
            name: "Heavy User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 150, weeks: [] },
              pullRequestContributions: {
                totalCount: 150,
                nodes: page1Nodes,
                pageInfo: { hasNextPage: true, endCursor: "cursor-page-1" },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "heavy_user",
            name: "Heavy User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 150, weeks: [] },
              pullRequestContributions: {
                totalCount: 150,
                nodes: page2Nodes,
                pageInfo: { hasNextPage: false, endCursor: "cursor-page-2" },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }));

    const result = await fetchEmuStats("heavy_user", "ghp_token");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    // All 150 merged PRs must be reflected in the metrics
    expect(result.stats.prsMergedCount).toBe(150);

    // linesAdded: page1 → 100*10=1000, page2 → 50*20=1000, total=2000
    expect(result.stats.linesAdded).toBe(2000);
    // linesDeleted: page1 → 100*5=500, page2 → 50*8=400, total=900
    expect(result.stats.linesDeleted).toBe(900);

    // prsMergedWeight must be capped at PR_WEIGHT_AGG_CAP but should have been
    // contributed to by all 150 PRs — assert it is the cap (120) given the volume
    expect(result.stats.prsMergedWeight).toBe(120);

    // Cursor from page 1 must be forwarded to page 2
    const page2Body = JSON.parse(mockFetch.mock.calls[1]![1]!.body as string) as {
      variables: { prCursor?: string | null };
    };
    expect(page2Body.variables.prCursor).toBe("cursor-page-1");
  });

  it("maps timeout failures into a stable error path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    mockFetch.mockRejectedValue(timeoutError);

    const result = await fetchEmuStats("corp_user", "ghp_token");
    expect(result).toEqual({
      ok: false,
      error: "Request timed out after 30000ms",
      errorCategory: "network",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[cli] fetch error: Request timed out after 30000ms",
    );

    errorSpy.mockRestore();
  });

  it("maps parse failures into the graphql error category", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{",
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "Invalid JSON response",
      errorCategory: "graphql",
    });
  });

  it("maps HTTP 403 failures into the auth error category", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 403: Forbidden",
      errorCategory: "auth",
    });
  });

  it("formats JSON HTTP error bodies when plain text is unavailable", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Bad query" }, 400));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 400: {\"error\":\"Bad query\"}",
      errorCategory: "graphql",
    });
  });

  it("returns a pagination error when another page is advertised without an endCursor", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockResolvedValue(jsonResponse({
      data: {
        user: {
          login: "corp_user",
          name: null,
          avatarUrl: "https://example.com/avatar.png",
          contributionsCollection: {
            contributionCalendar: { totalContributions: 0, weeks: [] },
            pullRequestContributions: {
              totalCount: 0,
              nodes: [],
              pageInfo: {
                hasNextPage: true,
                endCursor: null,
              },
            },
            pullRequestReviewContributions: { totalCount: 0 },
            issueContributions: { totalCount: 0 },
          },
          repositories: { totalCount: 0, nodes: [] },
        },
      },
    }));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GraphQL pagination error: missing endCursor",
      errorCategory: "graphql",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[cli] GraphQL pagination error for corp_user: missing endCursor",
    );
    errorSpy.mockRestore();
  });

  it("returns the second-page transport failure immediately", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 1, weeks: [] },
              pullRequestContributions: {
                totalCount: 1,
                nodes: [],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: "cursor-1",
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }))
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "Bad gateway",
      });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 502: Bad gateway",
      errorCategory: "server",
    });
  });

  it("returns a graphql error when a paginated response loses the user object", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 1, weeks: [] },
              pullRequestContributions: {
                totalCount: 1,
                nodes: [],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: "cursor-1",
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        errors: [{ message: "No longer visible" }],
        data: { user: null },
      }));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GitHub user not found or inaccessible",
      errorCategory: "graphql",
    });
  });

  it("uses default pagination info when a follow-up page omits it", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 2, weeks: [] },
              pullRequestContributions: {
                totalCount: 2,
                nodes: [],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: "cursor-1",
                },
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
            ownedRepos: { nodes: [] },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            login: "corp_user",
            name: "Corp User",
            avatarUrl: "https://example.com/avatar.png",
            contributionsCollection: {
              contributionCalendar: { totalContributions: 2, weeks: [] },
              pullRequestContributions: {
                totalCount: 2,
                nodes: [{
                  pullRequest: {
                    additions: 5,
                    deletions: 1,
                    changedFiles: 1,
                    merged: true,
                  },
                }],
              },
              pullRequestReviewContributions: { totalCount: 0 },
              issueContributions: { totalCount: 0 },
            },
            repositories: { totalCount: 0, nodes: [] },
          },
        },
      }));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.stats.prsMergedCount).toBe(1);
  });

  it("handles missing ownedRepos by defaulting to an empty array", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      data: {
        user: {
          login: "corp_user",
          name: null,
          avatarUrl: "https://example.com/avatar.png",
          contributionsCollection: {
            contributionCalendar: { totalContributions: 0, weeks: [] },
            pullRequestContributions: {
              totalCount: 0,
              nodes: [],
            },
            pullRequestReviewContributions: { totalCount: 0 },
            issueContributions: { totalCount: 0 },
          },
          repositories: { totalCount: 0, nodes: [] },
        },
      },
    }));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.stats.totalStars).toBe(0);
    expect(result.stats.totalForks).toBe(0);
    expect(result.stats.totalWatchers).toBe(0);
  });
});
