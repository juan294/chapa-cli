import { stripTrailingSlashes } from "./shared.js";
import { requestJson } from "./http.js";

export type TelemetryCommand = "login" | "merge" | "insights";
export type TelemetryStage = "auth" | "fetch" | "parse" | "upload" | "complete";
export type TelemetryErrorCategory = "auth" | "network" | "graphql" | "server" | "unknown";

export interface TelemetryStats {
  commitsTotal: number;
  reposContributed: number;
  prsMergedCount: number;
  activeDays: number;
  reviewsSubmittedCount: number;
}

export interface TelemetryPayload {
  operationId: string;
  command: TelemetryCommand;
  stage: TelemetryStage;
  targetHandle?: string;
  sourceHandle?: string;
  success: boolean;
  errorCategory?: TelemetryErrorCategory;
  stats: TelemetryStats;
  timing: {
    totalMs: number;
    authMs?: number;
    fetchMs?: number;
    parseMs?: number;
    uploadMs?: number;
  };
  cliVersion: string;
}

export const EMPTY_TELEMETRY_STATS: TelemetryStats = {
  commitsTotal: 0,
  reposContributed: 0,
  prsMergedCount: 0,
  activeDays: 0,
  reviewsSubmittedCount: 0,
};

/** Classify an error message into a category for dashboarding. */
export function classifyError(message: string): TelemetryErrorCategory {
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
