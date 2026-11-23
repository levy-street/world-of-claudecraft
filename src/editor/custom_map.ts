import { cloneMaterialFinishes } from '../sim/material_finishes';
import { cloneWallFinishes } from '../sim/wall_finishes';
import { WORLD_SEED } from '../sim/world_seed';
import { compileLiveWorldDocument } from './live_world_core';
// The CustomMap document: the editor's canonical, serializable map. The type and
// its sanitizer live in src/sim/map_doc.ts (shared with the server, which
// validates uploaded documents with the SAME code); this module adapts the
// document to the editor's live editing model and projects it onto the engine's
// WorldContent for play-test. Pure: no DOM, Vitest-importable.

import { autoCollideRadius } from '../sim/asset_collision';
import { colliderVolumesFromPlacements } from '../sim/collider_volumes';
import { clonePropsKeepingAuthoredTowns } from '../sim/custom_world_props';
import {
  BASE_WORLD,
  BUILTIN_WORLD,
  PLAYER_START,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
} from '../sim/data';
import { fluidVolumesFromPlacements } from '../sim/fluid_volumes';
import {
  type AssetCollisionBox,
  effectiveCollisionMode,
  GRASS_PATCH_ASSET_ID,
  GRASS_PATCH_PATH,
  MAP_DOC_VERSION,
  MAX_BLOCKER_LENGTH,
  MAX_BLOCKERS,
  type MapDoc,
  type MapDocMeta,
  type MapPlacement,
  MODEL_ASSET_ID,
  MODEL_PATH,
  ROCK_ASSET_ID,
  ROCK_PATH,
  ROCK_RIDGE_ASSET_ID,
  ROCK_RIDGE_PATH,
  TREE_ASSET_ID,
  TREE_PATH,
  WATERFALL_ASSET_ID,
  WATERFALL_PATH,
} from '../sim/map_doc';
import { mapObjectivesFromPlacements } from '../sim/map_objectives';
import { freezeObjectMoves } from '../sim/moved_objects';
import {
  emptyZoneProps,
  type GraveyardDef,
  type PlacedAsset,
  type PromotedScenery,
  type WorldContent,
  type ZoneDef,
} from '../sim/types';
import { WATER_LEVEL } from '../sim/world';
import { assetById } from './asset_catalog.generated';
import { FEATURE_PROMOTIONS } from './feature_prop_placements';
import { isLocalAssetId, localAssetUrl } from './local_assets';
import type { ZoneContent } from './model';
import { applyRoadEdits } from './road_edit_core';
import { userAssetPath } from './user_assets';
import {
  decorPropPlacements,
  farshorePalmPlacements,
  streetlampPropPlacements,
  willowPropPlacements,
  withoutEditableWorldProps,
  withoutMajorWorldProps,
  worldMajorPropPlacements,
} from './world_prop_placements';

export const CUSTOM_MAP_VERSION = MAP_DOC_VERSION;

/** A fresh blank map's water level: sunk far below the flat slate so the
 *  canvas starts dry (the maker raises it from the Water tab). Generate
 *  Terrain restores the shipped WATER_LEVEL when the maker never touched it,
 *  so sourced lakes and coastlines read as water. */
export const BLANK_MAP_WATER_LEVEL = -40;

// Editor-facing aliases: the document shape IS the shared MapDoc.
export type AssetPlacement = MapPlacement;
export type CustomMapMeta = MapDocMeta;
// The editor's in-memory document shares the LIVE ZoneContent ref with the
// marker model (readonly views of the same tables), so content stays readonly
// here; serialization casts back to the mutable MapDoc shape.
export type CustomMap = Omit<MapDoc, 'content'> & { content: ZoneContent };

// CustomMap and MapDoc describe the SAME on-wire document: only the static
// type of `content` differs (CustomMap's ZoneContent is readonly so the
// editor can share live table references with the marker model; MapDoc's
// MapDocContent is mutable, the shape the shared sanitizer/serializer and the
// server expect). The unsafe cast that bridges the two lives here, ONCE, so
// every save/serialize call site asks for the shared shape by name instead of
// re-deriving `map as unknown as MapDoc` inline.
export function toMapDoc(map: CustomMap): MapDoc {
  return map as unknown as MapDoc;
}

