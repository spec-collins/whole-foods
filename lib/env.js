import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads a local .env for scripts run from a terminal. On Vercel the variables
 * come from the project's environment settings and no .env file exists, so a
 * missing file is not an error.
 */
export function loadLocalEnv(file = '.env') {
  const envPath = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}
