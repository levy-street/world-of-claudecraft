import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MUSTER_CAMP_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input that decides the shipped bytes. The style references were owner-supplied
// concept images kept outside the repo (see the spec note and CREDITS.md), so they are
// not part of the hash; the factory encodes everything taken from them.
export const MUSTER_CAMP_SOURCE_FILES = Object.freeze([
  'scripts/assets/muster_camp/model.py',
  'scripts/assets/muster_camp/contract.mjs',
  'scripts/assets/muster_camp/export_muster_camp.mjs',
  'scripts/assets/muster_camp/source_fingerprint.mjs',
  'scripts/assets/specs/muster_camp.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function musterCampSourceFingerprint(repoRoot = MUSTER_CAMP_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of MUSTER_CAMP_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
