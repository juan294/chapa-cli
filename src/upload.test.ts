import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { linkGitHubAccount, readGitHubLinkStatus, unlinkGitHubAccount } from "./upload";
import { uploadInsights, triggerRecalculate } from "./insights";
import type { InsightsUpload } from "./shared";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeInsightsData(): InsightsUpload {
  return {
    tool: "claude-code",
    reportPeriod: {
      start: "2026-02-20",
      end: "2026-03-07",
    },
    volume: {
      messages: 120,
      linesAdded: 800,
      linesDeleted: 250,
      files: 18,
      days: 12,
      msgsPerDay: 10,
    },
    toolUsage: { Read: 50, Edit: 30 },
    sessionTypes: { coding: 8, research: 4 },
    outcomes: {
      fullyAchieved: 6,
      mostlyAchieved: 4,
      partiallyAchieved: 2,
    },
    friction: {
      buggyCode: 1,
      wrongApproach: 2,
      misunderstoodRequest: 1,
    },
    satisfaction: {
      dissatisfied: 1,
      likelySatisfied: 3,
      satisfied: 8,
    },
    multiClauding: {
      overlapEvents: 2,
      sessionsInvolved: 2,
      messagePercent: 12,
    },
    responseTime: {
      medianSeconds: 18,
      averageSeconds: 24,
    },
    toolErrors: { bash: 1 },
    totalSessions: 12,
    totalToolCalls: 80,
  };
}

const SERVER = "https://chapa.thecreativetoken.com";
const CLI_TOKEN = "chapa-cli-token";
const EMU_TOKEN = "ghp_emuSecretToken123";

function linkOptions(overrides: Record<string, unknown> = {}) {
  return {
    serverUrl: SERVER,
    authToken: CLI_TOKEN,
    login: "corp_user",
    githubToken: EMU_TOKEN,
    ...overrides,
  };
}

function sentHeaders(callIndex = 0): Record<string, string> {
  return (mockFetch.mock.calls[callIndex]![1]!.headers ?? {}) as Record<string, string>;
}

describe("linkGitHubAccount", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts exactly { login, token } to /api/github-linked with the CLI Bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "Corp_User", alsoRegistered: false, collection: "queued",
    }));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({ ok: true, login: "Corp_User", alsoRegistered: false, collection: "queued" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/api/github-linked`);
    expect(init.method).toBe("POST");
    expect(sentHeaders().Authorization).toBe(`Bearer ${CLI_TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({ login: "corp_user", token: EMU_TOKEN });
  });

  it("never sends the linked account token in any header", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "corp_user", alsoRegistered: false, collection: "queued",
    }));

    await linkGitHubAccount(linkOptions());

    for (const value of Object.values(sentHeaders())) {
      expect(value).not.toContain(EMU_TOKEN);
    }
  });

  it("never writes the linked account token to the verbose logger", async () => {
    const lines: string[] = [];
    const logger = {
      info: (m: string) => lines.push(m), debug: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m),
      time: () => {}, timeEnd: () => 0, getTimings: () => ({}),
    };
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "corp_user", alsoRegistered: true, collection: "deferred",
    }));

    await linkGitHubAccount(linkOptions({ logger }));

    expect(lines.join("\n")).not.toContain(EMU_TOKEN);
  });

  it("strips trailing slashes from the server URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "corp_user", alsoRegistered: false, collection: "queued",
    }));

    await linkGitHubAccount(linkOptions({ serverUrl: `${SERVER}///` }));

    expect(mockFetch.mock.calls[0]![0]).toBe(`${SERVER}/api/github-linked`);
  });

  it("reports alsoRegistered and a deferred collection", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "corp_user", alsoRegistered: true, collection: "deferred",
    }));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({ ok: true, login: "corp_user", alsoRegistered: true, collection: "deferred" });
  });

  it("returns the server error code, message, scopes and help link on 422", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      error: "insufficient_scope",
      message: "The token needs these scopes: repo, read:user, read:org.",
      requiredScopes: ["repo", "read:user", "read:org"],
      missingScopes: ["read:org"],
      helpUrl: "https://github.com/juan294/chapa-cli#emu-token-setup",
    }, 422));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({
      ok: false,
      status: 422,
      code: "insufficient_scope",
      message: "The token needs these scopes: repo, read:user, read:org.",
      missingScopes: ["read:org"],
      helpUrl: "https://github.com/juan294/chapa-cli#emu-token-setup",
    });
  });

  it("falls back to the error field when a 410 body has no message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      error: "chapa merge changed. Update: npx chapa-cli@latest merge --emu-handle corp_user",
    }, 410));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 410,
      message: "chapa merge changed. Update: npx chapa-cli@latest merge --emu-handle corp_user",
    }));
  });

  it("names the HTTP status when an error body is not JSON", async () => {
    mockFetch.mockResolvedValue(new Response("Bad gateway", { status: 502 }));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({ ok: false, status: 502, message: "Server returned 502" });
  });

  it("reports network failures without the token", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await linkGitHubAccount(linkOptions());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe("Request failed: ECONNREFUSED");
  });

  it("rejects a 2xx answer that does not confirm the link", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({ ok: false, status: 200, message: "Unexpected response from the server" });
  });

  it("rejects an empty 2xx answer", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "" });

    const result = await linkGitHubAccount(linkOptions());

    expect(result).toEqual({ ok: false, status: 200, message: "Unexpected response from the server" });
  });

  it("refuses to send credentials to a plain http server", async () => {
    const result = await linkGitHubAccount(linkOptions({ serverUrl: "http://chapa.thecreativetoken.com" }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain("non-HTTPS");
  });
});

