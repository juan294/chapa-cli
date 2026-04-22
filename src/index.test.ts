import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (must be declared before vi.mock calls) ──────────────
const mockParseArgs = vi.hoisted(() => vi.fn());
const mockResolveToken = vi.hoisted(() => vi.fn());
const mockFetchEmuStats = vi.hoisted(() => vi.fn());
const mockUploadSupplementalStats = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockDeleteConfig = vi.hoisted(() => vi.fn());
const mockLogin = vi.hoisted(() => vi.fn());
const mockCreateLogger = vi.hoisted(() => vi.fn());
const mockFormatStatsSummary = vi.hoisted(() => vi.fn());
const mockQueueTelemetry = vi.hoisted(() => vi.fn());
const mockClassifyError = vi.hoisted(() => vi.fn());
const mockEmptyTelemetryStats = vi.hoisted(() => ({
  commitsTotal: 0,
  reposContributed: 0,
  prsMergedCount: 0,
  activeDays: 0,
  reviewsSubmittedCount: 0,
}));
const mockParseInsightsHtml = vi.hoisted(() => vi.fn());
const mockUploadInsights = vi.hoisted(() => vi.fn());
const mockQueueRecalculate = vi.hoisted(() => vi.fn());
const mockInsightsModuleImported = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockResolve = vi.hoisted(() => vi.fn());

vi.mock("./cli.js", () => ({ parseArgs: mockParseArgs, DEFAULT_SERVER: "https://chapa.thecreativetoken.com" }));
vi.mock("./auth.js", () => ({ resolveToken: mockResolveToken }));
vi.mock("./fetch-emu.js", () => ({ fetchEmuStats: mockFetchEmuStats }));
vi.mock("./upload.js", () => ({ uploadSupplementalStats: mockUploadSupplementalStats }));
vi.mock("./insights.js", () => ({
  get parseInsightsHtml() {
    mockInsightsModuleImported();
    return mockParseInsightsHtml;
  },
  get uploadInsights() {
    mockInsightsModuleImported();
    return mockUploadInsights;
  },
  get queueRecalculate() {
    mockInsightsModuleImported();
    return mockQueueRecalculate;
  },
}));
vi.mock("./config.js", () => ({
  loadConfig: mockLoadConfig,
  deleteConfig: mockDeleteConfig,
}));
vi.mock("./login.js", () => ({ login: mockLogin }));
vi.mock("./logger.js", () => ({ createLogger: mockCreateLogger }));
vi.mock("./shared.js", () => ({ formatStatsSummary: mockFormatStatsSummary }));
vi.mock("./telemetry.js", () => ({
  queueTelemetry: mockQueueTelemetry,
  classifyError: mockClassifyError,
  EMPTY_TELEMETRY_STATS: mockEmptyTelemetryStats,
}));
vi.mock("node:fs", async () => {
  const actual = await import("node:fs");
  return { ...actual, readFileSync: mockReadFileSync };
});
vi.mock("node:path", async () => {
  const actual = await import("node:path");
  return { ...actual, resolve: mockResolve };
});

// ── Helpers ──────────────────────────────────────────────────────────────

/** Collect all output from a console spy into a single string. */
function spyOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

