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
const mockSendTelemetry = vi.hoisted(() => vi.fn());
const mockClassifyError = vi.hoisted(() => vi.fn());
const mockParseInsightsHtml = vi.hoisted(() => vi.fn());
const mockUploadInsights = vi.hoisted(() => vi.fn());
const mockTriggerRecalculate = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockResolve = vi.hoisted(() => vi.fn());

vi.mock("./cli.js", () => ({ parseArgs: mockParseArgs, DEFAULT_SERVER: "https://chapa.thecreativetoken.com" }));
vi.mock("./auth.js", () => ({ resolveToken: mockResolveToken }));
vi.mock("./fetch-emu.js", () => ({ fetchEmuStats: mockFetchEmuStats }));
vi.mock("./upload.js", () => ({ uploadSupplementalStats: mockUploadSupplementalStats }));
vi.mock("./insights.js", () => ({
  parseInsightsHtml: mockParseInsightsHtml,
  uploadInsights: mockUploadInsights,
  triggerRecalculate: mockTriggerRecalculate,
}));
vi.mock("./config.js", () => ({
  loadConfig: mockLoadConfig,
  deleteConfig: mockDeleteConfig,
}));
vi.mock("./login.js", () => ({ login: mockLogin }));
vi.mock("./logger.js", () => ({ createLogger: mockCreateLogger }));
vi.mock("./shared.js", () => ({ formatStatsSummary: mockFormatStatsSummary }));
vi.mock("./telemetry.js", () => ({
  sendTelemetry: mockSendTelemetry,
  classifyError: mockClassifyError,
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
    handle: undefined,
    emuHandle: undefined,
    emuToken: undefined,
    token: undefined,
    file: undefined,
    server: "https://chapa.thecreativetoken.com",
    verbose: false,
    json: false,
    insecure: false,
    version: false,
    help: false,
    ...overrides,
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
    mockFetchEmuStats.mockResolvedValue(null);
    mockUploadSupplementalStats.mockResolvedValue({ success: false, error: "mock" });
    mockLogin.mockResolvedValue(undefined);
    mockDeleteConfig.mockReturnValue(false);
    mockFormatStatsSummary.mockReturnValue("  Commits:  42\n  PRs merged:  5");
    mockSendTelemetry.mockResolvedValue(undefined);
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
    mockTriggerRecalculate.mockResolvedValue(undefined);
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

  it("outputs version and exits with code 0 for --version", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ version: true }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(0);
    const output = spyOutput(logSpy);
    // In dev/test mode, __CLI_VERSION__ is undefined so VERSION = "0.0.0-dev"
    expect(output).toContain("0.0.0-dev");
  });

  // ── --help ───────────────────────────────────────────────────────────

  it("outputs help text and exits with code 0 for --help", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ help: true }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(0);
    const output = spyOutput(logSpy);
    expect(output).toContain("chapa-cli");
    expect(output).toContain("Commands:");
    expect(output).toContain("chapa login");
    expect(output).toContain("chapa logout");
    expect(output).toContain("chapa merge");
    expect(output).toContain("--emu-handle");
    expect(output).toContain("--help");
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

  // ── --json + --verbose mutual exclusion ───────────────────────────────

  it("exits 1 when --json and --verbose are both set", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ json: true, verbose: true }));

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("--json");
    expect(output).toContain("--verbose");
    expect(output).toContain("cannot be used together");
  });

  // ── --insecure ───────────────────────────────────────────────────────

  it("sets NODE_TLS_REJECT_UNAUTHORIZED and warns when --insecure is used", async () => {
    const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    mockParseArgs.mockReturnValue(defaultArgs({ command: "login", insecure: true }));

    await runMain();

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");

    const allWarns = spyOutput(warnSpy);
    expect(allWarns).toContain("TLS certificate verification disabled");
    expect(allWarns).toContain("--insecure");

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

  it("exits 1 when fetchEmuStats returns null", async () => {
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
    mockFetchEmuStats.mockResolvedValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = loggerOutput(mockLogger.error);
    expect(output).toContain("Failed to fetch EMU stats");
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 10,
      prsMergedCount: 2,
      reviewsSubmittedCount: 1,
    });
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 10,
      reposContributed: 2,
      prsMergedCount: 2,
      activeDays: 5,
      reviewsSubmittedCount: 1,
    });
    mockUploadSupplementalStats.mockResolvedValue({
      success: false,
      error: "Server returned 401: Invalid token",
    });
    mockClassifyError.mockReturnValue("auth");

    await runMain();

    expect(mockSendTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        success: false,
        errorCategory: "auth",
        targetHandle: "juan294",
        sourceHandle: "corp_user",
      }),
    );
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 42,
      prsMergedCount: 5,
      reviewsSubmittedCount: 3,
      reposContributed: 7,
      activeDays: 180,
    });
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 42,
      prsMergedCount: 5,
      reviewsSubmittedCount: 3,
    });
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 42,
      reposContributed: 7,
      prsMergedCount: 5,
      activeDays: 180,
      reviewsSubmittedCount: 3,
    });
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockSendTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        success: true,
        targetHandle: "juan294",
        sourceHandle: "corp_user",
        stats: expect.objectContaining({ commitsTotal: 42 }),
        timing: expect.objectContaining({ fetchMs: expect.any(Number) }),
        cliVersion: expect.any(String),
      }),
    );
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
    mockFetchEmuStats.mockResolvedValue({
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
    });
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 10,
      reposContributed: 2,
      prsMergedCount: 1,
      activeDays: 5,
      reviewsSubmittedCount: 0,
    });
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
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 10,
      prsMergedCount: 1,
      reviewsSubmittedCount: 0,
    });
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

  // ── merge: explicit server overrides config server ───────────────────

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

    expect(mockTriggerRecalculate).toHaveBeenCalled();
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

    expect(mockSendTelemetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        success: true,
        targetHandle: "user",
        sourceHandle: "user",
      }),
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

  // ── merge: explicit server overrides config server ───────────────────

  it("uses explicit --server flag over config server when non-default", async () => {
    mockParseArgs.mockReturnValue(
      defaultArgs({
        command: "merge",
        emuHandle: "corp_user",
        handle: "juan294",
        token: "auth-tok",
        server: "https://my-custom.example.com",
      }),
    );
    mockLoadConfig.mockReturnValue({
      token: "t",
      handle: "h",
      server: "https://saved.server.com",
    });
    mockResolveToken.mockReturnValue("emu-tok");
    mockFetchEmuStats.mockResolvedValue({
      commitsTotal: 10,
      prsMergedCount: 1,
      reviewsSubmittedCount: 0,
    });
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://my-custom.example.com",
      }),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });
});