// The shipped world seed; a fresh map defaults to it so its built-in derived
// terrain matches what the editor previews (mirrors DEFAULT_PLAYTEST_SEED).
const DEFAULT_SEED = WORLD_SEED;
const FLAT_STAMPS = [
  {
    x: -WORLD_MAX_X / 2,
    z: 60,
    radius: 200,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  },
  {
    x: WORLD_MAX_X / 2,
    z: 60,
    radius: 200,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  },
  {
    x: -WORLD_MAX_X / 2,
    z: 260,
    radius: 200,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  },
  {
    x: WORLD_MAX_X / 2,
    z: 260,
    radius: 200,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  },
] satisfies CustomMap['terrainEdits'];

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
      zones: deepClone(BASE_WORLD.zones as CustomMap['content']['zones']),
      camps: deepClone(BASE_WORLD.camps as CustomMap['content']['camps']),
      npcs: deepClone(BASE_WORLD.npcs as CustomMap['content']['npcs']),
      objects: deepClone(BASE_WORLD.groundObjects as CustomMap['content']['objects']),
      roads: deepClone(BASE_WORLD.roads as CustomMap['content']['roads']),
    },
    terrainEdits: [],
    placements: [
      ...worldMajorPropPlacements(BASE_WORLD.props, DEFAULT_SEED, true),
      // The realms' authored dressing (flower beds, iron fences, torches, hex
      // homes): renderer-owned until now, which is why a maker could see them
      // and not move them.
      ...decorPropPlacements(BASE_WORLD.props),
      // The road network's lamp posts (empty when the builtin plan has not
      // been cached yet and the builtin world is not active to plan it;
      // promoteStreetlamps then upgrades the map on a later boot).
      ...streetlampPropPlacements(DEFAULT_SEED),
      // The Willowfen + Veiled Hollow weeping willows (reachPalmSpots idiom).
      ...willowPropPlacements(DEFAULT_SEED),
      // The Farshore isle's own strand palms.
      ...farshorePalmPlacements(DEFAULT_SEED),
      // The per-zone feature dressing (den treasure, valley boulders, pond
      // flora, lake flora, coconut clusters), one extractor per family.
      ...FEATURE_PROMOTIONS.flatMap((family) => family.placements(DEFAULT_SEED)),
    ],
    // The doc-persisted promoted-scenery flags for the families above (the
    // asset-detected families, lamps, willows, palms, self-detect instead).
    promotedScenery: Object.fromEntries(FEATURE_PROMOTIONS.map((family) => [family.flag, true])),
    propsMode: 'editable-all',
  };
}

/** Requested dimensions for a sized blank map (yards). */
export interface NewMapSize {
  width: number;
  height: number;
}

export const NEW_MAP_MIN_SIDE = 40;
export const NEW_MAP_MAX_SIDE = 2000;

/**
 * The level-to-zero stamp grid that keeps a sized blank map flat: 'level' +
 * 'flat' stamps set the heightfield to 0 across their disc, so a grid of them
 * (spacing under radius*sqrt(2)) covers the whole play rect. Bounded well
 * under MAX_TERRAIN_EDITS even at the maximum size (2000yd -> 81 stamps).
 */
function flatStampGrid(halfW: number, halfH: number): CustomMap['terrainEdits'] {
  const radius = 200;
  const step = 260;
  const out: CustomMap['terrainEdits'] = [];
  const cols = Math.max(1, Math.ceil((halfW * 2) / step));
  const rows = Math.max(1, Math.ceil((halfH * 2) / step));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: -halfW + ((c + 0.5) * (halfW * 2)) / cols,
        z: -halfH + ((r + 0.5) * (halfH * 2)) / rows,
        radius,
        delta: 0,
        falloff: 'flat',
        mode: 'level',
      });
    }
  }
  return out;
}

/** Split one boundary edge into blocker segments no longer than the cap. */
function boundaryEdge(
  out: NonNullable<CustomMap['blockers']>,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const parts = Math.max(1, Math.ceil(len / MAX_BLOCKER_LENGTH));
  for (let i = 0; i < parts; i++) {
    out.push({
      x1: x1 + ((x2 - x1) * i) / parts,
      z1: z1 + ((z2 - z1) * i) / parts,
      x2: x1 + ((x2 - x1) * (i + 1)) / parts,
      z2: z1 + ((z2 - z1) * (i + 1)) / parts,
    });
  }
}

/** Invisible perimeter walls at the exact map bounds, split into segments no
 *  longer than the blocker cap, so a small map is genuinely small in playtest. */
function perimeterBlockers(halfW: number, halfH: number): CustomMap['blockers'] {
  const out: NonNullable<CustomMap['blockers']> = [];
  boundaryEdge(out, -halfW, -halfH, halfW, -halfH);
  boundaryEdge(out, halfW, -halfH, halfW, halfH);
  boundaryEdge(out, halfW, halfH, -halfW, halfH);
  boundaryEdge(out, -halfW, halfH, -halfW, -halfH);
  return out.slice(0, MAX_BLOCKERS);
}

/** The map's playable rect: worldHalfX wide, the zone band tall. */
export function mapBounds(map: CustomMap): {
  halfW: number;
  zMin: number;
  zMax: number;
} {
  const halfW = map.worldHalfX ?? WORLD_MAX_X;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const z of map.content.zones) {
    zMin = Math.min(zMin, z.zMin);
    zMax = Math.max(zMax, z.zMax);
  }
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) {
    zMin = WORLD_MIN_Z;
    zMax = WORLD_MAX_Z;
  }
  return { halfW, zMin, zMax };
}

/** True when a blocker runs along the given axis-aligned boundary line. */
function blockerOnLine(
  b: { x1: number; z1: number; x2: number; z2: number },
  axis: 'x' | 'z',
  v: number,
): boolean {
  const eps = 0.5;
  return axis === 'x'
    ? Math.abs(b.x1 - v) < eps && Math.abs(b.x2 - v) < eps
    : Math.abs(b.z1 - v) < eps && Math.abs(b.z2 - v) < eps;
}

/**
 * Perimeter walls for the play-test projection: EVERY custom map gets a hard,
 * unjumpable boundary at its world rect (blocker collision is height-agnostic
 * in the sim, so nothing clears it). Edges the document already walls off
 * (sized flat maps store their own perimeter) are skipped.
 */
