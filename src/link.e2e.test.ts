import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end witnesses for `chapa merge` (link) and `chapa unlink` (#1401).
 * Real argument parsing, logger, HTTP transport and telemetry payload
 * building; only `fetch`, the saved config and the detached telemetry
 * process are replaced.
 */

const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockSpawnDetachedPost = vi.hoisted(() => vi.fn());

vi.mock("./config.js", () => ({
  loadConfig: mockLoadConfig,
  deleteConfig: vi.fn(),
}));
vi.mock("./background.js", () => ({ spawnDetachedPost: mockSpawnDetachedPost }));

const SERVER = "https://chapa.thecreativetoken.com";
const CLI_TOKEN = "chapa-cli-token";
const EMU_TOKEN = "ghp_emuSecretToken123";
const HELP_URL = "https://github.com/juan294/chapa-cli#emu-token-setup";
const RECOVERY = "npx chapa-cli@latest merge --emu-handle corp_user --emu-token <token>";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LINKED = { linked: true, login: "corp_user", alsoRegistered: false, collection: "queued" };
const STATUS_OK = { linked: true, login: "corp_user", needsReconnect: false, connectedAt: "2026-10-08T10:00:00Z" };

let output: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;
const originalArgv = process.argv;
const originalEmuEnv = process.env.GITHUB_EMU_TOKEN;

function allOutput(): string {
  return output.join("");
}

function stdoutJson(): Record<string, unknown> {
  const text = stdoutChunks.join("");
  return JSON.parse(text) as Record<string, unknown>;
}

let stdoutChunks: string[];

async function runCli(argv: string[], done: () => boolean): Promise<void> {
  process.argv = ["node", "chapa", ...argv];
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", handler);
  try {
    await import("./index.js");
    await vi.waitFor(() => {
      if (!done() && exitSpy.mock.calls.length === 0) throw new Error("CLI still running");
    }, { timeout: 2000, interval: 5 });
    await new Promise((r) => setTimeout(r, 5));
  } finally {
    process.removeListener("unhandledRejection", handler);
  }
}

/** merge always emits telemetry in its finally block. */
const telemetrySent = () => mockSpawnDetachedPost.mock.calls.length > 0;

function telemetryPayloads(): unknown[] {
  return mockSpawnDetachedPost.mock.calls.map((c: unknown[]) => (c[0] as { body: unknown }).body);
}

function mergeArgs(...extra: string[]): string[] {
  return ["merge", "--emu-handle", "corp_user", "--emu-token", EMU_TOKEN, ...extra];
}

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  mockSpawnDetachedPost.mockReset();
  mockLoadConfig.mockReset();
  mockLoadConfig.mockReturnValue({ token: CLI_TOKEN, handle: "juan294", server: SERVER });
  vi.stubGlobal("fetch", mockFetch);
  delete process.env.GITHUB_EMU_TOKEN;

  output = [];
  stdoutChunks = [];
  const capture = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return capture(chunk);
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(capture as never);
  for (const method of ["log", "error", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.join(" ") + "\n");
    });
  }
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.argv = originalArgv;
  if (originalEmuEnv === undefined) delete process.env.GITHUB_EMU_TOKEN;
  else process.env.GITHUB_EMU_TOKEN = originalEmuEnv;
});

