import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (must be declared before vi.mock calls) ──────────────
const mockParseArgs = vi.hoisted(() => vi.fn());
const mockResolveToken = vi.hoisted(() => vi.fn());
const mockFetchEmuStats = vi.hoisted(() => vi.fn());
const mockUploadSupplementalStats = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockDeleteConfig = vi.hoisted(() => vi.fn());
const mockLogin = vi.hoisted(() => vi.fn());

vi.mock("./cli.js", () => ({ parseArgs: mockParseArgs }));
vi.mock("./auth.js", () => ({ resolveToken: mockResolveToken }));
vi.mock("./fetch-emu.js", () => ({ fetchEmuStats: mockFetchEmuStats }));
vi.mock("./upload.js", () => ({ uploadSupplementalStats: mockUploadSupplementalStats }));
vi.mock("./config.js", () => ({
  loadConfig: mockLoadConfig,
  deleteConfig: mockDeleteConfig,
}));
vi.mock("./login.js", () => ({ login: mockLogin }));

// ── Helpers ──────────────────────────────────────────────────────────────

/** Collect all output from a console spy into a single string. */
function spyOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

/** Default CliArgs shape — override per test. */
function defaultArgs(overrides: Record<string, unknown> = {}) {
  return {
    command: null,
    handle: undefined,
    emuHandle: undefined,
    emuToken: undefined,
    token: undefined,
    server: "https://chapa.thecreativetoken.com",
    verbose: false,
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

// ── Test Suite ───────────────────────────────────────────────────────────

describe("index.ts command dispatch", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

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

    // Safe defaults for all downstream mocks
    mockLoadConfig.mockReturnValue(null);
    mockResolveToken.mockReturnValue(null);
    mockFetchEmuStats.mockResolvedValue(null);
    mockUploadSupplementalStats.mockResolvedValue({ success: false, error: "mock" });
    mockLogin.mockResolvedValue(undefined);
    mockDeleteConfig.mockReturnValue(false);
  });

  afterEach(() => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
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
    expect(output).toContain("login | logout | merge");
    expect(output).toContain("--help");
  });

  // ── merge: missing --emu-handle ──────────────────────────────────────

  it("exits 1 when merge is called without --emu-handle", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "merge" }));
    mockLoadConfig.mockReturnValue({ token: "tok", handle: "user", server: "https://s.com" });

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
    expect(output).toContain("--emu-handle is required");
  });

  // ── merge: missing personal handle ───────────────────────────────────

  it("exits 1 when merge has no personal handle (neither flag nor config)", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "merge", emuHandle: "corp_user" }));
    mockLoadConfig.mockReturnValue(null);

    await runMain();

    expect(mockExit).toHaveBeenCalledWith(1);
    const output = spyOutput(errorSpy);
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
    const output = spyOutput(errorSpy);
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
    const output = spyOutput(errorSpy);
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
    const output = spyOutput(errorSpy);
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
    const output = spyOutput(errorSpy);
    expect(output).toContain("Server returned 401");
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
    });
    mockUploadSupplementalStats.mockResolvedValue({ success: true });

    await runMain();

    expect(mockFetchEmuStats).toHaveBeenCalledWith("corp_user", "emu-tok");
    expect(mockUploadSupplementalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        targetHandle: "juan294",
        sourceHandle: "corp_user",
        token: "auth-tok",
      }),
    );

    const output = spyOutput(logSpy);
    expect(output).toContain("Success!");
    expect(output).toContain("42 commits");
    expect(output).toContain("5 PRs merged");
    expect(output).toContain("3 reviews");
    expect(mockExit).not.toHaveBeenCalled();
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
