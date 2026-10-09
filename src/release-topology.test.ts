import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const releaseCommand = readFileSync(
  `${repoRoot}.claude/commands/release.md`,
  "utf8",
);
const claudeGuidance = readFileSync(`${repoRoot}CLAUDE.md`, "utf8");
const deploymentSkill = readFileSync(
  `${repoRoot}.claude/skills/deployment-safety/SKILL.md`,
  "utf8",
);

describe("develop-to-main release topology", () => {
  it("promotes releases with a merge commit and rejects squash promotion", () => {
    const developFlow = releaseCommand.slice(
      releaseCommand.indexOf("### Develop-based flow"),
    );

    expect(developFlow).toContain("gh pr merge --merge --auto");
    expect(developFlow).not.toMatch(/gh pr merge --squash\b/);
  });

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
