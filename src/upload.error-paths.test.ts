import { afterEach, describe, expect, it, vi } from "vitest";

const mockRequestJson = vi.hoisted(() => vi.fn());
const mockSpawnDetachedPost = vi.hoisted(() => vi.fn());

vi.mock("./http.js", () => ({
  requestJson: mockRequestJson,
}));

vi.mock("./background.js", () => ({
  spawnDetachedPost: mockSpawnDetachedPost,
}));

import { queueRecalculate, triggerRecalculate, uploadInsights } from "./insights.js";
import { uploadSupplementalStats } from "./upload.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("upload catch paths", () => {
  it("surfaces unexpected uploadSupplementalStats exceptions", async () => {
    mockRequestJson.mockRejectedValueOnce(new Error("boom"));

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: {
        handle: "corp_user",
        commitsTotal: 0,
        activeDays: 0,
        prsMergedCount: 0,
        prsMergedWeight: 0,
        reviewsSubmittedCount: 0,
        issuesClosedCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
        reposContributed: 0,
        topRepoShare: 0,
        maxCommitsIn10Min: 0,
        totalStars: 0,
        totalForks: 0,
        totalWatchers: 0,
        heatmapData: [],
        fetchedAt: new Date().toISOString(),
      },
      token: "token",
      serverUrl: "https://example.com",
    });

    expect(result).toEqual({
      success: false,
      error: "Upload failed: boom",
    });
  });

  it("surfaces unexpected uploadInsights exceptions", async () => {
    mockRequestJson.mockRejectedValueOnce(new Error("insights exploded"));

    const result = await uploadInsights({
      data: {
        tool: "claude-code",
        reportPeriod: { start: "2026-01-01", end: "2026-01-02" },
        volume: { messages: 1, linesAdded: 0, linesDeleted: 0, files: 0, days: 1, msgsPerDay: 1 },
        toolUsage: {},
        sessionTypes: {},
        outcomes: { fullyAchieved: 0, mostlyAchieved: 0, partiallyAchieved: 0 },
        friction: { buggyCode: 0, wrongApproach: 0, misunderstoodRequest: 0 },
        satisfaction: { dissatisfied: 0, likelySatisfied: 0, satisfied: 0 },
        multiClauding: { overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 },
        responseTime: { medianSeconds: 0, averageSeconds: 0 },
        toolErrors: {},
        totalSessions: 1,
        totalToolCalls: 0,
      },
      token: "token",
      serverUrl: "https://example.com",
    });

    expect(result).toEqual({
      success: false,
      error: "Upload failed: insights exploded",
    });
  });

  it("logs the triggerRecalculate catch path through the optional logger", async () => {
    const logger = { debug: vi.fn() };
    mockRequestJson.mockRejectedValueOnce(new Error("network down"));

    await triggerRecalculate("https://example.com", "token", logger);

    expect(logger.debug).toHaveBeenCalledWith(
      "Recalculate request failed — score will update on next view.",
    );
  });

  it("passes insecure background recalculation requests through to the detached post helper", () => {
    queueRecalculate("https://example.com/", "token", { insecure: true });

    expect(mockSpawnDetachedPost).toHaveBeenCalledWith({
      url: "https://example.com/api/recalculate",
      timeoutMs: 30_000,
      token: "token",
      insecure: true,
    });
  });

  it("uses the reason field when uploadInsights gets an http body without error", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: false,
      category: "http",
      status: 400,
      body: { reason: "validation failed" },
      message: "HTTP 400",
    });

    const result = await uploadInsights({
      data: {
        tool: "claude-code",
        reportPeriod: { start: "2026-01-01", end: "2026-01-02" },
        volume: { messages: 1, linesAdded: 0, linesDeleted: 0, files: 0, days: 1, msgsPerDay: 1 },
        toolUsage: {},
        sessionTypes: {},
        outcomes: { fullyAchieved: 0, mostlyAchieved: 0, partiallyAchieved: 0 },
        friction: { buggyCode: 0, wrongApproach: 0, misunderstoodRequest: 0 },
        satisfaction: { dissatisfied: 0, likelySatisfied: 0, satisfied: 0 },
        multiClauding: { overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 },
        responseTime: { medianSeconds: 0, averageSeconds: 0 },
        toolErrors: {},
        totalSessions: 1,
        totalToolCalls: 0,
      },
      token: "token",
      serverUrl: "https://example.com",
    });

    expect(result).toEqual({
      success: false,
      error: "Server returned 400: validation failed",
    });
  });

  it("falls back to unknown status and error text for uploadInsights http failures", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: false,
      category: "http",
      message: "HTTP unknown",
      body: "not-an-object",
    });

    const result = await uploadInsights({
      data: {
        tool: "claude-code",
        reportPeriod: { start: "2026-01-01", end: "2026-01-02" },
        volume: { messages: 1, linesAdded: 0, linesDeleted: 0, files: 0, days: 1, msgsPerDay: 1 },
        toolUsage: {},
        sessionTypes: {},
        outcomes: { fullyAchieved: 0, mostlyAchieved: 0, partiallyAchieved: 0 },
        friction: { buggyCode: 0, wrongApproach: 0, misunderstoodRequest: 0 },
        satisfaction: { dissatisfied: 0, likelySatisfied: 0, satisfied: 0 },
        multiClauding: { overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 },
        responseTime: { medianSeconds: 0, averageSeconds: 0 },
        toolErrors: {},
        totalSessions: 1,
        totalToolCalls: 0,
      },
      token: "token",
      serverUrl: "https://example.com",
    });

    expect(result).toEqual({
      success: false,
      error: "Server returned unknown: Unknown error",
    });
  });

  it("falls back to unknown status for uploadSupplementalStats http failures", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: false,
      category: "http",
      message: "HTTP unknown",
      body: {},
    });

    const result = await uploadSupplementalStats({
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: {
        handle: "corp_user",
        commitsTotal: 0,
        activeDays: 0,
        prsMergedCount: 0,
        prsMergedWeight: 0,
        reviewsSubmittedCount: 0,
        issuesClosedCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
        reposContributed: 0,
        topRepoShare: 0,
        maxCommitsIn10Min: 0,
        totalStars: 0,
        totalForks: 0,
        totalWatchers: 0,
        heatmapData: [],
        fetchedAt: new Date().toISOString(),
      },
      token: "token",
      serverUrl: "https://example.com",
    });

    expect(result).toEqual({
      success: false,
      error: "Server returned unknown: Unknown error",
      serverResponse: {},
    });
  });
});
