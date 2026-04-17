import { spawn } from "node:child_process";

interface DetachedPostOptions {
  body?: unknown;
  timeoutMs: number;
  token?: string;
  url: string;
}

const DETACHED_POST_SCRIPT = `
const url = process.env.CHAPA_BG_URL;
const timeoutMs = Number(process.env.CHAPA_BG_TIMEOUT_MS ?? "0");
const token = process.env.CHAPA_BG_TOKEN || "";
const rawBody = process.env.CHAPA_BG_BODY;

if (!url) {
  process.exit(0);
}

const headers = {};
let body;

if (rawBody) {
  headers["Content-Type"] = "application/json";
  body = rawBody;
}

if (token) {
  headers.Authorization = \`Bearer \${token}\`;
}

try {
  await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
} catch {
  // Intentionally swallowed — detached best-effort background request.
}
`;

export function spawnDetachedPost({
  body,
  timeoutMs,
  token,
  url,
}: DetachedPostOptions): void {
  try {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", DETACHED_POST_SCRIPT],
      {
        detached: true,
        env: {
          ...process.env,
          CHAPA_BG_BODY: body === undefined ? "" : JSON.stringify(body),
          CHAPA_BG_TIMEOUT_MS: String(timeoutMs),
          CHAPA_BG_TOKEN: token ?? "",
          CHAPA_BG_URL: url,
        },
        stdio: "ignore",
      },
    );

    child.unref();
  } catch {
    // Intentionally swallowed — background work must never block or fail the CLI.
  }
}
