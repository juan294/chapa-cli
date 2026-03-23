# Phase 4: CLI — Upload Function and Output Formatting

> **Project**: chapa-cli
> **Prerequisite**: Phase 2 (command wiring), Phase 3 (parser)
> **Files modified**: `src/insights.ts`, `src/index.ts`
> **Tests modified**: `src/insights.test.ts`, `src/index.test.ts`

## Objective

Add the `uploadInsights()` function (following the `uploadSupplementalStats()` pattern), wire the full insights flow into `index.ts`, add output formatting (human-readable + JSON), and telemetry.

## Changes

### 1. Add upload function

**File**: `src/insights.ts` (append to existing parser module)

Follow the exact pattern from `src/upload.ts:19-62`.

```pseudo
import type { Logger } from "./logger.js";

export interface InsightsUploadOptions {
  data: InsightsUpload;
  token: string;
  serverUrl: string;
  logger?: Logger;
}

export interface InsightsUploadResult {
  success: boolean;
  error?: string;
  craftScore?: {
    dimensions: { proficiency: number; effectiveness: number; sophistication: number };
    craftScore: number;
    tier: string;
    reportPeriod: { start: string; end: string };
  };
}

export async function uploadInsights(opts: InsightsUploadOptions): Promise<InsightsUploadResult> {
  const baseUrl = opts.serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/insights`;
  const log = opts.logger;

  const payload = JSON.stringify(opts.data);
  log?.debug(`Insights payload size: ${payload.length} bytes`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: payload,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: `Server returned ${res.status}: ${body.error ?? body.reason ?? "Unknown error"}`,
      };
    }

    const body = await res.json().catch(() => ({}));
    log?.debug(`Server response: ${JSON.stringify(body)}`);
    return {
      success: true,
      craftScore: body.craftScore,
    };
  } catch (err) {
    return {
      success: false,
      error: `Upload failed: ${(err as Error).message}`,
    };
  }
}
```

### 2. Add recalculate trigger

**File**: `src/insights.ts` (append)

```pseudo
export async function triggerRecalculate(
  serverUrl: string,
  token: string,
  logger?: Logger,
): Promise<void> {
  const baseUrl = serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/recalculate`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) {
      logger?.debug("Impact score recalculated.");
    } else {
      logger?.debug(`Recalculate returned ${res.status} — score will update on next view.`);
    }
  } catch {
    logger?.debug("Recalculate request failed — score will update on next view.");
  }
}
```

### 3. Wire full insights flow in index.ts

**File**: `src/index.ts`

Replace the skeleton from Phase 2 with the full flow. Follow the same structure as the merge command (lines 81-226).

```pseudo
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseInsightsHtml, uploadInsights, triggerRecalculate } from "./insights.js";

// Inside the insights command block:

if (args.command === "insights") {
  const log = createLogger({ verbose: args.verbose, json: args.json });
  log.time("total");

  const config = loadConfig();
  const handle = args.handle ?? config?.handle;
  const authToken = args.token ?? config?.token;
  const serverUrl = args.server !== DEFAULT_SERVER ? args.server : (config?.server ?? args.server);

  // Validate required args
  if (!args.file) { log.error("--file is required..."); process.exit(1); }
  if (!handle) { log.error("No personal handle..."); process.exit(1); }
  if (!authToken) { log.error("Not authenticated..."); process.exit(1); }

  // Read HTML file
  const filePath = resolve(args.file);
  if (!existsSync(filePath)) {
    log.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let html: string;
  try {
    html = readFileSync(filePath, "utf-8");
  } catch (err) {
    log.error(`Error reading file: ${(err as Error).message}`);
    process.exit(1);
  }

  // Parse HTML
  log.info("Parsing insights report...");
  log.time("parse");
  let data: InsightsUpload;
  try {
    data = parseInsightsHtml(html);
  } catch (err) {
    log.error(`Error parsing insights HTML: ${(err as Error).message}`);
    process.exit(1);
  }
  const parseMs = log.timeEnd("parse");

  // Validate minimal viability (totalSessions must be >= 1 for server validation)
  if (data.totalSessions < 1) {
    log.error("Error: Could not extract session data from HTML. Is this a valid Claude Code insights report?");
    process.exit(1);
  }

  log.debug(`Parsed: ${data.totalSessions} sessions, ${data.volume.messages} messages, ${data.totalToolCalls} tool calls`);
  log.debug(`Period: ${data.reportPeriod.start} to ${data.reportPeriod.end}`);

  // Upload
  log.info(`Uploading insights to ${serverUrl}...`);
  log.time("upload");
  const result = await uploadInsights({
    data,
    token: authToken,
    serverUrl,
    logger: log,
  });
  const uploadMs = log.timeEnd("upload");

  // Trigger recalculate (non-blocking, fire-and-forget like telemetry)
  if (result.success) {
    triggerRecalculate(serverUrl, authToken, log);
  }

  const totalMs = log.timeEnd("total");

  // ── Output ──

  if (!result.success) {
    if (args.json) {
      process.stdout.write(JSON.stringify({
        success: false,
        handle,
        file: filePath,
        error: result.error,
        timing: { parseMs: round(parseMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
        cliVersion: VERSION,
      }, null, 2) + "\n");
    } else {
      log.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({
      success: true,
      handle,
      file: filePath,
      craftScore: result.craftScore,
      timing: { parseMs: round(parseMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
      cliVersion: VERSION,
    }, null, 2) + "\n");
  } else {
    const cs = result.craftScore;
    if (cs) {
      log.info(`Craft Score: ${cs.craftScore}/100 (${cs.tier})`);
      log.info(`  Proficiency:    ${cs.dimensions.proficiency}`);
      log.info(`  Effectiveness:  ${cs.dimensions.effectiveness}`);
      log.info(`  Sophistication: ${cs.dimensions.sophistication}`);
      log.info(`Period: ${cs.reportPeriod.start} to ${cs.reportPeriod.end}`);
    }
    log.info(`Success! Insights uploaded for ${handle} (${(totalMs / 1000).toFixed(1)}s)`);
  }

  // Telemetry (non-blocking, fire-and-forget)
  sendTelemetry(serverUrl, {
    operationId: randomUUID(),
    targetHandle: handle,
    sourceHandle: handle,  // insights is self-upload, no separate source
    success: true,
    stats: {
      commitsTotal: 0,
      reposContributed: 0,
      prsMergedCount: 0,
      activeDays: data.volume.days,
      reviewsSubmittedCount: 0,
    },
    timing: { fetchMs: 0, uploadMs: round(uploadMs), totalMs: round(totalMs) },
    cliVersion: VERSION,
  });

  return;
}
```

### 4. Tests

**File**: `src/insights.test.ts` (append to existing parser tests)

```pseudo
describe("uploadInsights", () => {
  const mockFetch = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const baseData: InsightsUpload = { /* minimal valid InsightsUpload from fixture parse */ };

  it("sends POST with Bearer auth and JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, craftScore: { craftScore: 72, tier: "Expert", ... } }),
    });
    const result = await uploadInsights({
      data: baseData,
      token: "test-token",
      serverUrl: "https://chapa.example.com",
    });
    expect(result.success).toBe(true);
    expect(result.craftScore?.tier).toBe("Expert");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.example.com/api/insights",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      }),
    );
  });

  it("returns error on HTTP 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ error: "Authentication required" }),
    });
    const result = await uploadInsights({ data: baseData, token: "bad", serverUrl: "https://x.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns error on HTTP 400 with validation reason", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: "Invalid insights data", reason: "totalSessions must be >= 1" }),
    });
    const result = await uploadInsights({ data: baseData, token: "t", serverUrl: "https://x.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await uploadInsights({ data: baseData, token: "t", serverUrl: "https://x.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error on rate limit (429)", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ error: "Too many uploads" }),
    });
    const result = await uploadInsights({ data: baseData, token: "t", serverUrl: "https://x.com" });
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
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer token" }) }),
    );
  });

  it("does not throw on failure", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    await expect(triggerRecalculate("https://x.com", "t")).resolves.toBeUndefined();
  });
});
```

**File**: `src/index.test.ts` (add to insights command tests)

```pseudo
it("exits with error when file does not exist", async () => {
  mockParseArgs.mockReturnValue(defaultArgs({
    command: "insights",
    file: "/nonexistent/report.html",
  }));
  mockLoadConfig.mockReturnValue({ token: "t", handle: "h", server: "https://x.com" });
  await runMain();
  expect(loggerOutput(mockLogger.error)).toContain("File not found");
});

it("uploads insights and displays craft score on success", async () => {
  // Mock file read, parse, and successful upload
  // Verify log.info output includes "Craft Score" and tier
});

it("outputs JSON on success with --json flag", async () => {
  // Verify process.stdout.write called with JSON containing craftScore
});
```

## Success Criteria

### Automated
- `pnpm test` — upload tests pass, all HTTP status codes covered
- `pnpm run typecheck` — InsightsUploadResult type correct
- Upload function follows exact same pattern as `uploadSupplementalStats()`
- Recalculate is fire-and-forget (never throws, never blocks)
- JSON output mode includes `craftScore`, `timing`, `cliVersion`
- Human output mode shows score, tier, and dimensions
