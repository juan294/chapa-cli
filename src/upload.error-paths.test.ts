import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "./logger.js";

const mockRequestJson = vi.hoisted(() => vi.fn());
const mockSpawnDetachedPost = vi.hoisted(() => vi.fn());

vi.mock("./http.js", () => ({
  requestJson: mockRequestJson,
}));

vi.mock("./background.js", () => ({
  spawnDetachedPost: mockSpawnDetachedPost,
}));

import { queueRecalculate, triggerRecalculate, uploadInsights } from "./insights.js";
import { linkGitHubAccount, readGitHubLinkStatus, unlinkGitHubAccount } from "./upload.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("upload catch paths", () => {
  it("surfaces unexpected link, status and unlink exceptions without the token", async () => {
    mockRequestJson.mockRejectedValue(new Error("boom"));
    const opts = { serverUrl: "https://example.com", authToken: "cli-token" };

    const linked = await linkGitHubAccount({ ...opts, login: "corp_user", githubToken: "ghp_secret" });
    const status = await readGitHubLinkStatus(opts);
    const unlinked = await unlinkGitHubAccount(opts);

    for (const result of [linked, status, unlinked]) {
      expect(result).toEqual({ ok: false, message: "Request failed: boom" });
    }
    mockRequestJson.mockReset();
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
    const logger: Logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(() => 0),
      getTimings: vi.fn(() => ({})),
    };
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

  it("falls back to an unknown status when a link failure has no status or body", async () => {
    mockRequestJson.mockResolvedValueOnce({
      ok: false,
      category: "http",
      message: "HTTP unknown",
      body: {},
    });

    const result = await linkGitHubAccount({
      serverUrl: "https://example.com", authToken: "token", login: "corp_user", githubToken: "ghp_secret",
    });

    expect(result).toEqual({ ok: false, message: "Server returned unknown" });
  });
});
