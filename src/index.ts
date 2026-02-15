import { parseArgs } from "./cli.js";
import { resolveToken } from "./auth.js";
import { fetchEmuStats } from "./fetch-emu.js";
import { uploadSupplementalStats } from "./upload.js";
import { loadConfig, deleteConfig } from "./config.js";
import { login } from "./login.js";

// Injected by tsup at build time; falls back for dev/test
declare const __CLI_VERSION__: string;
const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

const HELP_TEXT = `chapa-cli v${VERSION}

Merge GitHub EMU (Enterprise Managed User) contributions into your Chapa badge.

Commands:
  chapa login                          Authenticate with Chapa (opens browser)
  chapa logout                         Clear stored credentials
  chapa merge --emu-handle <emu>       Merge EMU stats into your badge

Options:
  --emu-handle <handle>   Your EMU GitHub handle (required for merge)
  --emu-token <token>     EMU GitHub token (or set GITHUB_EMU_TOKEN)
  --handle <handle>       Override personal handle (auto-detected from login)
  --token <token>         Override auth token (auto-detected from login)
  --server <url>          Chapa server URL (default: https://chapa.thecreativetoken.com)
  --verbose               Show detailed polling logs during login
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

  // ── merge ────────────────────────────────────────────────────────────
  if (args.command !== "merge") {
    console.error("Usage: chapa <login | logout | merge> [options]");
    console.error("\nRun 'chapa --help' for more information.");
    process.exit(1);
  }

  // Load saved config for handle and token fallback
  const config = loadConfig();

  const handle = args.handle ?? config?.handle;
  const emuHandle = args.emuHandle;

  if (!emuHandle) {
    console.error("Error: --emu-handle is required.");
    process.exit(1);
  }

  if (!handle) {
    console.error("Error: No personal handle found. Run 'chapa login' first, or pass --handle.");
    process.exit(1);
  }

  // Resolve tokens — CLI config token takes priority over GITHUB_TOKEN for auth
  const emuToken = resolveToken(args.emuToken, "GITHUB_EMU_TOKEN");
  if (!emuToken) {
    console.error("Error: EMU token required. Use --emu-token or set GITHUB_EMU_TOKEN.");
    process.exit(1);
  }

  const authToken = args.token ?? config?.token;
  if (!authToken) {
    console.error("Error: Not authenticated. Run 'chapa login' first, or pass --token.");
    process.exit(1);
  }

  // Fetch EMU stats
  console.log(`Fetching stats for EMU account: ${emuHandle}...`);
  const emuStats = await fetchEmuStats(emuHandle, emuToken);
  if (!emuStats) {
    console.error("Error: Failed to fetch EMU stats. Check your EMU token and handle.");
    process.exit(1);
  }

  console.log(`Found: ${emuStats.commitsTotal} commits, ${emuStats.prsMergedCount} PRs merged, ${emuStats.reviewsSubmittedCount} reviews`);

  // Upload to Chapa
  const serverUrl = args.server !== "https://chapa.thecreativetoken.com" ? args.server : (config?.server ?? args.server);
  console.log(`Uploading supplemental stats to ${serverUrl}...`);
  const result = await uploadSupplementalStats({
    targetHandle: handle,
    sourceHandle: emuHandle,
    stats: emuStats,
    token: authToken,
    serverUrl,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("Success! Supplemental stats uploaded. Your badge will reflect combined data on next refresh.");
}

main();