export function boundaryBlockers(map: CustomMap): NonNullable<CustomMap['blockers']> {
  const { halfW, zMin, zMax } = mapBounds(map);
  const existing = map.blockers ?? [];
  const out: NonNullable<CustomMap['blockers']> = [];
  if (!existing.some((b) => blockerOnLine(b, 'z', zMin))) {
    boundaryEdge(out, -halfW, zMin, halfW, zMin);
  }
  if (!existing.some((b) => blockerOnLine(b, 'x', halfW))) {
    boundaryEdge(out, halfW, zMin, halfW, zMax);
  }
  if (!existing.some((b) => blockerOnLine(b, 'z', zMax))) {
    boundaryEdge(out, halfW, zMax, -halfW, zMax);
  }
  if (!existing.some((b) => blockerOnLine(b, 'x', -halfW))) {
    boundaryEdge(out, -halfW, zMax, -halfW, zMin);
  }
  return out;
}

/**
 * A blank flat authoring map. With `size`, the world is bounded to the chosen
 * rect: the zone band carries the z extent, worldHalfX the x extent (terrain
 * rim walls + decoration bounds), the stamp grid flattens the interior, and
 * perimeter blockers make the bounds collide. Without `size`, the legacy
 * world-sized flat map (unchanged) for older call sites.
 */
