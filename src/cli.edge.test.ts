import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:util");
});

describe("parseArgs edge cases", () => {
  it("routes short flags through the single-dash path", async () => {
    const { parseArgs } = await import("./cli.js");

    const args = parseArgs(["merge", "-v", "-h"]);

    expect(args.command).toBe("merge");
    expect(args.version).toBe(true);
    expect(args.help).toBe(true);
  });

  it("treats -- as a terminator and leaves following tokens to strict parsing", async () => {
    const { parseArgs } = await import("./cli.js");

    expect(() => parseArgs(["merge", "--", "--help"])).toThrow();
  });

  it("rejects extra positional arguments after a recognized command", async () => {
    const { parseArgs } = await import("./cli.js");

    expect(() => parseArgs(["merge", "unexpected-positional"])).toThrow();
  });

  it("falls back to default values when util.parseArgs omits them", async () => {
    const parseArgsMock = vi.fn(() => ({
      values: {
        server: undefined,
        verbose: undefined,
        json: undefined,
        insecure: undefined,
        version: undefined,
        help: undefined,
      },
    }));

    vi.doMock("node:util", () => ({
      parseArgs: parseArgsMock,
    }));

    const { parseArgs, DEFAULT_SERVER } = await import("./cli.js");
    const args = parseArgs([]);

    expect(args.server).toBe(DEFAULT_SERVER);
    expect(args.serverExplicit).toBe(false);
    expect(args.verbose).toBe(false);
    expect(args.json).toBe(false);
    expect(args.insecure).toBe(false);
    expect(args.version).toBe(false);
    expect(args.help).toBe(false);
  });
});
