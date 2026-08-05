import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EASTBROOK_TOWN_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const EASTBROOK_TOWN_SOURCE_FILES = Object.freeze([
  'scripts/assets/eastbrook_town/shared.js',
  'scripts/assets/eastbrook_town/buildings_commerce.js',
  'scripts/assets/eastbrook_town/buildings_craft.js',
  'scripts/assets/eastbrook_town/furniture.js',
  'scripts/assets/eastbrook_town/model.js',
  'scripts/assets/eastbrook_town/export_entry.js',
  'scripts/assets/eastbrook_town/export_eastbrook_town.mjs',
  'scripts/assets/eastbrook_town/source_fingerprint.mjs',
  'scripts/assets/specs/eastbrook_town.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function eastbrookTownSourceFingerprint(repoRoot = EASTBROOK_TOWN_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of EASTBROOK_TOWN_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
