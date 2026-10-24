// Live-world authoring is an overlay on canonical game content, never a conversion
// of that content into a standalone Studio world. The compiler rejects edits it
// cannot carry faithfully instead of retaining or dropping them silently.
import { BASE_WORLD } from '../sim/data';
import {
  applyFenbridgeTouchupToWorld,
  resolveFenbridgeTerrainEdits,
} from '../sim/fenbridge_touchup';
import { MAP_DOC_VERSION, type MapDoc, sanitizeMapDoc } from '../sim/map_doc';
import { materialFinishTextureRefs } from '../sim/material_finishes';
import type { WorldContent } from '../sim/types';
import { wallFinishTextureRefs } from '../sim/wall_finishes';
import { WORLD_SEED } from '../sim/world_seed';
import {
  applyWorldTouchup,
  type WorldTouchup,
  worldTouchupBase,
  worldTouchupIdentity,
  worldTouchupToken,
} from '../sim/world_touchup';
import { WORLD_TOUCHUP, WORLD_TOUCHUP_SOURCE } from '../sim/world_touchup.generated';
import { type CustomMap, placementsToPlayAssets } from './custom_map';
import { ensureMapItemIdsFromContent } from './map_item_ids';
import { movableObjectByKey } from './object_moves_core';
import { applyRoadEdits } from './road_edit_core';

const DIRECT_LAYERS = [
  'terrainVertexEdits',
  'biomePaint',
  'detailRegions',
  'grassClear',
  'decorationExclusions',
  'objectMoves',
  'fenbridgeTouchup',
] as const;
const EDITABLE_KEYS = new Set<string>([
  'meta',
  'terrainEdits',
  'placements',
  'assetCollisionMesh',
  'roadEdits',
  'roadDefs',
  'markers',
  ...DIRECT_LAYERS,
]);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const equal = (a: unknown, b: unknown): boolean =>
  worldTouchupIdentity(a) === worldTouchupIdentity(b);
// Studio's active overlay mutates the exported NPC registry. Capture the native
// provenance before a standalone map can install that overlay in this tab.
const nativeContent = clone(BASE_WORLD);
const nativeBase = worldTouchupBase(nativeContent);
const currentRevision = worldTouchupToken(WORLD_TOUCHUP.changes);

export function liveWorldBaseline(): MapDoc {
  const base = nativeBase;
  const map = sanitizeMapDoc(
    clone({
      version: MAP_DOC_VERSION,
      meta: {
        id: `live-${base}-${currentRevision}`,
        name: 'Live world',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        seed: WORLD_SEED,
        parentId: '',
        overworldBase: base,
        overworldRevision: currentRevision,
      },
      content: {
        zones: nativeContent.zones,
        camps: nativeContent.camps,
        npcs: nativeContent.npcs,
        objects: nativeContent.groundObjects,
        roads: nativeContent.roads,
      },
      terrainEdits: BASE_WORLD.terrainEdits ?? [],
      placements: [],
    }),
  );
  if (!map) throw new Error('Cannot construct live-world baseline');
  map.terrainEdits.forEach((stamp, index) => {
    stamp.id = `live-terrain-${index}`;
  });
  ensureMapItemIdsFromContent(map);
  return map;
}

export function newLiveWorldMap(name: string): CustomMap {
  const map = WORLD_TOUCHUP_SOURCE ? clone(WORLD_TOUCHUP_SOURCE) : liveWorldBaseline();
  if (map.meta.overworldBase !== nativeBase) {
    throw new Error('Live-world source needs rebasing before editing');
  }
  map.meta.name = name;
  map.meta.overworldRevision = currentRevision;
  map.meta.id = `live-${nativeBase}-${currentRevision}`;
  return map;
}

/** Saved alongside the artifact; the next editor starts from this revision. */
export function publishedLiveWorldDocument(map: MapDoc, patch: WorldTouchup): MapDoc {
  const source = clone(map);
  source.meta.overworldRevision = worldTouchupToken(patch.changes);
  source.meta.id = `live-${source.meta.overworldBase}-${source.meta.overworldRevision}`;
  return source;
}

/** Shared live references for the viewport. Native props, services and gameplay stay intact. */
export function liveWorldPreview(map: CustomMap): WorldContent {
  const world: WorldContent = {
    ...BASE_WORLD,
    liveWorldPreview: true,
    terrainEdits: map.terrainEdits,
    roads: [
      ...applyRoadEdits(BASE_WORLD.roads, map.roadEdits),
      ...(map.roadDefs ?? []).map((r) => r.points),
    ].map((road) => [...road]),
  };
  for (const key of DIRECT_LAYERS) {
    if (map[key] !== undefined) Object.assign(world, { [key]: map[key] });
  }
  world.fenbridgeTouchup = liveFenbridgeTouchup(map);
  return applyFenbridgeTouchupToWorld(world);
}

/** Cottage placements are editable; their pads must follow the same UID. */
function liveFenbridgeTouchup(map: CustomMap): CustomMap['fenbridgeTouchup'] {
  const touchup = map.fenbridgeTouchup;
  if (!touchup?.addedCottages) return touchup;
  return {
    ...touchup,
    addedCottages: touchup.addedCottages.flatMap((cottage) => {
      const placement = map.placements.find((p) => p.uid === cottage.uid);
      return placement ? [{ ...cottage, x: placement.x, z: placement.z, rot: placement.rotY }] : [];
    }),
  };
}

