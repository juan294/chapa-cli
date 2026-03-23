import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseInsightsHtml,
  uploadInsights,
  triggerRecalculate,
  _parseNumeric,
  _parseSubtitle,
  _parseLinesStat,
} from "./insights.js";
import type { InsightsUpload } from "./shared.js";

const FIXTURE_HTML = readFileSync(
  join(import.meta.dirname, "__fixtures__", "claude-code-report.html"),
  "utf-8",
);

// ── Helper unit tests ────────────────────────────────────────────────────

describe("parseNumeric", () => {
  it("parses plain integers", () => {
    expect(_parseNumeric("1213")).toBe(1213);
  });

  it("strips commas", () => {
    expect(_parseNumeric("16,843")).toBe(16843);
  });

  it("strips percent sign", () => {
    expect(_parseNumeric("31%")).toBe(31);
  });

  it("returns 0 for non-numeric", () => {
    expect(_parseNumeric("abc")).toBe(0);
  });

  it("handles empty string", () => {
    expect(_parseNumeric("")).toBe(0);
  });

  it("parses decimals", () => {
    expect(_parseNumeric("80.6")).toBe(80.6);
  });
});

describe("parseSubtitle", () => {
  it("extracts messages, sessions, and date range", () => {
    const result = _parseSubtitle(
      "549 messages across 66 sessions (189 total) | 2026-02-20 to 2026-03-07",
    );
    expect(result).toEqual({
      messages: 549,
      sessions: 66,
      start: "2026-02-20",
      end: "2026-03-07",
    });
  });

  it("returns zeros for empty string", () => {
    const result = _parseSubtitle("");
    expect(result).toEqual({
      messages: 0,
      sessions: 0,
      start: "",
      end: "",
    });
  });
});

describe("parseLinesStat", () => {
  it("parses +added/-deleted format", () => {
    expect(_parseLinesStat("+16,843/-1,230")).toEqual({
      added: 16843,
      deleted: 1230,
    });
  });

  it("returns zeros for non-matching text", () => {
    expect(_parseLinesStat("none")).toEqual({ added: 0, deleted: 0 });
  });
});

// ── Full parser tests ────────────────────────────────────────────────────

