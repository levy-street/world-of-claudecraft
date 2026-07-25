import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EASTBROOK_NOTICEBOARD_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const EASTBROOK_NOTICEBOARD_SOURCE_FILES = Object.freeze([
  'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/noticeboard.png',
  'public/textures/eastbrook_surface_atlas.webp',
  'scripts/assets/eastbrook_noticeboard/model.js',
  'scripts/assets/eastbrook_noticeboard/export_entry.js',
  'scripts/assets/eastbrook_noticeboard/export_eastbrook_noticeboard.mjs',
  'scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs',
  'scripts/assets/specs/eastbrook_noticeboard.json',
  'scripts/assets/build_assets.mjs',
  'package-lock.json',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function eastbrookNoticeboardSourceFingerprint(repoRoot = EASTBROOK_NOTICEBOARD_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of EASTBROOK_NOTICEBOARD_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
