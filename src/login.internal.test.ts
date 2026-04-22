import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSaveConfig = vi.hoisted(() => vi.fn());
const mockRequestJson = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })));
const mockCreateInterface = vi.hoisted(() => vi.fn());
const mockRandomUUID = vi.hoisted(() => vi.fn(() => "test-session-id"));

vi.mock("./config.js", () => ({
  saveConfig: mockSaveConfig,
}));

vi.mock("./http.js", () => ({
  requestJson: mockRequestJson,
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:readline", () => ({
  createInterface: mockCreateInterface,
}));

import { POLL_INTERVAL_MS, getBrowserLaunchSpec, login } from "./login.js";

describe("login internals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mockRequestJson.mockResolvedValue({
      ok: true,
      data: { status: "approved", token: "tok", handle: "juan294" },
    });
    mockCreateInterface.mockImplementation(() => {
      const handlers = new Map<string, () => void>();
      return {
        on: (event: string, handler: () => void) => {
          handlers.set(event, handler);
        },
        question: (_prompt: string, cb: () => void) => {
          cb();
        },
        close: () => {
          handlers.get("close")?.();
        },
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advancePoll() {
    await Promise.resolve();
    return vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10);
  }

  it("returns the darwin browser launch spec", () => {
    expect(getBrowserLaunchSpec("https://example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://example.com"],
      shell: false,
    });
  });

  it("returns the linux browser launch spec", () => {
    expect(getBrowserLaunchSpec("https://example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"],
      shell: false,
    });
  });

  it("uses the built-in readline and child_process helpers in TTY mode", async () => {
    const promise = login("https://example.com");
    await advancePoll();
    await promise;

    expect(mockCreateInterface).toHaveBeenCalledTimes(1);
    const expectedSpec = getBrowserLaunchSpec("https://example.com/cli/authorize?session=test-session-id");
    expect(mockSpawn).toHaveBeenCalledWith(
      expectedSpec.command,
      expectedSpec.args,
      expect.objectContaining({ shell: false, stdio: "ignore" }),
    );
  });

  it("logs verbose HTTP poll failures without the one-time retry banner", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockResolvedValueOnce({
        ok: false,
        category: "http",
        status: 503,
        message: "HTTP 503",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com", { verbose: true });
    await advancePoll();
    await advancePoll();
    await promise;

    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).toContain("[poll 1] HTTP 503");
    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).not.toContain("Retrying");
    errorSpy.mockRestore();
  });

  it("suppresses duplicate non-verbose server error banners", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockResolvedValueOnce({
        ok: false,
        category: "http",
        status: 503,
        message: "HTTP 503",
      })
      .mockResolvedValueOnce({
        ok: false,
        category: "http",
        status: 503,
        message: "HTTP 503",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com");
    await advancePoll();
    await advancePoll();
    await advancePoll();
    await promise;

    const output = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output.match(/Server returned 503/g)).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("prints 'no status' in verbose mode when the poll response omits status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockResolvedValueOnce({
        ok: true,
        data: {},
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com", { verbose: true });
    await advancePoll();
    await advancePoll();
    await promise;

    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).toContain("no status");
    errorSpy.mockRestore();
  });

  it("continues polling when requestJson throws a non-Error value", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockRejectedValueOnce("socket closed")
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com", { verbose: true });
    await advancePoll();
    await advancePoll();
    await promise;

    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).toContain("socket closed");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("suggests --insecure even when the TLS failure has no detail field", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockResolvedValueOnce({
        ok: false,
        category: "network",
        message: "network error",
        chain: "SELF_SIGNED_CERT_IN_CHAIN",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com");
    await advancePoll();
    await advancePoll();
    await promise;

    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).toContain("network error");
    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).toContain("--insecure");
    errorSpy.mockRestore();
  });

  it("continues silently when requestJson throws an Error outside verbose mode", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRequestJson
      .mockRejectedValueOnce(new Error("request blew up"))
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "approved", token: "tok", handle: "juan294" },
      });

    const promise = login("https://example.com");
    await advancePoll();
    await advancePoll();
    await promise;

    expect(errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n")).not.toContain("request blew up");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