describe("chapa merge links a secondary GitHub account", () => {
  it("posts { login, token } with the CLI Bearer token and never puts the token in a header", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs(), telemetrySent);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/api/github-linked`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ login: "corp_user", token: EMU_TOKEN });
    for (const call of mockFetch.mock.calls) {
      const headers = (call[1]!.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${CLI_TOKEN}`);
      for (const value of Object.values(headers)) expect(value).not.toContain(EMU_TOKEN);
    }
  });

  it("reads the token from GITHUB_EMU_TOKEN when --emu-token is absent", async () => {
    process.env.GITHUB_EMU_TOKEN = EMU_TOKEN;
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(["merge", "--emu-handle", "corp_user"], telemetrySent);

    expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual({ login: "corp_user", token: EMU_TOKEN });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("200: prints the linked message, reads the status once and exits 0", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(
      "Linked corp_user to juan294. Chapa will collect corp_user's activity daily; your badge updates after the next collection.",
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [statusUrl, statusInit] = mockFetch.mock.calls[1]!;
    expect(statusUrl).toBe(`${SERVER}/api/github-linked/status`);
    expect(statusInit.method).toBe("GET");
    expect(allOutput()).not.toContain("also has its own Chapa profile");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("200 with alsoRegistered and a deferred collection: prints both notes and exits 0", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ...LINKED, alsoRegistered: true, collection: "deferred" }))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(
      "corp_user also has its own Chapa profile; ask support to remove it to avoid a duplicate.",
    );
    expect(allOutput()).toContain("next daily run");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("200 with a status that needs a new token: prints the recovery command", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse({ ...STATUS_OK, needsReconnect: true }));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(RECOVERY);
  });

  it("200 still succeeds when the status read fails", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse({ error: "status_unavailable" }, 503));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain("Linked corp_user to juan294.");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("409: prints the server message, the token setup link and the required scopes, and exits 1", async () => {
    const message = "corp_user is already linked to another Chapa profile. Unlink it there first (`chapa unlink` while logged in as that profile).";
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "linked_elsewhere", message }, 409));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(message);
    // A conflict is not a token problem: no token setup guidance.
    expect(allOutput()).not.toContain(HELP_URL);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("names the token owner the server reports, not --handle", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ...LINKED, owner: "juan294" }))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs("--handle", "someone-else"), telemetrySent);

    expect(allOutput()).toContain("Linked corp_user to juan294.");
    expect(allOutput()).not.toContain("to someone-else");
  });

  it("404: explains that the server does not support linking yet, and exits 1", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain("This Chapa server does not support linking a second GitHub account yet.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    [429, { error: "rate_limited", message: "Too many requests. Please try again later." }],
    [400, { error: "invalid_body", message: "Send { login, token } with a GitHub login and a GitHub token." }],
    [401, { error: "cli_token_required", message: "Use the Chapa CLI token from `chapa login`, not a GitHub token." }],
    [503, { error: "github_unavailable", message: "GitHub could not verify the token. Try again later." }],
  ])("%i: prints the server message and exits 1", async (status, body) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body, status));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(body.message);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("422: prints the message, link, scopes, missing scopes and the recovery command, and exits 1", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: "insufficient_scope",
      message: "The token needs these scopes: repo, read:user, read:org.",
      requiredScopes: ["repo", "read:user", "read:org"],
      missingScopes: ["read:org"],
      helpUrl: HELP_URL,
    }, 422));

    await runCli(mergeArgs(), telemetrySent);

    const text = allOutput();
    expect(text).toContain("The token needs these scopes: repo, read:user, read:org.");
    expect(text).toContain(HELP_URL);
    expect(text).toContain("Required scopes: repo, read:user, read:org");
    expect(text).toContain("Missing scopes: read:org");
    expect(text).toContain(RECOVERY);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("403: prints the identity mismatch message, link and scopes, and exits 1", async () => {
    const message = "This token belongs to a different GitHub account, not corp_user.";
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "token_identity_mismatch", message }, 403));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(message);
    expect(allOutput()).toContain(HELP_URL);
    expect(allOutput()).toContain("repo, read:user, read:org");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("410: prints the body error and exits 1", async () => {
    const error = "chapa merge changed. Update: npx chapa-cli@latest merge --emu-handle corp_user";
    mockFetch.mockResolvedValueOnce(jsonResponse({ error }, 410));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain(error);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("503: prints the try-again message and exits 1", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: "persist_failed", message: "Chapa could not save the link. Try again.",
    }, 503));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain("Chapa could not save the link. Try again.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("401: prints the message, tells the user to log in, and exits 1", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: "cli_token_required", message: "Use the Chapa CLI token from `chapa login`, not a GitHub token.",
    }, 401));

    await runCli(mergeArgs(), telemetrySent);

    expect(allOutput()).toContain("Use the Chapa CLI token");
    expect(allOutput()).toContain("chapa login");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--json success: writes one JSON object with the link result", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ...LINKED, alsoRegistered: true }))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs("--json"), telemetrySent);

    const json = stdoutJson();
    expect(json).toEqual(expect.objectContaining({
      success: true,
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      linked: true,
      alsoRegistered: true,
      collection: "queued",
      linkStatus: { linked: true, login: "corp_user", needsReconnect: false, connectedAt: "2026-10-08T10:00:00Z" },
    }));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("--json failure: writes the code, message, scopes and recovery command, and exits 1", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: "token_rejected",
      message: "GitHub rejected this token. Create a new token and try again.",
      requiredScopes: ["repo", "read:user", "read:org"],
      helpUrl: HELP_URL,
    }, 422));

    await runCli(mergeArgs("--json"), telemetrySent);

    expect(stdoutJson()).toEqual(expect.objectContaining({
      success: false,
      status: 422,
      code: "token_rejected",
      error: "GitHub rejected this token. Create a new token and try again.",
      requiredScopes: ["repo", "read:user", "read:org"],
      helpUrl: HELP_URL,
      recoveryCommand: RECOVERY,
    }));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("the linked account token never leaks", () => {
  const answers: Array<[string, () => void]> = [
    ["success", () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ ...LINKED, alsoRegistered: true }))
        .mockResolvedValueOnce(jsonResponse({ ...STATUS_OK, needsReconnect: true }));
    }],
    ["422", () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        error: "insufficient_scope", message: "needs scopes", missingScopes: ["repo"], helpUrl: HELP_URL,
      }, 422));
    }],
    ["network failure", () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    }],
  ];

  for (const [label, arrange] of answers) {
    for (const mode of [["--verbose"], ["--verbose", "--json"]]) {
      it(`${label} ${mode.join(" ")}: the token is absent from output and telemetry`, async () => {
        arrange();

        await runCli(mergeArgs(...mode), telemetrySent);

        expect(allOutput()).not.toContain(EMU_TOKEN);
        const payloads = telemetryPayloads();
        expect(payloads).toHaveLength(1);
        expect(JSON.stringify(payloads[0])).not.toContain(EMU_TOKEN);
        for (const call of mockSpawnDetachedPost.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(EMU_TOKEN);
        }
      });
    }
  }

  it("telemetry keeps command merge with zero stats", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(LINKED))
      .mockResolvedValueOnce(jsonResponse(STATUS_OK));

    await runCli(mergeArgs(), telemetrySent);

    expect(telemetryPayloads()[0]).toEqual(expect.objectContaining({
      command: "merge",
      stage: "complete",
      success: true,
      targetHandle: "juan294",
      sourceHandle: "corp_user",
      stats: { commitsTotal: 0, reposContributed: 0, prsMergedCount: 0, activeDays: 0, reviewsSubmittedCount: 0 },
    }));
    // The server's telemetry validator requires fetchMs, uploadMs and totalMs.
    const timing = (telemetryPayloads()[0] as { timing: Record<string, unknown> }).timing;
    expect(timing).toEqual({ fetchMs: 0, uploadMs: expect.any(Number), totalMs: expect.any(Number) });
  });
});

