// The game build version stamped on every batch header (selects the content
// pack at render time). The server bundle carries no version define, so read
// package.json once at boot; WOC_BUILD_VERSION overrides for deployments whose
// working directory has no package.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readBuildVersion(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WOC_BUILD_VERSION?.trim();
  if (override) return override;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = (parsed as { version: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    // fall through to unknown; capture still works, packs just cannot match
  }
  return 'unknown';
}
