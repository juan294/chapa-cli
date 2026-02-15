/**
 * Token resolution for CLI.
 *
 * Priority: explicit flag → environment variable → null
 * (gh auth token fallback is handled at the CLI orchestration level)
 */
export function resolveToken(
  flag: string | undefined,
  envVar: string,
): string | null {
  if (flag) return flag;
  const env = process.env[envVar]?.trim();
  if (env) return env;
  return null;
}
