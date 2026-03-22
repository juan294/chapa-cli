# Research: Claude Code Insights Upload via CLI

> Generated: 2026-03-22 | Branch: `develop`

## Objective

Understand how to add a new `chapa insights` command that reads a Claude Code `/insights` HTML report from disk and uploads it to the Chapa server.

---

## 1. Current CLI Architecture (chapa-cli)

### Command Dispatch

The CLI dispatches commands via a string match on the first positional argument (`src/index.ts:38-233`). Currently supported: `merge`, `login`, `logout`.

Argument parsing uses Node.js built-in `parseArgs` (`src/cli.ts:21-61`). Flags are defined in `src/cli.ts:23-39`.

### Authentication

The CLI authenticates to the Chapa server using a **Bearer token** sent in the `Authorization` header (`src/upload.ts:37`). The token is obtained via the device authorization flow (`src/login.ts:79-152`) and stored in `~/.chapa/credentials.json` (`src/config.ts:40-48`).

The stored config includes: `{ token, handle, server }` (`src/config.ts:6-10`).

### Existing Upload Pattern

`uploadSupplementalStats()` in `src/upload.ts:19-62`:
- Endpoint: `POST {serverUrl}/api/supplemental`
- Headers: `Content-Type: application/json`, `Authorization: Bearer {token}`
- Body: `{ targetHandle, sourceHandle, stats }`
- Returns: `{ success: boolean, error?: string, serverResponse?: unknown }`

---

## 2. Chapa Server Insights API

### Endpoint: POST /api/insights

**File:** `apps/web/app/api/insights/route.ts:15-72`

Accepts a JSON body conforming to the `InsightsUpload` type (not the raw HTML). The HTML parsing happens client-side in the browser before posting.

**Authentication (BLOCKER):** Currently uses **cookie-based session auth** via `requireSession()` (`apps/web/lib/auth/require-session.ts:34-57`), which reads a session cookie — NOT a Bearer token. The CLI cannot use this endpoint as-is.

**Contrast with `/api/supplemental`:** The supplemental endpoint (`apps/web/app/api/supplemental/route.ts:27-96`) accepts `Authorization: Bearer {token}` and resolves the handle via either a CLI token (HMAC-signed) or GitHub PAT. The insights endpoint does not have this.

**Rate limit:** 10 uploads per handle per 24 hours.

**Response:**
```json
{
  "success": true,
  "craftScore": {
    "tool": "claude-code",
    "dimensions": { "proficiency": N, "effectiveness": N, "sophistication": N },
    "craftScore": N,
    "tier": "Novice|Practitioner|Expert|Master",
    "reportPeriod": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "computedAt": "ISO8601"
  }
}
```

### Endpoint: GET /api/insights/:handle

**File:** `apps/web/app/api/insights/[handle]/route.ts:1-38`

Public, no auth. Returns `{ craftScore: CraftResult | null }`. Does not expose raw data.

---

## 3. InsightsUpload Data Shape

**File:** `packages/shared/src/types.ts:291-334`

The API expects a parsed JSON object, NOT raw HTML. The 14 required fields are:

```typescript
{
  tool: "claude-code",
  reportPeriod: { start: string, end: string },           // ISO dates
  volume: { messages, linesAdded, linesDeleted, files, days, msgsPerDay },
  toolUsage: Record<string, number>,        // e.g. { "Bash": 1213, "Read": 572 }
  sessionTypes: Record<string, number>,     // e.g. { "Single Task": 16 }
  outcomes: { fullyAchieved, mostlyAchieved, partiallyAchieved },
  friction: { buggyCode, wrongApproach, misunderstoodRequest },
  satisfaction: { dissatisfied, likelySatisfied, satisfied },
  multiClauding: { overlapEvents, sessionsInvolved, messagePercent },
  responseTime: { medianSeconds, averageSeconds },
  toolErrors: Record<string, number>,       // e.g. { "Other": 87 }
  totalSessions: number,                    // >= 1
  totalToolCalls: number                    // >= 0
}
```

### Validation

**File:** `apps/web/lib/insights/validation.ts:15-145`

Server validates all 14 fields. Key constraints:
- `tool` must be exactly `"claude-code"`
- Dates must be ISO format (YYYY-MM-DD), end >= start
- All numeric values must be non-negative
- `totalSessions` >= 1
- `multiClauding.messagePercent` must be 0-100

---

## 4. HTML Parsing (Currently Browser-Only)

**File:** `apps/web/lib/insights/parser.ts:1-310`

The `parseInsightsHtml(html)` function uses the browser's `DOMParser` to parse HTML. This is NOT available in Node.js.

### HTML Structure Expected

The Claude Code `/insights` report HTML contains:
- `.subtitle` — `"549 messages across 66 sessions (189 total) | 2026-02-20 to 2026-03-07"`
- `.stats-row .stat` — Volume metrics (Messages, Lines, Files, Days, Msgs/Day)
- `.chart-card` containers with `.chart-title`:
  - `"Top Tools Used"` — bar chart with `.bar-row > .bar-label + .bar-value`
  - `"Session Types"` — same structure
  - `"Outcomes"` — labels: Fully Achieved, Mostly Achieved, Partially Achieved
  - `"Primary Friction Types"` — labels: Buggy Code, Wrong Approach, Misunderstood Request
  - `"Inferred Satisfaction"` — labels: Dissatisfied, Likely Satisfied, Satisfied
  - `"User Response Time Distribution"` — footer text with "Median: Xs • Average: Ys"
  - `"Tool Errors Encountered"` — bar chart
  - `"Multi-Clauding"` — styled divs with bold values and uppercase labels