export function newFlatCustomMap(
  name: string,
  id: string,
  now: number,
  size?: NewMapSize,
): CustomMap {
  const clampSide = (v: number): number =>
    Math.min(NEW_MAP_MAX_SIDE, Math.max(NEW_MAP_MIN_SIDE, v));
  const halfW = size ? clampSide(size.width) / 2 : WORLD_MAX_X;
  const halfH = size ? clampSide(size.height) / 2 : 0; // legacy path ignores this
  const zMin = size ? -halfH : WORLD_MIN_Z;
  const zMax = size ? halfH : WORLD_MAX_Z;
  const map: CustomMap = {
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
      zones: [
        {
          id: 'blank_world',
          // Deliberately UNNAMED: a blank map shows no location name in
          // playtest until the maker authors locations with the Zone tool.
          name: '',
          zMin,
          zMax,
          levelRange: [1, 1],
          biome: 'vale',
          hub: { x: 0, z: 0, radius: 8, name: '' },
          graveyard: { x: 0, z: 0 },
          lakes: [],
          pois: [],
          welcome: '',
        },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: size ? flatStampGrid(halfW, halfH) : deepClone(FLAT_STAMPS),
    placements: [],
    waterLevel: BLANK_MAP_WATER_LEVEL,
    playerStart: { x: 0, z: 0 },
    propsMode: 'empty',
    decorationsMode: 'empty',
    presentationMode: 'blank',
    // A blank map starts with every automatic-texturing rule OFF: makers paint
    // and sculpt on a clean slate, so nothing repaints their cliffs or shores
    // until they opt in from the Biome tab's Auto textures section.
    terrainStyle: {
      slopeRock: false,
      snowCaps: false,
      rimMountains: false,
      shoreSand: false,
    },
  };
  if (size) {
    map.worldHalfX = halfW;
    map.blockers = perimeterBlockers(halfW, halfH);
  }
  return map;
}

// Build a CustomMap from a live ZoneContent (the editor's current edits) plus the
// authoring layers. Deep-cloned so the document is independent of further edits.
export function customMapFromContent(
  content: ZoneContent,
  layers: {
    terrainEdits?: CustomMap['terrainEdits'];
    placements?: AssetPlacement[];
    blockers?: CustomMap['blockers'];
    caves?: CustomMap['caves'];
    meta: CustomMapMeta;
    waterLevel?: number;
    playerStart?: { x: number; z: number };
    playerSpawnArea?: {
      minX: number;
      minZ: number;
      maxX: number;
      maxZ: number;
    };
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
  if (layers.caves && layers.caves.length > 0) map.caves = deepClone(layers.caves);
  if (layers.waterLevel !== undefined && layers.waterLevel !== WATER_LEVEL) {
    map.waterLevel = layers.waterLevel;
  }
  if (layers.playerStart) map.playerStart = { ...layers.playerStart };
  if (layers.playerSpawnArea) map.playerSpawnArea = { ...layers.playerSpawnArea };
  return map;
}

// The doc's imported-model bake map with every entry ALSO keyed by the path
// the play projection resolves. Local imports keep their 'local/<sha>' id as
// the path, but server uploads render at '/api/assets/<sha>.glb' - without
// the alias the sim's box lookup misses and a user-uploaded model collides
// as a plain circle (which visibly ignores the placement's rotation).
function playAssetCollision(
  src: Readonly<Record<string, AssetCollisionBox[]>>,
): Record<string, AssetCollisionBox[]> {
  const out: Record<string, AssetCollisionBox[]> = deepClone(src) as Record<
    string,
    AssetCollisionBox[]
  >;
  for (const id of Object.keys(src)) {
    const path = userAssetPath(id);
    if (path && !out[path]) out[path] = deepClone(src[id]) as AssetCollisionBox[];
  }
  return out;
}

/**
 * The scenery families this document owns as placements, for the renderer-side
 * builders that read a STATIC content module and so cannot tell.
 *
 * 'editable-all' is exactly the tier that promotes both: worldMajorPropPlacements
 * emits the strand's palms (includePalms) and the giant trees, and
 * withoutEditableWorldProps empties greatTrees behind them. Without this the
 * Palmreach strand drew every palm twice, the movable placement and, inside it,
 * jungle_features.ts's unpickable instance.
 */
export function promotedSceneryFor(
  propsMode: CustomMap['propsMode'],
  placements: readonly { assetId: string; x: number }[],
  docFlags?: Record<string, boolean>,
): PromotedScenery | undefined {
  if (propsMode !== 'editable-all') return undefined;
  return {
    reachPalms: true,
    greatTrees: true,
    // Streetlamps/willows/farshore only when the document actually carries
    // them: an older editable-all save that the load-time promotion could not
    // upgrade (its plan was never cached this session) keeps the renderer's
    // copies, uneditable but present, instead of losing them outright.
    // Farshore palms share the beach_palm assets with the Palmreach strand;
    // the two stands sit on opposite sides of the map, so the sign of x is
    // the discriminator (Palmreach x < -190, the isle x > 180).
    streetlamps: placements.some((p) => p.assetId.startsWith('props/streetlamp_')),
    willows: placements.some((p) => p.assetId === 'props/willow_tree'),
    farshorePalms: placements.some((p) => /^biome\/beach_palm_[123]$/.test(p.assetId) && p.x > 0),
    // Later families persist their flags on the DOC (map_doc promotedScenery)
    // because they have no unique asset id to self-detect from placements.
    ...(docFlags ?? {}),
  };
}

/** A custom world's respawn graveyards: one per zone, at its graveyard point. */
export function zoneGraveyards(zones: readonly ZoneDef[]): GraveyardDef[] {
  return zones.map((zone) => ({
    id: `gy_${zone.id}`,
    name: zone.name,
    x: zone.graveyard.x,
    z: zone.graveyard.z,
  }));
}

// Project a CustomMap onto the engine's WorldContent for play-testing. The
// editor does not author structured ZoneProps yet, so custom worlds retain an
// independent clone of reusable built-in props outside Eastbrook, filtered by
// the document's propsMode (the editable-foliage tiers). Free
// placements carry their collide footprint so the Sim's colliders and the
// renderer read the SAME records.
export function customMapToWorldContent(map: CustomMap): WorldContent {
  if (map.meta.overworldBase) {
    return { ...compileLiveWorldDocument(map).world, liveWorldPreview: true };
  }
  // LINKED map: the maker anchored this map into the world, project its
  // layers into the FULL built-in world at that offset instead of booting the
  // standalone authored slate.
  if (map.worldAnchor) return linkedWorldContent(map, map.worldAnchor);
  const start = map.playerStart ?? PLAYER_START;
  const world: WorldContent = {
    zones: deepClone(map.content.zones as WorldContent['zones']),
    camps: deepClone(map.content.camps as WorldContent['camps']),
    npcs: deepClone(map.content.npcs as WorldContent['npcs']),
    groundObjects: deepClone(map.content.objects as WorldContent['groundObjects']),
    // The legacy roads with this map's moves and removals applied, then the
    // authored roads: the same table the editor viewport builds.
    roads: deepClone([
      ...applyRoadEdits(map.content.roads ?? BUILTIN_WORLD.roads, map.roadEdits),
      ...(map.roadDefs ?? []).map((def) => def.points),
    ] as WorldContent['roads']),
    // clonePropsWithoutEastbrookLayout already returns an independent clone, so
    // it replaces the deepClone the fork branches used to take.
    props:
      map.propsMode === 'empty'
        ? emptyZoneProps()
        : map.propsMode === 'editable-all'
          ? withoutEditableWorldProps(clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props))
          : map.propsMode === 'editable-major'
            ? withoutMajorWorldProps(clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props))
            : clonePropsKeepingAuthoredTowns(BUILTIN_WORLD.props),
    playerStart: { x: start.x, z: start.z },
    zoneAtmosphere: map.zoneAtmosphere ? deepClone(map.zoneAtmosphere) : undefined,
    // Stamp ids are the editor's change-tracking handles; the game never
    // reads them, so the game-ready world leaves them out.
    terrainEdits: map.terrainEdits.map(({ id: _id, ...stamp }) => deepClone(stamp)),
    placements: placementsToPlayAssets(map.placements, map.assetCollisionMesh),
    biomePaint: map.biomePaint ? deepClone(map.biomePaint) : undefined,
    promotedScenery: promotedSceneryFor(map.propsMode, map.placements, map.promotedScenery),
  };
  if (map.playerSpawnArea) world.playerSpawnArea = { ...map.playerSpawnArea };
  // The built-in gameplay objects this map moved (farm beds, practice dummies,
  // gather nodes, dungeon doors): the playtest and the published map read
  // the same frozen record the editor viewport does (sim/moved_objects.ts).
  const objectMoves = freezeObjectMoves(map.objectMoves);
  if (objectMoves) world.objectMoves = objectMoves;
  // Every zone's graveyard point (the editor's graveyard handle) is a respawn:
  // a released spirit appears at the nearest one and a Spirit Healer hovers
  // there. Without this record a custom world has no graveyards at all and
  // every death released to the map's start point.
  const graveyards = zoneGraveyards(world.zones);
  if (graveyards.length > 0) world.services = { graveyards };
  if (map.blockers && map.blockers.length > 0) world.blockers = deepClone(map.blockers);
  // Imported-model collision bakes ride into the play world so the sim's
  // placement colliders resolve 'local/<sha>' / 'user/<sha>' paths.
  if (map.assetCollision && Object.keys(map.assetCollision).length > 0) {
    world.assetCollision = playAssetCollision(map.assetCollision);
  }
  // Per-asset sway opt-outs ride along: presentation the maker authored, so a
  // vine they stilled in the editor is still in playtest.
  if (map.assetSway && Object.keys(map.assetSway).length > 0) {
    world.assetSway = { ...map.assetSway };
  }
  if (map.caves && map.caves.length > 0) world.caves = deepClone(map.caves);
  if (map.holes && map.holes.length > 0) world.holes = deepClone(map.holes);
  if (map.holePatches && map.holePatches.length > 0) {
    world.holePatches = deepClone(map.holePatches);
  }
  if (map.terrainKnockouts && map.terrainKnockouts.length > 0) {
    world.terrainKnockouts = deepClone(map.terrainKnockouts);
  }
  if (map.terrainVertexEdits && map.terrainVertexEdits.length > 0) {
    world.terrainVertexEdits = deepClone(map.terrainVertexEdits);
  }
  if (map.rails && map.rails.length > 0) world.rails = deepClone(map.rails);
  if (map.detailRegions && map.detailRegions.length > 0) {
    world.detailRegions = deepClone(map.detailRegions);
  }
  // The map limits are ALWAYS a hard boundary in playtest: wall off any edge
  // of the world rect the document does not already cover. Projection-only:
  // these never enter the stored document.
  const boundary = boundaryBlockers(map);
  if (boundary.length > 0) world.blockers = [...(world.blockers ?? []), ...boundary];
  // Collider-volume placements (assetId 'collider/<kind>') resolve to no model
  // (invisible in playtest) but DO block: project them into sim volumes here.
  const colliderVolumes = colliderVolumesFromPlacements(map.placements);
  if (colliderVolumes.length > 0) world.colliderVolumes = colliderVolumes;
  // Fluid pools project the same way: invisible in the placements pipeline
  // (no GLB), but the sim damage tick and the renderer's fluid surfaces both
  // read the resolved volumes.
  const fluids = fluidVolumesFromPlacements(map.placements);
  if (fluids.length > 0) world.fluids = fluids;
  // Game-mode anchors (`regionRole`) the objective driver runs the flag and
  // rune rules off. Projection only: the tags stay ordinary placements the
  // maker can drag, and a map that tagged nothing gets no record at all.
  const objectives = mapObjectivesFromPlacements(map.placements);
  if (objectives) world.objectives = objectives;
  if (map.waterHue !== undefined) world.waterHue = map.waterHue;
  if (map.waterLum !== undefined) world.waterLum = map.waterLum;
  if (map.waterLevel !== undefined) world.waterLevel = map.waterLevel;
  if (map.worldHalfX !== undefined) world.worldHalfX = map.worldHalfX;
  if (map.decorationsMode === 'empty') world.decorationsMode = 'empty';
  if (map.decorationExclusions && map.decorationExclusions.length > 0) {
    world.decorationExclusions = [...map.decorationExclusions];
  }
  if (map.grassClear && map.grassClear.length > 0) {
    world.grassClear = map.grassClear.map(({ id: _id, ...c }) => ({ ...c }));
  }
  if (map.clutter && map.clutter.length > 0) {
    world.clutter = map.clutter.map((s) => ({ ...s }));
  }
  if (map.presentationMode !== undefined) world.presentationMode = map.presentationMode;
  if (map.terrainBase) world.terrainBase = { ...map.terrainBase };
  if (map.skybox !== undefined) world.skybox = map.skybox;
  if (map.terrainStyle) world.terrainStyle = { ...map.terrainStyle };
  if (map.timeScale !== undefined) world.timeScale = map.timeScale;
  if (map.zoneAtmosphere) world.zoneAtmosphere = deepClone(map.zoneAtmosphere);
  if (map.assetViewDistance !== undefined) world.assetViewDistance = map.assetViewDistance;
  if (map.weather) world.weather = deepClone(map.weather);
  if (map.lighting) world.lighting = { ...map.lighting };
  if (map.music) world.music = deepClone(map.music);
  if (map.locations && map.locations.length > 0) world.locations = deepClone(map.locations);
  if (map.lights && map.lights.length > 0) world.lights = deepClone(map.lights);
  if (map.pointSounds && map.pointSounds.length > 0) {
    world.pointSounds = deepClone(map.pointSounds);
  }
  if (map.decals && map.decals.length > 0) world.decals = deepClone(map.decals);
  // map.markers are deliberately NOT projected: they are editor/AI notes only.
  return world;
}

