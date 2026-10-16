import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MUSTER_EFFIGY_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input that decides the shipped bytes. The silhouette reference (Balgath's own
// shipped model) is read by eye only; the factory encodes every proportion taken from
// it, so it is not part of the hash.
export const MUSTER_EFFIGY_SOURCE_FILES = Object.freeze([
  'scripts/assets/muster_effigy/model.py',
  'scripts/assets/muster_effigy/contract.mjs',
  'scripts/assets/muster_effigy/export_muster_effigy.mjs',
  'scripts/assets/muster_effigy/source_fingerprint.mjs',
  'scripts/assets/specs/muster_effigy.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function musterEffigySourceFingerprint(repoRoot = MUSTER_EFFIGY_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of MUSTER_EFFIGY_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
