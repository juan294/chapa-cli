import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  it("parses all required flags", () => {
    const args = parseArgs([
      "merge",
      "--handle", "juan294",
      "--emu-handle", "Juan_corp",
    ]);
    expect(args.command).toBe("merge");
    expect(args.handle).toBe("juan294");
    expect(args.emuHandle).toBe("Juan_corp");
  });

  it("parses optional flags", () => {
    const args = parseArgs([
      "merge",
      "--handle", "juan294",
      "--emu-handle", "Juan_corp",
      "--emu-token", "ghp_emu",
      "--token", "gho_personal",
      "--server", "http://localhost:3001",
    ]);
    expect(args.emuToken).toBe("ghp_emu");
    expect(args.token).toBe("gho_personal");
    expect(args.server).toBe("http://localhost:3001");
    expect(args.serverExplicit).toBe(true);
  });

  it("uses default server URL when not provided", () => {
    const args = parseArgs([
      "merge",
      "--handle", "juan294",
      "--emu-handle", "Juan_corp",
    ]);
    expect(args.server).toBe("https://chapa.thecreativetoken.com");
    expect(args.serverExplicit).toBe(false);
  });

  it("returns null command when no positional arg", () => {
    const args = parseArgs(["--handle", "juan294"]);
    expect(args.command).toBeNull();
    expect(args.unknownCommand).toBeNull();
  });

  it("preserves unknown command tokens for targeted errors", () => {
    const args = parseArgs(["unknown", "--handle", "juan294"]);
    expect(args.command).toBeNull();
    expect(args.unknownCommand).toBe("unknown");
  });

  it("accepts the command after flags", () => {
    const args = parseArgs(["--json", "merge", "--emu-handle", "corp"]);
    expect(args.command).toBe("merge");
    expect(args.unknownCommand).toBeNull();
    expect(args.json).toBe(true);
  });

  it("sets version flag when --version is passed", () => {
    const args = parseArgs(["--version"]);
    expect(args.version).toBe(true);
  });

  it("sets help flag when --help is passed", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  it("version and help default to false", () => {
    const args = parseArgs(["merge", "--handle", "juan294", "--emu-handle", "x"]);
    expect(args.version).toBe(false);
    expect(args.help).toBe(false);
  });

  it("sets insecure flag when --insecure is passed", () => {
    const args = parseArgs(["login", "--insecure"]);
    expect(args.insecure).toBe(true);
  });

  it("insecure defaults to false", () => {
    const args = parseArgs(["login"]);
    expect(args.insecure).toBe(false);
  });

  it("sets json flag when --json is passed", () => {
    const args = parseArgs(["merge", "--emu-handle", "corp", "--json"]);
    expect(args.json).toBe(true);
  });

  it("json defaults to false", () => {
    const args = parseArgs(["merge", "--emu-handle", "corp"]);
    expect(args.json).toBe(false);
  });

  it("parses insights command with --file", () => {
    const args = parseArgs(["insights", "--file", "/path/to/report.html"]);
    expect(args.command).toBe("insights");
    expect(args.file).toBe("/path/to/report.html");
  });

  it("parses insights with other flags", () => {
    const args = parseArgs([
      "insights",
      "--file", "report.html",
      "--json",
      "--server", "http://localhost:3000",
    ]);
    expect(args.command).toBe("insights");
    expect(args.file).toBe("report.html");
    expect(args.json).toBe(true);
    expect(args.server).toBe("http://localhost:3000");
  });

  it("file defaults to undefined", () => {
    const args = parseArgs(["insights"]);
    expect(args.command).toBe("insights");
    expect(args.file).toBeUndefined();
  });

  it("throws on unknown flags", () => {
    expect(() => parseArgs(["merge", "--bogus"])).toThrow();
  });
});
