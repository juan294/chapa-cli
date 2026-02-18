import type { StatsData } from "./shared.js";
import type { Logger } from "./logger.js";

export interface UploadOptions {
  targetHandle: string;
  sourceHandle: string;
  stats: StatsData;
  token: string;
  serverUrl: string;
  logger?: Logger;
}

export interface UploadResult {
  success: boolean;
  error?: string;
  serverResponse?: unknown;
}

export async function uploadSupplementalStats(
  opts: UploadOptions,
): Promise<UploadResult> {
  const baseUrl = opts.serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/supplemental`;
  const log = opts.logger;

  const payload = JSON.stringify({
    targetHandle: opts.targetHandle,
    sourceHandle: opts.sourceHandle,
    stats: opts.stats,
  });

  log?.debug(`Upload payload size: ${payload.length} bytes`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: payload,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: `Server returned ${res.status}: ${body.error ?? "Unknown error"}`,
        serverResponse: body,
      };
    }

    const serverResponse = await res.json().catch(() => ({}));
    log?.debug(`Server response: ${JSON.stringify(serverResponse)}`);
    return { success: true, serverResponse };
  } catch (err) {
    return {
      success: false,
      error: `Upload failed: ${(err as Error).message}`,
    };
  }
}
