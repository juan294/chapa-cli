import type { StatsData } from "./shared.js";
import { stripTrailingSlashes } from "./shared.js";
import type { Logger } from "./logger.js";
import { requestJson } from "./http.js";

interface UploadOptions {
  targetHandle: string;
  sourceHandle: string;
  stats: StatsData;
  token: string;
  serverUrl: string;
  logger?: Logger;
  insecure?: boolean;
}

interface UploadResult {
  success: boolean;
  error?: string;
  serverResponse?: unknown;
}

export async function uploadSupplementalStats(
  opts: UploadOptions,
): Promise<UploadResult> {
  const baseUrl = stripTrailingSlashes(opts.serverUrl);
  const url = `${baseUrl}/api/supplemental`;
  const log = opts.logger;
  const payload = JSON.stringify({
    targetHandle: opts.targetHandle,
    sourceHandle: opts.sourceHandle,
    stats: opts.stats,
  });

  log?.debug(`Upload payload size: ${payload.length} bytes`);

  try {
    const res = await requestJson<Record<string, unknown>>({
      url,
      method: "POST",
      token: opts.token,
      timeoutMs: 30_000,
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      insecure: opts.insecure,
    });

    if (!res.ok) {
      if (res.category !== "http") {
        return {
          success: false,
          error: `Upload failed: ${res.message}`,
        };
      }

      const body = typeof res.body === "object" && res.body !== null
        ? res.body as Record<string, unknown>
        : {};
      const reason = typeof body.error === "string" ? body.error : "Unknown error";
      return {
        success: false,
        error: `Server returned ${res.status ?? "unknown"}: ${reason}`,
        serverResponse: body,
      };
    }

    const serverResponse = res.data;
    log?.debug(`Server response: ${JSON.stringify(serverResponse)}`);
    return { success: true, serverResponse };
  } catch (err) {
    return {
      success: false,
      error: `Upload failed: ${(err as Error).message}`,
    };
  }
}
