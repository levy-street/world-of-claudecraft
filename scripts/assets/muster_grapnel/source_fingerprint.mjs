import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MUSTER_GRAPNEL_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input that decides the shipped bytes. The grapnel has no reference image: the
// look is described in the factory header and encoded entirely in model.py.
export const MUSTER_GRAPNEL_SOURCE_FILES = Object.freeze([
  'scripts/assets/muster_grapnel/model.py',
  'scripts/assets/muster_grapnel/contract.mjs',
  'scripts/assets/muster_grapnel/export_muster_grapnel.mjs',
  'scripts/assets/muster_grapnel/source_fingerprint.mjs',
  'scripts/assets/specs/muster_grapnel.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function musterGrapnelSourceFingerprint(repoRoot = MUSTER_GRAPNEL_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of MUSTER_GRAPNEL_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
