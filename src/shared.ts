/**
 * Shared CLI helpers and types: URL and error-chain utilities, and the
 * insights upload payload.
 */

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Remove trailing slashes from a URL string. */
export function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Error chain utilities
// ---------------------------------------------------------------------------

interface NormalizedErrorCauseChain {
  rootMessage: string;
  detail: string;
  chain: string;
}

export function normalizeErrorCauseChain(err: unknown): NormalizedErrorCauseChain {
  const messages: string[] = [];
  const chainParts: string[] = [];
  let current = err;

  while (current instanceof Error) {
    if (current.message) {
      chainParts.push(current.message);
      if (current.message !== messages[messages.length - 1]) {
        messages.push(current.message);
      }
    }

    const code = (current as Error & { code?: string }).code;
    if (code) {
      chainParts.push(code);
    }

    current = (current as Error & { cause?: unknown }).cause;
  }

  return {
    rootMessage: messages[messages.length - 1] ?? "",
    detail: messages.join(" → "),
    chain: chainParts.join(" | "),
  };
}

/**
 * Walk the error `.cause` chain and return the deepest message.
 * Node.js `fetch()` wraps real errors: Error("fetch failed", { cause: Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE") })
 */
export function getRootErrorMessage(err: unknown): string {
  return normalizeErrorCauseChain(err).rootMessage;
}

/**
 * Collect all messages and error codes from the cause chain (for TLS pattern matching).
 * Includes both .message and .code from each error in the chain.
 */
export function getFullErrorChain(err: unknown): string {
  return normalizeErrorCauseChain(err).chain;
}

// ── Insights types ──────────────────────────────────────────────────────

export interface InsightsUpload {
  tool: "claude-code";
  reportPeriod: {
    start: string; // ISO date (YYYY-MM-DD)
    end: string; // ISO date (YYYY-MM-DD)
  };
  volume: {
    messages: number;
    linesAdded: number;
    linesDeleted: number;
    files: number;
    days: number;
    msgsPerDay: number;
  };
  toolUsage: Record<string, number>;
  sessionTypes: Record<string, number>;
  outcomes: {
    fullyAchieved: number;
    mostlyAchieved: number;
    partiallyAchieved: number;
  };
  friction: {
    buggyCode: number;
    wrongApproach: number;
    misunderstoodRequest: number;
  };
  satisfaction: {
    dissatisfied: number;
    likelySatisfied: number;
    satisfied: number;
  };
  multiClauding: {
    overlapEvents: number;
    sessionsInvolved: number;
    messagePercent: number; // 0-100
  };
  responseTime: {
    medianSeconds: number;
    averageSeconds: number;
  };
  toolErrors: Record<string, number>;
  totalSessions: number;
  totalToolCalls: number;
}
