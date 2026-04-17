import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelemetry, classifyError, type TelemetryPayload } from "./telemetry";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("classifyError", () => {
  it("classifies 401 as auth", () => {
    expect(classifyError("Server returned 401: Invalid token")).toBe("auth");
  });

  it("classifies 403 as auth", () => {
    expect(classifyError("Server returned 403: Forbidden")).toBe("auth");
  });

  it("classifies ECONNREFUSED as network", () => {
    expect(classifyError("ECONNREFUSED")).toBe("network");
  });

  it("classifies ETIMEDOUT as network", () => {
    expect(classifyError("ETIMEDOUT")).toBe("network");
  });

  it("classifies normalized timeout messages as network", () => {
    expect(classifyError("Upload failed: Request timed out after 30000ms")).toBe("network");
  });

  it("classifies DNS errors as network", () => {
    expect(classifyError("getaddrinfo ENOTFOUND api.example.com")).toBe("network");
  });

  it("classifies GraphQL errors as graphql", () => {
    expect(classifyError("GraphQL errors for user: [...]")).toBe("graphql");
  });

  it("classifies 500 as server", () => {
    expect(classifyError("Server returned 500: Internal Server Error")).toBe("server");
  });

  it("classifies 502 as server", () => {
    expect(classifyError("Server returned 502")).toBe("server");
  });

  it("classifies unknown errors as unknown", () => {
    expect(classifyError("something weird happened")).toBe("unknown");
  });
});

describe("sendTelemetry", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePayload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
    return {
      operationId: "test-op-123",
      command: "merge",
      stage: "complete",
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      success: true,
      stats: {
        commitsTotal: 42,
        reposContributed: 7,
        prsMergedCount: 5,
        activeDays: 180,
        reviewsSubmittedCount: 3,
      },
      timing: {
        totalMs: 1163,
        fetchMs: 823,
        uploadMs: 340,
      },
      cliVersion: "0.2.9",
      ...overrides,
    };
  }

  it("sends POST to /api/telemetry with JSON body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry("https://chapa.example.com", makePayload());

    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.example.com/api/telemetry",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.command).toBe("merge");
    expect(body.stage).toBe("complete");
    expect(body.operationId).toBe("test-op-123");
    expect(body.targetHandle).toBe("juan294");
    expect(body.success).toBe(true);
  });

  it("supports login telemetry without merge handles", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry(
      "https://chapa.example.com",
      makePayload({
        command: "login",
        stage: "auth",
        targetHandle: undefined,
        sourceHandle: undefined,
        success: false,
        errorCategory: "network",
        timing: {
          totalMs: 9000,
          authMs: 9000,
        },
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.command).toBe("login");
    expect(body.stage).toBe("auth");
    expect(body.targetHandle).toBeUndefined();
    expect(body.sourceHandle).toBeUndefined();
    expect(body.timing.authMs).toBe(9000);
  });

  it("includes AbortSignal with 5s timeout", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry("https://chapa.example.com", makePayload());

    const opts = mockFetch.mock.calls[0]![1]!;
    expect(opts.signal).toBeDefined();
  });

  it("strips trailing slash from server URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry("https://chapa.example.com/", makePayload());

    expect(mockFetch).toHaveBeenCalledWith(
      "https://chapa.example.com/api/telemetry",
      expect.anything(),
    );
  });

  it("never throws on fetch failure (fire-and-forget)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    // Should not throw
    await expect(
      sendTelemetry("https://chapa.example.com", makePayload()),
    ).resolves.toBeUndefined();
  });

  it("never throws on non-ok response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "server" }, 500));

    await expect(
      sendTelemetry("https://chapa.example.com", makePayload()),
    ).resolves.toBeUndefined();
  });

  it("includes error category when success is false", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry(
      "https://chapa.example.com",
      makePayload({ success: false, errorCategory: "auth" }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.success).toBe(false);
    expect(body.errorCategory).toBe("auth");
  });

  it("does not include sensitive data (no tokens, no stack traces)", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await sendTelemetry("https://chapa.example.com", makePayload());

    const bodyStr = mockFetch.mock.calls[0]![1]!.body as string;
    expect(bodyStr).not.toContain("ghp_");
    expect(bodyStr).not.toContain("gho_");
    expect(bodyStr).not.toContain("Bearer");
    expect(bodyStr).not.toContain("stack");
  });

  it("never throws on timeout failures", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    mockFetch.mockRejectedValue(timeoutError);

    await expect(
      sendTelemetry("https://chapa.example.com", makePayload()),
    ).resolves.toBeUndefined();
  });
});
