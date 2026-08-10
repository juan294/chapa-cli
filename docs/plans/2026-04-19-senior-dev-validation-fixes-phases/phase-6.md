# Phase 6: `parseMultiClauding` Hardening

> **Project**: chapa-cli
> **Prerequisite**: None
> **Files modified**: `src/insights.ts`
> **Tests modified**: `src/insights.test.ts`
> **Batch**: `[batch-eligible]` with phases 1, 2, 5 (disjoint file set)
> **Status**: Not started

## Objective

Make `parseMultiClauding` robust against minor formatting variation in the upstream Claude Code insights HTML, and surface a signal when the extraction goes wrong instead of silently returning zeros. The schema returned to the server is unchanged.

Reference: `docs/research/2026-04-19-deep-dive-validation.md` item #3. The senior dev confirmed this is a robustness fix, not a response to a known active regression — the existing fixture must continue to parse identically.

## Changes

### 1. Replace brittle substring checks with whitespace-tolerant regexes

**File**: `src/insights.ts:173-204`

```pseudo
// before (abridged)
for (const div of statDivs) {
  const style = div.getAttribute("style") ?? "";
  if (style.includes("font-weight: 700") || style.includes("font-weight:700")) {
    values.push(parseNumeric(div.textContent?.trim() ?? "0"));
  }
  if (style.includes("text-transform: uppercase") || style.includes("text-transform:uppercase")) {
    labels.push(div.textContent?.trim().toLowerCase() ?? "");
  }
}

// after
const VALUE_STYLE = /font-weight\s*:\s*(700|bold)\b/i;
const LABEL_STYLE = /text-transform\s*:\s*uppercase\b/i;

for (const div of statDivs) {
  const style = div.getAttribute("style") ?? "";
  if (VALUE_STYLE.test(style)) {
    values.push(parseNumeric(div.textContent?.trim() ?? "0"));
  }
  if (LABEL_STYLE.test(style)) {
    labels.push(div.textContent?.trim().toLowerCase() ?? "");
  }
}
```

The regexes:
- Tolerate arbitrary whitespace around the `:`.
- Accept `font-weight: bold` (historically equivalent to 700) in addition to the numeric form.
- Use word-boundaries to avoid partial matches (e.g. `7000`).

### 2. Detect label/value count mismatches

**File**: `src/insights.ts:195-200`

```pseudo
// before
for (let i = 0; i < labels.length && i < values.length; i++) {
  const label = labels[i]!;
  const value = values[i]!;
  if (label.includes("overlap")) result.overlapEvents = value;
  else if (label.includes("sessions")) result.sessionsInvolved = value;
  else if (label.includes("message")) result.messagePercent = value;
}

// after
if (labels.length !== values.length) {
  // Structural drift: label/value count disagree.
  // Return zeros rather than silently pairing wrong numbers with the wrong label.
  return result;
}

for (let i = 0; i < labels.length; i++) {
  const label = labels[i]!;
  const value = values[i]!;
  if (label.includes("overlap")) result.overlapEvents = value;
  else if (label.includes("sessions")) result.sessionsInvolved = value;
  else if (label.includes("message")) result.messagePercent = value;
}
```

Notes:
- On mismatch we return the already-initialized zero result rather than partially populating it from the wrong pairings. This is safer than silently reporting incorrect numbers.
- No logging is emitted from inside the parser: `parseInsightsHtml` has no logger parameter, and threading one through would expand the refactor. The server-side validation that `data.totalSessions < 1` in `src/index.ts:259` already catches the case where the entire report is unparseable; the narrow multi-clauding mismatch here is a soft failure that still lets the rest of the report upload.

### 3. No changes to the `InsightsUpload` schema

The `multiClauding` shape in `src/shared.ts:408-413` is unchanged. Only the parser's tolerance changes.

## Tests

**File**: `src/insights.test.ts`

Existing test at `src/insights.test.ts:174-181` must continue to pass (the committed fixture has `font-weight: 700` and `text-transform: uppercase`).

Add the following cases:

### 1. Accepts `font-weight:700` with no space

```pseudo
it("parses multi-clauding when font-weight has no space after the colon", () => {
  const html = `
    <html><body>
      <div class="chart-card">
        <div class="chart-title">Multi-Clauding (Parallel Sessions)</div>
        <div style="display:flex;">
          <div>
            <div style="font-weight:700;">10</div>
            <div style="text-transform:uppercase;">Overlap Events</div>
          </div>
          <div>
            <div style="font-weight:700;">20</div>
            <div style="text-transform:uppercase;">Sessions Involved</div>
          </div>
          <div>
            <div style="font-weight:700;">30%</div>
            <div style="text-transform:uppercase;">Of Messages</div>
          </div>
        </div>
      </div>
    </body></html>`;
  const result = parseInsightsHtml(html);
  expect(result.multiClauding).toEqual({
    overlapEvents: 10, sessionsInvolved: 20, messagePercent: 30,
  });
});
```

### 2. Accepts `font-weight: bold` in place of 700

```pseudo
it("parses multi-clauding when font-weight is 'bold' instead of 700", () => {
  const html = /* same as above but with "font-weight: bold" */;
  const result = parseInsightsHtml(html);
  expect(result.multiClauding.overlapEvents).toBe(10);
});
```

### 3. Ignores extra whitespace around the colon

```pseudo
it("tolerates whitespace variants like 'font-weight :  700'", () => {
  const html = /* using "font-weight :  700" and "text-transform :  uppercase" */;
  const result = parseInsightsHtml(html);
  expect(result.multiClauding.overlapEvents).toBeGreaterThan(0);
});
```

### 4. Returns zeros when label/value counts disagree

```pseudo
it("returns zero multi-clauding stats when value/label counts disagree", () => {
  const html = `
    <html><body>
      <div class="chart-card">
        <div class="chart-title">Multi-Clauding (Parallel Sessions)</div>
        <div>
          <div style="font-weight: 700;">99</div>
          <div style="font-weight: 700;">88</div>
          <div style="text-transform: uppercase;">Overlap Events</div>
          <!-- only one label, two values -->
        </div>
      </div>
    </body></html>`;
  const result = parseInsightsHtml(html);
  expect(result.multiClauding).toEqual({
    overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0,
  });
});
```

### 5. Does not match unrelated inline styles

```pseudo
it("does not treat font-weight: 700 as a match when it's actually font-weight: 7000 (boundary)", () => {
  // Uses word-boundary \b — confirm regex rejects "font-weight: 7000"
  const html = /* with "font-weight: 7000" */;
  const result = parseInsightsHtml(html);
  expect(result.multiClauding.overlapEvents).toBe(0);
});
```

### 6. Existing fixture coverage still passes

No change required to `src/insights.test.ts:174-181`; rerun it as-is.

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test src/insights.test.ts` passes:
  - Existing `"extracts multi-clauding stats"` against the committed fixture (value unchanged).
  - All five new variant / mismatch / boundary cases.
- Full `pnpm test` passes.

### Manual

- `chapa insights --file committed-fixture.html` continues to print the same craft score it printed before the change.
- A hand-crafted test HTML with `font-weight: bold` parses successfully.
- A hand-crafted test HTML with a missing label returns zeros for multi-clauding (no incorrect pairing of `sessionsInvolved` with the overlap-events number).

## Notes

- Per senior dev, this is below items #1 and #4 in priority. It ships as hardening, not as a response to a known production break.
- The `upstream data-attribute selectors` suggestion from the senior dev is **not** acted on here because the committed fixture does not expose stable attributes for these stats. If a future Claude Code report adds `data-metric="overlap-events"` etc., a follow-up can switch to that path.
