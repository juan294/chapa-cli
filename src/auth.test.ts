import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveToken } from "./auth";

describe("resolveToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns explicit flag value when provided", () => {
    const token = resolveToken("ghp_explicit", "GITHUB_TOKEN");
    expect(token).toBe("ghp_explicit");
  });

  it("falls back to environment variable when flag is undefined", () => {
    process.env.GITHUB_TOKEN = "ghp_from_env";
    const token = resolveToken(undefined, "GITHUB_TOKEN");
    expect(token).toBe("ghp_from_env");
  });

  it("trims whitespace from environment variable", () => {
    process.env.GITHUB_TOKEN = "  ghp_padded  \n";
    const token = resolveToken(undefined, "GITHUB_TOKEN");
    expect(token).toBe("ghp_padded");
  });

  it("returns null when no flag and no env var", () => {
    delete process.env.GITHUB_TOKEN;
    const token = resolveToken(undefined, "GITHUB_TOKEN");
    expect(token).toBeNull();
  });
});
