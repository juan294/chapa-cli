import { spawn } from "node:child_process";

interface DetachedPostOptions {
  body?: unknown;
  timeoutMs: number;
  token?: string;
  url: string;
  insecure?: boolean;
}

const DETACHED_POST_SCRIPT = `
const url = process.env.CHAPA_BG_URL;
const timeoutMs = Number(process.env.CHAPA_BG_TIMEOUT_MS ?? "0");
const token = process.env.CHAPA_BG_TOKEN || "";
const rawBody = process.env.CHAPA_BG_BODY;
const insecure = process.env.CHAPA_BG_INSECURE === "1";

if (!url) {
  process.exit(0);
}

if (insecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
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

const ALLOWED_ENV_VARS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "APPDATA",
  "TMPDIR", "TEMP", "TMP",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

function buildChildEnv(extras: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_VARS) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return { ...env, ...extras };
}

export function spawnDetachedPost({
  body,
  timeoutMs,
  token,
  url,
  insecure,
}: DetachedPostOptions): void {
  try {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", DETACHED_POST_SCRIPT],
      {
        detached: true,
        env: buildChildEnv({
          CHAPA_BG_BODY: body === undefined ? "" : JSON.stringify(body),
          CHAPA_BG_TIMEOUT_MS: String(timeoutMs),
          CHAPA_BG_TOKEN: token ?? "",
          CHAPA_BG_URL: url,
          CHAPA_BG_INSECURE: insecure ? "1" : "",
        }),
        stdio: "ignore",
      },
    );

    child.unref();
  } catch {
    // Intentionally swallowed — background work must never block or fail the CLI.
  }
}
