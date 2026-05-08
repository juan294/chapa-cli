import { parseHTML } from "linkedom";
import type { InsightsUpload } from "./shared.js";
import { stripTrailingSlashes } from "./shared.js";
import { requestJson } from "./http.js";
import { spawnDetachedPost } from "./background.js";

interface ChartCards {
  toolUsage: Element | null;
  sessionTypes: Element | null;
  outcomes: Element | null;
  friction: Element | null;
  satisfaction: Element | null;
  toolErrors: Element | null;
  multiClauding: Element | null;
  responseTime: Element | null;
}

function collectChartCards(doc: Document): ChartCards {
  const cards: ChartCards = {
    toolUsage: null,
    sessionTypes: null,
    outcomes: null,
    friction: null,
    satisfaction: null,
    toolErrors: null,
    multiClauding: null,
    responseTime: null,
  };

  for (const card of doc.querySelectorAll(".chart-card")) {
    const title = card.querySelector(".chart-title")?.textContent?.trim() ?? "";

    if (!cards.toolUsage && title.startsWith("Top Tools Used")) {
      cards.toolUsage = card;
      continue;
    }

    if (!cards.sessionTypes && title.startsWith("Session Types")) {
      cards.sessionTypes = card;
      continue;
    }

    if (!cards.outcomes && title.startsWith("Outcomes")) {
      cards.outcomes = card;
      continue;
    }

    if (!cards.friction && title.startsWith("Primary Friction Types")) {
      cards.friction = card;
      continue;
    }

    if (!cards.satisfaction && title.startsWith("Inferred Satisfaction")) {
      cards.satisfaction = card;
      continue;
    }

    if (!cards.toolErrors && title.startsWith("Tool Errors Encountered")) {
      cards.toolErrors = card;
      continue;
    }

    if (!cards.multiClauding && title.startsWith("Multi-Clauding")) {
      cards.multiClauding = card;
      continue;
    }

    if (!cards.responseTime && title.startsWith("User Response Time")) {
      cards.responseTime = card;
    }
  }

  return cards;
}

function extractBarChart(card: Element | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!card) return result;

  const rows = card.querySelectorAll(".bar-row");
  for (const row of rows) {
    const label =
      row.querySelector(".bar-label")?.textContent?.trim() ?? "";
    const rawValue =
      row.querySelector(".bar-value")?.textContent?.trim() ?? "0";
    if (label) {
      result[label] = parseNumeric(rawValue);
    }
  }
  return result;
}

