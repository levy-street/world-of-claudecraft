// Deterministic source fingerprint for the rift course kit: a sha256 over the
// length-delimited (path, bytes) sequence of every input that shapes the
// shipped GLBs. Stamped into each GLB's asset extras by the exporter and
// recomputed live by the contract test, so a drifted input can never ship a
// stale asset unnoticed. No reference turnaround and no atlas in the list:
// the kit is a procedural original with vertex colours only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RIFT_COURSE_KIT_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const RIFT_COURSE_KIT_SOURCE_FILES = Object.freeze([
  'scripts/assets/rift_course_kit/model.js',
  'scripts/assets/rift_course_kit/export_entry.js',
  'scripts/assets/rift_course_kit/export_rift_course_kit.mjs',
  'scripts/assets/rift_course_kit/source_fingerprint.mjs',
  'scripts/assets/eastbrook_town/shared.js',
  'scripts/assets/specs/rift_course_kit.json',
  'scripts/assets/build_assets.mjs',
  'package-lock.json',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function riftCourseKitSourceFingerprint(repoRoot = RIFT_COURSE_KIT_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of RIFT_COURSE_KIT_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
