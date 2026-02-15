import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";

// Mock homedir to use a temp directory
const mockHome = vi.hoisted(() => vi.fn());
vi.mock("node:os", async () => {
  const actual = await import("node:os");
  return { ...actual, homedir: mockHome };
});

import { loadConfig, saveConfig, deleteConfig } from "./config";

describe("CLI config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "chapa-test-"));
    mockHome.mockReturnValue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig returns null when no config exists", () => {
    expect(loadConfig()).toBeNull();
  });

  it("saveConfig creates the .chapa directory and credentials file", () => {
    saveConfig({ token: "tok", handle: "user", server: "https://example.com" });
    const filePath = join(tempDir, ".chapa", "credentials.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf8"));
    expect(data.token).toBe("tok");
    expect(data.handle).toBe("user");
    expect(data.server).toBe("https://example.com");
  });

  it("loadConfig reads saved config", () => {
    saveConfig({ token: "t1", handle: "h1", server: "https://s.com" });
    const config = loadConfig();
    expect(config).toEqual({ token: "t1", handle: "h1", server: "https://s.com" });
  });

  it("deleteConfig removes the credentials file", () => {
    saveConfig({ token: "t", handle: "h", server: "https://s.com" });
    expect(deleteConfig()).toBe(true);
    expect(loadConfig()).toBeNull();
  });

  it("deleteConfig returns false when no config exists", () => {
    expect(deleteConfig()).toBe(false);
  });

  it("loadConfig returns null for malformed JSON", () => {
    const dir = join(tempDir, ".chapa");
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), "not json");
    expect(loadConfig()).toBeNull();
  });

  it("loadConfig returns null for JSON missing required fields", () => {
    const dir = join(tempDir, ".chapa");
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ token: "t" }));
    expect(loadConfig()).toBeNull();
  });
});
