/**
 * Device authorization flow for Chapa CLI.
 *
 * 1. Generate a session ID (UUID)
 * 2. Display authorize URL for user to open in their personal browser
 * 3. Poll the server until the user approves
 * 4. Save the token locally
 */

import { randomUUID } from "node:crypto";
import { saveConfig } from "./config.js";

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

/**
 * Walk the error `.cause` chain and return the deepest message.
 * Node.js `fetch()` wraps real errors: Error("fetch failed", { cause: Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE") })
 */
function getRootErrorMessage(err: unknown): string {
  let current = err;
  let message = "";
  while (current instanceof Error) {
    message = current.message;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return message;
}

/**
 * Collect all messages and error codes from the cause chain (for TLS pattern matching).
 * Includes both .message and .code from each error in the chain.
 */
function getFullErrorChain(err: unknown): string {
  const parts: string[] = [];
  let current = err;
  while (current instanceof Error) {
    parts.push(current.message);
    const code = (current as Error & { code?: string }).code;
    if (code) parts.push(code);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

export async function login(serverUrl: string, opts: LoginOptions = {}): Promise<void> {
  const { verbose = false, insecure = false } = opts;

  const baseUrl = serverUrl.replace(/\/+$/, "");
  const sessionId = randomUUID();
  const authorizeUrl = `${baseUrl}/cli/authorize?session=${sessionId}`;

  console.log("\nOpen this URL in a browser where your personal GitHub account is logged in:");
  console.log(`\n  ${authorizeUrl}\n`);
  console.log("Tip: If your default browser has your work (EMU) account,");
  console.log("     use a different browser or an incognito/private window.\n");
  console.log("Waiting for approval...");

  let serverErrorLogged = false;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    // Progress feedback every 5 polls
    if (i > 0 && i % 5 === 0) {
      process.stdout.write(".");
    }

    let data: PollResponse | null = null;
    try {
      const res = await fetch(
        `${baseUrl}/api/cli/auth/poll?session=${sessionId}`,
      );
      if (!res.ok) {
        if (verbose) {
          console.error(`[poll ${i + 1}] HTTP ${res.status}`);
        } else if (!serverErrorLogged) {
          console.error(`\nServer returned ${res.status}. Retrying...`);
          serverErrorLogged = true;
        }
        continue;
      }
      data = await res.json();
      if (verbose) {
        console.error(`[poll ${i + 1}] ${data?.status ?? "no status"}`);
      }
    } catch (err) {
      const rootMsg = getRootErrorMessage(err);
      const fullChain = getFullErrorChain(err);
      if (verbose) {
        console.error(`[poll ${i + 1}] network error: ${rootMsg}`);
      }
      if (!insecure && isTlsError(fullChain)) {
        console.error(`\nTLS certificate error: ${rootMsg}`);
        console.error("This looks like a corporate network with TLS interception.");
        console.error("  try: chapa login --insecure\n");
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
      return;
    }

    if (data?.status === "expired") {
      console.error("\nSession expired. Please try again.");
      process.exit(1);
    }
  }

  console.error("\nTimed out waiting for approval. Please try again.");
  process.exit(1);
}
