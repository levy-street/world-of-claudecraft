import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TRUCK_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// Every input the shipped GLB's bytes depend on. The terrorspark surface core is
// on the list because this model imports it: a look-dev tweak over there changes
// this asset's baked COLOR_0 and its map sets, so both families re-export
// together rather than one silently going stale.
export const TRUCK_SOURCE_FILES = Object.freeze([
  // The stamped portrait is an INPUT to the shipped bytes, so a swapped photo
  // has to invalidate the asset the same way a code edit does.
  'docs/design/weirdo-cream-truck/reference/luffy-face.jpg',
  'docs/design/weirdo-cream-truck/reference/reference-metadata.json',
  'scripts/assets/weirdo_cream_truck/model.js',
  'scripts/assets/weirdo_cream_truck/decal_atlas.mjs',
  'scripts/assets/weirdo_cream_truck/export_entry.js',
  'scripts/assets/weirdo_cream_truck/export_weirdo_cream_truck.mjs',
  'scripts/assets/weirdo_cream_truck/source_fingerprint.mjs',
  'scripts/assets/terrorspark_groundshaker/surface_shading.mjs',
  'scripts/assets/terrorspark_groundshaker/surface_maps.mjs',
  'scripts/assets/specs/weirdo_cream_truck.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function truckSourceFingerprint(repoRoot = TRUCK_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of TRUCK_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
