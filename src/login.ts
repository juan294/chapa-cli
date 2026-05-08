/**
 * Device authorization flow for Chapa CLI.
 *
 * 1. Generate a session ID (UUID)
 * 2. Display authorize URL for user to open in their personal browser
 * 3. Poll the server until the user approves
 * 4. Save the token locally
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { saveConfig } from "./config.js";
import { DEFAULT_SERVER } from "./cli.js";
import { stripTrailingSlashes } from "./shared.js";
import type { RequestFailure } from "./http.js";
import { requestJson } from "./http.js";

export const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes at 2s intervals

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PollResponse {
  status: "pending" | "approved" | "expired";
  token?: string;
  handle?: string;
}

interface LoginOptions {
  verbose?: boolean;
  insecure?: boolean;
  /** @internal — test injection points */
  _openBrowser?: (url: string) => void;
  _waitForEnter?: () => Promise<void>;
}

interface BrowserLaunchSpec {
  command: string;
  args: string[];
  shell: boolean;
}

export function getBrowserLaunchSpec(url: string, platform = process.platform): BrowserLaunchSpec {
  if (platform === "darwin") {
    return { command: "open", args: [url], shell: false };
  }

  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      shell: false,
    };
  }

  return { command: "xdg-open", args: [url], shell: false };
}

function openBrowser(url: string): void {
  const spec = getBrowserLaunchSpec(url);
  const child = spawn(spec.command, spec.args, { stdio: "ignore", shell: spec.shell });
  child.unref();
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("close", () => resolve());
    rl.question("", () => {
      rl.close();
      resolve(); // Also resolve directly — Promise.resolve is idempotent
    });
  });
}

const TLS_ERROR_PATTERNS = [
  // Node.js error codes (uppercase)
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERTIFICATE_VERIFY_FAILED",
  // Human-readable messages (lowercase, as returned by Node.js fetch)
  "self-signed certificate",
  "unable to verify",
  "certificate has expired",
];

function isTlsError(message: string): boolean {
  return TLS_ERROR_PATTERNS.some((p) => message.includes(p));
}

function handlePollFailure(
  failure: RequestFailure,
  attempt: number,
  verbose: boolean,
  insecure: boolean,
  serverErrorLogged: boolean,
): boolean {
  if (failure.category === "http") {
    if (verbose) {
      console.error(`[poll ${attempt}] HTTP ${failure.status}`);
    } else if (!serverErrorLogged) {
      console.error(`\nServer returned ${failure.status}. Retrying...`);
      return true;
    }

    return serverErrorLogged;
  }

  if (verbose) {
    console.error(`[poll ${attempt}] network error: ${failure.message}`);
  }
  if (!insecure && failure.chain && isTlsError(failure.chain)) {
    console.error(`\nTLS certificate error: ${failure.detail ?? failure.message}`);
    console.error("This looks like a corporate network with TLS interception.");
    console.error("  try: chapa login --insecure\n");
  }

  return serverErrorLogged;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1";
}

function assertHttpsServerUrl(serverUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(`Invalid server URL: ${serverUrl}`);
  }

  if (parsed.protocol === "https:") {
    return;
  }

  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return;
  }

  throw new Error(
    `--server must use HTTPS. Refusing to start device flow against insecure server ${serverUrl}. Use HTTPS, or http://localhost only for local development.`,
  );
}

export async function login(serverUrl: string, opts: LoginOptions = {}): Promise<void> {
  const { verbose = false, insecure = false, _openBrowser = openBrowser, _waitForEnter = waitForEnter } = opts;

  assertHttpsServerUrl(serverUrl);

  const baseUrl = stripTrailingSlashes(serverUrl);
  const sessionId = randomUUID();
  const authorizeUrl = `${baseUrl}/cli/authorize?session=${sessionId}`;

  console.log(`\n  ${authorizeUrl}\n`);
  console.log("Tip: If your default browser has your work (EMU) account,");
  console.log("     use a different browser or an incognito/private window.\n");

  if (process.stdin.isTTY) {
    console.log("Press ENTER to open in the browser...");
    await _waitForEnter();
    _openBrowser(authorizeUrl);
    console.log("Opened browser. Waiting for approval...");
  } else {
    console.log("Open the URL above in your browser.");
    console.log("Waiting for approval...");
  }

  let serverErrorLogged = false;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    // Progress feedback every poll
    if (i > 0) {
      process.stdout.write(".");
    }

    let data: PollResponse | null = null;
    try {
      const res = await requestJson<PollResponse>({
        url: `${baseUrl}/api/cli/auth/poll?session=${sessionId}`,
        timeoutMs: 10_000,
      });
      if (!res.ok) {
        serverErrorLogged = handlePollFailure(res, i + 1, verbose, insecure, serverErrorLogged);
        continue;
      }
      data = res.data;
      if (verbose) {
        console.error(`[poll ${i + 1}] ${data?.status ?? "no status"}`);
      }
    } catch (err) {
      const rootMsg = err instanceof Error ? err.message : String(err);
      if (verbose) {
        console.error(`[poll ${i + 1}] network error: ${rootMsg}`);
      }
      continue;
    }

    if (data?.status === "approved" && data.token && data.handle) {
      saveConfig({
        token: data.token,
        handle: data.handle,
        server: baseUrl,
      });
      console.log(`\nLogged in as ${data.handle}!`);
      console.log("Credentials saved to ~/.chapa/credentials.json");
      if (baseUrl !== DEFAULT_SERVER) {
        console.log(`Future merge and insights commands will reuse ${baseUrl} until you override it with --server.`);
      }
      return;
    }

    if (data?.status === "expired") {
      console.error("\nSession expired. Please try again.");
      throw new Error("Session expired. Please try again.");
    }
  }

  console.error("\nTimed out waiting for approval. Please try again.");
  throw new Error("Timed out waiting for approval. Please try again.");
}
