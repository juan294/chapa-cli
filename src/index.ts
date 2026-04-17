import { parseArgs, DEFAULT_SERVER } from "./cli.js";
import type { CliArgs } from "./cli.js";
import { resolveToken } from "./auth.js";
import { fetchEmuStats } from "./fetch-emu.js";
import { uploadSupplementalStats } from "./upload.js";
import { loadConfig, deleteConfig } from "./config.js";
import { login } from "./login.js";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { formatStatsSummary } from "./shared.js";
import type { InsightsUpload } from "./shared.js";
import { queueTelemetry, classifyError, EMPTY_TELEMETRY_STATS } from "./telemetry.js";
import type { TelemetryPayload } from "./telemetry.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Injected by tsup at build time; falls back for dev/test
declare const __CLI_VERSION__: string;
const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

const HELP_TEXT = `chapa-cli v${VERSION}

Merge GitHub EMU (Enterprise Managed User) contributions into your Chapa badge.

Commands:
  chapa login                          Authenticate with Chapa (opens browser)
  chapa logout                         Clear stored credentials
  chapa merge --emu-handle <emu>       Merge EMU stats into your badge
  chapa insights --file <path>         Upload Claude Code insights report

Options:
  --emu-handle <handle>   Your EMU GitHub handle (required for merge)
  --emu-token <token>     EMU GitHub token (or set GITHUB_EMU_TOKEN)
  --handle <handle>       Override personal handle (auto-detected from login)
  --token <token>         Override auth token (auto-detected from login)
  --file <path>           Path to Claude Code insights HTML file (required for insights)
  --server <url>          Chapa server URL (default: https://chapa.thecreativetoken.com)
  --verbose               Show detailed debug output and timings
  --json                  Output result as JSON (for scripting)
  --insecure              Skip TLS certificate verification (corporate networks)
  --version, -v           Show version number
  --help, -h              Show this help message
`;

/** Use explicit --server if set, otherwise fall back to saved config, otherwise default. */
function resolveServerUrl(args: Pick<CliArgs, "server" | "serverExplicit">, configServer?: string): string {
  return args.serverExplicit ? args.server : (configServer ?? args.server);
}

/** Sentinel error for known CLI error exits (validation failures, expected errors). */
class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

type InsightsModule = typeof import("./insights.js");

function loadInsightsModule(): Promise<InsightsModule> {
  return import("./insights.js");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadSavedConfig(): ReturnType<typeof loadConfig> {
  try {
    return loadConfig();
  } catch (err) {
    throw new CliError(errorMessage(err));
  }
}

function loadSavedConfigOrThrow(log: Pick<Logger, "error">): ReturnType<typeof loadConfig> {
  try {
    return loadSavedConfig();
  } catch (err) {
    const message = errorMessage(err);
    log.error(`Error: ${message}`);
    throw err;
  }
}

function deleteSavedConfig(): boolean {
  try {
    return deleteConfig();
  } catch (err) {
    throw new CliError(errorMessage(err));
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1";
}

function assertTrustedServer(serverUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new CliError(`Invalid server URL: ${serverUrl}`);
  }

  if (parsed.protocol === "https:") {
    return;
  }

  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return;
  }

  throw new CliError(
    `Refusing to send credentials or stats to insecure server ${serverUrl}. Use HTTPS, or http://localhost only for local development.`,
  );
}

function assertTrustedServerOrThrow(
  log: Pick<Logger, "error">,
  serverUrl: string,
): void {
  try {
    assertTrustedServer(serverUrl);
  } catch (err) {
    const message = errorMessage(err);
    log.error(`Error: ${message}`);
    throw err;
  }
}

function warnIfUsingSavedServer(
  log: Pick<Logger, "warn">,
  args: Pick<CliArgs, "serverExplicit">,
  configServer?: string,
): void {
  if (args.serverExplicit || !configServer || configServer === DEFAULT_SERVER) {
    return;
  }

  log.warn(
    `Using saved server ${configServer} from ~/.chapa/credentials.json. Pass --server ${DEFAULT_SERVER} to use production.`,
  );
}

// ── Command Handlers ──────────────────────────────────────────────────────

async function handleLogin(args: CliArgs): Promise<void> {
  const operationId = randomUUID();
  const startedAt = Date.now();
  let succeeded = false;
  let caught: unknown;

  try {
    await login(args.server, { verbose: args.verbose, insecure: args.insecure });
    succeeded = true;
  } catch (err) {
    caught = err;
    if (err instanceof Error) {
      throw new CliError(err.message);
    }
    throw err;
  } finally {
    const totalMs = round(Date.now() - startedAt);
    emitTelemetry(args.server, {
      operationId,
      command: "login",
      stage: succeeded ? "complete" : "auth",
      success: succeeded,
      errorCategory: succeeded ? undefined : classifyError(errorMessage(caught)),
      stats: EMPTY_TELEMETRY_STATS,
      timing: { totalMs, authMs: totalMs },
      cliVersion: VERSION,
    });
  }
}