describe("parseInsightsHtml", () => {
  it("parses fixture into complete InsightsUpload", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.tool).toBe("claude-code");
  });

  it("extracts report period from subtitle", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.reportPeriod).toEqual({
      start: "2026-02-20",
      end: "2026-03-07",
    });
  });

  it("extracts volume stats", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.volume.messages).toBe(549);
    expect(result.volume.linesAdded).toBe(16843);
    expect(result.volume.linesDeleted).toBe(1230);
    expect(result.volume.files).toBe(290);
    expect(result.volume.days).toBe(9);
    expect(result.volume.msgsPerDay).toBe(61);
  });

  it("extracts tool usage", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.toolUsage["Bash"]).toBe(1213);
    expect(result.toolUsage["Read"]).toBe(572);
    expect(result.toolUsage["Edit"]).toBe(377);
    expect(result.toolUsage["Write"]).toBe(134);
    expect(result.toolUsage["Grep"]).toBe(115);
    expect(result.toolUsage["Agent"]).toBe(110);
  });

  it("computes totalToolCalls as sum of tool usage", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    const sum = Object.values(result.toolUsage).reduce((a, b) => a + b, 0);
    expect(result.totalToolCalls).toBe(sum);
  });

  it("extracts session types", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.sessionTypes["Single Task"]).toBe(16);
    expect(result.sessionTypes["Multi Task"]).toBe(11);
    expect(result.sessionTypes["Iterative Refinement"]).toBe(4);
    expect(result.sessionTypes["Exploration"]).toBe(1);
  });

  it("extracts totalSessions from subtitle", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.totalSessions).toBe(66);
  });

  it("extracts outcomes", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.outcomes).toEqual({
      fullyAchieved: 24,
      mostlyAchieved: 6,
      partiallyAchieved: 2,
    });
  });

  it("extracts friction", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.friction).toEqual({
      buggyCode: 15,
      wrongApproach: 12,
      misunderstoodRequest: 4,
    });
  });

  it("extracts satisfaction", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.satisfaction).toEqual({
      dissatisfied: 5,
      likelySatisfied: 50,
      satisfied: 19,
    });
  });

  it("extracts multi-clauding stats", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.multiClauding).toEqual({
      overlapEvents: 52,
      sessionsInvolved: 45,
      messagePercent: 31,
    });
  });

  it("extracts response time", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.responseTime).toEqual({
      medianSeconds: 80.6,
      averageSeconds: 188.4,
    });
  });

  it("extracts tool errors", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.toolErrors["Other"]).toBe(87);
    expect(result.toolErrors["Command Failed"]).toBe(64);
    expect(result.toolErrors["File Not Found"]).toBe(5);
    expect(result.toolErrors["User Rejected"]).toBe(5);
    expect(result.toolErrors["File Changed"]).toBe(1);
  });

  it("handles empty HTML gracefully", () => {
    const result = parseInsightsHtml("<html><body></body></html>");
    expect(result.tool).toBe("claude-code");
    expect(result.totalSessions).toBe(0);
    expect(result.volume.messages).toBe(0);
    expect(result.toolUsage).toEqual({});
    expect(result.totalToolCalls).toBe(0);
  });

  it("handles partial HTML (missing sections)", () => {
    const html = `<html><body>
      <p class="subtitle">100 messages across 5 sessions (10 total) | 2026-01-01 to 2026-01-15</p>
    </body></html>`;
    const result = parseInsightsHtml(html);
    expect(result.totalSessions).toBe(5);
    expect(result.volume.messages).toBe(100);
    expect(result.toolUsage).toEqual({});
    expect(result.reportPeriod).toEqual({
      start: "2026-01-01",
      end: "2026-01-15",
    });
  });

  it("returns all 14 top-level fields", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    const keys = Object.keys(result);
    expect(keys).toContain("tool");
    expect(keys).toContain("reportPeriod");
    expect(keys).toContain("volume");
    expect(keys).toContain("toolUsage");
    expect(keys).toContain("sessionTypes");
    expect(keys).toContain("outcomes");
    expect(keys).toContain("friction");
    expect(keys).toContain("satisfaction");
    expect(keys).toContain("multiClauding");
    expect(keys).toContain("responseTime");
    expect(keys).toContain("toolErrors");
    expect(keys).toContain("totalSessions");
    expect(keys).toContain("totalToolCalls");
  });
});

// ── Upload tests ─────────────────────────────────────────────────────────

function makeInsightsData(): InsightsUpload {
  return parseInsightsHtml(FIXTURE_HTML);
}

describe("uploadInsights", () => {
  const mockFetch = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends POST with Bearer auth and JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        craftScore: {
          craftScore: 72,
          tier: "Expert",
          dimensions: { proficiency: 80, effectiveness: 70, sophistication: 66 },
          reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
        },
      }),
    });
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "test-token",
      serverUrl: "https://chapa.example.com",
    });
    expect(result.success).toBe(true);
    expect(result.craftScore?.tier).toBe("Expert");
    expect(result.craftScore?.craftScore).toBe(72);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.example.com/api/insights",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
      }),
    );
  });

  it("strips trailing slash from server URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, craftScore: {} }),
    });
    await uploadInsights({
      data: makeInsightsData(),
      token: "t",
      serverUrl: "https://example.com/",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api/insights",
      expect.anything(),
    );
  });

  it("returns error on HTTP 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Authentication required" }),
    });
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "bad",
      serverUrl: "https://x.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("Authentication required");
  });

  it("returns error on HTTP 400 with validation reason", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid insights data", reason: "totalSessions must be >= 1" }),
    });
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "t",
      serverUrl: "https://x.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "t",
      serverUrl: "https://x.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error on rate limit (429)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Too many uploads" }),
    });
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "t",
      serverUrl: "https://x.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
  });
});

describe("triggerRecalculate", () => {
  const mockFetch = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends POST to /api/recalculate with Bearer auth", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await triggerRecalculate("https://chapa.example.com", "token");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.example.com/api/recalculate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("does not throw on failure", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    await expect(triggerRecalculate("https://x.com", "t")).resolves.toBeUndefined();
  });

  it("does not throw on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(triggerRecalculate("https://x.com", "t")).resolves.toBeUndefined();
  });
});
