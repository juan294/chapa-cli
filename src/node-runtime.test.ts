import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the Node runtime declarations (fleet Node engine overhaul, phase 7).
//
// Development, coverage and publishing run on the fleet line, which `.nvmrc`
// declares once. The user-facing support floor stays separate: `engines.node`,
// the tsup build target and the CI matrix that proves the floor must not move
// when the line moves.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) =>
  readFileSync(`${repoRoot}${relative}`, "utf8");

// Returns the `with:` inputs of every actions/setup-node step in a workflow.
function setupNodeInputs(workflow: string): string[][] {
  const lines = workflow.split("\n");
  const steps: string[][] = [];
  lines.forEach((line, index) => {
    const uses = line.match(/^(\s*)-\s+uses:\s*actions\/setup-node@/);
    if (!uses) return;
    const stepIndent = uses[1]?.length ?? 0;
    const inputs: string[] = [];
    for (const next of lines.slice(index + 1)) {
      const indent = next.match(/^\s*/)?.[0].length ?? 0;
      if (next.trim() !== "" && indent <= stepIndent) break;
      inputs.push(next.trim());
    }
    steps.push(inputs);
  });
  return steps;
}

describe("Node runtime declarations", () => {
  it(".nvmrc holds the bare line major", () => {
    expect(read(".nvmrc")).toBe("24\n");
  });

  for (const file of ["coverage.yml", "publish.yml"]) {
    it(`${file} reads the Node version from .nvmrc`, () => {
      const steps = setupNodeInputs(read(`.github/workflows/${file}`));
      expect(steps).toHaveLength(1);
      const inputs = steps[0] ?? [];
      expect(inputs).toContain("node-version-file: .nvmrc");
      expect(inputs.some((input) => input.startsWith("node-version:"))).toBe(
        false,
      );
    });
  }

  it("the CI matrix still proves the support floor on 20, 22 and 24", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/^\s+node-version:\s*\[20, 22, 24\]\s*$/m);
    const steps = setupNodeInputs(ci);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain("node-version: ${{ matrix.node-version }}");
  });

  it("keeps the published support floor and the matching build target", () => {
    const pkg = JSON.parse(read("package.json")) as {
      engines: { node: string };
    };
    expect(pkg.engines.node).toBe(">=20");
    expect(read("tsup.config.ts")).toMatch(/^\s+target:\s*"node20",\s*$/m);
  });
});
