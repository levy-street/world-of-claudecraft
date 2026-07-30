import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GRAND_FERRY_SHIP_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const GRAND_FERRY_SHIP_SOURCE_FILES = Object.freeze([
  'scripts/assets/grand_ferry_ship/model.js',
  'scripts/assets/grand_ferry_ship/export_entry.js',
  'scripts/assets/grand_ferry_ship/export_grand_ferry_ship.mjs',
  'scripts/assets/grand_ferry_ship/source_fingerprint.mjs',
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
