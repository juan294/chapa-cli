/**
 * Tests for the HTTP transport layer (http.ts).
 *
 * AR-L1: Verifies that error-chain normalization is delegated to the canonical
 * utility in shared.ts — there is no local re-implementation in http.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestJson, requestText } from "./http";

describe("requestJson", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("returns ok: true with parsed JSON on success", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    );

    const result = await requestJson<{ hello: string }>({ url: "https://example.com/api" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toEqual({ hello: "world" });
    expect(result.status).toBe(200);
  });

  it("uses GET by default", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await requestJson({ url: "https://example.com" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends Authorization header when token is provided", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await requestJson({ url: "https://example.com", token: "my-token" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
      }),
    );
  });

  it("serializes object bodies as JSON and sets Content-Type", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await requestJson({ url: "https://example.com", method: "POST", body: { foo: "bar" } });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        body: JSON.stringify({ foo: "bar" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // HTTP error responses
  // ---------------------------------------------------------------------------

  it("returns ok: false with category 'http' on non-2xx status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("http");
    expect(result.status).toBe(404);
  });

  it("parses JSON error body when available", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
    );

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.body).toEqual({ message: "Unauthorized" });
  });

  it("returns text field when error body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Bad Gateway", { status: 502 }),
    );

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.text).toBe("Bad Gateway");
    expect(result.body).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Network error handling — AR-L1: chain normalization from shared.ts
  // ---------------------------------------------------------------------------

  it("returns ok: false with category 'network' on fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("network");
  });

  it("populates chain field with the full error cause chain (AR-L1)", async () => {
    // Simulate the real Node.js fetch error structure:
    // Error("fetch failed") -> cause: Error("SELF_SIGNED_CERT_IN_CHAIN")
    const cause = Object.assign(new Error("self-signed certificate in chain"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed", { cause }));

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    // chain must include the root error code (computed by normalizeErrorCauseChain in shared.ts)
    expect(result.chain).toContain("SELF_SIGNED_CERT_IN_CHAIN");
    // detail should reflect the cause message too
    expect(result.detail).toBeTruthy();
  });

  it("populates chain field with error codes for TLS pattern matching (AR-L1)", async () => {
    const cause = Object.assign(new Error("certificate verify failed"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed", { cause }));

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    // The chain field is what login.ts uses for TLS detection — must include error codes
    expect(result.chain).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("returns category 'timeout' when AbortSignal fires", async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    vi.mocked(fetch).mockRejectedValue(err);

    const result = await requestJson({ url: "https://example.com", timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("timeout");
    expect(result.message).toContain("5000");
  });

  // ---------------------------------------------------------------------------
  // Parse error handling
  // ---------------------------------------------------------------------------

  it("returns ok: false with category 'parse' when response body is empty and no fallback", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 200 }));

    const result = await requestJson({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("parse");
  });

  it("uses fallbackData when response body is empty", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 200 }));

    const result = await requestJson({ url: "https://example.com", fallbackData: { default: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toEqual({ default: true });
  });

  it("uses fallbackData when response body is invalid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not-json", { status: 200 }));

    const result = await requestJson({ url: "https://example.com", fallbackData: { fallback: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toEqual({ fallback: 1 });
  });
});

describe("requestText", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the response body as a string", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("plain text body", { status: 200 }));

    const result = await requestText({ url: "https://example.com" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.data).toBe("plain text body");
  });

  it("returns ok: false on HTTP errors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Server Error", { status: 500 }));

    const result = await requestText({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("http");
    expect(result.status).toBe(500);
  });

  it("returns ok: false with network error chain on fetch failure (AR-L1)", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error("fetch failed", { cause: new Error("DEPTH_ZERO_SELF_SIGNED_CERT") }),
    );

    const result = await requestText({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.category).toBe("network");
    // chain is computed by normalizeErrorCauseChain in shared.ts, used by http.ts
    expect(result.chain).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
  });
});
