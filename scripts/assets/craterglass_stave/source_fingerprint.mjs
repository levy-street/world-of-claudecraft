import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CRATERGLASS_STAVE_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input that decides the shipped bytes. The stave has no reference image: the
// look is described in the factory header and encoded entirely in model.py.
export const CRATERGLASS_STAVE_SOURCE_FILES = Object.freeze([
  'scripts/assets/craterglass_stave/model.py',
  'scripts/assets/craterglass_stave/contract.mjs',
  'scripts/assets/craterglass_stave/export_craterglass_stave.mjs',
  'scripts/assets/craterglass_stave/source_fingerprint.mjs',
  'scripts/assets/specs/craterglass_stave.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function craterglassStaveSourceFingerprint(repoRoot = CRATERGLASS_STAVE_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of CRATERGLASS_STAVE_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
