# Phase 3: CLI — HTML Parser with linkedom

> **Project**: chapa-cli
> **Prerequisite**: Phase 2 (InsightsUpload type must exist in `src/shared.ts`)
> **Files modified**: `package.json`
> **Files created**: `src/insights.ts`, `src/insights.test.ts`, `src/__fixtures__/claude-code-report.html`
> **Tests created**: `src/insights.test.ts`

## Objective

Port the browser-side HTML parser from the Chapa server (`apps/web/lib/insights/parser.ts`) to Node.js using `linkedom`. Create the `parseInsightsHtml()` function and comprehensive tests.

## Changes

### 1. Add linkedom dependency

**File**: `package.json`

```bash
pnpm add linkedom
```

This will be the project's first runtime dependency. `linkedom` provides a `DOMParser` compatible with the standard Web API, enabling near-verbatim port of the browser parser.

Also add types (if separate, check if linkedom ships its own):

```bash
pnpm add -D @types/linkedom  # only if needed — linkedom may ship its own types
```

### 2. Create HTML parser module

**File**: `src/insights.ts` (NEW)

Port `apps/web/lib/insights/parser.ts:1-310` with minimal changes. The only change is the DOMParser import.

```pseudo
import { parseHTML } from "linkedom";
import type { InsightsUpload } from "./shared.js";

// ── Helper functions (ported verbatim from server parser.ts) ──

function findChartCard(doc: Document, titlePrefix: string): Element | null {
  // Exact port of parser.ts:7-14
  // querySelectorAll(".chart-card"), match .chart-title by prefix
}

function extractBarChart(doc: Document, chartTitle: string): Record<string, number> {
  // Exact port of parser.ts:20-39
  // .bar-row → .bar-label, .bar-value → parseNumeric
}

function parseNumeric(raw: string): number {
  // Exact port of parser.ts:45-49
  // Strip commas, %, return number or 0
}

function parseSubtitle(text: string): { messages, sessions, start, end } {
  // Exact port of parser.ts:55-71
  // Regex: messages, sessions, date range
}

function parseLinesStat(text: string): { added, deleted } {
  // Exact port of parser.ts:76-83
  // Regex: "+N/-M" format
}

function extractVolumeStats(doc: Document): Volume {
  // Exact port of parser.ts:88-133
  // .stats-row .stat → switch on label
}

function parseMultiClauding(doc: Document): MultiClauding {
  // Exact port of parser.ts:138-171
  // Styled divs: font-weight:700 → values, text-transform:uppercase → labels
}

function parseResponseTime(doc: Document): ResponseTime {
  // Exact port of parser.ts:177-193
  // Regex: "Median: Xs • Average: Ys"
}

function mapOutcomes(chart: Record<string, number>): Outcomes {
  // Exact port of parser.ts:198-208
}

function mapFriction(chart: Record<string, number>): Friction {
  // Exact port of parser.ts:213-223
}

function mapSatisfaction(chart: Record<string, number>): Satisfaction {
  // Exact port of parser.ts:228-238
}

// ── Main parser ──

export function parseInsightsHtml(html: string): InsightsUpload {
  // Use linkedom instead of browser DOMParser
  const { document: doc } = parseHTML(html);

  // Exact same logic as parser.ts:245-302
  // subtitle → volume → charts → multiClauding → responseTime → assemble
}

// Export helpers for unit testing (same pattern as server parser)
export {
  parseNumeric as _parseNumeric,
  parseSubtitle as _parseSubtitle,
  parseLinesStat as _parseLinesStat,
};
```

**Key difference from browser parser**:
- Browser: `const parser = new DOMParser(); const doc = parser.parseFromString(html, "text/html");`
- Node.js: `const { document: doc } = parseHTML(html);`
- All `querySelector`/`querySelectorAll` calls remain identical — linkedom implements the standard DOM API.

### 3. Copy test fixture

**File**: `src/__fixtures__/claude-code-report.html` (NEW)

Copy the test fixture from `apps/web/lib/insights/__fixtures__/claude-code-report.html` (209 lines). This is the canonical example of a Claude Code `/insights` HTML report.

### 4. Tests

**File**: `src/insights.test.ts` (NEW)

Port key tests from `apps/web/lib/insights/parser.test.ts`, adapted for Vitest patterns used in this project.

```pseudo
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInsightsHtml, _parseNumeric, _parseSubtitle, _parseLinesStat } from "./insights.js";

const FIXTURE_HTML = readFileSync(
  join(import.meta.dirname, "__fixtures__", "claude-code-report.html"),
  "utf-8",
);

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
});

describe("parseSubtitle", () => {
  it("extracts messages, sessions, and date range", () => {
    const result = _parseSubtitle(
      "549 messages across 66 sessions (189 total) | 2026-02-20 to 2026-03-07"
    );
    expect(result).toEqual({
      messages: 549,
      sessions: 66,
      start: "2026-02-20",
      end: "2026-03-07",
    });
  });
});

describe("parseLinesStat", () => {
  it("parses +added/-deleted format", () => {
    expect(_parseLinesStat("+16,843/-1,230")).toEqual({ added: 16843, deleted: 1230 });
  });
});

describe("parseInsightsHtml", () => {
  it("parses fixture into complete InsightsUpload", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.tool).toBe("claude-code");
  });

  it("extracts report period from subtitle", () => {
    const result = parseInsightsHtml(FIXTURE_HTML);
    expect(result.reportPeriod).toEqual({ start: "2026-02-20", end: "2026-03-07" });
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
  });

  it("handles empty HTML gracefully", () => {
    const result = parseInsightsHtml("<html><body></body></html>");
    expect(result.tool).toBe("claude-code");
    expect(result.totalSessions).toBe(0);
    expect(result.volume.messages).toBe(0);
  });

  it("handles partial HTML (missing sections)", () => {
    const html = `<html><body>
      <p class="subtitle">100 messages across 5 sessions (10 total) | 2026-01-01 to 2026-01-15</p>
    </body></html>`;
    const result = parseInsightsHtml(html);
    expect(result.totalSessions).toBe(5);
    expect(result.volume.messages).toBe(100); // fallback from subtitle
    expect(result.toolUsage).toEqual({});
  });
});
```

## Success Criteria

### Automated
- `pnpm test` — all parser tests pass, fixture parses correctly into all 14 fields
- `pnpm run typecheck` — `parseInsightsHtml` return type matches `InsightsUpload`
- `pnpm run build` — `linkedom` bundled into `dist/index.js` by tsup
- Parser output matches server parser output for the same fixture HTML
