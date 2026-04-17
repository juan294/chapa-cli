import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadSupplementalStats } from "./upload";
import type { StatsData } from "./shared";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeStats(): StatsData {
  return {
    handle: "corp_user",
    commitsTotal: 30,
    activeDays: 10,
    prsMergedCount: 3,
    prsMergedWeight: 5,
    reviewsSubmittedCount: 2,
    issuesClosedCount: 1,
    linesAdded: 500,
    linesDeleted: 200,
    reposContributed: 2,
    topRepoShare: 0.6,
    maxCommitsIn10Min: 3,
    totalStars: 0,
    totalForks: 0,
    totalWatchers: 0,
    heatmapData: [],
    fetchedAt: new Date().toISOString(),
  };
}

describe("uploadSupplementalStats", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST with correct body and auth header", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com/api/supplemental",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer gho_personal",
          "Content-Type": "application/json",
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
    expect(body.targetHandle).toBe("juan294");
    expect(body.sourceHandle).toBe("corp_user");
    expect(body.stats).toEqual(expect.objectContaining({ handle: "corp_user", commitsTotal: 30 }));
  });

  it("returns error message on 401", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Invalid token" }, 401));

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "bad_token",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns error message on 403", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Handle mismatch" }, 403));

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "wrong_user_token",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("403");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("falls back when res.json() rejects on error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "(unreadable)",
    });

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
    // Fallback should produce "Unknown error" since json() failed
    expect(result.error).toContain("Unknown error");
  });

  it("falls back when res.json() rejects on success response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    // Should still succeed — the fallback {} is used for serverResponse
    expect(result.success).toBe(true);
    expect(result.serverResponse).toEqual({});
  });

  it("strips trailing slash from server URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));

    await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com/",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com/api/supplemental",
      expect.anything(),
    );
  });

  it("returns normalized timeout errors", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    mockFetch.mockRejectedValue(timeoutError);

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: makeStats(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Upload failed: Request timed out after 30000ms");
  });
});
