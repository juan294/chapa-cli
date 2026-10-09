import { describe, it, expect } from "vitest";
import {
  stripTrailingSlashes,
  normalizeErrorCauseChain,
  getRootErrorMessage,
  getFullErrorChain,
} from "./shared";

describe("stripTrailingSlashes", () => {
  it("removes a single trailing slash", () => {
    expect(stripTrailingSlashes("https://example.com/")).toBe("https://example.com");
  });

  it("removes multiple trailing slashes", () => {
    expect(stripTrailingSlashes("https://example.com///")).toBe("https://example.com");
  });

  it("returns the string unchanged when there is no trailing slash", () => {
    expect(stripTrailingSlashes("https://example.com")).toBe("https://example.com");
  });

  it("returns empty string for empty input", () => {
    expect(stripTrailingSlashes("")).toBe("");
  });

  it("does not remove internal slashes", () => {
    expect(stripTrailingSlashes("https://example.com/api/v1/")).toBe("https://example.com/api/v1");
  });

  it("handles a string that is just slashes", () => {
    expect(stripTrailingSlashes("///")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeErrorCauseChain
// ---------------------------------------------------------------------------

describe("normalizeErrorCauseChain", () => {
  it("collects root, detail, and chain from nested errors", () => {
    const root = Object.assign(new Error("certificate failed"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    const mid = new Error("fetch failed", { cause: root });
    const top = new Error("request failed", { cause: mid });

    expect(normalizeErrorCauseChain(top)).toEqual({
      rootMessage: "certificate failed",
      detail: "request failed → fetch failed → certificate failed",
      chain: "request failed | fetch failed | certificate failed | SELF_SIGNED_CERT_IN_CHAIN",
    });
  });

  it("returns empty fields for non-Error input", () => {
    expect(normalizeErrorCauseChain("not an error")).toEqual({
      rootMessage: "",
      detail: "",
      chain: "",
    });
  });

  it("skips empty messages but preserves error codes in the chain", () => {
    const err = Object.assign(new Error(""), { code: "SELF_SIGNED_CERT_IN_CHAIN" });

    expect(normalizeErrorCauseChain(err)).toEqual({
      rootMessage: "",
      detail: "",
      chain: "SELF_SIGNED_CERT_IN_CHAIN",
    });
  });
});

// ---------------------------------------------------------------------------
// getRootErrorMessage
// ---------------------------------------------------------------------------

describe("getRootErrorMessage", () => {
  it("returns the message from a simple error", () => {
    expect(getRootErrorMessage(new Error("simple error"))).toBe("simple error");
  });

  it("returns the deepest cause message from a nested error chain", () => {
    const root = new Error("root cause");
    const mid = new Error("middle", { cause: root });
    const top = new Error("top level", { cause: mid });
    expect(getRootErrorMessage(top)).toBe("root cause");
  });

  it("returns empty string for non-Error input", () => {
    expect(getRootErrorMessage("not an error")).toBe("");
  });

  it("handles a single-level error (no cause)", () => {
    expect(getRootErrorMessage(new Error("only one"))).toBe("only one");
  });
});

// ---------------------------------------------------------------------------
// getFullErrorChain
// ---------------------------------------------------------------------------

describe("getFullErrorChain", () => {
  it("returns message from a single error", () => {
    expect(getFullErrorChain(new Error("single"))).toContain("single");
  });

  it("includes all messages from the cause chain", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    const result = getFullErrorChain(top);
    expect(result).toContain("top");
    expect(result).toContain("mid");
    expect(result).toContain("root");
  });

  it("includes error codes when present", () => {
    const err = Object.assign(new Error("cert failed"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    const result = getFullErrorChain(err);
    expect(result).toContain("cert failed");
    expect(result).toContain("SELF_SIGNED_CERT_IN_CHAIN");
  });

  it("returns empty string for non-Error input", () => {
    expect(getFullErrorChain("not an error")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractErrorDetail
// ---------------------------------------------------------------------------
