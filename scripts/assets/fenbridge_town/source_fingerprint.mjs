import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const FENBRIDGE_TOWN_REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const INTAKE_IDS = Object.freeze([
  'warden-gatehouse',
  'crooked-reed-inn',
  'lantern-chapel',
  'moonwort-apothecary',
  'gilded-strongbox',
  'hesk-tannery',
  'scout-lodge',
  'mirelight-cistern',
  'provision-stall',
  'palisade-wing',
  'gate-arch',
  'boardwalk',
  'muster-board',
  'muster-order',
]);

export const FENBRIDGE_TOWN_SOURCE_FILES = Object.freeze([
  'scripts/assets/fenbridge_town/shared.js',
  'scripts/assets/fenbridge_town/buildings_civic.js',
  'scripts/assets/fenbridge_town/buildings_service.js',
  'scripts/assets/fenbridge_town/props.js',
  'scripts/assets/fenbridge_town/model.js',
  'scripts/assets/fenbridge_town/export_entry.js',
  'scripts/assets/fenbridge_town/export_fenbridge_town.mjs',
  'scripts/assets/fenbridge_town/author_intake_records.mjs',
  'scripts/assets/fenbridge_town/source_fingerprint.mjs',
  'scripts/assets/fenbridge_town/support_maps.mjs',
  'scripts/assets/fenbridge_town/build_support_maps.mjs',
  'scripts/assets/fenbridge_town/support_maps.json',
  'docs/design/fenbridge-rebuild/materials/fenbridge-surface-atlas-source.png',
  'scripts/assets/specs/fenbridge_town.json',
  'scripts/assets/build_assets.mjs',
  'scripts/assets/compress_glb_textures.mjs',
  ...INTAKE_IDS.flatMap((id) => [
    `docs/design/fenbridge-rebuild/references/${id}-turnaround.png`,
    `docs/design/fenbridge-rebuild/img2threejs/${id}/pre-spec-assessment.json`,
    `docs/design/fenbridge-rebuild/img2threejs/${id}/zones/detail-inventory.json`,
    `docs/design/fenbridge-rebuild/img2threejs/${id}/sculpt-spec.json`,
    ...['front', 'hero', 'rear', id === 'warden-gatehouse' ? 'left' : 'side'].map(
      (view) => `docs/design/fenbridge-rebuild/img2threejs/${id}/zones/${view}.png`,
    ),
  ]),
  'public/textures/fenbridge_surface_atlas.webp',
  'public/textures/fenbridge_surface_normal.webp',
  'public/textures/fenbridge_surface_roughness.webp',
  'package.json',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function fenbridgeTownSourceFingerprint(repoRoot = FENBRIDGE_TOWN_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of FENBRIDGE_TOWN_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
