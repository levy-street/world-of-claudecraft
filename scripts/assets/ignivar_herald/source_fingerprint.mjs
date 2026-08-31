import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IGNIVAR_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const IGNIVAR_SOURCE_FILES = Object.freeze([
  'docs/design/ignivar-boss-model/reference-turnaround.png',
  'docs/design/ignivar-boss-model/ignivar-kaykit-input-v2.png',
  'docs/design/ignivar-boss-model/provenance.md',
  'docs/design/ignivar-boss-model/kaykit-model-spec.md',
  'scripts/assets/ignivar_herald/author_kaykit_boss_clips.mjs',
  'scripts/assets/ignivar_herald/finalize_kaykit.mjs',
  'scripts/assets/ignivar_herald/source_fingerprint.mjs',
  'scripts/asset_pipeline/lib/manual_rig.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function ignivarSourceFingerprint(repoRoot = IGNIVAR_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of IGNIVAR_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
