// The editor export boundary. Every artifact passes through the same sanitizer
// as server map storage, projects through the editor-to-engine adapter, and
// boots the real deterministic Sim before any bytes are offered to the user.

import { Sim } from '../sim/sim';
import type { WorldContent } from '../sim/types';
import { wallFinishTextureRefs } from '../sim/wall_finishes';
import { type CustomMap, customMapToWorldContent } from './custom_map';
import { isLocalAssetId } from './local_assets';
import { parseMap, serializeMap } from './persist';

export class ExportCompatibilityError extends Error {
  constructor(message = 'Map is not compatible with the engine export contract') {
    super(message);
    this.name = 'ExportCompatibilityError';
  }
}

export interface PreparedMapExport {
  map: CustomMap;
  json: string;
  world: WorldContent;
}

/** Canonicalize a document and prove the actual engine can consume it. */
export function prepareMapForEngine(map: CustomMap): PreparedMapExport {
  const canonical = parseMap(serializeMap(map));
  if (!canonical) throw new ExportCompatibilityError();
  try {
    const world = customMapToWorldContent(canonical);
    new Sim({
      seed: canonical.meta.seed,
      playerClass: 'warrior',
      noPlayer: true,
      world,
    });
    return { map: canonical, json: serializeMap(canonical), world };
  } catch (error) {
    throw new ExportCompatibilityError(
      error instanceof Error ? error.message : 'Engine rejected the map',
    );
  }
}

export interface BundleDependencyRefs {
  models: string[];
  textures: string[];
  skyboxes: string[];
}

/** Stable, unique browser-owned dependencies an export must carry. */
export function bundleDependencyRefs(map: CustomMap): BundleDependencyRefs {
  const models = new Set<string>();
  for (const placement of map.placements) {
    if (isLocalAssetId(placement.assetId)) {
      models.add(placement.assetId.slice('local/'.length));
    }
  }
  const textures = new Set<string>();
  for (const placement of map.placements) {
    for (const sha of wallFinishTextureRefs(placement.wallFinishes)) textures.add(sha);
  }
  for (const swatch of map.biomePaint?.custom ?? []) {
    if (swatch.textureSha) textures.add(swatch.textureSha);
  }
  // Imported decal art shares the ground-texture store (both are "images this
  // map references"), so it packs through the same `textures/` entries. A
  // `builtin:` decal ships with the app and needs nothing in the bundle.
  for (const decal of map.decals ?? []) {
    if (!decal.tex.startsWith('builtin:')) textures.add(decal.tex);
  }
  const skyboxes = new Set<string>();
  if (map.skybox?.startsWith('custom:')) skyboxes.add(map.skybox.slice('custom:'.length));
  return {
    models: [...models].sort(),
    textures: [...textures].sort(),
    skyboxes: [...skyboxes].sort(),
  };
}

/** Count referenced dependency payloads absent from an imported bundle. */
export function missingBundleEntries(map: CustomMap, files: readonly { path: string }[]): number {
  const paths = new Set(files.map((file) => file.path));
  const refs = bundleDependencyRefs(map);
  let missing = 0;
  for (const sha of refs.models) if (!paths.has(`models/${sha}.glb`)) missing++;
  for (const sha of refs.textures) if (!paths.has(`textures/${sha}`)) missing++;
  for (const sha of refs.skyboxes) if (!paths.has(`skybox/${sha}`)) missing++;
  return missing;
}
