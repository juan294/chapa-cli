# Phase 4: `spawnDetachedPost` Env Allow-List

> **Project**: chapa-cli
> **Prerequisite**: Phase 3 (`CHAPA_BG_INSECURE` contract)
> **Files modified**: `src/background.ts`
> **Files created**: `src/background.test.ts`
> **Batch**: Not batch-eligible (shares `src/background.ts` with phase 3)
> **Status**: Not started

## Objective

Stop leaking the full parent `process.env` (including `GITHUB_EMU_TOKEN`, `GH_TOKEN`, AWS/Vercel/npm secrets, arbitrary shell vars) into the detached telemetry/recalculate child. Replace the `...process.env` spread with a narrow allow-list; the only CLI-specific values the child needs are already in the `CHAPA_BG_*` vars introduced earlier.

Reference: `docs/research/2026-04-19-deep-dive-validation.md` item H.

## Changes

### 1. Define the allow-list

**File**: `src/background.ts`

```pseudo
// Vars required for Node to boot + resolve the module loader + locate CAs.
// Keep this list intentionally narrow — everything CLI-specific goes through CHAPA_BG_*.
const ALLOWED_ENV_VARS = [
  "PATH",                    // Node binary resolution on POSIX
  "HOME",                    // required by some libc paths
  "USERPROFILE",             // Windows equivalent of HOME
  "SystemRoot",              // Windows — required for child Node boot
  "APPDATA",                 // Windows — npm/node config discovery
  "TMPDIR", "TEMP", "TMP",   // tmp dirs across POSIX/Windows
  "NODE_PATH",               // module resolution override, if set
  "NODE_EXTRA_CA_CERTS",     // additional CA bundle (corporate networks)
  "SSL_CERT_FILE",           // OpenSSL CA bundle
  "SSL_CERT_DIR",            // OpenSSL CA dir
] as const;

function buildChildEnv(extras: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_VARS) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return { ...env, ...extras };
}
```

### 2. Replace the spread

**File**: `src/background.ts` (around lines 55-62)

```pseudo
// before
env: {
  ...process.env,
  CHAPA_BG_BODY: body === undefined ? "" : JSON.stringify(body),
  CHAPA_BG_TIMEOUT_MS: String(timeoutMs),
  CHAPA_BG_TOKEN: token ?? "",
  CHAPA_BG_URL: url,
  CHAPA_BG_INSECURE: insecure ? "1" : "",
},

// after
env: buildChildEnv({
  CHAPA_BG_BODY: body === undefined ? "" : JSON.stringify(body),
  CHAPA_BG_TIMEOUT_MS: String(timeoutMs),
  CHAPA_BG_TOKEN: token ?? "",
  CHAPA_BG_URL: url,
  CHAPA_BG_INSECURE: insecure ? "1" : "",
}),
```

The child script (`DETACHED_POST_SCRIPT`) stays unchanged — it only reads `CHAPA_BG_*` and `NODE_TLS_REJECT_UNAUTHORIZED` (set internally based on `CHAPA_BG_INSECURE`), all of which are explicitly populated.

### 3. Do not fall back to process.env on missing allow-list vars

If `PATH` is somehow absent (extremely unusual), the child may fail to start. Do not paper over that — an absent `PATH` is a malformed environment and the detached call is best-effort anyway (failures are already swallowed at `src/background.ts:69-70`).

## Tests

### New: `src/background.test.ts`

```pseudo
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnDetachedPost } from "./background.js";

const mockUnref = vi.fn();
const mockSpawn = vi.fn(() => ({ unref: mockUnref }));

vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

describe("spawnDetachedPost env isolation", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockUnref.mockClear();
  });

  it("does not leak GITHUB_EMU_TOKEN to the child", () => {
    process.env.GITHUB_EMU_TOKEN = "super-secret";
    try {
      spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
      const env = mockSpawn.mock.calls[0]?.[2]?.env;
      expect(env).toBeDefined();
      expect(env!.GITHUB_EMU_TOKEN).toBeUndefined();
    } finally {
      delete process.env.GITHUB_EMU_TOKEN;
    }
  });

  it("does not leak arbitrary shell vars to the child", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
    process.env.NPM_TOKEN = "npm-secret";
    process.env.OPENAI_API_KEY = "sk-...";
    try {
      spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
      const env = mockSpawn.mock.calls[0]?.[2]?.env;
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
      const env = mockSpawn.mock.calls[0]?.[2]?.env;
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
    const env = mockSpawn.mock.calls[0]?.[2]?.env;
    expect(env!.CHAPA_BG_URL).toBe("https://chapa.test/api/telemetry");
    expect(env!.CHAPA_BG_TIMEOUT_MS).toBe("5000");
    expect(env!.CHAPA_BG_TOKEN).toBe("chapa-token");
    expect(env!.CHAPA_BG_BODY).toBe(JSON.stringify({ hello: "world" }));
    expect(env!.CHAPA_BG_INSECURE).toBe("1");
  });

  it("sets CHAPA_BG_INSECURE to empty string when insecure is false/undefined", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    const env = mockSpawn.mock.calls[0]?.[2]?.env;
    expect(env!.CHAPA_BG_INSECURE).toBe("");
  });

  it("sets CHAPA_BG_BODY to empty string when body is undefined", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    const env = mockSpawn.mock.calls[0]?.[2]?.env;
    expect(env!.CHAPA_BG_BODY).toBe("");
  });

  it("calls unref on the spawned child so the parent can exit", () => {
    spawnDetachedPost({ url: "https://x.test", timeoutMs: 1000 });
    expect(mockUnref).toHaveBeenCalled();
  });
});
```

## Success Criteria

### Automated

- `pnpm run typecheck` passes.
- `pnpm test src/background.test.ts` passes.
- Full `pnpm test` passes (existing `insights.test.ts` spawn assertions should still hold because they only check the `spawn` call count and the script's argv, not the env).

### Manual

- With `GITHUB_EMU_TOKEN=ghp_xxx chapa merge --emu-handle foo`, the detached telemetry child's `process.env.GITHUB_EMU_TOKEN` is undefined (verifiable by temporarily instrumenting the child script to log environ length).
- Running on Windows still works (PATH/USERPROFILE/SystemRoot allow-listed).
- Running behind a corporate root CA via `NODE_EXTRA_CA_CERTS` still allows the detached telemetry request to validate TLS when `--insecure` is **not** set.
