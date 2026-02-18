import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelemetry, classifyError, type TelemetryPayload } from "./telemetry";

const mockFetch = vi.fn();

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
        fetchMs: 823,
        uploadMs: 340,
        totalMs: 1163,
      },
      cliVersion: "0.2.9",
      ...overrides,
    };
  }

  it("sends POST to /api/telemetry with JSON body", async () => {
    mockFetch.mockResolvedValue({ ok: true });

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
    expect(body.operationId).toBe("test-op-123");
    expect(body.targetHandle).toBe("juan294");
    expect(body.success).toBe(true);
  });

  it("includes AbortSignal with 5s timeout", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendTelemetry("https://chapa.example.com", makePayload());

    const opts = mockFetch.mock.calls[0]![1]!;
    expect(opts.signal).toBeDefined();
  });

  it("strips trailing slash from server URL", async () => {
    mockFetch.mockResolvedValue({ ok: true });

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
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      sendTelemetry("https://chapa.example.com", makePayload()),
    ).resolves.toBeUndefined();
  });

  it("includes error category when success is false", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendTelemetry(
      "https://chapa.example.com",
      makePayload({ success: false, errorCategory: "auth" }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.success).toBe(false);
    expect(body.errorCategory).toBe("auth");
  });

  it("does not include sensitive data (no tokens, no stack traces)", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendTelemetry("https://chapa.example.com", makePayload());

    const bodyStr = mockFetch.mock.calls[0]![1]!.body as string;
    expect(bodyStr).not.toContain("ghp_");
    expect(bodyStr).not.toContain("gho_");
    expect(bodyStr).not.toContain("Bearer");
    expect(bodyStr).not.toContain("stack");
  });
});
