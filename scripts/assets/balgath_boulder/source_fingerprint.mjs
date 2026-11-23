import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BALGATH_BOULDER_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input that decides the shipped bytes. The kit has no reference image: the look
// is described in the factory header and encoded entirely in model.py.
export const BALGATH_BOULDER_SOURCE_FILES = Object.freeze([
  'scripts/assets/balgath_boulder/model.py',
  'scripts/assets/balgath_boulder/contract.mjs',
  'scripts/assets/balgath_boulder/export_balgath_boulder.mjs',
  'scripts/assets/balgath_boulder/source_fingerprint.mjs',
  'scripts/assets/specs/balgath_boulder.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function balgathBoulderSourceFingerprint(repoRoot = BALGATH_BOULDER_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of BALGATH_BOULDER_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
