import { parseArgs as nodeParseArgs } from "node:util";

export const DEFAULT_SERVER = "https://chapa.thecreativetoken.com";

export interface CliArgs {
  command: "merge" | "login" | "logout" | "insights" | null;
  unknownCommand: string | null;
  handle?: string;
  emuHandle?: string;
  emuToken?: string;
  token?: string;
  file?: string;
  server: string;
  serverExplicit: boolean;
  verbose: boolean;
  json: boolean;
  insecure: boolean;
  version: boolean;
  help: boolean;
}

const VALID_COMMANDS = ["merge", "login", "logout", "insights"] as const;
const STRING_OPTIONS = new Set(["handle", "emu-handle", "emu-token", "token", "file", "server"]);

function extractCommand(argv: string[]): {
  command: CliArgs["command"];
  unknownCommand: string | null;
  flagArgs: string[];
} {
  const flagArgs: string[] = [];
  let command: CliArgs["command"] = null;
  let unknownCommand: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      flagArgs.push(...argv.slice(i));
      break;
    }

    if (arg.startsWith("--")) {
      flagArgs.push(arg);

      const optionName = arg.slice(2);
      if (STRING_OPTIONS.has(optionName) && i + 1 < argv.length) {
        flagArgs.push(argv[i + 1]!);
        i++;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      flagArgs.push(arg);
      continue;
    }

    if (command === null && unknownCommand === null) {
      if (VALID_COMMANDS.includes(arg as (typeof VALID_COMMANDS)[number])) {
        command = arg as CliArgs["command"];
      } else {
        unknownCommand = arg;
      }
      continue;
    }

    flagArgs.push(arg);
  }

  return { command, unknownCommand, flagArgs };
}

export function parseArgs(argv: string[]): CliArgs {
  const { command, unknownCommand, flagArgs } = extractCommand(argv);

  const { values } = nodeParseArgs({
    args: flagArgs,
    options: {
      handle: { type: "string" },
      "emu-handle": { type: "string" },
      "emu-token": { type: "string" },
      token: { type: "string" },
      file: { type: "string" },
      server: { type: "string", default: DEFAULT_SERVER },
      verbose: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      insecure: { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  return {
    command,
    unknownCommand,
    handle: values.handle as string | undefined,
    emuHandle: values["emu-handle"] as string | undefined,
    emuToken: values["emu-token"] as string | undefined,
    token: values.token as string | undefined,
    file: values.file as string | undefined,
    server: (values.server as string) ?? DEFAULT_SERVER,
    serverExplicit: argv.includes("--server"),
    verbose: (values.verbose as boolean) ?? false,
    json: (values.json as boolean) ?? false,
    insecure: (values.insecure as boolean) ?? false,
    version: (values.version as boolean) ?? false,
    help: (values.help as boolean) ?? false,
  };
}
