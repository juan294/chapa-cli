import { parseArgs } from "./cli.js";
import { resolveToken } from "./auth.js";
import { fetchEmuStats } from "./fetch-emu.js";
import { uploadSupplementalStats } from "./upload.js";
import { parseInsightsHtml, uploadInsights, triggerRecalculate } from "./insights.js";
import { loadConfig, deleteConfig } from "./config.js";
import { login } from "./login.js";
import { createLogger } from "./logger.js";
import { formatStatsSummary } from "./shared.js";
import type { InsightsUpload } from "./shared.js";
import { sendTelemetry, classifyError } from "./telemetry.js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // --json and --verbose are mutually exclusive
  if (args.json && args.verbose) {
    console.error("Error: --json and --verbose cannot be used together.");
    process.exit(1);
  }

  // Global TLS bypass for corporate networks — applies to all commands
  if (args.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.warn("\n⚠ TLS certificate verification disabled (--insecure).");
    console.warn("  Use only on corporate networks with TLS interception.\n");
  }

  // ── login ────────────────────────────────────────────────────────────
  if (args.command === "login") {
    await login(args.server, { verbose: args.verbose, insecure: args.insecure });
    return;
  }

  // ── logout ───────────────────────────────────────────────────────────
  if (args.command === "logout") {
    const removed = deleteConfig();
    if (removed) {
      console.log("Logged out. Credentials removed from ~/.chapa/credentials.json");
    } else {
      console.log("Not logged in (no credentials found).");
    }
    return;
  }

  // ── insights ────────────────────────────────────────────────────────
  if (args.command === "insights") {
    const log = createLogger({ verbose: args.verbose, json: args.json });
    log.time("total");

    const config = loadConfig();
    const handle = args.handle ?? config?.handle;
    const authToken = args.token ?? config?.token;
    const serverUrl = args.server !== "https://chapa.thecreativetoken.com" ? args.server : (config?.server ?? args.server);

    if (!args.file) {
      log.error("Error: --file is required. Provide the path to your Claude Code insights HTML file.");
      process.exit(1);
    }

    if (!handle) {
      log.error("Error: No personal handle found. Run 'chapa login' first, or pass --handle.");
      process.exit(1);
    }

    if (!authToken) {
      log.error("Error: Not authenticated. Run 'chapa login' first, or pass --token.");
      process.exit(1);
    }

    // Read HTML file
    const filePath = resolve(args.file);
    if (!existsSync(filePath)) {
      log.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    let html: string;
    try {
      html = readFileSync(filePath, "utf-8");
    } catch (err) {
      log.error(`Error reading file: ${(err as Error).message}`);
      process.exit(1);
    }

    // Parse HTML
    log.info("Parsing insights report...");
    log.time("parse");
    let data: InsightsUpload;
    try {
      data = parseInsightsHtml(html);
    } catch (err) {
      log.error(`Error parsing insights HTML: ${(err as Error).message}`);
      process.exit(1);
    }
    const parseMs = log.timeEnd("parse");

    // Validate minimal viability
    if (data.totalSessions < 1) {
      log.error("Error: Could not extract session data from HTML. Is this a valid Claude Code insights report?");
      process.exit(1);
    }

    log.debug(`Parsed: ${data.totalSessions} sessions, ${data.volume.messages} messages, ${data.totalToolCalls} tool calls`);
    log.debug(`Period: ${data.reportPeriod.start} to ${data.reportPeriod.end}`);

    // Upload
    log.info(`Uploading insights to ${serverUrl}...`);
    log.time("upload");
    const result = await uploadInsights({
      data,
      token: authToken,
      serverUrl,
      logger: log,
    });
    const uploadMs = log.timeEnd("upload");

    // Trigger recalculate (non-blocking, fire-and-forget)
    if (result.success) {
      triggerRecalculate(serverUrl, authToken, log);
    }

    const totalMs = log.timeEnd("total");

    if (!result.success) {
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
      process.exit(1);
    }

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

    // Telemetry (non-blocking, fire-and-forget)
    sendTelemetry(serverUrl, {
      operationId: randomUUID(),
      targetHandle: handle,
      sourceHandle: handle,
      success: true,
      stats: {
        commitsTotal: 0,
        reposContributed: 0,
        prsMergedCount: 0,
        activeDays: data.volume.days,
        reviewsSubmittedCount: 0,
      },
      timing: { fetchMs: 0, uploadMs: round(uploadMs), totalMs: round(totalMs) },
      cliVersion: VERSION,
    });

    return;
  }

  // ── merge ────────────────────────────────────────────────────────────
  if (args.command !== "merge") {
    console.error("Usage: chapa <login | logout | merge | insights> [options]");
    console.error("\nRun 'chapa --help' for more information.");
    process.exit(1);
  }

  const log = createLogger({ verbose: args.verbose, json: args.json });
  log.time("total");

  // Load saved config for handle and token fallback
  const config = loadConfig();

  const handle = args.handle ?? config?.handle;
  const emuHandle = args.emuHandle;

  if (!emuHandle) {
    log.error("Error: --emu-handle is required.");
    process.exit(1);
  }

  if (!handle) {
    log.error("Error: No personal handle found. Run 'chapa login' first, or pass --handle.");
    process.exit(1);
  }

  // Resolve tokens — CLI config token takes priority over GITHUB_TOKEN for auth
  const emuToken = resolveToken(args.emuToken, "GITHUB_EMU_TOKEN");
  if (!emuToken) {
    log.error("Error: EMU token required. Use --emu-token or set GITHUB_EMU_TOKEN.");
    process.exit(1);
  }

  const authToken = args.token ?? config?.token;
  if (!authToken) {
    log.error("Error: Not authenticated. Run 'chapa login' first, or pass --token.");
    process.exit(1);
  }

  // Fetch EMU stats
  log.info(`Fetching stats for EMU account: ${emuHandle}...`);
  log.time("fetch");
  const emuStats = await fetchEmuStats(emuHandle, emuToken, { logger: log });
  const fetchMs = log.timeEnd("fetch");

  if (!emuStats) {
    log.error("Error: Failed to fetch EMU stats. Check your EMU token and handle.");
    process.exit(1);
  }

  log.info(formatStatsSummary(emuStats));

  // Upload to Chapa
  const serverUrl = args.server !== "https://chapa.thecreativetoken.com" ? args.server : (config?.server ?? args.server);
  log.info(`Uploading supplemental stats to ${serverUrl}...`);
  log.time("upload");
  const result = await uploadSupplementalStats({
    targetHandle: handle,
    sourceHandle: emuHandle,
    stats: emuStats,
    token: authToken,
    serverUrl,
    logger: log,
  });
  const uploadMs = log.timeEnd("upload");
  const totalMs = log.timeEnd("total");

  if (!result.success) {
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

    // Fire telemetry (non-blocking)
    sendTelemetry(serverUrl, {
      operationId: randomUUID(),
      targetHandle: handle,
      sourceHandle: emuHandle,
      success: false,
      errorCategory: classifyError(result.error ?? "unknown"),
      stats: {
        commitsTotal: emuStats.commitsTotal,
        reposContributed: emuStats.reposContributed,
        prsMergedCount: emuStats.prsMergedCount,
        activeDays: emuStats.activeDays,
        reviewsSubmittedCount: emuStats.reviewsSubmittedCount,
      },
      timing: { fetchMs: round(fetchMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
      cliVersion: VERSION,
    });

    process.exit(1);
  }

  // ── Success output ───────────────────────────────────────────────────

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

  // Fire telemetry (non-blocking)
  sendTelemetry(serverUrl, {
    operationId: randomUUID(),
    targetHandle: handle,
    sourceHandle: emuHandle,
    success: true,
    stats: {
      commitsTotal: emuStats.commitsTotal,
      reposContributed: emuStats.reposContributed,
      prsMergedCount: emuStats.prsMergedCount,
      activeDays: emuStats.activeDays,
      reviewsSubmittedCount: emuStats.reviewsSubmittedCount,
    },
    timing: { fetchMs: round(fetchMs), uploadMs: round(uploadMs), totalMs: round(totalMs) },
    cliVersion: VERSION,
  });
}

/** Round to 1 decimal place. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

main();
