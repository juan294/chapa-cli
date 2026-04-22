import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("./shared.js");
});

describe("http helpers", () => {
  it("classifies non-Error throws as network failures", async () => {
    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw "plain failure";
    }));

    const result = await requestJson({ url: "https://example.com" });

    expect(result).toEqual({
      ok: false,
      category: "network",
      message: "plain failure",
      detail: "plain failure",
      chain: "plain failure",
    });
  });

  it("falls back to rootMessage when the normalized detail is empty", async () => {
    vi.doMock("./shared.js", async () => {
      const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
      return {
        ...actual,
        normalizeErrorCauseChain: vi.fn(() => ({
          rootMessage: "root only",
          detail: "",
          chain: "root only",
        })),
      };
    });

    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ignored");
    }));

    const result = await requestJson({ url: "https://example.com" });

    expect(result).toEqual({
      ok: false,
      category: "network",
      message: "root only",
      detail: "root only",
      chain: "root only",
    });
  });

  it("falls back to a generic network message when every error string is empty", async () => {
    vi.doMock("./shared.js", async () => {
      const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
      return {
        ...actual,
        normalizeErrorCauseChain: vi.fn(() => ({
          rootMessage: "",
          detail: "",
          chain: "",
        })),
      };
    });

    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("");
    }));

    const result = await requestJson({ url: "https://example.com" });

    expect(result).toEqual({
      ok: false,
      category: "network",
      message: "Network request failed",
      detail: "",
      chain: "",
    });
  });

  it("passes Uint8Array bodies through unchanged", async () => {
    const { requestJson } = await import("./http.js");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = new Uint8Array([1, 2, 3]);

    await requestJson({ url: "https://example.com", method: "POST", body });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(body);
  });

  it("preserves an existing lowercase content-type header", async () => {
    const { requestJson } = await import("./http.js");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestJson({
      url: "https://example.com",
      method: "POST",
      headers: { "content-type": "application/custom+json" },
      body: { ok: true },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["content-type"]).toBe("application/custom+json");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("returns an empty http failure body when the response text is blank", async () => {
    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("   ", { status: 400 })));

    const result = await requestJson({ url: "https://example.com" });

    expect(result).toEqual({
      ok: false,
      category: "http",
      status: 400,
      message: "HTTP 400",
    });
  });

  it("uses fallbackData for empty successful JSON responses", async () => {
    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const result = await requestJson({
      url: "https://example.com",
      fallbackData: { ok: true },
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { ok: true },
    });
  });

  it("uses fallbackData for malformed successful JSON responses", async () => {
    const { requestJson } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{", { status: 200 })));

    const result = await requestJson({
      url: "https://example.com",
      fallbackData: { ok: true },
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { ok: true },
    });
  });

  it("returns requestText failures unchanged", async () => {
    const { requestText } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const result = await requestText({ url: "https://example.com" });

    expect(result).toEqual({
      ok: false,
      category: "http",
      status: 500,
      message: "HTTP 500",
      text: "nope",
    });
  });

  it("returns an empty string when requestText cannot read the body", async () => {
    const { requestText } = await import("./http.js");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("stream broken");
      },
    })));

    const result = await requestText({ url: "https://example.com" });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: "",
    });
  });
});
