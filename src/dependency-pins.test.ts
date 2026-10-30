import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the dev-dependency pins against the drift found in the 2026-10-30
// triage. `pnpm.overrides.vite` was left at ^8.1.2 while `devDependencies.vite`
// asked for ^8.3.4. The override wins, so the lockfile kept resolving
// vite 8.2.2, which carries eight open Dependabot advisories (fixed in 8.2.4).
// The mismatch is silent: install, tests and build all pass.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface PackageJson {
  devDependencies: Record<string, string>;
  pnpm: { overrides: Record<string, string> };
}

const pkg = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8")) as PackageJson;
const lockfile = readFileSync(`${repoRoot}pnpm-lock.yaml`, "utf8");

/** Reads the root importer entry (`specifier` and `version`) for a dependency. */
function lockedImporter(name: string): { specifier: string; version: string } {
  const quoted = name.replace(/[/@]/g, (c) => `\\${c}`);
  const match = new RegExp(
    `^ {6}'?${quoted}'?:\\n {8}specifier: (\\S+)\\n {8}version: (\\S+)`,
    "m",
  ).exec(lockfile);
  const [, specifier, version] = match ?? [];
  if (!specifier || !version) {
    throw new Error(`${name} is not in the lockfile root importer`);
  }
  return { specifier: specifier.replace(/^'|'$/g, ""), version };
}

function parseVersion(version: string): number[] {
  return (version.split("(")[0] ?? "").split(".").map(Number);
}

function isAtLeast(version: string, floor: string): boolean {
  const have = parseVersion(version);
  const want = parseVersion(floor);
  for (let i = 0; i < 3; i += 1) {
    const [a, b] = [have[i] ?? 0, want[i] ?? 0];
    if (a !== b) return a > b;
  }
  return true;
}

describe("dev-dependency pins", () => {
  it("keeps every pnpm override that names a dev dependency on the same range", () => {
    const drifted = Object.entries(pkg.devDependencies)
      .filter(([name]) => name in pkg.pnpm.overrides)
      .filter(([name, range]) => pkg.pnpm.overrides[name] !== range)
      .map(([name, range]) => `${name}: devDependencies ${range} vs override ${pkg.pnpm.overrides[name]}`);
    expect(drifted).toEqual([]);
  });

  it("keeps the lockfile root importer on the package.json specifiers", () => {
    const drifted = Object.entries(pkg.devDependencies)
      .filter(([name, range]) => lockedImporter(name).specifier !== range)
      .map(([name, range]) => `${name}: package.json ${range} vs lockfile ${lockedImporter(name).specifier}`);
    expect(drifted).toEqual([]);
  });

  it("resolves vite at or above 8.2.4, the first release without the open advisories", () => {
    expect(isAtLeast(lockedImporter("vite").version, "8.2.4")).toBe(true);
  });

  it("resolves vitest at or above 4.1.12, the first release with the @vitest/mocker fixes", () => {
    expect(isAtLeast(lockedImporter("vitest").version, "4.1.12")).toBe(true);
  });
});
