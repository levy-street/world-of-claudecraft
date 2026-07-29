import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TANK_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const TANK_SOURCE_FILES = Object.freeze([
  'docs/design/terrorspark-groundshaker/reference-metadata.json',
  'docs/design/terrorspark-groundshaker/object-sculpt-spec.json',
  'scripts/assets/terrorspark_groundshaker/model.js',
  'scripts/assets/terrorspark_groundshaker/surface_shading.mjs',
  'scripts/assets/terrorspark_groundshaker/surface_maps.mjs',
  'scripts/assets/terrorspark_groundshaker/export_entry.js',
  'scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs',
  'scripts/assets/terrorspark_groundshaker/source_fingerprint.mjs',
  'scripts/assets/specs/terrorspark_groundshaker.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function tankSourceFingerprint(repoRoot = TANK_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of TANK_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