describe("chapa unlink", () => {
  const outputSeen = () => output.length > 0;

  it("posts to /api/github-linked/disconnect with the CLI Bearer token and exits 0", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, linked: false }));

    await runCli(["unlink"], outputSeen);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/api/github-linked/disconnect`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CLI_TOKEN}`);
    expect(allOutput()).toContain("Unlinked");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("says nothing was linked when the server reports wasLinked:false", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, linked: false, owner: "juan294", wasLinked: false }));

    await runCli(["unlink"], outputSeen);

    expect(allOutput()).toContain("No second GitHub account was linked to juan294.");
    expect(allOutput()).not.toContain("Unlinked");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prints the server message and exits 1 when the delete fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: "persist_failed", message: "Chapa could not remove the link. Try again.",
    }, 503));

    await runCli(["unlink"], outputSeen);

    expect(allOutput()).toContain("Chapa could not remove the link. Try again.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("tells the user to log in and exits 1 on 401", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "authentication_required" }, 401));

    await runCli(["unlink"], outputSeen);

    expect(allOutput()).toContain("chapa login");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 without a request when not logged in", async () => {
    mockLoadConfig.mockReturnValue(null);

    await runCli(["unlink"], outputSeen);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(allOutput()).toContain("chapa login");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--json writes the unlink result", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, linked: false }));

    await runCli(["unlink", "--json"], outputSeen);

    expect(stdoutJson()).toEqual(expect.objectContaining({ success: true, linked: false, handle: "juan294" }));
  });

  it("is listed in the help text", async () => {
    await runCli(["--help"], outputSeen);

    expect(allOutput()).toContain("chapa unlink");
  });
});
