import type { StatsData } from "./shared.js";

interface UploadOptions {
  targetHandle: string;
  sourceHandle: string;
  stats: StatsData;
  token: string;
  serverUrl: string;
}

interface UploadResult {
  success: boolean;
  error?: string;
}

export async function uploadSupplementalStats(
  opts: UploadOptions,
): Promise<UploadResult> {
  const baseUrl = opts.serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/supplemental`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        targetHandle: opts.targetHandle,
        sourceHandle: opts.sourceHandle,
        stats: opts.stats,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: `Server returned ${res.status}: ${body.error ?? "Unknown error"}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Upload failed: ${(err as Error).message}`,
    };
  }
}