describe("readGitHubLinkStatus", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads /api/github-linked/status with the CLI Bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      linked: true, login: "corp_user", needsReconnect: true, connectedAt: "2026-10-08T10:00:00Z",
    }));

    const result = await readGitHubLinkStatus({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result).toEqual({
      ok: true,
      link: { linked: true, login: "corp_user", needsReconnect: true, connectedAt: "2026-10-08T10:00:00Z" },
    });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/api/github-linked/status`);
    expect(init.method).toBe("GET");
    expect(sentHeaders().Authorization).toBe(`Bearer ${CLI_TOKEN}`);
  });

  it("reports an unlinked account", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ linked: false }));

    const result = await readGitHubLinkStatus({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result).toEqual({ ok: true, link: { linked: false } });
  });

  it("returns a failure for an error answer", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "status_unavailable" }, 503));

    const result = await readGitHubLinkStatus({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result).toEqual({ ok: false, status: 503, code: "status_unavailable", message: "status_unavailable" });
  });

  it("rejects a linked answer without a login", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ linked: true }));

    const result = await readGitHubLinkStatus({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result.ok).toBe(false);
  });
});

describe("unlinkGitHubAccount", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /api/github-linked/disconnect with the CLI Bearer token and no body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, linked: false }));

    const result = await unlinkGitHubAccount({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result).toEqual({ ok: true });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/api/github-linked/disconnect`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(sentHeaders().Authorization).toBe(`Bearer ${CLI_TOKEN}`);
  });

  it("returns the server message when the delete fails", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      error: "persist_failed", message: "Chapa could not remove the link. Try again.",
    }, 503));

    const result = await unlinkGitHubAccount({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result).toEqual({
      ok: false, status: 503, code: "persist_failed", message: "Chapa could not remove the link. Try again.",
    });
  });

  it("rejects a 2xx answer that does not confirm the unlink", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, linked: true }));

    const result = await unlinkGitHubAccount({ serverUrl: SERVER, authToken: CLI_TOKEN });

    expect(result.ok).toBe(false);
  });
});

describe("uploadInsights write contract", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects empty 2xx responses instead of reporting success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Upload failed: Invalid JSON response");
  });

  it("rejects malformed 2xx JSON responses instead of reporting success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{",
    });

    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "gho_personal",
      serverUrl: "https://chapa.thecreativetoken.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Upload failed: Invalid JSON response");
  });
});

describe("HTTPS enforcement (#95)", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects uploadInsights over plain http with a token", async () => {
    const result = await uploadInsights({
      data: makeInsightsData(),
      token: "gho_personal",
      serverUrl: "http://chapa.thecreativetoken.com",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("non-HTTPS");
  });

  it("triggerRecalculate does not throw on http:// URL (fire-and-forget)", async () => {
    await expect(
      triggerRecalculate("http://chapa.thecreativetoken.com", "token"),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
