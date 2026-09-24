import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOARD_ENTRANCE_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const HOARD_ENTRANCE_SOURCE_FILES = Object.freeze([
  'docs/design/buried-hoard-entrance/asset-provenance.md',
  'scripts/assets/hoard_entrance/model.js',
  'scripts/assets/hoard_entrance/export_entry.js',
  'scripts/assets/hoard_entrance/export_hoard_entrance.mjs',
  'scripts/assets/hoard_entrance/source_fingerprint.mjs',
  'scripts/assets/specs/hoard_entrance.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function hoardEntranceSourceFingerprint(repoRoot = HOARD_ENTRANCE_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of HOARD_ENTRANCE_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
