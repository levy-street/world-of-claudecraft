import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GRAND_FERRY_SHIP_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Everything the shipped ferry is a function of: the ART, the scripted edits
// and measurement that turn it into a game object, and the generated plan
// itself. Change any one of them and the fingerprint moves, which is what
// makes a stale artifact detectable rather than merely unlikely.
export const GRAND_FERRY_SHIP_SOURCE_FILES = Object.freeze([
  'scripts/assets/grand_ferry_ship/source/grand_ferry_ship_art.glb',
  'scripts/assets/grand_ferry_ship/build.mjs',
  'scripts/assets/grand_ferry_ship/verify.mjs',
  'scripts/assets/grand_ferry_ship/export_grand_ferry_ship.mjs',
  'scripts/assets/grand_ferry_ship/source_fingerprint.mjs',
  'scripts/assets/lib/mesh_collision.mjs',
  'scripts/assets/lib/glb_geometry.mjs',
  'scripts/assets/lib/glb_edit.mjs',
  'scripts/assets/specs/grand_ferry_ship.json',
  'scripts/assets/build_assets.mjs',
  'src/sim/grand_ferry_ship_plan.generated.ts',
  'package-lock.json',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function grandFerryShipSourceFingerprint(repoRoot = GRAND_FERRY_SHIP_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of GRAND_FERRY_SHIP_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
