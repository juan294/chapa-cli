import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("node:fs");
  vi.doUnmock("node:os");
});

describe("config error paths", () => {
  it("wraps unexpected read failures in ConfigError", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => "/tmp/chapa-config-read" };
    });

    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: vi.fn(() => {
          const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
          throw error;
        }),
      };
    });

    const { loadConfig } = await import("./config.js");

    expect(() => loadConfig()).toThrow(/Could not read ~\/\.chapa\/credentials\.json: permission denied/);
  });

  it("wraps unexpected delete failures in ConfigError", async () => {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => "/tmp/chapa-config-delete" };
    });

    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        unlinkSync: vi.fn(() => {
          const error = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
          throw error;
        }),
      };
    });

    const { deleteConfig } = await import("./config.js");

    expect(() => deleteConfig()).toThrow(/Could not remove ~\/\.chapa\/credentials\.json: operation not permitted/);
  });
});
