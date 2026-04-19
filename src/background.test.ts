import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { spawnDetachedPost } from "./background.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const mockSpawn = vi.mocked(spawn);

function getChildEnv(): NodeJS.ProcessEnv | undefined {
  const call = mockSpawn.mock.calls[0] as unknown[] | undefined;
  const opts = call?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
  return opts?.env;
}

function getMockUnref(): ReturnType<typeof vi.fn> {
  const result = mockSpawn.mock.results[0]?.value as { unref: ReturnType<typeof vi.fn> } | undefined;
  return result?.unref ?? vi.fn();
}

describe("spawnDetachedPost env isolation", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockSpawn.mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof spawn>);
  });

  it("does not leak GITHUB_EMU_TOKEN to the child", () => {
    process.env.GITHUB_EMU_TOKEN = "super-secret";
    try {
      spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
      const env = getChildEnv();
      expect(env).toBeDefined();
      expect(env!.GITHUB_EMU_TOKEN).toBeUndefined();
    } finally {
      delete process.env.GITHUB_EMU_TOKEN;
    }
  });

  it("does not leak arbitrary shell vars to the child", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
    process.env.NPM_TOKEN = "npm-secret";
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
      const env = getChildEnv();
      expect(env!.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env!.NPM_TOKEN).toBeUndefined();
      expect(env!.OPENAI_API_KEY).toBeUndefined();
    } finally {
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.NPM_TOKEN;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("propagates PATH, HOME, and NODE_EXTRA_CA_CERTS when present", () => {
    const origPath = process.env.PATH;
    process.env.NODE_EXTRA_CA_CERTS = "/etc/ssl/custom-ca.pem";
    try {
      spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
      const env = getChildEnv();
      expect(env!.PATH).toBe(origPath);
      expect(env!.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/custom-ca.pem");
    } finally {
      delete process.env.NODE_EXTRA_CA_CERTS;
    }
  });

  it("always sets CHAPA_BG_URL, CHAPA_BG_TIMEOUT_MS, CHAPA_BG_TOKEN, CHAPA_BG_BODY, CHAPA_BG_INSECURE", () => {
    spawnDetachedPost({
      url: "https://chapa.test/api/telemetry",
      timeoutMs: 5000,
      body: { hello: "world" },
      token: "chapa-token",
      insecure: true,
    });
    const env = getChildEnv();
    expect(env!.CHAPA_BG_URL).toBe("https://chapa.test/api/telemetry");
    expect(env!.CHAPA_BG_TIMEOUT_MS).toBe("5000");
    expect(env!.CHAPA_BG_TOKEN).toBe("chapa-token");
    expect(env!.CHAPA_BG_BODY).toBe(JSON.stringify({ hello: "world" }));
    expect(env!.CHAPA_BG_INSECURE).toBe("1");
  });

  it("sets CHAPA_BG_INSECURE to empty string when insecure is false/undefined", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    const env = getChildEnv();
    expect(env!.CHAPA_BG_INSECURE).toBe("");
  });

  it("sets CHAPA_BG_BODY to empty string when body is undefined", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    const env = getChildEnv();
    expect(env!.CHAPA_BG_BODY).toBe("");
  });

  it("calls unref on the spawned child so the parent can exit", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const unref = getMockUnref();
    expect(unref).toHaveBeenCalled();
  });
});
