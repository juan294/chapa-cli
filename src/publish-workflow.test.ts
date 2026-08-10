import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the npm OIDC trusted-publishing setup (issue #123).
//
// The trust relationship registered with `npm trust github chapa-cli` binds to
// the repository, the workflow FILENAME, and the environment name. Breaking any
// of them fails a release with an opaque 401 that reads like bad credentials —
// and a release is the only time this workflow ever runs, so nothing else would
// catch it first. These assertions are the early warning.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const publishWorkflowPath = `${repoRoot}.github/workflows/publish.yml`;

const workflow = readFileSync(publishWorkflowPath, "utf8");

describe("publish workflow (npm trusted publishing)", () => {
  it("lives at the filename the npm trust relationship is registered against", () => {
    expect(existsSync(publishWorkflowPath)).toBe(true);
  });

  it("runs in the `npm` environment the trust relationship is bound to", () => {
    expect(workflow).toMatch(/^\s{4}environment:\s*npm\s*$/m);
  });

  it("grants id-token: write so npm can exchange an OIDC token", () => {
    expect(workflow).toMatch(/^\s+id-token:\s*write\s*$/m);
  });

  it("upgrades npm past 11.5.1, since Node 22 bundles npm 10.9 without OIDC", () => {
    expect(workflow).toMatch(/npm install -g npm@latest/);
  });

  it("publishes with provenance", () => {
    expect(workflow).toMatch(/npm publish .*--provenance/);
  });

  it("reads no repository secret — a stored token would defeat the migration", () => {
    // Comments may still name NPM_TOKEN to explain why it is gone; what must
    // not come back is an actual reference that feeds a credential to npm.
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN:/);
  });

  it("has no token-expiry reminder workflow left to nag about a dead token", () => {
    expect(
      existsSync(`${repoRoot}.github/workflows/token-expiry-reminder.yml`),
    ).toBe(false);
  });
});
