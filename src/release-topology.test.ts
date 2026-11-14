import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const releaseSkills = [
  ".claude/skills/rpi-release/SKILL.md",
  ".agents/skills/rpi-release/SKILL.md",
].map((file) => [file, readFileSync(`${repoRoot}${file}`, "utf8")] as const);
const claudeGuidance = readFileSync(`${repoRoot}CLAUDE.md`, "utf8");
const deploymentSkill = readFileSync(
  `${repoRoot}.claude/skills/deployment-safety/SKILL.md`,
  "utf8",
);

describe("develop-to-main release topology", () => {
  it.each(releaseSkills)(
    "promotes releases with a merge commit and rejects squash promotion in %s",
    (_file, skill) => {
      const start = skill.indexOf(
        "## Project-specific procedure (develop to main",
      );
      const end = skill.indexOf("## Authorized publication");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const developFlow = skill.slice(start, end);

      expect(developFlow).toContain("gh pr merge --merge");
      expect(developFlow).not.toMatch(/gh pr merge --squash\b/);
    },
  );

  it("documents merge commits for releases and squash merges for features", () => {
    expect(claudeGuidance).toContain(
      "`develop` → `main` release PRs use a merge commit",
    );
    expect(claudeGuidance).toContain(
      "Feature PRs into `develop` may still squash.",
    );
    expect(claudeGuidance).toContain("Never squash a release PR.");
  });

  it("allows both merge methods for their distinct branch roles", () => {
    const developMainSettings = deploymentSkill.slice(
      deploymentSkill.indexOf("For a long-lived"),
      deploymentSkill.indexOf("For a main-only repository"),
    );

    expect(developMainSettings).toContain("allow_squash_merge=true");
    expect(developMainSettings).toContain("allow_merge_commit=true");
    expect(developMainSettings).toMatch(/feature PRs.*squash/is);
    expect(developMainSettings).toMatch(/release PRs.*merge commit/is);
  });
});
