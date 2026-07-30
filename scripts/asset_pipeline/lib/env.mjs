// API key loading for the asset pipeline. Keys come from the environment or the
// repo-root .env (same pattern as ELEVENLABS_API_KEY: offline tooling only, the
// game server and client never read these).
//
//   TRIPO_API_KEY   required for every generation command (tsk_...)
//   OPENAI_API_KEY  optional; enables the gpt-image-2 concept-image stage
//
// Keys are never logged; error messages tell the operator where to put them.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../../..');

let envLoaded = false;
function loadDotEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = resolve(REPO_ROOT, '.env');
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Malformed .env lines are not fatal; explicit env vars still win.
    }
  }
}

export function tripoKey() {
  loadDotEnv();
  const key = process.env.TRIPO_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'TRIPO_API_KEY is not set. Add it to the repo-root .env (gitignored) or export it: ' +
        'get a key at https://platform.tripo3d.ai',
    );
  }
  return key;
}

export function openaiKey() {
  loadDotEnv();
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** True when the optional gpt-image-2 concept stage can run. */
export function hasOpenAi() {
  return openaiKey() !== null;
}
