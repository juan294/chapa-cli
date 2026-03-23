import { parseArgs as nodeParseArgs } from "node:util";

export const DEFAULT_SERVER = "https://chapa.thecreativetoken.com";

export interface CliArgs {
  command: "merge" | "login" | "logout" | "insights" | null;
  handle?: string;
  emuHandle?: string;
  emuToken?: string;
  token?: string;
  file?: string;
  server: string;
  verbose: boolean;
  json: boolean;
  insecure: boolean;
  version: boolean;
  help: boolean;
}

const VALID_COMMANDS = ["merge", "login", "logout", "insights"] as const;

export function parseArgs(argv: string[]): CliArgs {
  // Extract leading command (must be first argument, before any flags)
  const first = argv[0];
  const hasPositionalFirst = first != null && !first.startsWith("-");
  const command = hasPositionalFirst &&
    VALID_COMMANDS.includes(first as (typeof VALID_COMMANDS)[number])
    ? (first as CliArgs["command"])
    : null;

  // Strip the positional command slot so nodeParseArgs only sees flags
  const flagArgs = hasPositionalFirst ? argv.slice(1) : argv;

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
    handle: values.handle as string | undefined,
    emuHandle: values["emu-handle"] as string | undefined,
    emuToken: values["emu-token"] as string | undefined,
    token: values.token as string | undefined,
    file: values.file as string | undefined,
    server: (values.server as string) ?? DEFAULT_SERVER,
    verbose: (values.verbose as boolean) ?? false,
    json: (values.json as boolean) ?? false,
    insecure: (values.insecure as boolean) ?? false,
    version: (values.version as boolean) ?? false,
    help: (values.help as boolean) ?? false,
  };
}
