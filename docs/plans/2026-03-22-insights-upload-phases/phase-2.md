# Phase 2: CLI — Types, Flag, and Command Wiring

> **Project**: chapa-cli
> **Prerequisite**: None (can start before Phase 1 — server not needed for types/wiring)
> **Files modified**: `src/shared.ts`, `src/cli.ts`, `src/index.ts`
> **Files created**: None
> **Tests modified**: `src/cli.test.ts`, `src/index.test.ts`

## Objective

Add the `InsightsUpload` type, the `--file` CLI flag, the `insights` command to the command union, and the dispatch skeleton in `index.ts`.

## Changes

### 1. Add InsightsUpload type

**File**: `src/shared.ts`

Add the `InsightsUpload` interface at the end of the file (after existing types). This is a direct copy from `packages/shared/src/types.ts:291-334`.

```pseudo
export interface InsightsUpload {
  tool: "claude-code";
  reportPeriod: { start: string; end: string };
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
    messagePercent: number;
  };
  responseTime: {
    medianSeconds: number;
    averageSeconds: number;
  };
  toolErrors: Record<string, number>;
  totalSessions: number;
  totalToolCalls: number;
}
```

### 2. Add `--file` flag and `insights` command

**File**: `src/cli.ts`

```pseudo
// Update CliArgs interface:
export interface CliArgs {
  command: "merge" | "login" | "logout" | "insights" | null;  // add "insights"
  // ... existing fields ...
  file?: string;  // NEW — path to insights HTML file
}

// Update VALID_COMMANDS:
const VALID_COMMANDS = ["merge", "login", "logout", "insights"] as const;

// Add to parseArgs options (inside nodeParseArgs call):
file: { type: "string" },

// Add to return object:
file: values.file as string | undefined,
```

### 3. Add insights command dispatch skeleton

**File**: `src/index.ts`

Add the dispatch block between `logout` and `merge`, following the same pattern. At this phase, it's a skeleton that validates inputs and exits — the actual parsing/upload is wired in Phase 4.

```pseudo
// Update HELP_TEXT (add insights command):
Commands:
  chapa login                          Authenticate with Chapa (opens browser)
  chapa logout                         Clear stored credentials
  chapa merge --emu-handle <emu>       Merge EMU stats into your badge
  chapa insights --file <path>         Upload Claude Code insights report

Options:
  // ... existing options ...
  --file <path>             Path to Claude Code insights HTML file (required for insights)

// Update usage error (line 83):
console.error("Usage: chapa <login | logout | merge | insights> [options]");

// Add insights dispatch block (after logout, before merge):
if (args.command === "insights") {
  const log = createLogger({ verbose: args.verbose, json: args.json });
  log.time("total");

  // Load config for auth
  const config = loadConfig();
  const handle = args.handle ?? config?.handle;
  const authToken = args.token ?? config?.token;
  const serverUrl = args.server !== DEFAULT_SERVER ? args.server : (config?.server ?? args.server);

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

  // Phase 4 will add: readFile, parse, upload, output
  // For now, just validate and exit
  return;
}
```

### 4. Tests

**File**: `src/cli.test.ts` — Add tests:

```pseudo
describe("insights command", () => {
  it("parses insights command", () => {
    const args = parseArgs(["insights", "--file", "/path/to/report.html"]);
    expect(args.command).toBe("insights");
    expect(args.file).toBe("/path/to/report.html");
  });

  it("parses insights with other flags", () => {
    const args = parseArgs(["insights", "--file", "report.html", "--json", "--server", "http://localhost:3000"]);
    expect(args.command).toBe("insights");
    expect(args.file).toBe("report.html");
    expect(args.json).toBe(true);
    expect(args.server).toBe("http://localhost:3000");
  });
});
```

**File**: `src/index.test.ts` — Add tests:

```pseudo
describe("insights command", () => {
  it("exits with error when --file is missing", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "insights" }));
    await runMain();
    expect(loggerOutput(mockLogger.error)).toContain("--file is required");
  });

  it("exits with error when not authenticated", async () => {
    mockParseArgs.mockReturnValue(defaultArgs({ command: "insights", file: "report.html" }));
    mockLoadConfig.mockReturnValue(null);
    await runMain();
    expect(loggerOutput(mockLogger.error)).toContain("Not authenticated");
  });
});
```

## Success Criteria

### Automated
- `pnpm test` passes — existing tests unchanged, new tests green
- `pnpm run typecheck` passes — InsightsUpload type compiles correctly
- `chapa --help` shows insights command in output
- `chapa insights` without `--file` exits with error code 1
