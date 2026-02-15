/**
 * Local config management for Chapa CLI.
 * Stores credentials at ~/.chapa/credentials.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CliConfig {
  token: string;
  handle: string;
  server: string;
}

function configDir(): string {
  return join(homedir(), ".chapa");
}

function configPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadConfig(): CliConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    if (data.token && data.handle && data.server) {
      return data as CliConfig;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function deleteConfig(): boolean {
  const path = configPath();
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
