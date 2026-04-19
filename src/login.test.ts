import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
const mockSaveConfig = vi.hoisted(() => vi.fn());

vi.mock("./config.js", () => ({
  saveConfig: mockSaveConfig,
}));

import { getBrowserLaunchSpec, login, POLL_INTERVAL_MS } from "./login";

// Injected test doubles (avoid mocking node:readline/node:child_process built-ins)
const mockOpenBrowser = vi.fn();
const mockWaitForEnter = vi.fn().mockResolvedValue(undefined);

const loginOpts = (overrides: Record<string, unknown> = {}) => ({
  _openBrowser: mockOpenBrowser,
  _waitForEnter: mockWaitForEnter,
  ...overrides,
});

describe("getBrowserLaunchSpec", () => {
  it("avoids shell-based browser launch on Windows", () => {
    expect(getBrowserLaunchSpec("https://example.com", "win32")).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://example.com"],
      shell: false,
    });
  });
});

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());

    // Default: TTY mode (interactive terminal)
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advancePoll() {
    // Flush microtasks first — on Node 18, await in login() (e.g., await _waitForEnter())
    // may not resolve before advanceTimersByTimeAsync processes fake timers.
    await Promise.resolve();
    return vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
  }

  it("prints authorize URL and personal account hint to stdout", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "tok", handle: "juan294" }),
        { status: 200 },
      ),
    );

    const p = login("https://chapa.thecreativetoken.com", loginOpts());
    await advancePoll();
    await p;

    const allOutput = logSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allOutput).toContain("chapa.thecreativetoken.com/cli/authorize?session=");
    expect(allOutput).toContain("Press ENTER to open in the browser");
    logSpy.mockRestore();
  });

  it("saves config on successful approval", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "my-cli-token", handle: "alice" }),
        { status: 200 },
      ),
    );

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await p;

    expect(mockSaveConfig).toHaveBeenCalledWith({
      token: "my-cli-token",
      handle: "alice",
      server: "https://example.com",
    });
  });

  it("strips trailing slashes from server URL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      ),
    );

    const p = login("https://example.com///", loginOpts());
    await advancePoll();
    await p;

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ server: "https://example.com" }),
    );
  });

  it("polls until approved", async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll(); // poll 1 -> pending
    await advancePoll(); // poll 2 -> pending
    await advancePoll(); // poll 3 -> approved
    await p;

    expect(callCount).toBe(3);
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("writes progress dots during polling", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount < 6) {
        return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    for (let i = 0; i < 6; i++) await advancePoll();
    await p;

    const dots = writeSpy.mock.calls.filter(c => c[0] === ".").length;
    expect(dots).toBeGreaterThan(0);
    writeSpy.mockRestore();
  });

  it("logs server error status during polling", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable" }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll(); // poll 1 -> 503
    await advancePoll(); // poll 2 -> approved
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("503");
    errorSpy.mockRestore();
  });

  it("logs each poll response in verbose mode", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts({ verbose: true }));
    await advancePoll(); // poll 1 -> pending
    await advancePoll(); // poll 2 -> pending
    await advancePoll(); // poll 3 -> approved
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("[poll 1]");
    expect(allErrors).toContain("pending");
    expect(allErrors).toContain("[poll 3]");
    expect(allErrors).toContain("approved");
    errorSpy.mockRestore();
  });

  it("logs network errors in verbose mode", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("fetch failed");
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts({ verbose: true }));
    await advancePoll(); // poll 1 -> network error
    await advancePoll(); // poll 2 -> approved
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("[poll 1]");
    expect(allErrors).toContain("network error");
    errorSpy.mockRestore();
  });

  it("retries when a poll request times out", async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const timeoutError = new Error("The operation was aborted due to timeout");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    expect(callCount).toBe(2);
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("never mutates NODE_TLS_REJECT_UNAUTHORIZED — scoping is per-request in http.ts", async () => {
    // TLS bypass is per-request in http.ts (withInsecureTls), not in login().
    // Verify login() does NOT touch the env var.
    const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    const warnSpy = vi.spyOn(console, "warn");
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      ),
    );

    const p = login("https://example.com", loginOpts({ insecure: true }));
    await advancePoll();
    await p;

    // login() should NOT have set NODE_TLS_REJECT_UNAUTHORIZED
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

    // login() should NOT print TLS warning (index.ts does that)
    const allWarns = warnSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allWarns).not.toContain("TLS certificate verification disabled");

    if (originalVal !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalVal;
    }
    warnSpy.mockRestore();
  });

  it("suggests --insecure when TLS error is detected", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll(); // poll 1 -> TLS error
    await advancePoll(); // poll 2 -> approved
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("--insecure");
    expect(allErrors).toContain("corporate network");
    errorSpy.mockRestore();
  });

  it("suggests --insecure for CERT_HAS_EXPIRED errors", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("CERT_HAS_EXPIRED");
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("--insecure");
    errorSpy.mockRestore();
  });

  it("does not suggest --insecure for non-TLS errors", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("ECONNREFUSED");
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).not.toContain("--insecure");
    errorSpy.mockRestore();
  });

  it("verbose mode shows root cause from error.cause chain", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("fetch failed", {
          cause: new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
        });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts({ verbose: true }));
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    errorSpy.mockRestore();
  });

  it("suggests --insecure when TLS error is nested in error.cause", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("fetch failed", {
          cause: new Error("SELF_SIGNED_CERT_IN_CHAIN"),
        });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("--insecure");
    expect(allErrors).toContain("corporate network");
    errorSpy.mockRestore();
  });

  it("suggests --insecure for human-readable TLS messages with error code", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Real-world Node.js fetch error: human-readable message + code property
        const cause = Object.assign(
          new Error("self-signed certificate in certificate chain"),
          { code: "SELF_SIGNED_CERT_IN_CHAIN" },
        );
        throw new Error("fetch failed", { cause });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("--insecure");
    expect(allErrors).toContain("self-signed certificate");
    errorSpy.mockRestore();
  });

  it("suggests --insecure for human-readable TLS message without code property", async () => {
    const errorSpy = vi.spyOn(console, "error");
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Some environments only set the message, no code
        throw new Error("fetch failed", {
          cause: new Error("unable to verify the first certificate"),
        });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("--insecure");
    errorSpy.mockRestore();
  });

  it("opens browser after user presses ENTER in TTY mode", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      ),
    );

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await p;

    expect(mockOpenBrowser).toHaveBeenCalledOnce();
    const url = mockOpenBrowser.mock.calls[0]![0] as string;
    expect(url).toContain("example.com/cli/authorize");
  });

  it("does not prompt or open browser in non-TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const logSpy = vi.spyOn(console, "log");

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      ),
    );

    const p = login("https://example.com", loginOpts());
    await advancePoll();
    await p;

    const allOutput = logSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allOutput).not.toContain("Press ENTER");
    expect(allOutput).toContain("Open the URL above");
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockWaitForEnter).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("does not suggest --insecure when insecure is already enabled", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const originalVal = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const p = login("https://example.com", loginOpts({ insecure: true }));
    await advancePoll();
    await advancePoll();
    await p;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    // Should NOT suggest --insecure since it's already enabled
    expect(allErrors).not.toContain("try: chapa login --insecure");
    errorSpy.mockRestore();

    if (originalVal === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalVal;
    }
  });

  it("rejects with an expired-session error", { timeout: 10000 }, async () => {
    vi.useRealTimers(); // Use real timers for this test -- fast enough with 2s sleep

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "expired" }), { status: 200 }),
    );

    await expect(login("https://example.com", loginOpts())).rejects.toThrow(
      "Session expired. Please try again.",
    );
  });

  it("rejects with a timeout error after MAX_POLL_ATTEMPTS", async () => {
    const errorSpy = vi.spyOn(console, "error");

    // Always return pending
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
    );

    const noopWait = () => Promise.resolve();
    const noopOpen = () => {};
    const p = login("https://example.com", { _waitForEnter: noopWait, _openBrowser: noopOpen });
    const rejection = expect(p).rejects.toThrow("Timed out waiting for approval. Please try again.");
    // Advance fake timers through all 150 poll iterations
    for (let i = 0; i < 150; i++) await advancePoll();
    await rejection;

    const allErrors = errorSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(allErrors).toContain("Timed out");

    errorSpy.mockRestore();
  });

  it("prints a progress dot after every poll, not every 5 polls", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount < 4) {
        return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "approved", token: "t", handle: "h" }),
        { status: 200 },
      );
    });

    const noopWait = () => Promise.resolve();
    const noopOpen = () => {};
    const p = login("https://example.com", { _waitForEnter: noopWait, _openBrowser: noopOpen });
    for (let i = 0; i < 4; i++) await advancePoll();
    await p;

    // With 3 pending polls, we should get dots starting from poll index 1
    // (poll 0 is skipped as the initial poll, dots start at i > 0)
    const dots = writeSpy.mock.calls.filter(c => c[0] === ".").length;
    // Previously only every 5 polls got a dot; now every poll after the first
    expect(dots).toBeGreaterThanOrEqual(2);
    writeSpy.mockRestore();
  });
});