### Parser Helpers (portable logic)

These functions contain the extraction logic and do not depend on DOMParser:
- `parseNumeric(raw)` — strips commas/%, returns number (`parser.ts:45-49`)
- `parseSubtitle(text)` — regex extraction of messages, sessions, date range (`parser.ts:55-71`)
- `parseLinesStat(text)` — parses "+N/-M" format (`parser.ts:76-83`)
- `mapOutcomes/mapFriction/mapSatisfaction` — map chart labels to field names (`parser.ts:198-238`)

### Node.js Compatibility

The DOM querying (`querySelector`, `querySelectorAll`) needs a Node.js alternative. Options:
1. **`linkedom`** — Lightweight DOM implementation (~50KB), supports querySelector. Zero native dependencies.
2. **`cheerio`** — jQuery-like HTML parser (~200KB). Popular but larger.
3. **`node-html-parser`** — Fast HTML parser (~30KB), supports querySelector.
4. **Regex-only** — Avoid DOM entirely, extract via regex. Fragile but zero-dependency.

**Note:** chapa-cli currently has zero runtime dependencies. Adding a DOM parser would be the first.

### Test Fixture

A complete example HTML report exists at:
`apps/web/lib/insights/__fixtures__/claude-code-report.html` (209 lines)

Tests at `apps/web/lib/insights/parser.test.ts` (396 lines) cover all extraction paths.

---

## 5. Server-Side Auth Gap

The insights endpoint requires a server-side change to support CLI authentication:

| Endpoint | Auth Method | CLI Compatible? |
|----------|-------------|-----------------|
| `POST /api/supplemental` | Bearer token (CLI token or GitHub PAT) | Yes |
| `POST /api/insights` | Session cookie (`requireSession`) | **No** |

The supplemental endpoint resolves auth via `resolveHandle(token)` (`supplemental/route.ts:14-25`), which supports both HMAC CLI tokens (`isCliToken` / `verifyCliToken` from `lib/auth/cli-token.ts`) and GitHub PATs (`fetchGitHubUser`). The insights endpoint would need the same pattern.

---

## 6. End-to-End Flow (What the CLI Would Do)

1. User runs: `chapa insights --file ./insights-report.html`
2. CLI reads the HTML file from disk (`fs.readFileSync`)
3. CLI parses HTML into `InsightsUpload` JSON (needs Node.js DOM parser)
4. CLI loads auth token from `~/.chapa/credentials.json`
5. CLI sends `POST {server}/api/insights` with:
   - `Authorization: Bearer {token}`
   - `Content-Type: application/json`
   - Body: the parsed `InsightsUpload` object
6. CLI displays the returned craft score and tier

---

## 7. Open Questions Requiring Decisions

### A. Server Auth Change Required

The `POST /api/insights` endpoint must be updated to accept Bearer tokens (like `/api/supplemental` does). This is a change in the **Chapa server** codebase, not the CLI.

**Two approaches:**
1. Add Bearer token auth alongside cookie auth in the existing endpoint
2. Create a separate `POST /api/cli/insights` endpoint with Bearer auth

### B. HTML Parsing in Node.js

The browser-side parser uses `DOMParser`. The CLI needs a Node.js alternative. This would be the project's **first runtime dependency** (currently zero).

**Option 1 — Port with a lightweight DOM lib:** Use `linkedom` or `node-html-parser`. Re-implement the parser using the same querySelector-based approach.

**Option 2 — Regex-only parser:** Extract data via regex patterns without a DOM library. Maintains zero-dependency policy but is more fragile.

**Option 3 — Send raw HTML to server:** Skip client-side parsing entirely. Add a new endpoint that accepts `multipart/form-data` with the HTML file, does server-side parsing, and returns the craft score. This keeps the CLI simple but requires a larger server change.

### C. Recalculation

The web UI calls `POST /api/recalculate` after a successful insights upload (`UserMenu.tsx:97`). The CLI should do the same to ensure the user's impact score updates immediately.

The recalculate endpoint also uses `requireSession` (`apps/web/app/api/recalculate/route.ts`), so it would need the same Bearer token auth fix.

---

## 8. Files That Would Be Created/Modified

### chapa-cli (this project)

| File | Change |
|------|--------|
| `src/cli.ts` | Add `insights` command + `--file` flag |
| `src/index.ts` | Add `insights` command dispatch |
| `src/insights.ts` | **New** — HTML parsing + upload function |
| `src/shared.ts` | Add `InsightsUpload` type definition |
| `tests/insights.test.ts` | **New** — Tests for parser + upload |
| `package.json` | Add DOM parser dep (if Option 1/2) |

### chapa (server — separate project)

| File | Change |
|------|--------|
| `apps/web/app/api/insights/route.ts` | Add Bearer token auth |
| `apps/web/app/api/recalculate/route.ts` | Add Bearer token auth (if CLI triggers recalc) |

---

## 9. Existing Patterns to Follow

- Upload function pattern: `src/upload.ts` — same fetch/error-handling structure
- CLI flag pattern: `src/cli.ts:23-39` — add `file` to options
- Command dispatch pattern: `src/index.ts:65-79` — add `insights` case
- Logger usage: pass `logger` through for `--verbose` / `--json` support
- Error return shape: `{ success: boolean, error?: string, serverResponse?: unknown }`
- Telemetry: fire telemetry event on success/failure (`src/telemetry.ts`)
