import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("linkedom");
});

describe("parseInsightsHtml nullish DOM fallbacks", () => {
  it("handles missing query results and null text/style values defensively", async () => {
    const row = {
      querySelector: vi.fn(() => null),
    };

    const stat = {
      querySelector: vi.fn(() => null),
    };

    const toolCard = {
      querySelector: vi.fn((selector: string) => (
        selector === ".chart-title" ? { textContent: "Top Tools Used" } : null
      )),
      querySelectorAll: vi.fn((selector: string) => (
        selector === ".bar-row" ? [row] : []
      )),
    };

    const multiCard = {
      querySelector: vi.fn((selector: string) => (
        selector === ".chart-title" ? { textContent: "Multi-Clauding" } : null
      )),
      querySelectorAll: vi.fn((selector: string) => (
        selector === "div[style]"
          ? [
              {
                getAttribute: vi.fn(() => null),
                textContent: null,
              },
              {
                getAttribute: vi.fn(() => "font-weight:700"),
                textContent: null,
              },
              {
                getAttribute: vi.fn(() => "text-transform:uppercase"),
                textContent: null,
              },
            ]
          : []
      )),
    };

    const responseCard = {
      textContent: null,
      querySelector: vi.fn((selector: string) => (
        selector === ".chart-title" ? { textContent: "User Response Time" } : null
      )),
      querySelectorAll: vi.fn(() => []),
    };

    const fakeDocument = {
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === ".chart-card") {
          return [toolCard, multiCard, responseCard];
        }
        if (selector === ".stats-row .stat") {
          return [stat];
        }
        return [];
      }),
    };

    vi.doMock("linkedom", () => ({
      parseHTML: () => ({ document: fakeDocument }),
    }));

    const { parseInsightsHtml } = await import("./insights.js");
    const result = parseInsightsHtml("<html></html>");

    expect(result.toolUsage).toEqual({});
    expect(result.volume).toEqual({
      messages: 0,
      linesAdded: 0,
      linesDeleted: 0,
      files: 0,
      days: 0,
      msgsPerDay: 0,
    });
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
});
