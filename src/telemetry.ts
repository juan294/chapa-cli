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
  if (/40[13]/.test(message)) return "auth";
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|DNS/i.test(message)) return "network";
  if (/graphql/i.test(message)) return "graphql";
  if (/5\d{2}/.test(message)) return "server";
  return "unknown";
}

/** Fire-and-forget telemetry. Never throws, never blocks. */
export async function sendTelemetry(
  serverUrl: string,
  payload: TelemetryPayload,
): Promise<void> {
  const baseUrl = serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/telemetry`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Intentionally swallowed — telemetry must never block or fail the CLI
  }
}
