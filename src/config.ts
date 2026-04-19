/**
 * Local config management for Chapa CLI.
 * Stores credentials at ~/.chapa/credentials.json
 */

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CliConfig {
  token: string;
  handle: string;
  server: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function configDir(): string {
  return join(homedir(), ".chapa");
}

function configPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadConfig(): CliConfig | null {
  const filePath = configPath();
  let raw: string;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw new ConfigError(`Could not read ~/.chapa/credentials.json: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigError("Stored credentials are invalid JSON. Delete ~/.chapa/credentials.json and log in again.");
  }

  if (
    typeof data === "object" && data !== null &&
    typeof (data as CliConfig).token === "string" &&
    typeof (data as CliConfig).handle === "string" &&
    typeof (data as CliConfig).server === "string"
  ) {
    return data as CliConfig;
  }

  throw new ConfigError("Stored credentials are missing required fields. Delete ~/.chapa/credentials.json and log in again.");
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(configDir(), { mode: 0o700, recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function deleteConfig(): boolean {
  try {
    unlinkSync(configPath());
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw new ConfigError(`Could not remove ~/.chapa/credentials.json: ${(err as Error).message}`);
  }
}