function handleLogout(): void {
  let removed: boolean;
  try {
    removed = deleteSavedConfig();
  } catch (err) {
    console.error(`Error: ${errorMessage(err)}`);
    throw err;
  }
  if (removed) {
    console.log("Logged out. Credentials removed from ~/.chapa/credentials.json");
  } else {
    console.log("Not logged in (no credentials found).");
  }
}

async function handleInsights(
  args: CliArgs,
  insightsModule: Pick<InsightsModule, "parseInsightsHtml" | "queueRecalculate" | "uploadInsights">,
): Promise<void> {
  const log = createLogger({ verbose: args.verbose, json: args.json });
  log.time("total");

  const config = loadSavedConfigOrThrow(log);
  warnIfUsingSavedServer(log, args, config?.server);
  const handle = args.handle ?? config?.handle;
  const authToken = args.token ?? config?.token;
  const serverUrl = resolveServerUrl(args, config?.server);
  const operationId = randomUUID();
  assertTrustedServerOrThrow(log, serverUrl);
  let parseMs = 0;
  let uploadMs = 0;
  let totalMs = 0;
  let telemetryStage: TelemetryPayload["stage"] = "parse";
  let telemetryErrorCategory: TelemetryPayload["errorCategory"] | undefined;
  let insightsSucceeded = false;
  let data: InsightsUpload | undefined;
  let caught: unknown;

  if (!args.file) {
    log.error("Error: --file is required. Provide the path to your Claude Code insights HTML file.");
    throw new CliError("--file is required");
  }

  if (!handle) {
    log.error("Error: No personal handle found. Run 'chapa login' first, or pass --handle.");
    throw new CliError("No personal handle found");
  }

  if (!authToken) {
    log.error("Error: Not authenticated. Run 'chapa login' first, or pass --token.");
    throw new CliError("Not authenticated");
  }

  const filePath = resolve(args.file);
  let html: string;
  try {
    html = readFileSync(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      log.error(`Error: File not found: ${filePath}`);
    } else {
      log.error(`Error reading file: ${(err as Error).message}`);
    }
    throw new CliError("File read error");
  }

  try {
    log.info("Parsing insights report...");
    log.time("parse");
    try {
      data = insightsModule.parseInsightsHtml(html);
    } catch (err) {
      parseMs = log.timeEnd("parse");
      log.error(`Error parsing insights HTML: ${(err as Error).message}`);
      throw new CliError("Insights parse error");
    }
    parseMs = log.timeEnd("parse");

    // Validate minimal viability
    if (data.totalSessions < 1) {
      log.error("Error: Could not extract session data from HTML. Is this a valid Claude Code insights report?");
      throw new CliError("Invalid insights data");
    }

    log.debug(`Parsed: ${data.totalSessions} sessions, ${data.volume.messages} messages, ${data.totalToolCalls} tool calls`);
    log.debug(`Period: ${data.reportPeriod.start} to ${data.reportPeriod.end}`);

    log.info(`Uploading insights to ${serverUrl}...`);
    telemetryStage = "upload";
    log.time("upload");
    const result = await insightsModule.uploadInsights({
      data,
      token: authToken,
      serverUrl,
      logger: log,
    });
    uploadMs = log.timeEnd("upload");

  // Trigger recalculate (non-blocking, fire-and-forget)
  if (result.success) {
    insightsModule.queueRecalculate(serverUrl, authToken);
  }

    totalMs = log.timeEnd("total");

    if (!result.success) {
      telemetryErrorCategory = classifyError(result.error ?? "unknown");
      if (args.json) {
        process.stdout.write(JSON.stringify({
          success: false,
          handle,
          file: filePath,
          error: result.error,
          timing: { parseMs: round(parseMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
          cliVersion: VERSION,
        }, null, 2) + "\n");
      } else {
        log.error(`Error: ${result.error}`);
      }
      throw new CliError(result.error ?? "Upload failed");
    }

    insightsSucceeded = true;
    telemetryStage = "complete";

    if (args.json) {
      process.stdout.write(JSON.stringify({
        success: true,
        handle,
        file: filePath,
        craftScore: result.craftScore,
        timing: { parseMs: round(parseMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
        cliVersion: VERSION,
      }, null, 2) + "\n");
    } else {
      const cs = result.craftScore;
      if (cs) {
        log.info(`Craft Score: ${cs.craftScore}/100 (${cs.tier})`);
        log.info(`  Proficiency:    ${cs.dimensions.proficiency}`);
        log.info(`  Effectiveness:  ${cs.dimensions.effectiveness}`);
        log.info(`  Sophistication: ${cs.dimensions.sophistication}`);
        log.info(`Period: ${cs.reportPeriod.start} to ${cs.reportPeriod.end}`);
      }
      log.info(`Success! Insights uploaded for ${handle} (${(totalMs / 1000).toFixed(1)}s)`);
    }
  } catch (err) {
    caught = err;
    if (!telemetryErrorCategory) {
      telemetryErrorCategory = classifyError(errorMessage(err));
    }
    totalMs = totalMs || log.timeEnd("total");
  } finally {
    emitTelemetry(serverUrl, {
      operationId,
      command: "insights",
      stage: telemetryStage,
      targetHandle: handle,
      sourceHandle: handle,
      success: insightsSucceeded,
      errorCategory: insightsSucceeded ? undefined : telemetryErrorCategory,
      stats: {
        ...EMPTY_TELEMETRY_STATS,
        activeDays: data?.volume.days ?? 0,
      },
      timing: {
        totalMs: round(totalMs || log.timeEnd("total")),
        parseMs: round(parseMs),
        uploadMs: round(uploadMs),
      },
      cliVersion: VERSION,
    });
  }

  if (caught) {
    throw caught;
  }
}

async function handleMerge(args: CliArgs): Promise<void> {
  const log = createLogger({ verbose: args.verbose, json: args.json });
  log.time("total");

  // Load saved config for handle and token fallback
  const config = loadSavedConfigOrThrow(log);
  warnIfUsingSavedServer(log, args, config?.server);

  const handle = args.handle ?? config?.handle;
  const emuHandle = args.emuHandle;
  const serverUrl = resolveServerUrl(args, config?.server);
  assertTrustedServerOrThrow(log, serverUrl);
  const operationId = randomUUID();
  let fetchMs = 0;
  let uploadMs = 0;
  let totalMs = 0;
  let telemetryStage: TelemetryPayload["stage"] = "fetch";
  let telemetryStats = { ...EMPTY_TELEMETRY_STATS };
  let telemetryErrorCategory: TelemetryPayload["errorCategory"] | undefined;
  let shouldSendTelemetry = false;
  let mergeSucceeded = false;
  let caught: unknown;

  if (!emuHandle) {
    log.error("Error: --emu-handle is required.");
    throw new CliError("--emu-handle is required");
  }

  if (!handle) {
    log.error("Error: No personal handle found. Run 'chapa login' first, or pass --handle.");
    throw new CliError("No personal handle found");
  }

  // Resolve tokens — CLI config token takes priority over GITHUB_TOKEN for auth
  const emuToken = resolveToken(args.emuToken, "GITHUB_EMU_TOKEN");
  if (!emuToken) {
    log.error("Error: EMU token required. Use --emu-token or set GITHUB_EMU_TOKEN.");
    throw new CliError("EMU token required");
  }

  const authToken = args.token ?? config?.token;
  if (!authToken) {
    log.error("Error: Not authenticated. Run 'chapa login' first, or pass --token.");
    throw new CliError("Not authenticated");
  }

  try {
    log.info(`Fetching stats for EMU account: ${emuHandle}...`);
    log.time("fetch");
    const fetchResult = await fetchEmuStats(emuHandle, emuToken, { logger: log });
    fetchMs = log.timeEnd("fetch");

    if (!fetchResult.ok) {
      telemetryErrorCategory = fetchResult.errorCategory;
      shouldSendTelemetry = true;
      totalMs = log.timeEnd("total");

      if (args.json) {
        process.stdout.write(JSON.stringify({
          success: false,
          targetHandle: handle,
          sourceHandle: emuHandle,
          error: fetchResult.error,
          timing: { fetchMs: round(fetchMs), uploadMs: 0, totalMs: round(totalMs) },
          cliVersion: VERSION,
        }, null, 2) + "\n");
      }

      throw new CliError(fetchResult.error);
    }

    const emuStats = fetchResult.stats;
    telemetryStats = mergeTelemetryStats(emuStats);
    log.info(formatStatsSummary(emuStats));

    log.info(`Uploading supplemental stats to ${serverUrl}...`);
    telemetryStage = "upload";
    log.time("upload");
    const result = await uploadSupplementalStats({
      targetHandle: handle,
      sourceHandle: emuHandle,
      stats: emuStats,
      token: authToken,
      serverUrl,
      logger: log,
    });
    uploadMs = log.timeEnd("upload");

    if (!result.success) {
      telemetryErrorCategory = classifyError(result.error ?? "unknown");
      shouldSendTelemetry = true;
      totalMs = log.timeEnd("total");

      if (args.json) {
        process.stdout.write(JSON.stringify({
          success: false,
          targetHandle: handle,
          sourceHandle: emuHandle,
          error: result.error,
          timing: { fetchMs: round(fetchMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
          cliVersion: VERSION,
        }, null, 2) + "\n");
      } else {
        log.error(`Error: ${result.error}`);
      }

      throw new CliError(result.error ?? "Upload failed");
    }

    totalMs = log.timeEnd("total");
    mergeSucceeded = true;
    telemetryStage = "complete";
    shouldSendTelemetry = true;

    if (args.json) {
      process.stdout.write(JSON.stringify({
        success: true,
        targetHandle: handle,
        sourceHandle: emuHandle,
        stats: {
          commitsTotal: emuStats.commitsTotal,
          activeDays: emuStats.activeDays,
          prsMergedCount: emuStats.prsMergedCount,
          prsMergedWeight: emuStats.prsMergedWeight,
          reviewsSubmittedCount: emuStats.reviewsSubmittedCount,
          issuesClosedCount: emuStats.issuesClosedCount,
          linesAdded: emuStats.linesAdded,
          linesDeleted: emuStats.linesDeleted,
          reposContributed: emuStats.reposContributed,
          totalStars: emuStats.totalStars,
          totalForks: emuStats.totalForks,
        },
        timing: { fetchMs: round(fetchMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
        cliVersion: VERSION,
      }, null, 2) + "\n");
    } else {
      log.info(`Success! Stats merged for ${emuHandle} -> ${handle} (${(totalMs / 1000).toFixed(1)}s)`);
    }
  } catch (err) {
    caught = err;
    if (!shouldSendTelemetry) {
      telemetryErrorCategory = classifyError(err instanceof Error ? err.message : String(err));
      shouldSendTelemetry = true;
    }
  } finally {
    if (shouldSendTelemetry) {
      emitTelemetry(serverUrl, {
        operationId,
        command: "merge",
        stage: telemetryStage,
        targetHandle: handle,
        sourceHandle: emuHandle,
        success: mergeSucceeded,
        errorCategory: mergeSucceeded ? undefined : telemetryErrorCategory,
        stats: telemetryStats,
        timing: {
          fetchMs: round(fetchMs),
          uploadMs: round(uploadMs),
          totalMs: round(totalMs || log.timeEnd("total")),
        },
        cliVersion: VERSION,
      });
    }
  }

  if (caught) {
    throw caught;
  }
}

function mergeTelemetryStats(stats: {
  commitsTotal: number;
  reposContributed: number;
  prsMergedCount: number;
  activeDays: number;
  reviewsSubmittedCount: number;
}) {
  return {
    commitsTotal: stats.commitsTotal,
    reposContributed: stats.reposContributed,
    prsMergedCount: stats.prsMergedCount,
    activeDays: stats.activeDays,
    reviewsSubmittedCount: stats.reviewsSubmittedCount,
  };
}

function emitTelemetry(serverUrl: string, payload: TelemetryPayload): void {
  queueTelemetry(serverUrl, payload);
}

// ── Main Dispatcher ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    return;
  }

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (args.unknownCommand) {
    console.error(`Error: Unknown command '${args.unknownCommand}'.`);
    console.error("Usage: chapa <login | logout | merge | insights> [options]");
    console.error("\nRun 'chapa --help' for more information.");
    throw new CliError(`Unknown command '${args.unknownCommand}'`);
  }

  // Global TLS bypass for corporate networks — applies to all commands
  if (args.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.warn("\n⚠ TLS certificate verification disabled (--insecure).");
    console.warn("  Use only on corporate networks with TLS interception.\n");
  }

  if (args.command === "login") {
    try {
      assertTrustedServer(args.server);
    } catch (err) {
      console.error(`Error: ${errorMessage(err)}`);
      throw err;
    }
    await handleLogin(args);
    return;
  }

  if (args.command === "logout") {
    handleLogout();
    return;
  }

  if (args.command === "insights") {
    await handleInsights(args, await loadInsightsModule());
    return;
  }

  if (args.command === "merge") {
    await handleMerge(args);
    return;
  }

  // Unknown or missing command
  console.error("Usage: chapa <login | logout | merge | insights> [options]");
  console.error("\nRun 'chapa --help' for more information.");
  throw new CliError("Unknown command");
}

/** Round to 1 decimal place. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Error boundary ────────────────────────────────────────────────────────
main().catch((err: unknown) => {
  // CliError messages are already printed by the handlers above;
  // only print for unexpected errors.
  if (!(err instanceof CliError)) {
    console.error(errorMessage(err));
  }
  process.exit(1);
});