/**
 * LINK-TO-WORLD projection: embed the map's layers into the FULL built-in
 * world, offset so the map's origin lands on `anchor`. The base game keeps
 * running around the placed region (terrain, mobs, NPCs, quests, SPACEY's
 * chosen link mode), so:
 *   - the world's own zones/props/settings stay (no presentationMode, no
 *     worldHalfX shrink, no custom water level/sky/weather, those are
 *     whole-world knobs and this map is now a district of the world),
 *   - every authored coordinate layer is offset by the anchor,
 *   - the map rect's auto perimeter walls are STRIPPED (the point of linking
 *     is walking in from the world); maker-drawn interior blockers survive,
 *   - the flatten stamp grid a blank map carries embeds as terrain leveling,
 *     which is what visually seats the flat canvas into the landscape.
 * Authoring is untouched: the editor always works at the map's own origin,
 * only this playtest projection applies the offset.
 */
function linkedWorldContent(map: CustomMap, anchor: { x: number; z: number }): WorldContent {
  const ax = anchor.x;
  const az = anchor.z;
  const { halfW, zMin, zMax } = mapBounds(map);
  // Maker blockers minus the auto rect-perimeter walls (matched by the same
  // on-line test boundaryBlockers uses to avoid doubling them).
  const interiorBlockers = (map.blockers ?? []).filter(
    (b) =>
      !blockerOnLine(b, 'z', zMin) &&
      !blockerOnLine(b, 'z', zMax) &&
      !blockerOnLine(b, 'x', -halfW) &&
      !blockerOnLine(b, 'x', halfW),
  );
  const placements = map.placements.map((p) => ({ ...p, x: p.x + ax, z: p.z + az }));
  const start = map.playerStart ?? { x: 0, z: 0 };
  const world: WorldContent = {
    zones: deepClone(BUILTIN_WORLD.zones),
    // The maker's camps/NPCs/objects/roads join the world's own at the offset.
    // Colliding NPC ids keep the maker's copy (their version of that NPC).
    camps: [
      ...deepClone(BUILTIN_WORLD.camps),
      ...map.content.camps.map((c) => ({
        ...deepClone(c),
        center: { x: c.center.x + ax, z: c.center.z + az },
      })),
    ] as WorldContent['camps'],
    npcs: {
      ...deepClone(BUILTIN_WORLD.npcs),
      ...Object.fromEntries(
        Object.entries(map.content.npcs).map(([id, npc]) => [
          id,
          { ...deepClone(npc), pos: { x: npc.pos.x + ax, z: npc.pos.z + az } },
        ]),
      ),
    } as WorldContent['npcs'],
    groundObjects: [
      ...deepClone(BUILTIN_WORLD.groundObjects),
      ...map.content.objects.map((o) => ({
        ...deepClone(o),
        positions: o.positions.map((pt) => ({ x: pt.x + ax, z: pt.z + az })),
      })),
    ] as WorldContent['groundObjects'],
    roads: [
      ...deepClone(BUILTIN_WORLD.roads),
      ...applyRoadEdits(map.content.roads ?? [], map.roadEdits).map((road) =>
        road.map((pt) => ({ x: pt.x + ax, z: pt.z + az })),
      ),
      ...(map.roadDefs ?? []).map((def) =>
        def.points.map((pt) => ({ x: pt.x + ax, z: pt.z + az })),
      ),
    ] as WorldContent['roads'],
    props: deepClone(BUILTIN_WORLD.props),
    playerStart: { x: start.x + ax, z: start.z + az },
    terrainEdits: map.terrainEdits.map((s) => ({ ...s, x: s.x + ax, z: s.z + az })),
    ...(map.clutter && map.clutter.length > 0
      ? { clutter: map.clutter.map((s) => ({ ...s, x: s.x + ax, z: s.z + az })) }
      : {}),
    placements: placementsToPlayAssets(placements, map.assetCollisionMesh),
    // The map's own terrain REPLACES the overworld base inside its rect
    // (world.ts terrainHeight linkedMap override, edge-blended): the placed
    // district looks exactly like the authored map, its flat slate or its
    // Generate Terrain source, and open-sea fatigue is off inside the rect
    // so a map placed beyond the shipped coasts is safe ground.
    linkedMap: {
      anchor: { x: ax, z: az },
      minX: -halfW,
      maxX: halfW,
      minZ: zMin,
      maxZ: zMax,
      ...(map.terrainBase ? { terrainBase: { ...map.terrainBase } } : {}),
    },
  };
  if (map.playerSpawnArea) {
    world.playerSpawnArea = {
      minX: map.playerSpawnArea.minX + ax,
      minZ: map.playerSpawnArea.minZ + az,
      maxX: map.playerSpawnArea.maxX + ax,
      maxZ: map.playerSpawnArea.maxZ + az,
    };
  }
  if (interiorBlockers.length > 0) {
    world.blockers = interiorBlockers.map((b) => ({
      ...b,
      x1: b.x1 + ax,
      z1: b.z1 + az,
      x2: b.x2 + ax,
      z2: b.z2 + az,
    }));
  }
  if (map.assetCollision && Object.keys(map.assetCollision).length > 0) {
    world.assetCollision = playAssetCollision(map.assetCollision);
  }
  // Per-asset sway opt-outs ride along: presentation the maker authored, so a
  // vine they stilled in the editor is still in playtest.
  if (map.assetSway && Object.keys(map.assetSway).length > 0) {
    world.assetSway = { ...map.assetSway };
  }
  if (map.caves && map.caves.length > 0) {
    world.caves = map.caves.map((c) => ({
      ...deepClone(c),
      nodes: c.nodes.map((n) => ({ ...n, x: n.x + ax, z: n.z + az })),
    }));
  }
  if (map.holes && map.holes.length > 0) {
    world.holes = map.holes.map((h) => ({ ...h, x: h.x + ax, z: h.z + az }));
  }
  if (map.holePatches && map.holePatches.length > 0) {
    world.holePatches = map.holePatches.map((h) => ({ ...h, x: h.x + ax, z: h.z + az }));
  }
  if (map.terrainKnockouts && map.terrainKnockouts.length > 0) {
    world.terrainKnockouts = map.terrainKnockouts.map((k) => ({ ...k, x: k.x + ax, z: k.z + az }));
  }
  if (map.terrainVertexEdits && map.terrainVertexEdits.length > 0) {
    world.terrainVertexEdits = map.terrainVertexEdits.map((v) => ({
      ...v,
      x: v.x + ax,
      z: v.z + az,
    }));
  }
  if (map.rails && map.rails.length > 0) {
    world.rails = map.rails.map((r) => ({
      ...r,
      points: r.points.map((p) => ({ x: p.x + ax, y: p.y, z: p.z + az })),
    }));
  }
  if (map.detailRegions && map.detailRegions.length > 0) {
    world.detailRegions = map.detailRegions.map((r) => ({ ...r, x: r.x + ax, z: r.z + az }));
  }
  const colliderVolumes = colliderVolumesFromPlacements(placements);
  if (colliderVolumes.length > 0) world.colliderVolumes = colliderVolumes;
  const fluids = fluidVolumesFromPlacements(placements);
  if (fluids.length > 0) world.fluids = fluids;
  if (map.biomePaint) {
    world.biomePaint = {
      ...deepClone(map.biomePaint),
      originX: map.biomePaint.originX + ax,
      originZ: map.biomePaint.originZ + az,
    };
  }
  if (map.locations && map.locations.length > 0) {
    world.locations = map.locations.map((l) => ({
      ...l,
      minX: l.minX + ax,
      minZ: l.minZ + az,
      maxX: l.maxX + ax,
      maxZ: l.maxZ + az,
    }));
  }
  if (map.lights && map.lights.length > 0) {
    world.lights = map.lights.map((l) => ({ ...l, x: l.x + ax, z: l.z + az }));
  }
  if (map.pointSounds && map.pointSounds.length > 0) {
    world.pointSounds = map.pointSounds.map((s) => ({ ...s, x: s.x + ax, z: s.z + az }));
  }
  if (map.decals && map.decals.length > 0) {
    world.decals = map.decals.map((d) => ({ ...d, x: d.x + ax, z: d.z + az }));
  }
  // Music AREAS ride along at the offset, like lights and point sounds: they are
  // positional authoring about this patch of ground. The map-wide zoneTrack is
  // deliberately dropped, with the rest of the global presentation layers
  // (lighting, weather, skybox, ...): once embedded, the surrounding world owns
  // the default score, and one small linked map must not retheme all of it.
  if (map.music?.areas && map.music.areas.length > 0) {
    world.music = {
      areas: map.music.areas.map((a) => ({
        ...a,
        minX: a.minX + ax,
        maxX: a.maxX + ax,
        minZ: a.minZ + az,
        maxZ: a.maxZ + az,
      })),
    };
  }
  // map.markers stay editor-only, exactly like the standalone projection.
  return world;
}

