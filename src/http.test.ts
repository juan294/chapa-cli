import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestJson } from "./http.js";

describe("requestJson with insecure: true", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  it("sets NODE_TLS_REJECT_UNAUTHORIZED='0' for the duration of the fetch", async () => {
    let envDuringFetch: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async () => {
      envDuringFetch = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      return new Response("{}", { status: 200 });
    }));

    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    await requestJson({ url: "https://x.test", insecure: true });

    expect(envDuringFetch).toBe("0");
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("restores NODE_TLS_REJECT_UNAUTHORIZED after a fetch that throws", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network boom");
    }));

    await requestJson({ url: "https://x.test", insecure: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("preserves a previously-set NODE_TLS_REJECT_UNAUTHORIZED value", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    await requestJson({ url: "https://x.test", insecure: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("1");
  });

  it("does not touch the env when insecure is false/undefined", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    vi.stubGlobal("fetch", vi.fn(async () => {
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      return new Response("{}", { status: 200 });
    }));
    await requestJson({ url: "https://x.test" });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
