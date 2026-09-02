// Source fingerprint for the Riftbound Boulder: a sha256 over every input that
// can change the shipped GLB, stamped into the model's extras by the exporter
// and recomputed live by tests/riftbound_boulder_model.test.ts. If the hash in
// the GLB no longer matches the tree, the committed model is stale and the
// exporter has to be re-run.
//
// Same construction as terrorspark_groundshaker/source_fingerprint.mjs: each
// entry contributes its path bytes and its file bytes, both length-delimited,
// so no rename or content shuffle can collide.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BOULDER_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const BOULDER_SOURCE_FILES = Object.freeze([
  'scripts/assets/riftbound_boulder/model.js',
  'scripts/assets/riftbound_boulder/export_entry.js',
  'scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs',
  'scripts/assets/riftbound_boulder/source_fingerprint.mjs',
  'scripts/assets/specs/riftbound_boulder.json',
  'scripts/assets/build_assets.mjs',
  // three authors the icosphere this model displaces, so a three bump really can
  // move the geometry. Same reason (and the same known cost: a lockfile-only
  // bump means a re-export) as the terrorspark list.
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function boulderSourceFingerprint(repoRoot = BOULDER_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of BOULDER_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
