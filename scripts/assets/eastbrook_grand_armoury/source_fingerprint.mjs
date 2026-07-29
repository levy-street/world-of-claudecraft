import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EASTBROOK_GRAND_ARMOURY_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const EASTBROOK_GRAND_ARMOURY_SOURCE_FILES = Object.freeze([
  'scripts/assets/eastbrook_grand_armoury/model.js',
  'scripts/assets/eastbrook_grand_armoury/export_entry.js',
  'scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs',
  'scripts/assets/specs/eastbrook_grand_armoury.json',
  'scripts/assets/eastbrook_grand_armoury/source_fingerprint.mjs',
  'scripts/assets/build_assets.mjs',
  'package-lock.json',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

/**
 * Hashes every source as: path-byte-length, stable UTF-8 path, file-byte-length,
 * and exact file bytes. Explicit lengths make the stream unambiguous without
 * relying on sentinel characters that source bytes could contain.
 */
export function eastbrookGrandArmourySourceFingerprint(
  repoRoot = EASTBROOK_GRAND_ARMOURY_REPO_ROOT,
) {
  const hash = createHash('sha256');
  for (const relativePath of EASTBROOK_GRAND_ARMOURY_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
