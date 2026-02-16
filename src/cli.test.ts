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
  });

  it("uses default server URL when not provided", () => {
    const args = parseArgs([
      "merge",
      "--handle", "juan294",
      "--emu-handle", "Juan_corp",
    ]);
    expect(args.server).toBe("https://chapa.thecreativetoken.com");
  });

  it("returns null command when no positional arg", () => {
    const args = parseArgs(["--handle", "juan294"]);
    expect(args.command).toBeNull();
  });

  it("returns null command for unknown commands", () => {
    const args = parseArgs(["unknown", "--handle", "juan294"]);
    expect(args.command).toBeNull();
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
});
