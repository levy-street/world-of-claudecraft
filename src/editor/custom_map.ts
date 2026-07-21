// The CustomMap document: the editor's canonical, serializable map. The type and
// its sanitizer live in src/sim/map_doc.ts (shared with the server, which
// validates uploaded documents with the SAME code); this module adapts the
// document to the editor's live editing model and projects it onto the engine's
// WorldContent for play-test. Pure: no DOM, Vitest-importable.

import { BUILTIN_WORLD, PLAYER_START } from '../sim/data';
import {
  collideRadiusFor,
  MAP_DOC_VERSION,
  type MapDoc,
  type MapDocMeta,
  type MapPlacement,
} from '../sim/map_doc';
import type { PlacedAsset, WorldContent } from '../sim/types';
import { WATER_LEVEL } from '../sim/world';
import { assetById } from './asset_catalog.generated';
import type { ZoneContent } from './model';
import { userAssetPath } from './user_assets';

export const CUSTOM_MAP_VERSION = MAP_DOC_VERSION;

// Editor-facing aliases: the document shape IS the shared MapDoc.
export type AssetPlacement = MapPlacement;
export type CustomMapMeta = MapDocMeta;
// The editor's in-memory document shares the LIVE ZoneContent ref with the
// marker model (readonly views of the same tables), so content stays readonly
// here; serialization casts back to the mutable MapDoc shape.
export type CustomMap = Omit<MapDoc, 'content'> & { content: ZoneContent };

// The game's fixed offline seed; a fresh map defaults to it so its built-in
// derived terrain matches what the editor previews (mirrors DEFAULT_PLAYTEST_SEED).
const DEFAULT_SEED = 20061;

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// A new map seeded from the built-in world content (so it is immediately playable
// and editable). `now` and `id` are injected (no Date.now/Math.random in callers
// that want determinism; the DOM app passes real values).
export function newCustomMap(name: string, id: string, now: number): CustomMap {
  return {
    version: CUSTOM_MAP_VERSION,
    meta: {
      id,
      name,
      description: '',
      createdAt: now,
      updatedAt: now,
      seed: DEFAULT_SEED,
      parentId: '',
    },
    content: {
      zones: deepClone(BUILTIN_WORLD.zones as CustomMap['content']['zones']),
      camps: deepClone(BUILTIN_WORLD.camps as CustomMap['content']['camps']),
      npcs: deepClone(BUILTIN_WORLD.npcs as CustomMap['content']['npcs']),
      objects: deepClone(BUILTIN_WORLD.groundObjects as CustomMap['content']['objects']),
      roads: deepClone(BUILTIN_WORLD.roads as CustomMap['content']['roads']),
    },
    terrainEdits: [],
    placements: [],
  };
}

// Build a CustomMap from a live ZoneContent (the editor's current edits) plus the
// authoring layers. Deep-cloned so the document is independent of further edits.
export function customMapFromContent(
  content: ZoneContent,
  layers: {
    terrainEdits?: CustomMap['terrainEdits'];
    placements?: AssetPlacement[];
    blockers?: CustomMap['blockers'];
    meta: CustomMapMeta;
    waterLevel?: number;
    playerStart?: { x: number; z: number };
  },
): CustomMap {
  const map: CustomMap = {
    version: CUSTOM_MAP_VERSION,
    meta: { ...layers.meta },
    content: {
      zones: deepClone(content.zones as CustomMap['content']['zones']),
      camps: deepClone(content.camps as CustomMap['content']['camps']),
      npcs: deepClone(content.npcs as CustomMap['content']['npcs']),
      objects: deepClone(content.objects as CustomMap['content']['objects']),
      roads: deepClone((content.roads ?? []) as CustomMap['content']['roads']),
    },
    terrainEdits: deepClone(layers.terrainEdits ?? []),
    placements: deepClone(layers.placements ?? []),
  };
  if (layers.blockers && layers.blockers.length > 0) map.blockers = deepClone(layers.blockers);
  if (layers.waterLevel !== undefined && layers.waterLevel !== WATER_LEVEL) {
    map.waterLevel = layers.waterLevel;
  }
  if (layers.playerStart) map.playerStart = { ...layers.playerStart };
  return map;
}

// Project a CustomMap onto the engine's WorldContent for play-testing. Props
// come from the built-in world (the editor does not author them yet); free
// placements carry their collide footprint so the Sim's colliders and the
// renderer read the SAME records.
export function customMapToWorldContent(map: CustomMap): WorldContent {
  const start = map.playerStart ?? PLAYER_START;
  const world: WorldContent = {
    zones: deepClone(map.content.zones as WorldContent['zones']),
    camps: deepClone(map.content.camps as WorldContent['camps']),
    npcs: deepClone(map.content.npcs as WorldContent['npcs']),
    groundObjects: deepClone(map.content.objects as WorldContent['groundObjects']),
    roads: deepClone((map.content.roads ?? BUILTIN_WORLD.roads) as WorldContent['roads']),
    props: deepClone(BUILTIN_WORLD.props),
    playerStart: { x: start.x, z: start.z },
    terrainEdits: deepClone(map.terrainEdits),
    placements: placementsToPlayAssets(map.placements),
    biomePaint: map.biomePaint ? deepClone(map.biomePaint) : undefined,
  };
  if (map.blockers && map.blockers.length > 0) world.blockers = deepClone(map.blockers);
  if (map.waterLevel !== undefined) world.waterLevel = map.waterLevel;
  return world;
}

// The collision radius a colliding placement actually gets: the per-placement
// override when authored, else the scale-derived default. The ONE resolution
// used by both the render footprint and the playtest colliders.
export function effectiveCollideRadius(p: Pick<MapPlacement, 'scale' | 'collideRadius'>): number {
  return p.collideRadius ?? collideRadiusFor(p.scale);
}

// Resolve editor placements (catalogue id, or an uploaded 'user/<sha256>' id)
// into render-ready PlacedAssets (GLB path). INDEX-ALIGNED with the document:
// slot i always describes placement i, and a placement with an unknown id
// becomes a null hole instead of being dropped, so the 3D view (which keys
// meshes by DOCUMENT index) never drifts one slot after an unresolvable id.
// Colliding placements get their authored collideRadius override, else the
// scale-proportional default (see effectiveCollideRadius above).
export function placementsToRenderAssets(
  placements: readonly AssetPlacement[],
): (PlacedAsset | null)[] {
  return placements.map((p) => {
    const path = userAssetPath(p.assetId) ?? assetById(p.assetId)?.path;
    if (!path) return null;
    const placed: PlacedAsset = { path, x: p.x, z: p.z, rotY: p.rotY, scale: p.scale };
    if (p.collide) placed.collideRadius = effectiveCollideRadius(p);
    return placed;
  });
}

// The compact (hole-free) resolution, for consumers that do not key by document
// index: the play-test WorldContent (sim colliders + the game renderer's
// constructor build) only needs the resolvable placements.
export function placementsToPlayAssets(placements: readonly AssetPlacement[]): PlacedAsset[] {
  return placementsToRenderAssets(placements).filter((a): a is PlacedAsset => a !== null);
}