// The collision radius a colliding placement actually gets: the per-placement
// override when authored, else the derived default, in 'basic' mode a
// baked-footprint fit that hugs the actual mesh, otherwise the scale- and
// family-derived factor. The ONE resolution used by both the render footprint
// and the playtest colliders.
export function effectiveCollideRadius(
  p: Pick<
    MapPlacement,
    'assetId' | 'scale' | 'collideRadius' | 'collide' | 'collisionMode' | 'collideShape'
  >,
): number {
  return p.collideRadius ?? autoCollideRadius(p.assetId, p.scale, effectiveCollisionMode(p));
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
  opts?: {
    keepLocalIds?: boolean;
    hideHidden?: boolean;
    /** Editor zone-isolate: placements outside this world rect become null
     *  slots (view-only, same contract as hideHidden, never for export). */
    zoneRect?: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** Fine "true collision" bakes by asset id (MapDoc.assetCollisionMesh). */
    meshCollision?: Readonly<Record<string, readonly AssetCollisionBox[]>>;
  },
): (PlacedAsset | null)[] {
  return placements.map((p) => {
    // Editor-only Scene Collection hide: a null slot renders nothing but keeps
    // the index aligned. Playtest/export never passes hideHidden, so a hidden
    // object still exists in the game, it is only skipped in the editor view.
    if (opts?.hideHidden && p.hidden) return null;
    if (opts?.zoneRect) {
      const r = opts.zoneRect;
      if (p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
    }
    // keepLocalIds: playtest hand-off keeps the logical 'local/<sha256>' id.
    // The editor's object URLs die when the page navigates to the game, so the
    // game re-resolves the id against the shared IndexedDB store on boot
    // (game/editor_playtest.ts) instead of receiving a dead blob: URL.
    const path =
      p.assetId === GRASS_PATCH_ASSET_ID
        ? GRASS_PATCH_PATH
        : p.assetId === WATERFALL_ASSET_ID
          ? WATERFALL_PATH
          : p.assetId === ROCK_ASSET_ID
            ? ROCK_PATH
            : p.assetId === ROCK_RIDGE_ASSET_ID
              ? ROCK_RIDGE_PATH
              : p.assetId === MODEL_ASSET_ID
                ? MODEL_PATH
                : p.assetId === TREE_ASSET_ID
                  ? TREE_PATH
                  : opts?.keepLocalIds && isLocalAssetId(p.assetId)
                    ? p.assetId
                    : (localAssetUrl(p.assetId) ??
                      userAssetPath(p.assetId) ??
                      assetById(p.assetId)?.path);
    if (!path) return null;
    const placed: PlacedAsset = {
      path,
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      scale: p.scale,
    };
    if (p.worldPropKind !== undefined) placed.worldPropKind = p.worldPropKind;
    if (p.worldPropWidth !== undefined) placed.worldPropWidth = p.worldPropWidth;
    if (p.worldPropDepth !== undefined) placed.worldPropDepth = p.worldPropDepth;
    if (p.hue !== undefined) placed.hue = p.hue;
    if (p.lum !== undefined) placed.lum = p.lum;
    if (p.clump !== undefined) placed.clump = p.clump;
    if (p.rockSeed !== undefined) placed.rockSeed = p.rockSeed;
    if (p.rockNoise !== undefined) placed.rockNoise = p.rockNoise;
    if (p.rockDetail !== undefined) placed.rockDetail = p.rockDetail;
    if (p.rockSharp !== undefined) placed.rockSharp = p.rockSharp;
    if (p.rockTex !== undefined) placed.rockTex = p.rockTex;
    if (p.rockHeight !== undefined) placed.rockHeight = p.rockHeight;
    if (p.rockDepth !== undefined) placed.rockDepth = p.rockDepth;
    if (p.rockJag !== undefined) placed.rockJag = p.rockJag;
    if (p.rockTexId !== undefined) placed.rockTexId = p.rockTexId;
    if (p.rockTexTile !== undefined) placed.rockTexTile = p.rockTexTile;
    if (p.rockNodes !== undefined) placed.rockNodes = p.rockNodes.map((n) => ({ ...n }));
    if (p.meshes !== undefined) {
      placed.meshes = p.meshes.map((m) => ({
        verts: m.verts.slice(),
        tris: m.tris.slice(),
        ...(m.ramp ? { ramp: true as const } : {}),
      }));
    }
    if (p.modelTexId !== undefined) placed.modelTexId = p.modelTexId;
    if (p.wallFinishes) placed.wallFinishes = cloneWallFinishes(p.wallFinishes);
    if (p.materialFinishes) placed.materialFinishes = cloneMaterialFinishes(p.materialFinishes);
    if (p.building) placed.building = { ...p.building };
    if (p.modelTexTile !== undefined) placed.modelTexTile = p.modelTexTile;
    if (p.modelHue !== undefined) placed.modelHue = p.modelHue;
    if (p.modelSat !== undefined) placed.modelSat = p.modelSat;
    if (p.modelLight !== undefined) placed.modelLight = p.modelLight;
    if (p.tree !== undefined) {
      placed.tree = {
        ...p.tree,
        ...(p.tree.volumes ? { volumes: p.tree.volumes.map((v) => ({ ...v })) } : {}),
      };
    }
    if (p.tint !== undefined) placed.tint = p.tint;
    if (p.opacity !== undefined) placed.opacity = p.opacity;
    if (p.glow !== undefined) placed.glow = p.glow;
    if (p.glowStrength !== undefined) placed.glowStrength = p.glowStrength;
    if (p.fire === true) placed.fire = true;
    if (p.fireEffects && p.fireEffects.length > 0) {
      placed.fireEffects = p.fireEffects.map((fx) => ({ ...fx }));
    }
    // Collision projection by effective mode (legacy documents derive theirs
    // from collide/collideRadius/collideShape; see effectiveCollisionMode).
    const mode = effectiveCollisionMode(p);
    if (mode !== 'none') {
      placed.collideRadius = effectiveCollideRadius(p);
      if (mode === 'basic') {
        // The maker's hand-picked footprint: circle or square, never upgraded
        // to the baked boxes.
        if (p.collideShape === 'square') placed.collideShape = 'square';
        placed.collideCustom = true;
      } else if (mode === 'mesh') {
        // "True collision": the fine re-bake of the real geometry when it has
        // resolved; until then the normal baked set covers the placement.
        const fine = opts?.meshCollision?.[p.assetId];
        if (fine && fine.length > 0) placed.hitboxes = fine.map((b) => ({ ...b }));
      } else if (p.hitboxes && p.hitboxes.length > 0) {
        // Baked mode with hand-edited boxes: the edits ARE the collision.
        placed.hitboxes = p.hitboxes.map((b) => ({ ...b }));
      }
      // Per-placement walkable ramp decks ride into playtest alongside the
      // boxes (the Collision Master scene's live decks; see MapPlacement.ramps).
      if (p.ramps && p.ramps.length > 0) placed.ramps = p.ramps.map((r) => ({ ...r }));
    }
    // Gizmo transform axes (visual): carried through so tilts, per-axis scale,
    // and the vertical offset render identically in the editor and playtest.
    if (p.rotX !== undefined) placed.rotX = p.rotX;
    if (p.rotZ !== undefined) placed.rotZ = p.rotZ;
    if (p.scaleX !== undefined) placed.scaleX = p.scaleX;
    if (p.scaleY !== undefined) placed.scaleY = p.scaleY;
    if (p.scaleZ !== undefined) placed.scaleZ = p.scaleZ;
    if (p.y !== undefined) placed.y = p.y;
    if (p.detached) {
      placed.detached = true;
      if (p.groundY !== undefined) placed.groundY = p.groundY;
    }
    return placed;
  });
}

// The compact (hole-free) resolution, for consumers that do not key by document
// index: the play-test WorldContent (sim colliders + the game renderer's
// constructor build) only needs the resolvable placements.
export function placementsToPlayAssets(
  placements: readonly AssetPlacement[],
  meshCollision?: Readonly<Record<string, readonly AssetCollisionBox[]>>,
): PlacedAsset[] {
  return placementsToRenderAssets(placements, {
    keepLocalIds: true,
    meshCollision,
  }).filter((a): a is PlacedAsset => a !== null);
}