function parseNumeric(raw: string): number {
  const cleaned = raw.replace(/,/g, "").replace(/%/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseSubtitle(text: string): {
  messages: number;
  sessions: number;
  start: string;
  end: string;
} {
  const messagesMatch = text.match(/(\d[\d,]*)\s+messages/);
  const sessionsMatch = text.match(/(\d[\d,]*)\s+sessions/);
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);

  return {
    messages: messagesMatch ? parseNumeric(messagesMatch[1] ?? "0") : 0,
    sessions: sessionsMatch ? parseNumeric(sessionsMatch[1] ?? "0") : 0,
    start: dateMatch?.[1] ?? "",
    end: dateMatch?.[2] ?? "",
  };
}

function parseLinesStat(text: string): { added: number; deleted: number } {
  const match = text.match(/\+?([\d,]+)\s*\/\s*-?([\d,]+)/);
  if (!match) return { added: 0, deleted: 0 };
  return {
    added: parseNumeric(match[1] ?? "0"),
    deleted: parseNumeric(match[2] ?? "0"),
  };
}

function extractVolumeStats(doc: Document): {
  messages: number;
  linesAdded: number;
  linesDeleted: number;
  files: number;
  days: number;
  msgsPerDay: number;
} {
  const result = {
    messages: 0,
    linesAdded: 0,
    linesDeleted: 0,
    files: 0,
    days: 0,
    msgsPerDay: 0,
  };

  const stats = doc.querySelectorAll(".stats-row .stat");
  for (const stat of stats) {
    const value = stat.querySelector(".stat-value")?.textContent?.trim() ?? "";
    const label = stat.querySelector(".stat-label")?.textContent?.trim().toLowerCase() ?? "";

    switch (label) {
      case "messages":
        result.messages = parseNumeric(value);
        break;
      case "lines": {
        const lines = parseLinesStat(value);
        result.linesAdded = lines.added;
        result.linesDeleted = lines.deleted;
        break;
      }
      case "files":
        result.files = parseNumeric(value);
        break;
      case "days":
        result.days = parseNumeric(value);
        break;
      case "msgs/day":
        result.msgsPerDay = parseNumeric(value);
        break;
    }
  }

  return result;
}

function parseMultiClauding(card: Element | null): {
  overlapEvents: number;
  sessionsInvolved: number;
  messagePercent: number;
} {
  const result = { overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 };
  if (!card) return result;

  const statDivs = card.querySelectorAll("div[style]");
  const values: number[] = [];
  const labels: string[] = [];

  for (const div of statDivs) {
    const style = div.getAttribute("style") ?? "";
    if (style.includes("font-weight: 700") || style.includes("font-weight:700")) {
      values.push(parseNumeric(div.textContent?.trim() ?? "0"));
    }
    if (style.includes("text-transform: uppercase") || style.includes("text-transform:uppercase")) {
      labels.push(div.textContent?.trim().toLowerCase() ?? "");
    }
  }

  for (let i = 0; i < labels.length && i < values.length; i++) {
    const label = labels[i]!;
    const value = values[i]!;
    if (label.includes("overlap")) result.overlapEvents = value;
    else if (label.includes("sessions")) result.sessionsInvolved = value;
    else if (label.includes("message")) result.messagePercent = value;
  }

  return result;
}

function parseResponseTime(card: Element | null): {
  medianSeconds: number;
  averageSeconds: number;
} {
  const result = { medianSeconds: 0, averageSeconds: 0 };
  if (!card) return result;

  const text = card.textContent ?? "";
  const medianMatch = text.match(/Median:\s*([\d.]+)s/);
  const avgMatch = text.match(/Average:\s*([\d.]+)s/);

  if (medianMatch?.[1]) result.medianSeconds = parseNumeric(medianMatch[1]);
  if (avgMatch?.[1]) result.averageSeconds = parseNumeric(avgMatch[1]);

  return result;
}
function mapOutcomes(chart: Record<string, number>): {
  fullyAchieved: number;
  mostlyAchieved: number;
  partiallyAchieved: number;
} {
  return {
    fullyAchieved: chart["Fully Achieved"] ?? 0,
    mostlyAchieved: chart["Mostly Achieved"] ?? 0,
    partiallyAchieved: chart["Partially Achieved"] ?? 0,
  };
}

function mapFriction(chart: Record<string, number>): {
  buggyCode: number;
  wrongApproach: number;
  misunderstoodRequest: number;
} {
  return {
    buggyCode: chart["Buggy Code"] ?? 0,
    wrongApproach: chart["Wrong Approach"] ?? 0,
    misunderstoodRequest: chart["Misunderstood Request"] ?? 0,
  };
}

function mapSatisfaction(chart: Record<string, number>): {
  dissatisfied: number;
  likelySatisfied: number;
  satisfied: number;
} {
  return {
    dissatisfied: chart["Dissatisfied"] ?? 0,
    likelySatisfied: chart["Likely Satisfied"] ?? 0,
    satisfied: chart["Satisfied"] ?? 0,
  };
}

export function parseInsightsHtml(html: string): InsightsUpload {
  const { document: doc } = parseHTML(html);

  const subtitleEl = doc.querySelector(".subtitle");
  const subtitle = parseSubtitle(subtitleEl?.textContent ?? "");

  const volume = extractVolumeStats(doc);
  if (volume.messages === 0 && subtitle.messages > 0) {
    volume.messages = subtitle.messages;
  }

  const cards = collectChartCards(doc);
  const toolUsage = extractBarChart(cards.toolUsage);
  const totalToolCalls = Object.values(toolUsage).reduce((a, b) => a + b, 0);

  return {
    tool: "claude-code",
    reportPeriod: {
      start: subtitle.start,
      end: subtitle.end,
    },
    volume: {
      messages: volume.messages,
      linesAdded: volume.linesAdded,
      linesDeleted: volume.linesDeleted,
      files: volume.files,
      days: volume.days,
      msgsPerDay: volume.msgsPerDay,
    },
    toolUsage,
    sessionTypes: extractBarChart(cards.sessionTypes),
    outcomes: mapOutcomes(extractBarChart(cards.outcomes)),
    friction: mapFriction(extractBarChart(cards.friction)),
    satisfaction: mapSatisfaction(extractBarChart(cards.satisfaction)),
    multiClauding: parseMultiClauding(cards.multiClauding),
    responseTime: parseResponseTime(cards.responseTime),
    toolErrors: extractBarChart(cards.toolErrors),
    totalSessions: subtitle.sessions,
    totalToolCalls,
  };
}

// ── Upload ──────────────────────────────────────────────────────────────

import type { Logger } from "./logger.js";

interface InsightsUploadOptions {
  data: InsightsUpload;
  token: string;
  serverUrl: string;
  logger?: Logger;
}

interface InsightsUploadResult {
  success: boolean;
  error?: string;
  craftScore?: {
    dimensions: { proficiency: number; effectiveness: number; sophistication: number };
    craftScore: number;
    tier: string;
    reportPeriod: { start: string; end: string };
  };
}

export async function uploadInsights(
  opts: InsightsUploadOptions,
): Promise<InsightsUploadResult> {
  const baseUrl = stripTrailingSlashes(opts.serverUrl);
  const url = `${baseUrl}/api/insights`;
  const log = opts.logger;
  const payload = JSON.stringify(opts.data);
  log?.debug(`Insights payload size: ${payload.length} bytes`);

  try {
    const res = await requestJson<{
      craftScore?: InsightsUploadResult["craftScore"];
    }>({
      url,
      method: "POST",
      token: opts.token,
      timeoutMs: 30_000,
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
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
      const reason =
        typeof body.error === "string" ? body.error
          : typeof body.reason === "string" ? body.reason
            : "Unknown error";
      return {
        success: false,
        error: `Server returned ${res.status ?? "unknown"}: ${reason}`,
      };
    }

    const body = res.data;
    log?.debug(`Server response: ${JSON.stringify(body)}`);
    return {
      success: true,
      craftScore: body.craftScore,
    };
  } catch (err) {
    return {
      success: false,
      error: `Upload failed: ${(err as Error).message}`,
    };
  }
}

export async function triggerRecalculate(
  serverUrl: string,
  token: string,
  logger?: Logger,
): Promise<void> {
  const baseUrl = stripTrailingSlashes(serverUrl);
  const url = `${baseUrl}/api/recalculate`;

  try {
    const res = await requestJson<Record<string, never>>({
      url,
      method: "POST",
      token,
      timeoutMs: 30_000,
    });
    if (res.ok) {
      logger?.debug("Impact score recalculated.");
    } else {
      logger?.debug(`Recalculate returned ${res.status} — score will update on next view.`);
    }
  } catch {
    logger?.debug("Recalculate request failed — score will update on next view.");
  }
}

export function queueRecalculate(serverUrl: string, token: string): void {
  const baseUrl = stripTrailingSlashes(serverUrl);

  spawnDetachedPost({
    url: `${baseUrl}/api/recalculate`,
    timeoutMs: 30_000,
    token,
  });
}

// Export helpers for isolated testing
export {
  parseNumeric as _parseNumeric,
  parseSubtitle as _parseSubtitle,
  parseLinesStat as _parseLinesStat,
};
