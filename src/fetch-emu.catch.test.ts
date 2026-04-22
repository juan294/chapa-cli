import { afterEach, describe, expect, it, vi } from "vitest";

const mockRequestJson = vi.hoisted(() => vi.fn());

vi.mock("./http.js", () => ({
  requestJson: mockRequestJson,
}));

import { fetchEmuStats } from "./fetch-emu.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchEmuStats catch-only paths", () => {
  it("returns Unknown error when an http failure has no text or body", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: false,
      category: "http",
      status: 400,
      message: "HTTP 400",
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GraphQL HTTP 400: Unknown error",
      errorCategory: "graphql",
    });
  });

  it("marks missing users with top-level GraphQL errors as graphql failures", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        errors: [{ message: "No such user" }],
        data: { user: null },
      },
    });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GitHub user not found or inaccessible",
      errorCategory: "graphql",
    });
  });

  it("marks paginated missing users without GraphQL errors as unknown", async () => {
    mockRequestJson
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          data: {
            user: {
              login: "corp_user",
              name: "Corp User",
              avatarUrl: "https://example.com/avatar.png",
              contributionsCollection: {
                contributionCalendar: { totalContributions: 0, weeks: [] },
                pullRequestContributions: {
                  totalCount: 0,
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
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          data: { user: null },
        },
      });

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "GitHub user not found or inaccessible",
      errorCategory: "unknown",
    });
  });

  it("surfaces unexpected requestJson exceptions through the outer catch path", async () => {
    mockRequestJson.mockRejectedValueOnce(new Error("requestJson exploded"));

    const result = await fetchEmuStats("corp_user", "ghp_token");

    expect(result).toEqual({
      ok: false,
      error: "requestJson exploded",
      errorCategory: "unknown",
    });
  });
});
