import { stripTrailingSlashes } from "./shared.js";
import type { Logger } from "./logger.js";
import { requestJson } from "./http.js";
import type { RequestResult } from "./http.js";

/**
 * Client for the Chapa linked GitHub account API (juan294/chapa#1401).
 *
 * `chapa merge` sends the secondary account's GitHub token once, in the JSON
 * body of POST /api/github-linked. The Chapa server verifies the token
 * belongs to that account, stores it encrypted and collects the account's
 * activity daily. The token is never sent in a header, logged or stored here.
 */

export const LINKED_GITHUB_REQUIRED_SCOPES = ["repo", "read:user", "read:org"] as const;
export const LINKED_GITHUB_TOKEN_HELP_URL = "https://github.com/juan294/chapa-cli#emu-token-setup";

interface ServerOptions {
  serverUrl: string;
  /** Chapa CLI token from `chapa login`, sent as the Bearer token. */
  authToken: string;
  insecure?: boolean;
  logger?: Logger;
}

interface LinkOptions extends ServerOptions {
  /** Login of the secondary GitHub account. */
  login: string;
  /** GitHub token of the secondary account. Sent only in the JSON body. */
  githubToken: string;
}

export interface ServerFailure {
  ok: false;
  status?: number;
  /** Server error code, for example `insufficient_scope`. */
  code?: string;
  message: string;
  missingScopes?: string[];
  helpUrl?: string;
}

export type LinkResult =
  | { ok: true; login: string; alsoRegistered: boolean; collection: "queued" | "deferred" }
  | ServerFailure;

export type LinkState =
  | { linked: false }
  | { linked: true; login: string; needsReconnect: boolean; connectedAt?: string };

export type LinkStatusResult = { ok: true; link: LinkState } | ServerFailure;

export type UnlinkResult = { ok: true } | ServerFailure;

type JsonObject = Record<string, unknown>;

const UNEXPECTED_RESPONSE = "Unexpected response from the server";

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
}

function toFailure(res: Exclude<RequestResult<unknown>, { ok: true }>): ServerFailure {
  if (res.category !== "http") {
    return res.category === "parse"
      ? { ok: false, status: res.status, message: UNEXPECTED_RESPONSE }
      : { ok: false, message: `Request failed: ${res.message}` };
  }

  const body = asObject(res.body);
  const code = typeof body.error === "string" ? body.error : undefined;
  const message = typeof body.message === "string"
    ? body.message
    : code ?? `Server returned ${res.status ?? "unknown"}`;
  const missingScopes = stringArray(body.missingScopes);
  const helpUrl = typeof body.helpUrl === "string" ? body.helpUrl : undefined;

  return {
    ok: false,
    ...(res.status !== undefined && { status: res.status }),
    ...(code !== undefined && { code }),
    message,
    ...(missingScopes && { missingScopes }),
    ...(helpUrl && { helpUrl }),
  };
}

async function callServer(
  opts: ServerOptions,
  path: string,
  method: "GET" | "POST",
  body?: JsonObject,
): Promise<{ ok: true; status: number; data: JsonObject } | ServerFailure> {
  const url = `${stripTrailingSlashes(opts.serverUrl)}${path}`;
  opts.logger?.debug(`${method} ${url}`);

  try {
    const res = await requestJson<unknown>({
      url,
      method,
      token: opts.authToken,
      timeoutMs: 30_000,
      body,
      insecure: opts.insecure,
    });
    opts.logger?.debug(`${method} ${url} -> ${res.ok ? res.status : res.status ?? res.category}`);
    return res.ok ? { ok: true, status: res.status, data: asObject(res.data) } : toFailure(res);
  } catch (err) {
    return { ok: false, message: `Request failed: ${(err as Error).message}` };
  }
}

/** Link a secondary GitHub account to the logged-in Chapa profile. */
export async function linkGitHubAccount(opts: LinkOptions): Promise<LinkResult> {
  const res = await callServer(opts, "/api/github-linked", "POST", {
    login: opts.login,
    token: opts.githubToken,
  });
  if (!res.ok) return res;

  const { linked, login, alsoRegistered, collection } = res.data;
  if (linked !== true || typeof login !== "string") {
    return { ok: false, status: res.status, message: UNEXPECTED_RESPONSE };
  }
  return {
    ok: true,
    login,
    alsoRegistered: alsoRegistered === true,
    collection: collection === "deferred" ? "deferred" : "queued",
  };
}

/** Read the linked secondary GitHub account of the logged-in Chapa profile. */
export async function readGitHubLinkStatus(opts: ServerOptions): Promise<LinkStatusResult> {
  const res = await callServer(opts, "/api/github-linked/status", "GET");
  if (!res.ok) return res;

  const { linked, login, needsReconnect, connectedAt } = res.data;
  if (linked === false) return { ok: true, link: { linked: false } };
  if (linked !== true || typeof login !== "string") {
    return { ok: false, status: res.status, message: UNEXPECTED_RESPONSE };
  }
  return {
    ok: true,
    link: {
      linked: true,
      login,
      needsReconnect: needsReconnect === true,
      ...(typeof connectedAt === "string" && { connectedAt }),
    },
  };
}

/** Remove the linked secondary GitHub account and its stored token. */
export async function unlinkGitHubAccount(opts: ServerOptions): Promise<UnlinkResult> {
  const res = await callServer(opts, "/api/github-linked/disconnect", "POST");
  if (!res.ok) return res;

  return res.data.linked === false
    ? { ok: true }
    : { ok: false, status: res.status, message: UNEXPECTED_RESPONSE };
}
