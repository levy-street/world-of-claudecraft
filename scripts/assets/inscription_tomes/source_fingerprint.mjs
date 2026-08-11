import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INSCRIPTION_TOMES_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// One fingerprint covers the whole three-tome family: the committed item-icon
// SVG references, the factory, the exporter chain, the optimizer, and the
// lockfile. Any change to any of these re-exports all three GLBs.
export const INSCRIPTION_TOMES_SOURCE_FILES = Object.freeze([
  'docs/achievements/masterwrought-phase06-art/silverleaf_primer.svg',
  'docs/achievements/masterwrought-phase06-art/goldleaf_folio.svg',
  'docs/achievements/masterwrought-phase06-art/sunpetal_grimoire.svg',
  'scripts/assets/inscription_tomes/model.js',
  'scripts/assets/inscription_tomes/export_entry.js',
  'scripts/assets/inscription_tomes/export_inscription_tomes.mjs',
  'scripts/assets/inscription_tomes/source_fingerprint.mjs',
  'scripts/assets/specs/inscription_tomes.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function inscriptionTomesSourceFingerprint(repoRoot = INSCRIPTION_TOMES_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of INSCRIPTION_TOMES_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
