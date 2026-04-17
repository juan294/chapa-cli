import { stripTrailingSlashes } from "./shared.js";
import { requestJson } from "./http.js";

export interface TelemetryPayload {
  operationId: string;
  targetHandle: string;
  sourceHandle: string;
  success: boolean;
  errorCategory?: "auth" | "network" | "graphql" | "server" | "unknown";
  stats: {
    commitsTotal: number;
    reposContributed: number;
    prsMergedCount: number;
    activeDays: number;
    reviewsSubmittedCount: number;
  };
  timing: {
    fetchMs: number;
    uploadMs: number;
    totalMs: number;
  };
  cliVersion: string;
}

/** Classify an error message into a category for dashboarding. */
export function classifyError(message: string): TelemetryPayload["errorCategory"] {
  if (/\b40[13]\b/.test(message)) return "auth";
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|DNS|timed out/i.test(message)) return "network";
  if (/graphql/i.test(message)) return "graphql";
  if (/\b5\d{2}\b/.test(message)) return "server";
  return "unknown";
}

/** Fire-and-forget telemetry. Never throws, never blocks. */
export async function sendTelemetry(
  serverUrl: string,
  payload: TelemetryPayload,
): Promise<void> {
  const baseUrl = stripTrailingSlashes(serverUrl);
  const url = `${baseUrl}/api/telemetry`;

  try {
    await requestJson<Record<string, never>>({
      url,
      method: "POST",
      timeoutMs: 5000,
      body: payload,
      fallbackData: {},
    });
  } catch {
    // Intentionally swallowed — telemetry must never block or fail the CLI
  }
}
