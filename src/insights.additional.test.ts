import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _parseLinesStat,
  _parseMultiClauding,
  _parseResponseTime,
  _parseSubtitle,
  parseInsightsHtml,
} from "./insights.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// insights.ts:190,193 — ?? right-side branches inside parseMultiClauding when
// textContent is null on VALUE_STYLE / LABEL_STYLE divs.
// Real DOM (linkedom) never returns null textContent; direct testing via the
// exported helper avoids module mocking and the associated V8 coverage merge issues.
describe("_parseMultiClauding — null textContent on style divs", () => {
  function makeDiv(style: string | null, textContent: string | null): Element {
    return {
      getAttribute: () => style,
      textContent,
    } as unknown as Element;
  }

  function makeCard(divs: Element[]): Element {
    return {
      querySelectorAll: () => divs,
    } as unknown as Element;
  }

  it("falls back to 0 when VALUE_STYLE div has null textContent (line 190 ?? branch)", () => {
    const card = makeCard([
      makeDiv("font-weight: 700", null),         // VALUE_STYLE, null → ?? "0"
      makeDiv("text-transform: uppercase", "overlap events"),  // LABEL_STYLE, non-null
    ]);
    const result = _parseMultiClauding(card);
    expect(result).toEqual({ overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 });
  });

  it("falls back to '' when LABEL_STYLE div has null textContent (line 193 ?? branch)", () => {
    const card = makeCard([
      makeDiv("font-weight: 700", "5"),           // VALUE_STYLE, non-null
      makeDiv("text-transform: uppercase", null), // LABEL_STYLE, null → ?? ""
    ]);
    const result = _parseMultiClauding(card);
    // values=[5], labels=[""] — label "" doesn't match any key → all zeros
    expect(result).toEqual({ overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 });
  });

  // insights.ts:188 — getAttribute("style") returns null → ?? "" right-side branch.
  // Only reachable via a mock since div[style] selector always yields non-null getAttribute.
  it("treats a div with null getAttribute result as having no style (line 188 ?? branch)", () => {
    const card = makeCard([
      makeDiv(null, "overlap events"), // null ?? "" = ""  → style="" → no pattern match
    ]);
    const result = _parseMultiClauding(card);
    expect(result).toEqual({ overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 });
  });
});

// insights.ts:219 — ?? right-side branch in parseResponseTime when textContent is null.
describe("_parseResponseTime — null textContent on card", () => {
  it("falls back to empty string when card.textContent is null (line 219 ?? branch)", () => {
    const card = { textContent: null, querySelectorAll: () => [] } as unknown as Element;
    const result = _parseResponseTime(card);
    expect(result).toEqual({ medianSeconds: 0, averageSeconds: 0 });
  });
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
    const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (
      matcher: { [Symbol.match](string: string): RegExpMatchArray | null },
    ) {
      const pattern = matcher as RegExp;
      if (pattern.source.includes("\\s+messages")) {
        return [" messages", undefined] as unknown as RegExpMatchArray;
      }
      if (pattern.source.includes("\\s+sessions")) {
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

  // insights.ts:83-85 — ?.textContent null branch in extractBarChart when bar-label/bar-value
  // child elements are absent from the row (querySelector returns null → short-circuit).
  it("handles bar rows that are missing bar-label or bar-value elements", () => {
    const html = `<html><body>
      <p class="subtitle">5 messages across 2 sessions | 2026-01-01 to 2026-01-31</p>
      <div class="chart-card">
        <div class="chart-title">Top Tools Used</div>
        <div class="bar-row"></div>
      </div>
    </body></html>`;

    const result = parseInsightsHtml(html);
    // No bar-label or bar-value elements → both querySelector calls return null → label="" → skipped
    expect(result.toolUsage).toEqual({});
  });

  // insights.ts:144-145 — ?.textContent null branch in extractVolumeStats when stat children absent.
  it("handles stat elements that are missing stat-value or stat-label children", () => {
    const html = `<html><body>
      <p class="subtitle">5 messages across 2 sessions | 2026-01-01 to 2026-01-31</p>
      <div class="stats-row"><div class="stat"></div></div>
    </body></html>`;

    const result = parseInsightsHtml(html);
    // No .stat-value or .stat-label → querySelector returns null → value="" label="" → switch default
    expect(result.volume.messages).toBe(5); // comes from subtitle fallback
    expect(result.volume.files).toBe(0);
  });

  // insights.ts:88 — false branch of `if (label)` in extractBarChart
  it("skips bar rows with empty labels even on recognized chart cards", () => {
    const html = `<html><body>
      <p class="subtitle">10 messages across 5 sessions | 2026-01-01 to 2026-01-31</p>
      <div class="chart-card">
        <div class="chart-title">Top Tools Used</div>
        <div class="bar-row">
          <span class="bar-label"></span>
          <span class="bar-value">42</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">read_file</span>
          <span class="bar-value">10</span>
        </div>
      </div>
    </body></html>`;

    const result = parseInsightsHtml(html);

    expect(result.toolUsage).toEqual({ read_file: 10 });
    expect(result.totalToolCalls).toBe(10);
  });

  // insights.ts:276 — false branch of `if (!subtitleEl)` in parseInsightsHtml
  it("uses only the first subtitle when the HTML contains two", () => {
    const html = `<html><body>
      <p class="subtitle">10 messages across 5 sessions | 2026-01-01 to 2026-01-31</p>
      <p class="subtitle">99 messages across 50 sessions | 2026-02-01 to 2026-02-28</p>
    </body></html>`;

    const result = parseInsightsHtml(html);

    expect(result.totalSessions).toBe(5);
    expect(result.volume.messages).toBe(10);
  });

  it("uses 0 fallbacks when line-stat capture groups are missing", () => {
    const matchSpy = vi.spyOn(String.prototype, "match").mockImplementation(function (
      matcher: { [Symbol.match](string: string): RegExpMatchArray | null },
    ) {
      const pattern = matcher as RegExp;
      if (pattern.source.includes("\\+?([\\d,]+)")) {
        return ["+/‑", undefined, undefined] as unknown as RegExpMatchArray;
      }
      return null;
    });

    expect(_parseLinesStat("broken line stat")).toEqual({ added: 0, deleted: 0 });

    matchSpy.mockRestore();
  });
});
