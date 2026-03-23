import { parseHTML } from "linkedom";
import type { InsightsUpload } from "./shared.js";

function findChartCard(doc: Document, titlePrefix: string): Element | null {
  const cards = doc.querySelectorAll(".chart-card");
  for (const card of cards) {
    const title = card.querySelector(".chart-title")?.textContent?.trim() ?? "";
    if (title.startsWith(titlePrefix)) return card;
  }
  return null;
}

function extractBarChart(
  doc: Document,
  chartTitle: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  const card = findChartCard(doc, chartTitle);
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

function parseMultiClauding(doc: Document): {
  overlapEvents: number;
  sessionsInvolved: number;
  messagePercent: number;
} {
  const result = { overlapEvents: 0, sessionsInvolved: 0, messagePercent: 0 };
  const card = findChartCard(doc, "Multi-Clauding");
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

function parseResponseTime(doc: Document): {
  medianSeconds: number;
  averageSeconds: number;
} {
  const result = { medianSeconds: 0, averageSeconds: 0 };
  const card = findChartCard(doc, "User Response Time");
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

  const toolUsage = extractBarChart(doc, "Top Tools Used");
  const sessionTypes = extractBarChart(doc, "Session Types");
  const outcomesChart = extractBarChart(doc, "Outcomes");
  const frictionChart = extractBarChart(doc, "Primary Friction Types");
  const satisfactionChart = extractBarChart(doc, "Inferred Satisfaction");
  const toolErrors = extractBarChart(doc, "Tool Errors Encountered");
  const multiClauding = parseMultiClauding(doc);
  const responseTime = parseResponseTime(doc);
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
    sessionTypes,
    outcomes: mapOutcomes(outcomesChart),
    friction: mapFriction(frictionChart),
    satisfaction: mapSatisfaction(satisfactionChart),
    multiClauding,
    responseTime,
    toolErrors,
    totalSessions: subtitle.sessions,
    totalToolCalls,
  };
}

// ── Upload ──────────────────────────────────────────────────────────────

import type { Logger } from "./logger.js";

export interface InsightsUploadOptions {
  data: InsightsUpload;
  token: string;
  serverUrl: string;
  logger?: Logger;
}

export interface InsightsUploadResult {
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
  const baseUrl = opts.serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/insights`;
  const log = opts.logger;

  const payload = JSON.stringify(opts.data);
  log?.debug(`Insights payload size: ${payload.length} bytes`);

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
        error: `Server returned ${res.status}: ${body.error ?? body.reason ?? "Unknown error"}`,
      };
    }

    const body = await res.json().catch(() => ({}));
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
  const baseUrl = serverUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/recalculate`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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

// Export helpers for isolated testing
export {
  parseNumeric as _parseNumeric,
  parseSubtitle as _parseSubtitle,
  parseLinesStat as _parseLinesStat,
};