/** A placement edit only rebuilds terrain when a cottage pad actually moves. */
export function liveWorldCottagesChanged(world: WorldContent, map: CustomMap): boolean {
  if (!map.meta.overworldBase || !map.fenbridgeTouchup?.addedCottages) return false;
  return !equal(world.fenbridgeTouchup?.addedCottages, liveFenbridgeTouchup(map)?.addedCottages);
}

/** Rebind derived town pads after a stroke, erase, undo or redo. */
export function refreshLiveWorldTerrain(world: WorldContent, map: CustomMap): void {
  if (!map.meta.overworldBase) return;
  world.fenbridgeTouchup = liveFenbridgeTouchup(map);
  world.terrainEdits = resolveFenbridgeTerrainEdits(map.terrainEdits, world.fenbridgeTouchup);
}

export function compileLiveWorldDocument(raw: unknown): {
  map: MapDoc;
  patch: WorldTouchup;
  world: WorldContent;
} {
  const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const map = sanitizeMapDoc(input);
  if (!map) throw new Error('Invalid live-world document');
  if (map.fenbridgeTouchup) map.fenbridgeTouchup = liveFenbridgeTouchup(map);
  for (const key of ['placements', 'terrainEdits'] as const) {
    if (!Array.isArray(input?.[key]) || input[key].length !== map[key].length) {
      throw new Error(`Invalid or truncated live-world layer: ${key}`);
    }
  }
  const baseline = liveWorldBaseline();
  if (map.meta.overworldBase !== baseline.meta.overworldBase || map.meta.seed !== WORLD_SEED) {
    throw new Error('Live-world baseline changed or missing. Open the current live-world source.');
  }
  if (map.meta.overworldRevision !== currentRevision) {
    throw new Error(
      'Live-world touch-up revision changed. Reopen the current source before exporting.',
    );
  }
  const unsupported = [...new Set([...Object.keys(map), ...Object.keys(baseline)])].filter(
    (key) =>
      !EDITABLE_KEYS.has(key) && !equal(map[key as keyof MapDoc], baseline[key as keyof MapDoc]),
  );
  if (unsupported.length)
    throw new Error(`Unsupported live-world edits: ${unsupported.join(', ')}`);
  const patch: WorldTouchup = { version: 1, base: baseline.meta.overworldBase!, changes: {} };
  for (const key of DIRECT_LAYERS) {
    if (!equal(map[key], baseline[key])) Object.assign(patch.changes, { [key]: clone(map[key]) });
  }
  if (!equal(map.terrainEdits, baseline.terrainEdits)) {
    const originals = new Map(baseline.terrainEdits.map((s, i) => [s.id, i]));
    const seen = new Set<string>();
    patch.changes.terrainEdits = map.terrainEdits.map((stamp) => {
      if (stamp.id && seen.has(stamp.id)) throw new Error('Duplicate terrain stamp identity');
      if (stamp.id) seen.add(stamp.id);
      const index = originals.get(stamp.id);
      if (index !== undefined && equal(stamp, baseline.terrainEdits[index])) {
        return clone(BASE_WORLD.terrainEdits![index]);
      }
      const { id: _id, ...value } = stamp;
      return value;
    });
  }
  if (map.roadEdits || map.roadDefs?.length) {
    for (const key of Object.keys(map.roadEdits ?? {})) {
      if (!BASE_WORLD.roads[Number(key)]) throw new Error(`Unknown native road: ${key}`);
    }
    patch.changes.roads = clone(
      [
        ...applyRoadEdits(BASE_WORLD.roads, map.roadEdits),
        ...(map.roadDefs ?? []).map((r) => r.points),
      ].map((road) => [...road]),
    );
  }
  for (const key of Object.keys(map.objectMoves ?? {})) {
    if (!movableObjectByKey(key)) throw new Error(`Unknown gameplay object: ${key}`);
  }
  if (map.biomePaint?.custom?.some((swatch) => swatch.textureSha)) {
    throw new Error('Imported terrain textures must be shipped before world export');
  }
  for (const p of map.placements) {
    if (
      wallFinishTextureRefs(p.wallFinishes).length ||
      materialFinishTextureRefs(p.materialFinishes).length
    ) {
      throw new Error('Imported material textures must be shipped before world export');
    }
    // Browser-local uploads need a separate asset intake before they can be part of a release.
    if (p.assetId.startsWith('local/') || p.assetId.startsWith('user/')) {
      throw new Error(`Unshipped placement asset: ${p.assetId}`);
    }
  }
  const placements = placementsToPlayAssets(map.placements, map.assetCollisionMesh);
  if (placements.length !== map.placements.length) {
    throw new Error('A placement cannot be resolved to a shipped asset or volume');
  }
  if (placements.length) patch.changes.placements = placements;
  const world = applyWorldTouchup(
    worldTouchupBase(BASE_WORLD) === nativeBase ? BASE_WORLD : nativeContent,
    patch,
  );
  return { map, patch, world };
}
