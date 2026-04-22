import { afterEach, describe, expect, it, vi } from "vitest";
import { _parseLinesStat, _parseSubtitle, parseInsightsHtml } from "./insights.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("insights fallbacks", () => {
  it("handles chart cards, rows, stats, and response-time blocks with missing text nodes", () => {
    const html = `<html><body>
      <p class="subtitle"></p>
      <div class="chart-card">
        <div class="bar-row"><span class="bar-label"></span><span class="bar-value"></span></div>
      </div>
      <div class="stats-row">
        <div class="stat"><span class="stat-value"></span><span class="stat-label"></span></div>
      </div>
      <div class="chart-card"><div class="chart-title">Multi-Clauding</div><div style="font-weight:700"></div><div style="text-transform:uppercase"></div></div>
      <div class="chart-card"><div class="chart-title">User Response Time</div><div></div></div>
    </body></html>`;

    const result = parseInsightsHtml(html);

    expect(result.toolUsage).toEqual({});
    expect(result.volume.messages).toBe(0);
    expect(result.multiClauding).toEqual({
      overlapEvents: 0,
      sessionsInvolved: 0,
      messagePercent: 0,
    });
    expect(result.responseTime).toEqual({
      medianSeconds: 0,
      averageSeconds: 0,
    });
  });

  it("parses response time when only the median is present", () => {
    const html = `<html><body>
      <p class="subtitle">1 messages across 1 sessions (1 total) | 2026-01-01 to 2026-01-01</p>
      <div class="chart-card">
        <div class="chart-title">User Response Time</div>
        <div>Median: 12.5s</div>
      </div>
    </body></html>`;

    const result = parseInsightsHtml(html);

    expect(result.responseTime).toEqual({
      medianSeconds: 12.5,
      averageSeconds: 0,
    });
  });

  it("uses 0 fallbacks when subtitle capture groups are missing", () => {
    const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (pattern: string | RegExp) {
      if (pattern instanceof RegExp && pattern.source.includes("\\s+messages")) {
        return [" messages", undefined] as unknown as RegExpMatchArray;
      }
      if (pattern instanceof RegExp && pattern.source.includes("\\s+sessions")) {
        return [" sessions", undefined] as unknown as RegExpMatchArray;
      }
      return null;
    });

    expect(_parseSubtitle("broken subtitle")).toEqual({
      messages: 0,
      sessions: 0,
      start: "",
      end: "",
    });

    matchSpy.mockRestore();
  });

  it("uses 0 fallbacks when line-stat capture groups are missing", () => {
    const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (pattern: string | RegExp) {
      if (pattern instanceof RegExp && pattern.source.includes("\\+?([\\d,]+)")) {
        return ["+/‑", undefined, undefined] as unknown as RegExpMatchArray;
      }
      return null;
    });

    expect(_parseLinesStat("broken line stat")).toEqual({ added: 0, deleted: 0 });

    matchSpy.mockRestore();
  });
});