/** Collect all output from a mock logger method into a single string. */
function loggerOutput(method: ReturnType<typeof vi.fn>): string {
  return method.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

/** Default CliArgs shape — override per test. */
function defaultArgs(overrides: Record<string, unknown> = {}) {
  return {
    command: null,
    unknownCommand: null,
    handle: undefined,
    emuHandle: undefined,
    emuToken: undefined,
    token: undefined,
    file: undefined,
    server: "https://chapa.thecreativetoken.com",
    serverExplicit: false,
    verbose: false,
    json: false,
    insecure: false,
    version: false,
    help: false,
    ...overrides,
  };
}

function successFetchResult(stats: Record<string, unknown> = {}) {
  return {
    ok: true,
    stats: {
      commitsTotal: 0,
      activeDays: 0,
      prsMergedCount: 0,
      prsMergedWeight: 0,
      reviewsSubmittedCount: 0,
      issuesClosedCount: 0,
      linesAdded: 0,
      linesDeleted: 0,
      reposContributed: 0,
      totalStars: 0,
      totalForks: 0,
      ...stats,
    },
  };
}

function failedFetchResult(
  error = "GraphQL HTTP 401: Unauthorized",
  errorCategory: string = "auth",
) {
  return {
    ok: false,
    error,
    errorCategory,
  };
}

/**
 * Dynamically import index.ts to run main().
 *
 * index.ts calls main() at the top level as a fire-and-forget async call.
 * When process.exit() throws, the rejection from main() becomes an
 * unhandled rejection. We catch it by listening for the event during import.
 *
 * For tests where process.exit is NOT called, main() completes normally
 * and we just await the import.
 */
async function runMain() {
  // Capture any unhandled rejections thrown by the fire-and-forget main()
  const rejections: Error[] = [];
  // Node.js uses 'unhandledRejection' on process, not the browser event
  const nodeHandler = (reason: unknown) => {
    rejections.push(reason as Error);
  };
  process.on("unhandledRejection", nodeHandler);

  try {
    await import("./index.js");
    // Give the async main() a chance to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.removeListener("unhandledRejection", nodeHandler);
  }
}

/** Create a mock logger with spyable methods. */
function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn().mockReturnValue(0),
    getTimings: vi.fn().mockReturnValue({}),
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────

describe("index.ts command dispatch", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Mock process.exit to throw — this stops further code execution in main(),
    // just like the real process.exit would. The thrown error becomes an
    // unhandled rejection that runMain() captures.
    mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // Create mock logger and wire it up
    mockLogger = createMockLogger();
    mockCreateLogger.mockReturnValue(mockLogger);

    // Safe defaults for all downstream mocks
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue(null);
    mockFetchEmuStats.mockResolvedValue(failedFetchResult("mock", "unknown"));
    mockUploadSupplementalStats.mockResolvedValue({ success: false, error: "mock" });
    mockLogin.mockResolvedValue(undefined);
    mockDeleteConfig.mockReturnValue(false);
    mockFormatStatsSummary.mockReturnValue("  Commits:  42\n  PRs merged:  5");
    mockQueueTelemetry.mockResolvedValue(undefined);
    mockClassifyError.mockReturnValue("unknown");
    mockParseInsightsHtml.mockReturnValue({
      tool: "claude-code",
      totalSessions: 66,
      totalToolCalls: 2521,
      volume: { messages: 549, linesAdded: 16843, linesDeleted: 1230, files: 290, days: 9, msgsPerDay: 61 },
      reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      toolUsage: {},
      sessionTypes: {},
      outcomes: { fullyAchieved: 24, mostlyAchieved: 6, partiallyAchieved: 2 },
      friction: { buggyCode: 15, wrongApproach: 12, misunderstoodRequest: 4 },
      satisfaction: { dissatisfied: 5, likelySatisfied: 50, satisfied: 19 },
      multiClauding: { overlapEvents: 52, sessionsInvolved: 45, messagePercent: 31 },
      responseTime: { medianSeconds: 80.6, averageSeconds: 188.4 },
      toolErrors: {},
    });
    mockUploadInsights.mockResolvedValue({ success: false, error: "mock" });
    mockQueueRecalculate.mockResolvedValue(undefined);
    mockReadFileSync.mockReturnValue("<html></html>");
    mockResolve.mockImplementation((p: string) => `/resolved/${p}`);
  });

  afterEach(() => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  // ── --version ────────────────────────────────────────────────────────

  it("outputs version and returns cleanly for --version", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ version: true }));

    await runMain();

    const output = spyOutput(logSpy);
    // In dev/test mode, __CLI_VERSION__ is undefined so VERSION = "0.0.0-dev"
    expect(output).toContain("0.0.0-dev");
    expect(mockExit).not.toHaveBeenCalled();
  });

  // ── --help ───────────────────────────────────────────────────────────

  it("outputs help text and returns cleanly for --help", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ help: true }));

    await runMain();

    const output = spyOutput(logSpy);
    expect(output).toContain("chapa-cli");
    expect(output).toContain("Commands:");
    expect(output).toContain("chapa login");
    expect(output).toContain("chapa logout");
    expect(output).toContain("chapa merge");
    expect(output).toContain("--emu-handle");
    expect(output).toContain("--help");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("help text includes insights command and --file flag", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ help: true }));

    await runMain();

    const output = spyOutput(logSpy);
    expect(output).toContain("chapa insights");
    expect(output).toContain("--file");
  });

  it("help text includes --json and --verbose flags", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ help: true }));

    await runMain();

    const output = spyOutput(logSpy);
    expect(output).toContain("--json");
    expect(output).toContain("--verbose");
  });

  // ── --json + --verbose coexistence ────────────────────────────────────

  it("allows --json and --verbose together", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "merge",
      emuHandle: "corp_user",
      handle: "juan294",
      token: "auth-tok",
      json: true,
      verbose: true,
    }));
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 1 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockCreateLogger).toHaveBeenCalledWith({ verbose: true, json: true });
    expect(mockExit).not.toHaveBeenCalled();
    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(JSON.parse(written).success).toBe(true);
  });

  // ── --insecure ───────────────────────────────────────────────────────

  it("does not globally set NODE_TLS_REJECT_UNAUTHORIZED when --insecure is used", async () => {
    const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    mockParseArgs.mockReturnValue(defaultArgs({ command: "login", insecure: true }));

    await runMain();

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

    const allWarns = spyOutput(warnSpy);
    expect(allWarns).toContain("--insecure");
    expect(allWarns).toContain("Chapa server");
    expect(allWarns).toContain("GitHub API calls still validate TLS");

    // Restore
    if (originalVal !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalVal;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  });

  it("does not set NODE_TLS_REJECT_UNAUTHORIZED when --insecure is not used", async () => {
    const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    mockParseArgs.mockReturnValue(defaultArgs({ command: "login", insecure: false }));

    await runMain();

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

    // Restore
    if (originalVal !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalVal;
    }
  });

  it("forwards insecure: true to uploadSupplementalStats on merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "foo",
        handle: "juan294",
        token: "auth-tok",
        insecure: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 5 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({ insecure: true }),
    );
  });

  it("does NOT forward insecure to fetchEmuStats (GitHub always validates TLS)", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "foo",
        handle: "juan294",
        token: "auth-tok",
        insecure: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 5 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockFetchEmuStats).toHaveBeenCalled();
    const fetchEmuCalls = mockFetchEmuStats.mock.calls;
    for (const callArgs of fetchEmuCalls) {
      // callArgs[2] is the opts object passed to fetchEmuStats
      const opts = callArgs[2] as Record<string, unknown> | undefined;
      if (opts != null) {
        expect(opts).not.toHaveProperty("insecure");
      }
    }
  });

  // ── login command ────────────────────────────────────────────────────

  it("calls login() with server and options for 'login' command", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login", verbose: true }));

    await runMain();

    expect(mockLogin).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com",
      { verbose: true, insecure: false },
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("sends success telemetry on successful login", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com",
      expect.objectContaining({
        command: "login",
        stage: "complete",
        success: true,
        errorCategory: undefined,
        timing: expect.objectContaining({ authMs: expect.any(Number), totalMs: expect.any(Number) }),
      }),
      expect.anything(),
    );
  });

  it("rejects non-HTTPS login servers outside localhost", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "login",
      server: "http://insecure.example.com",
      serverExplicit: true,
    }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockLogin).not.toHaveBeenCalled();
    const output = spyOutput(errorSpy);
    expect(output).toContain("HTTPS");
    expect(output).toContain("localhost");
  });

  it("does not import insights module for login command", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));

    await runMain();

    expect(mockInsightsModuleImported).not.toHaveBeenCalled();
  });

  it("exits 1 through the error boundary when login rejects", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));
    mockLogin.mockRejectedValue(new Error("Session expired. Please try again."));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("sends failure telemetry when login rejects", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));
    mockLogin.mockRejectedValue(new Error("Timed out waiting for approval. Please try again."));
    mockClassifyError.mockReturnValue("network");

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com",
      expect.objectContaining({
        command: "login",
        stage: "auth",
        success: false,
        errorCategory: "network",
        timing: expect.objectContaining({ authMs: expect.any(Number), totalMs: expect.any(Number) }),
      }),
      expect.anything(),
    );
  });

  // ── logout command ───────────────────────────────────────────────────

  it("prints success message when logout removes credentials", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "logout" }));
    mockDeleteConfig.mockReturnValue(true);

    await runMain();

    expect(mockDeleteConfig).toHaveBeenCalled();
    const output = spyOutput(logSpy);
    expect(output).toContain("Logged out");
    expect(output).toContain("credentials.json");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("prints 'not logged in' when logout finds no credentials", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "logout" }));
    mockDeleteConfig.mockReturnValue(false);

    await runMain();

    expect(mockDeleteConfig).toHaveBeenCalled();
    const output = spyOutput(logSpy);
    expect(output).toContain("Not logged in");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("surfaces config delete errors during logout", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "logout" }));
    mockDeleteConfig.mockImplementation(() => {
      throw new Error("Could not remove ~/.chapa/credentials.json: EACCES");
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("Could not remove");
    expect(output).toContain("credentials.json");
  });

  // ── Unknown / no command ─────────────────────────────────────────────

  it("shows usage error and exits 1 for unknown command", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: null }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("Usage:");
    expect(output).toContain("login | logout | merge | insights");
    expect(output).toContain("--help");
  });

  it("shows a targeted error for an unknown command token", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: null, unknownCommand: "mrege" }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("Unknown command 'mrege'");
    expect(output).toContain("login | logout | merge | insights");
  });

  // ── merge: logger creation ──────────────────────────────────────────

  it("creates logger with verbose and json flags for merge command", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "merge", verbose: true }));
    mockLoadConfig.mockReturnValue({ token: "tok", handle: "user", server: "https://s.com" });

    await runMain();

    expect(mockCreateLogger).toHaveBeenCalledWith({ verbose: true, json: false });
  });

  // ── merge: missing --emu-handle ──────────────────────────────────────

  it("exits 1 when merge is called without --emu-handle", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "merge" }));
    mockLoadConfig.mockReturnValue({ token: "tok", handle: "user", server: "https://s.com" });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("--emu-handle is required");
  });

  // ── merge: missing personal handle ───────────────────────────────────

  it("exits 1 when merge has no personal handle (neither flag nor config)", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "merge", emuHandle: "corp_user" }));
    mockLoadConfig.mockReturnValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("No personal handle found");
    expect(output).toContain("chapa login");
  });

  // ── merge: missing EMU token ─────────────────────────────────────────

  it("exits 1 when merge has no EMU token", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "merge", emuHandle: "corp_user", handle: "juan294" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("EMU token required");
    expect(output).toContain("--emu-token");
    expect(output).toContain("GITHUB_EMU_TOKEN");
  });

  // ── merge: missing auth token ────────────────────────────────────────

  it("exits 1 when merge has no auth token (neither flag nor config)", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "merge", emuHandle: "corp_user", handle: "juan294" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok"); // EMU token resolves

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Not authenticated");
    expect(output).toContain("chapa login");
  });

  // ── merge: fetchEmuStats fails ───────────────────────────────────────

  it("exits 1 when fetchEmuStats returns a typed failure", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(
      failedFetchResult("GitHub user not found or inaccessible", "graphql"),
    );

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockUploadSupplementalStats).not.toHaveBeenCalled();
  });

  it("sends failure telemetry when GitHub fetch fails before upload", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(
      failedFetchResult("Request timed out after 30000ms", "network"),
    );

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "merge",
        stage: "fetch",
        success: false,
        errorCategory: "network",
        targetHandle: "juan294",
        sourceHandle: "corp_user",
        stats: expect.objectContaining({ commitsTotal: 0 }),
        timing: expect.objectContaining({ uploadMs: 0 }),
      }),
      expect.anything(),
    );
    expect(mockQueueTelemetry).toHaveBeenCalledTimes(1);
    expect(mockUploadSupplementalStats).not.toHaveBeenCalled();
  });

  // ── merge: upload fails ──────────────────────────────────────────────

  it("exits 1 when upload returns failure", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 10,
      prsMergedCount: 2,
      reviewsSubmittedCount: 1,
    }));
    mockUploadSupplementalStats.mockResolvedValue({
      success: false,
      error: "Server returned 401: Invalid token",
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Server returned 401");
  });

  it("sends failure telemetry when upload fails", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 10,
      reposContributed: 2,
      prsMergedCount: 2,
      activeDays: 5,
      reviewsSubmittedCount: 1,
    }));
    mockUploadSupplementalStats.mockResolvedValue({
      success: false,
      error: "Server returned 401: Invalid token",
    });
    mockClassifyError.mockReturnValue("auth");

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "merge",
        stage: "upload",
        success: false,
        errorCategory: "auth",
        targetHandle: "juan294",
        sourceHandle: "corp_user",
      }),
      expect.anything(),
    );
    expect(mockQueueTelemetry).toHaveBeenCalledTimes(1);
  });

  // ── merge: happy path ────────────────────────────────────────────────

  it("completes successfully when all merge inputs are valid", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 42,
      prsMergedCount: 5,
      reviewsSubmittedCount: 3,
      reposContributed: 7,
      activeDays: 180,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockFetchEmuStats).toHaveBeenCalledWith("corp_user", "emu-tok", expect.objectContaining({ logger: mockLogger }));
    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        targetHandle: "juan294",
        sourceHandle: "corp_user",
        token: "auth-tok",
        logger: mockLogger,
      }),
    );

    const output = loggerOutput(mockLogger.info);
    expect(output).toContain("Success!");
    expect(output).toContain("Stats merged for");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("does not import insights module for merge command", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 42,
      prsMergedCount: 5,
      reviewsSubmittedCount: 3,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockInsightsModuleImported).not.toHaveBeenCalled();
  });

  it("shows formatStatsSummary output in default merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 42,
      prsMergedCount: 5,
      reviewsSubmittedCount: 3,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });
    mockFormatStatsSummary.mockReturnValue("  Commits: 42\n  Repos: 7");

    await runMain();

    expect(mockFormatStatsSummary).toHaveBeenCalled();
    const output = loggerOutput(mockLogger.info);
    expect(output).toContain("Commits: 42");
    expect(output).toContain("Repos: 7");
  });

  it("sends success telemetry on successful merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 42,
      reposContributed: 7,
      prsMergedCount: 5,
      activeDays: 180,
      reviewsSubmittedCount: 3,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "merge",
        stage: "complete",
        success: true,
        targetHandle: "juan294",
        sourceHandle: "corp_user",
        stats: expect.objectContaining({ commitsTotal: 42 }),
        timing: expect.objectContaining({ fetchMs: expect.any(Number) }),
        cliVersion: expect.any(String),
      }),
      expect.anything(),
    );
    expect(mockQueueTelemetry).toHaveBeenCalledTimes(1);
  });

  // ── merge: --json output ─────────────────────────────────────────────

  it("outputs structured JSON on success when --json is set", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        json: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 42,
      activeDays: 180,
      prsMergedCount: 5,
      prsMergedWeight: 8.2,
      reviewsSubmittedCount: 3,
      issuesClosedCount: 1,
      linesAdded: 2340,
      linesDeleted: 890,
      reposContributed: 7,
      totalStars: 12,
      totalForks: 3,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    // JSON goes to process.stdout.write, not console.log
    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const jsonOutput = JSON.parse(written);
    expect(jsonOutput.success).toBe(true);
    expect(jsonOutput.targetHandle).toBe("juan294");
    expect(jsonOutput.sourceHandle).toBe("corp_user");
    expect(jsonOutput.stats.commitsTotal).toBe(42);
    expect(jsonOutput.stats.reposContributed).toBe(7);
    expect(jsonOutput.timing).toBeDefined();
    expect(jsonOutput.cliVersion).toBeDefined();
    // Logger info should NOT have been called for success message in JSON mode
    // (createLogger with json=true suppresses info)
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("outputs JSON with error on failure when --json is set", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        json: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 10,
      reposContributed: 2,
      prsMergedCount: 1,
      activeDays: 5,
      reviewsSubmittedCount: 0,
    }));
    mockUploadSupplementalStats.mockResolvedValue({
      success: false,
      error: "Server returned 500: Internal Server Error",
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const jsonOutput = JSON.parse(written);
    expect(jsonOutput.success).toBe(false);
    expect(jsonOutput.error).toContain("500");
  });

  // ── merge: uses config fallback for handle and token ─────────────────

  it("falls back to config handle and token when flags are not provided", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "merge", emuHandle: "corp_user" }),
    );
    mockLoadConfig.mockReturnValue({
      token: "config-auth-tok",
      handle: "config-user",
      server: "https://custom.server.com",
    });
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 10,
      prsMergedCount: 1,
      reviewsSubmittedCount: 0,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        targetHandle: "config-user",
        token: "config-auth-tok",
        serverUrl: "https://custom.server.com",
      }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("warns when merge implicitly uses a saved non-default server", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "merge", emuHandle: "corp_user" }),
    );
    mockLoadConfig.mockReturnValue({
      token: "config-auth-tok",
      handle: "config-user",
      server: "https://custom.server.com",
    });
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 10 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    const warnings = loggerOutput(mockLogger.warn);
    expect(warnings).toContain("Using saved server");
    expect(warnings).toContain("https://custom.server.com");
  });

  it("rejects non-HTTPS merge servers outside localhost", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "http://insecure.example.com",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockFetchEmuStats).not.toHaveBeenCalled();
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("HTTPS");
    expect(output).toContain("localhost");
  });

  it("allows localhost HTTP servers for merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "http://localhost:3001",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 10 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "http://localhost:3001" }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("allows bracketed IPv6 loopback [::1] HTTP servers for merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "http://[::1]:3000",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 10 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "http://[::1]:3000" }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("allows 127.0.0.1 HTTP servers for merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "http://127.0.0.1:3000",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 10 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "http://127.0.0.1:3000" }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("rejects non-loopback HTTP servers (insecure.example.com) for merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "http://insecure.example.com",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockFetchEmuStats).not.toHaveBeenCalled();
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("HTTPS");
    expect(output).toContain("localhost");
  });

  it("surfaces config corruption instead of treating merge as logged out", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "merge", emuHandle: "corp_user" }),
    );
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Stored credentials are invalid JSON. Delete ~/.chapa/credentials.json and log in again.");
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("invalid JSON");
    expect(output).toContain("credentials.json");
  });

  // ── insights: missing --file ───────────────────────────────────────

  it("exits 1 when insights is called without --file", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "insights" }));
    mockLoadConfig.mockReturnValue({ token: "tok", handle: "user", server: "https://s.com" });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("--file is required");
  });

  // ── insights: missing personal handle ─────────────────────────────

  it("exits 1 when insights has no personal handle", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "insights", file: "report.html" }));
    mockLoadConfig.mockReturnValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("No personal handle found");
    expect(output).toContain("chapa login");
  });

  // ── insights: missing auth token ──────────────────────────────────

  it("exits 1 when insights has no auth token", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "juan294" }),
    );
    mockLoadConfig.mockReturnValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Not authenticated");
    expect(output).toContain("chapa login");
  });

  it("surfaces config corruption instead of treating insights as logged out", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "insights", file: "report.html" }));
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Stored credentials are missing required fields. Delete ~/.chapa/credentials.json and log in again.");
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("missing required fields");
    expect(output).toContain("credentials.json");
  });

  // ── insights: creates logger with correct flags ────────────────────

  it("creates logger with verbose and json flags for insights command", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", verbose: true }),
    );
    mockLoadConfig.mockReturnValue({ token: "tok", handle: "user", server: "https://s.com" });

    await runMain();

    expect(mockCreateLogger).toHaveBeenCalledWith({ verbose: true, json: false });
  });

  // ── insights: file not found ──────────────────────────────────────────

  it("exits 1 when insights file does not exist", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "nonexistent.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFileSync.mockImplementation(() => { throw err; });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("File not found");
  });

  // ── insights: invalid HTML (no sessions) ───────────────────────────────

  it("exits 1 when parsed HTML has no sessions", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "bad.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockParseInsightsHtml.mockReturnValue({
      tool: "claude-code",
      totalSessions: 0,
      volume: { messages: 0, days: 0 },
      reportPeriod: { start: "", end: "" },
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Could not extract session data");
  });

  it("sends failure telemetry when parsing insights HTML fails", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "bad.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockParseInsightsHtml.mockImplementation(() => {
      throw new Error("Malformed insights HTML");
    });
    mockClassifyError.mockReturnValue("unknown");

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "insights",
        stage: "parse",
        success: false,
        errorCategory: "unknown",
        targetHandle: "user",
        sourceHandle: "user",
        timing: expect.objectContaining({ parseMs: expect.any(Number), uploadMs: 0, totalMs: expect.any(Number) }),
      }),
      expect.anything(),
    );
  });

  // ── insights: upload failure ──────────────────────────────────────────

  it("exits 1 when upload returns failure", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: false,
      error: "Server returned 401: Invalid token",
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Server returned 401");
  });

  it("sends failure telemetry when insights upload fails", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: false,
      error: "Server returned 401: Invalid token",
    });
    mockClassifyError.mockReturnValue("auth");

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "insights",
        stage: "upload",
        success: false,
        errorCategory: "auth",
        targetHandle: "user",
        sourceHandle: "user",
        timing: expect.objectContaining({ parseMs: expect.any(Number), uploadMs: expect.any(Number), totalMs: expect.any(Number) }),
      }),
      expect.anything(),
    );
  });

  // ── insights: happy path ──────────────────────────────────────────────

  it("completes successfully and displays craft score", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 72,
        tier: "Expert",
        dimensions: { proficiency: 80, effectiveness: 70, sophistication: 66 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    expect(mockExit).not.toHaveBeenCalled();
    const output = loggerOutput(mockLogger.info);
    expect(output).toContain("Craft Score: 72/100 (Expert)");
    expect(output).toContain("Proficiency");
    expect(output).toContain("Effectiveness");
    expect(output).toContain("Sophistication");
    expect(output).toContain("Success!");
  });

  it("loads insights module when insights command runs", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 72,
        tier: "Expert",
        dimensions: { proficiency: 80, effectiveness: 70, sophistication: 66 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    expect(mockInsightsModuleImported).toHaveBeenCalled();
  });

  it("triggers recalculate on successful upload", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 55,
        tier: "Expert",
        dimensions: { proficiency: 60, effectiveness: 55, sophistication: 50 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    expect(mockQueueRecalculate).toHaveBeenCalled();
  });

  it("sends telemetry on successful insights upload", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok" }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 55,
        tier: "Expert",
        dimensions: { proficiency: 60, effectiveness: 55, sophistication: 50 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "insights",
        stage: "complete",
        success: true,
        targetHandle: "user",
        sourceHandle: "user",
        timing: expect.objectContaining({ parseMs: expect.any(Number), uploadMs: expect.any(Number), totalMs: expect.any(Number) }),
      }),
      expect.anything(),
    );
  });

  // ── insights: --json output ───────────────────────────────────────────

  it("outputs JSON on successful insights upload with --json", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok", json: true }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 72,
        tier: "Expert",
        dimensions: { proficiency: 80, effectiveness: 70, sophistication: 66 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const jsonOutput = JSON.parse(written);
    expect(jsonOutput.success).toBe(true);
    expect(jsonOutput.handle).toBe("user");
    expect(jsonOutput.craftScore.tier).toBe("Expert");
    expect(jsonOutput.timing).toBeDefined();
    expect(jsonOutput.cliVersion).toBeDefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("outputs JSON on failed insights upload with --json", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({ command: "insights", file: "report.html", handle: "user", token: "tok", json: true }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockUploadInsights.mockResolvedValue({
      success: false,
      error: "Server returned 429: Too many uploads",
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const jsonOutput = JSON.parse(written);
    expect(jsonOutput.success).toBe(false);
    expect(jsonOutput.error).toContain("429");
  });

  it("uses explicit default --server over a saved custom server for merge", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "https://chapa.thecreativetoken.com",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue({
      token: "t",
      handle: "h",
      server: "https://saved.server.com",
    });
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 10 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://chapa.thecreativetoken.com",
      }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("uses explicit default --server over a saved custom server for insights", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "insights",
        file: "report.html",
        handle: "user",
        token: "tok",
        server: "https://chapa.thecreativetoken.com",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue({
      token: "t",
      handle: "h",
      server: "https://saved.server.com",
    });
    mockUploadInsights.mockResolvedValue({
      success: true,
      craftScore: {
        craftScore: 72,
        tier: "Expert",
        dimensions: { proficiency: 80, effectiveness: 70, sophistication: 66 },
        reportPeriod: { start: "2026-02-20", end: "2026-03-07" },
      },
    });

    await runMain();

    expect(mockUploadInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://chapa.thecreativetoken.com",
      }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("uses explicit --server flag over config server when non-default", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "https://my-custom.example.com",
        serverExplicit: true,
      }),
    );
    mockLoadConfig.mockReturnValue({
      token: "t",
      handle: "h",
      server: "https://saved.server.com",
    });
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({
      commitsTotal: 10,
      prsMergedCount: 1,
      reviewsSubmittedCount: 0,
    }));
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://my-custom.example.com",
      }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  // ── Error boundary (W12) ──────────────────────────────────────────────

  it("catches unexpected errors in main() and exits 1 via error boundary", async () => {
    mockParseArgs.mockImplementation(() => {
      throw new Error("Unexpected kaboom");
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("Unexpected kaboom");
  });

  it("error boundary handles non-Error thrown values", async () => {
    mockParseArgs.mockImplementation(() => {
      throw "string error value";
    });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("string error value");
  });

  it("exits 1 when login() throws an unexpected error", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));
    mockLogin.mockRejectedValue(new Error("Network timeout"));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when fetchEmuStats throws an unexpected error", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
      }),
    );
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockRejectedValue(new Error("GraphQL schema mismatch"));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("GraphQL schema mismatch");
  });

  it("prefers the injected build-time version when __CLI_VERSION__ is defined", async () => {
    vi.stubGlobal("__CLI_VERSION__", "9.9.9-test");
    mockParseArgs.mockReturnValue(defaultArgs({ version: true }));

    await runMain();

    expect(spyOutput(logSpy)).toContain("9.9.9-test");
    vi.unstubAllGlobals();
  });

  it("rethrows non-Error login failures after telemetry classification", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "login" }));
    mockLogin.mockRejectedValue("plain failure");

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com",
      expect.objectContaining({
        success: false,
        errorCategory: "unknown",
      }),
      { insecure: false },
    );
  });

  it("reports non-ENOENT file read failures for insights uploads", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "insights",
      file: "report.html",
    }));
    mockLoadConfig.mockReturnValue({
      handle: "juan294",
      token: "auth-token",
      server: "https://chapa.thecreativetoken.com",
    });
    mockReadFileSync.mockImplementation(() => {
      const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
      throw err;
    });

    await runMain();

    expect(loggerOutput(mockLogger.error)).toContain("Error reading file: permission denied");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("emits JSON when insights upload fails without an explicit error message", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "insights",
      file: "report.html",
      json: true,
    }));
    mockLoadConfig.mockReturnValue({
      handle: "juan294",
      token: "auth-token",
      server: "https://chapa.thecreativetoken.com",
    });
    mockUploadInsights.mockResolvedValue({ success: false });

    await runMain();

    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const payload = JSON.parse(written);
    expect(payload.success).toBe(false);
    expect(payload.error).toBeUndefined();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("logs a plain success message when insights upload succeeds without a craft score", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "insights",
      file: "report.html",
    }));
    mockLoadConfig.mockReturnValue({
      handle: "juan294",
      token: "auth-token",
      server: "https://chapa.thecreativetoken.com",
    });
    mockUploadInsights.mockResolvedValue({ success: true });

    await runMain();

    expect(loggerOutput(mockLogger.info)).toContain("Success! Insights uploaded for juan294");
    expect(loggerOutput(mockLogger.info)).not.toContain("Craft Score:");
  });

  it("emits JSON when merge fetch fails in json mode", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "merge",
      handle: "juan294",
      emuHandle: "corp_user",
      emuToken: "emu-token",
      token: "auth-token",
      json: true,
    }));
    mockResolveToken.mockReturnValue("emu-token");
    mockFetchEmuStats.mockResolvedValue(failedFetchResult("fetch broke", "network"));

    await runMain();

    const written = stdoutWriteSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    const payload = JSON.parse(written);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("fetch broke");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("falls back to Upload failed when merge upload omits an error message", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "merge",
      handle: "juan294",
      emuHandle: "corp_user",
      emuToken: "emu-token",
      token: "auth-token",
    }));
    mockResolveToken.mockReturnValue("emu-token");
    mockFetchEmuStats.mockResolvedValue(successFetchResult({ commitsTotal: 1 }));
    mockUploadSupplementalStats.mockResolvedValue({ success: false });

    await runMain();

    expect(loggerOutput(mockLogger.error)).toContain("Error: undefined");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("classifies non-Error merge failures through the generic catch path", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "merge",
      handle: "juan294",
      emuHandle: "corp_user",
      emuToken: "emu-token",
      token: "auth-token",
    }));
    mockResolveToken.mockReturnValue("emu-token");
    mockFetchEmuStats.mockRejectedValue("plain failure");

    await runMain();

    expect(mockQueueTelemetry).toHaveBeenCalledWith(
      "https://chapa.thecreativetoken.com",
      expect.objectContaining({
        success: false,
        errorCategory: "unknown",
      }),
      { insecure: false },
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects invalid login server URLs before dispatching login", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({
      command: "login",
      server: "not a url",
      serverExplicit: true,
    }));

    await runMain();

    expect(spyOutput(errorSpy)).toContain("Invalid server URL: not a url");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
