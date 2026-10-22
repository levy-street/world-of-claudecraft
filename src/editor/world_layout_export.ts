// Built-in-world export is deliberately separate from publishing an offline map.
// A review binds editor identities to current gameplay identities. No editor
// capabilities, inventories or whole-world suppression flags cross this boundary.
import type { AuthoredTownBuildingRecord } from '../sim/authored_town_registry';
import type { MapDoc, MapPlacement } from '../sim/map_doc';
import {
  MAX_OBJECT_SCALE,
  MIN_OBJECT_SCALE,
  OBJECT_EDIT_CAPS,
  parseObjectMoveKey,
} from '../sim/moved_objects';
import type { GroundObjectDef, WorldContent } from '../sim/types';
import { type CampEdit, composeWorldLayout, type WorldLayout } from '../sim/world_layout';
import { placeLayoutZoneGraveyards } from '../sim/world_layout/services';
import { WORLD_SEED } from '../sim/world_seed';
import { movableObjectByKey } from './object_moves_core';
import { compileLayoutAdditions } from './world_layout_additions';
import { type CivicLayoutBinding, compileLayoutCivic } from './world_layout_civic';
import { type CollisionLayoutAdoption, compileLayoutCollision } from './world_layout_collision';
import {
  compileLayoutDecorations,
  type DecorationLayoutReplacement,
} from './world_layout_decorations';
import { compileLayoutEnvironment, type EnvironmentLayoutReview } from './world_layout_environment';
import { compileLayoutProps, type PropLayoutReplacement } from './world_layout_props';
import { compileLayoutRoads, type RoadLayoutReview } from './world_layout_roads';
import { matchLayoutScenery } from './world_layout_scenery';
import {
  compileLayoutGraveyards,
  compileLayoutStations,
  type StationLayoutBindings,
} from './world_layout_services';
import { compileLayoutStreetlamps, type StreetlampLayoutBinding } from './world_layout_streetlamps';

export interface WorldLayoutReview {
  version: 1;
  /** Checked against the exact input bytes by the CLI before using array references. */
  sourceSha256: string;
  baseRevision: string;
  buildingBindings: Record<string, string>;
  npcIds: string[];
  groundObjectIds: string[];
  camps: { sources: CampEdit['sources']; mapIndices: number[] }[];
  objectMoveKeys: string[];
  roads?: RoadLayoutReview;
  stationBindings?: StationLayoutBindings;
  graveyardBindings?: Record<string, string>;
  environment?: EnvironmentLayoutReview;
  collisionAdoptions?: CollisionLayoutAdoption[];
  sceneryAdditions?: Record<string, string>;
  decorationReplacements?: DecorationLayoutReplacement[];
  propReplacements?: PropLayoutReplacement[];
  streetlampBindings?: StreetlampLayoutBinding[];
  civicBindings?: CivicLayoutBinding[];
  /** Retain current objects only when their projected render/collision data match exactly. */
  preserveMatchingScenery?: boolean;
  /** Every intentionally excluded asset has a reason, never just a silent filter. */
  excludedPlacements: Record<string, string>;
  /** Explicitly retain the current game's layer instead of importing this layer. */
  preservedLayers?: Record<string, string>;
  /** Source records deliberately not imported (e.g. obsolete editor-only NPCs). */
  preservedRecords?: Record<string, string>;
  /** Population changes are gameplay migrations, separately acknowledged from geometry. */
  campPopulationChanges?: Record<string, { before: number; after: number; reason: string }>;
  campSpawnMigrationReason?: string;
  pending: { id: string; reason: string }[];
}

export interface LayoutExportIssue {
  id: string;
  reason: string;
}

export interface LayoutExportResult {
  layout: WorldLayout;
  issues: LayoutExportIssue[];
  /** Unbound placements remain explicit review work, not dropped assets. */
  unboundPlacementUids: string[];
  preservedScenery?: { uid: string; currentIndex: number }[];
}

const finite = (...values: unknown[]) =>
  values.every((value) => typeof value === 'number' && Number.isFinite(value));

/** Compile only reviewed spatial changes; diagnostics prohibit production emission. */
export function compileWorldLayout(
  map: MapDoc,
  current: WorldContent,
  buildings: readonly AuthoredTownBuildingRecord[],
  review: WorldLayoutReview,
  currentScenery?: readonly MapPlacement[],
): LayoutExportResult {
  if (
    review.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(review.sourceSha256) ||
    !/^[0-9a-f]{40}$/.test(review.baseRevision)
  ) {
    throw new Error('Invalid world layout review provenance');
  }
  const layout: WorldLayout = {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  };
  const issues: LayoutExportIssue[] = [...review.pending];
  const issue = (id: string, reason: string) => issues.push({ id, reason });
  if (map.meta.seed !== WORLD_SEED)
    issue('world-seed', 'The authored map must use the built-in world seed.');
  Object.assign(layout, compileLayoutGraveyards(map, current, review.graveyardBindings, issue));
  const environment = compileLayoutEnvironment(map, review.environment, issue);
  if (environment) layout.environment = environment;
  const empty = (value: unknown) =>
    value === undefined ||
    value === null ||
    (Array.isArray(value)
      ? value.length === 0
      : typeof value === 'object' && Object.keys(value).length === 0);
  const supported = new Set([
    'version',
    'meta',
    'content',
    'placements',
    'objectMoves',
    'roadDefs',
    'roadEdits',
  ]);
  for (const key of ['terrainEdits', 'grassClear', 'biomePaint'] as const)
    if (review.environment?.[key]) supported.add(key);
  for (const [key, value] of Object.entries(map)) {
    if (!supported.has(key) && !empty(value) && !review.preservedLayers?.[key]?.trim())
      issue(
        `layer:${key}`,
        'Layer has not been reconciled. Import it or explicitly retain the current game layer with a reason.',
      );
  }
  for (const key of ['zones', 'roads'] as const) {
    if (
      !empty(map.content[key]) &&
      JSON.stringify(map.content[key]) !==
        JSON.stringify(
          key === 'zones'
            ? placeLayoutZoneGraveyards(current.zones, layout.zoneGraveyards)
            : current[key],
        ) &&
      !review.preservedLayers?.[`content.${key}`]?.trim()
    )
      issue(
        `content.${key}`,
        'Map differs from the current game; resolve the spatial change explicitly.',
      );
  }
  const roads = compileLayoutRoads(map, review.roads, review.preservedRecords, issue);
  if (roads) layout.roads = roads;
  const placements = new Map<string, MapDoc['placements'][number]>();
  for (const placement of map.placements) {
    if (!placement.uid) {
      issue('placement-without-id', 'Assign a stable placement UID before export.');
      continue;
    }
    if (placements.has(placement.uid)) issue(placement.uid, 'Duplicate placement UID.');
    placements.set(placement.uid, placement);
  }
  const used = new Set<string>();
  for (const [id, uid] of Object.entries(review.buildingBindings)) {
    const canonical = buildings.find((building) => building.id === id);
    const placement = placements.get(uid);
    if (!canonical || !placement) {
      issue(id, 'Building binding no longer resolves.');
      continue;
    }
    if (used.has(uid)) {
      issue(id, 'Placement bound to more than one building.');
      continue;
    }
    used.add(uid);
    const path = `/models/${placement.assetId}.glb`;
    if (path !== canonical.assetId) {
      issue(id, 'Model substitution requires a canonical content change.');
      continue;
    }
    if (
      !finite(placement.x, placement.z, placement.rotY, placement.scale, placement.y ?? 0) ||
      placement.scale <= 0
    ) {
      issue(id, 'Invalid building transform.');
      continue;
    }
    if (
      (placement.rotX ?? 0) !== 0 ||
      (placement.rotZ ?? 0) !== 0 ||
      [placement.scaleX, placement.scaleY, placement.scaleZ].some((scale) => (scale ?? 1) !== 1)
    ) {
      issue(id, 'Town buildings require yaw-only rotation and uniform scale.');
      continue;
    }
    const originalScale =
      canonical.placement.modelSize === undefined
        ? NaN
        : (canonical.placement.scale * canonical.placement.modelSize) / 2.2;
    // Legacy town measurements are rounded (Studio uses measured GLB bounds).
    // Larger resizes need the town's dependent sockets/pads remeasured as well.
    if (!Number.isFinite(originalScale) || Math.abs(placement.scale - originalScale) > 0.001) {
      issue(id, 'Building resize requires review of dependent town sockets and pads.');
      continue;
    }
    if (placement.detached && !finite(placement.groundY)) {
      issue(id, 'Detached building needs its absolute ground seat.');
      continue;
    }
    if (!placement.collide || placement.collisionMode !== 'baked') {
      issue(id, 'Walkable town geometry requires baked collision.');
      continue;
    }
    layout.buildings[id] = {
      path,
      x: placement.x,
      z: placement.z,
      rotation: placement.rotY,
      scale: placement.scale,
      lift: placement.y ?? 0,
      ...(placement.detached ? { groundY: placement.groundY } : {}),
    };
  }
  for (const id of review.npcIds) {
    const npc = map.content.npcs[id];
    if (!npc || !Object.hasOwn(current.npcs, id)) {
      issue(id, 'NPC binding no longer resolves.');
      continue;
    }
    if (!finite(npc.pos.x, npc.pos.z) || (npc.facing !== undefined && !finite(npc.facing))) {
      issue(id, 'Invalid NPC transform.');
      continue;
    }
    layout.npcs[id] = {
      pos: { x: npc.pos.x, z: npc.pos.z },
      ...(npc.facing === undefined ? {} : { facing: npc.facing }),
    };
  }
  const stations = compileLayoutStations(
    current,
    layout.npcs,
    review.stationBindings,
    review.preservedRecords,
    issue,
  );
  if (stations) layout.stations = stations;
  for (const id of review.groundObjectIds) {
    const objects = map.content.objects.filter((object) => object.itemId === id);
    if (objects.length !== 1) {
      issue(id, 'Ground object identity is missing or ambiguous.');
      continue;
    }
    const positions = objects[0].positions;
    if (
      !positions.every(
        (p) =>
          finite(p.x, p.z) && [p.y, p.facing, p.scale].every((v) => v === undefined || finite(v)),
      )
    ) {
      issue(id, 'Invalid ground object transform.');
      continue;
    }
    layout.groundObjects[id] = {
      positions: positions.map(({ x, z, y, facing, scale }) => ({
        x,
        z,
        ...(y === undefined ? {} : { y }),
        ...(facing === undefined ? {} : { facing }),
        ...(scale === undefined ? {} : { scale }),
      })),
    };
  }
  const campIndices = new Set<number>();
  for (const edit of review.camps) {
    const targets: CampEdit['placements'] = [];
    let valid = true;
    for (const index of edit.mapIndices) {
      const camp = map.content.camps[index];
      if (
        !Number.isInteger(index) ||
        !camp ||
        campIndices.has(index) ||
        edit.sources.some((s) => s.mobId !== camp.mobId)
      ) {
        issue(`camp:${index}`, 'Camp binding is missing, duplicated or changes mob identity.');
        valid = false;
        continue;
      }
      campIndices.add(index);
      if (
        !finite(camp.center.x, camp.center.z, camp.radius, camp.count) ||
        camp.radius < 0 ||
        camp.count < 1 ||
        !Number.isInteger(camp.count)
      ) {
        issue(`camp:${index}`, 'Invalid camp placement.');
        valid = false;
        continue;
      }
      targets.push({ center: { ...camp.center }, radius: camp.radius, count: camp.count });
    }
    if (valid) layout.camps.push({ sources: edit.sources, placements: targets });
  }
  for (const key of review.objectMoveKeys) {
    const move = map.objectMoves?.[key];
    const parsed = parseObjectMoveKey(key);
    if (!move || !parsed || !movableObjectByKey(key)) {
      issue(key, 'Object move no longer resolves.');
      continue;
    }
    const caps = OBJECT_EDIT_CAPS[parsed.kind];
    if (
      !finite(move.x, move.z) ||
      (move.removed !== undefined && move.removed !== true) ||
      (move.rotY !== undefined && (!caps.rotate || !finite(move.rotY))) ||
      (move.scale !== undefined &&
        (!caps.scale ||
          !finite(move.scale) ||
          move.scale < MIN_OBJECT_SCALE ||
          move.scale > MAX_OBJECT_SCALE)) ||
      Object.keys(move).some((field) => !['x', 'z', 'rotY', 'scale', 'removed'].includes(field))
    ) {
      issue(key, 'Invalid object move.');
      continue;
    }
    layout.objectMoves[key] = {
      x: move.x,
      z: move.z,
      ...(move.rotY === undefined ? {} : { rotY: move.rotY }),
      ...(move.scale === undefined ? {} : { scale: move.scale }),
      ...(move.removed ? { removed: true } : {}),
    };
  }
  for (const [uid, reason] of Object.entries(review.excludedPlacements)) {
    if (!reason.trim() || !placements.has(uid) || used.has(uid))
      issue(uid, 'Exclusion is missing, stale or also bound to a building.');
    used.add(uid);
  }
  const preserve = (key: string) => !!review.preservedRecords?.[key]?.trim();
  const objectPositions = (positions: GroundObjectDef['positions']) =>
    JSON.stringify(positions.map(({ x, z, y, facing, scale }) => [x, z, y, facing, scale]));
  for (const [id, npc] of Object.entries(map.content.npcs)) {
    const base = current.npcs[id];
    if (
      !Object.hasOwn(layout.npcs, id) &&
      !preserve(`npc:${id}`) &&
      (!base || npc.pos.x !== base.pos.x || npc.pos.z !== base.pos.z || npc.facing !== base.facing)
    )
      issue(
        `npc:${id}`,
        'Unreconciled NPC position: import it or explicitly retain the current game record.',
      );
  }
  for (const object of map.content.objects) {
    const key = `object:${object.itemId}:${object.name}`;
    const bases = current.groundObjects.filter(
      (b) => b.itemId === object.itemId && b.name === object.name,
    );
    if (
      !Object.hasOwn(layout.groundObjects, object.itemId) &&
      !preserve(key) &&
      (bases.length !== 1 ||
        objectPositions(object.positions) !== objectPositions(bases[0].positions))
    )
      issue(key, 'Unreconciled ground object positions.');
  }
  const sourceKey = (c: { mobId: string; center: { x: number; z: number } }) =>
    JSON.stringify([c.mobId, c.center.x, c.center.z]);
  const replacedCamps = new Set(review.camps.flatMap((edit) => edit.sources.map(sourceKey)));
  const remainingCamps = current.camps.filter((camp) => !replacedCamps.has(sourceKey(camp)));
  for (const [index, camp] of map.content.camps.entries()) {
    if (campIndices.has(index) || preserve(`camp:${index}`)) continue;
    const unchanged = remainingCamps.findIndex(
      (base) =>
        base.mobId === camp.mobId &&
        base.center.x === camp.center.x &&
        base.center.z === camp.center.z &&
        base.radius === camp.radius &&
        base.count === camp.count,
    );
    if (unchanged === -1)
      issue(
        `camp:${index}`,
        'Unreconciled camp: import it or explicitly retain the current game camps.',
      );
    else remainingCamps.splice(unchanged, 1);
  }
  for (const [key, move] of Object.entries(map.objectMoves ?? {})) {
    if (
      !Object.hasOwn(layout.objectMoves, key) &&
      !preserve(key) &&
      JSON.stringify(move) !== JSON.stringify(current.objectMoves?.[key])
    )
      issue(key, 'Unreconciled object move.');
  }
  let preservedScenery: LayoutExportResult['preservedScenery'];
  const adopted = compileLayoutCollision(
    map,
    review.collisionAdoptions,
    currentScenery,
    used,
    issue,
  );
  const additions = compileLayoutAdditions(map, review.sceneryAdditions, used, issue);
  const civic = compileLayoutCivic(
    map,
    review.civicBindings,
    currentScenery,
    used,
    adopted.reservedIndices,
    issue,
  );
  if (Object.keys(civic).length) layout.civic = civic;
  const decorations = compileLayoutDecorations(
    map,
    review.decorationReplacements,
    currentScenery,
    used,
    adopted.reservedIndices,
    issue,
  );
  const props = compileLayoutProps(
    map,
    review.propReplacements,
    current.props,
    currentScenery,
    used,
    adopted.reservedIndices,
    issue,
  );
  const lamps = compileLayoutStreetlamps(
    map,
    review.streetlampBindings,
    currentScenery,
    used,
    adopted.reservedIndices,
    issue,
  );
  additions.push(...decorations.additions, ...props.additions);
  if (adopted.collisions.length || additions.length || lamps.length)
    layout.scenery = {
      lamps,
      collisions: adopted.collisions,
      additions,
      decorationExclusions: decorations.decorationExclusions,
      propRemovals: props.propRemovals,
      retainedFences: props.retainedFences,
      ambience: props.ambience,
      decks: props.decks,
    };
  if (review.preserveMatchingScenery) {
    if (!currentScenery)
      issue(
        'scenery-baseline',
        'Exact scenery preservation requires a fresh current-world snapshot.',
      );
    else {
      // Bound buildings already have their own replacement. Their old baseline
      // slots cannot also preserve a copy left behind when the original moves.
      const bound = buildings.filter((building) => Object.hasOwn(layout.buildings, building.id));
      const available = currentScenery
        .map((placement, index) => ({ placement, index }))
        .filter(
          ({ placement, index }) =>
            !adopted.reservedIndices.has(index) &&
            !bound.some(
              (building) =>
                building.assetId === `/models/${placement.assetId}.glb` &&
                building.placement.x === placement.x &&
                building.placement.z === placement.z,
            ),
        );
      const source = map.placements.filter(
        (placement) => placement.uid && !used.has(placement.uid),
      );
      const comparison = matchLayoutScenery(
        source,
        available.map(({ placement }) => placement),
        map.assetCollisionMesh,
      );
      preservedScenery = [];
      for (const match of comparison.matches) {
        const uid = source[match.sourceIndex].uid;
        if (!uid || used.has(uid)) continue;
        used.add(uid);
        preservedScenery.push({ uid, currentIndex: available[match.currentIndex].index });
      }
    }
  }
  const unboundPlacementUids = [...placements.keys()].filter((uid) => !used.has(uid));
  if (unboundPlacementUids.length)
    issue(
      'unbound-scenery',
      `${unboundPlacementUids.length} placements still need reconciliation against the original authoring base.`,
    );
  try {
    const composed = composeWorldLayout(current, layout);
    if (layout.camps.length && !review.campSpawnMigrationReason?.trim())
      issue(
        'camp-spawn-order',
        'Camp splits/moves change seeded spawn allocation; acknowledge the migration and validate host parity before activation.',
      );
    const population = (camps: WorldContent['camps']) => {
      const totals = new Map<string, number>();
      for (const camp of camps) totals.set(camp.mobId, (totals.get(camp.mobId) ?? 0) + camp.count);
      return totals;
    };
    const before = population(current.camps);
    const after = population(composed.camps);
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const from = before.get(id) ?? 0;
      const to = after.get(id) ?? 0;
      if (from === to) continue;
      const approval = review.campPopulationChanges?.[id];
      if (!approval?.reason.trim() || approval.before !== from || approval.after !== to)
        issue(
          `population:${id}`,
          `Population ${from} → ${to} needs an explicit, current review decision.`,
        );
    }
  } catch (error) {
    issue('composition', String(error));
  }
  return {
    layout,
    issues,
    unboundPlacementUids,
    ...(preservedScenery ? { preservedScenery } : {}),
  };
}

export function emitWorldLayoutModule(result: LayoutExportResult, sourceSha256: string): string {
  if (result.issues.length)
    throw new Error(
      `World layout export blocked: ${result.issues.map((issue) => issue.id).join(', ')}`,
    );
  const stamps = result.layout.environment?.terrainEdits;
  const formatComment =
    '// biome-ignore format: Preserve the deterministic JSON serialization of reviewed map data.\n';
  // Bound each literal's inference cost: a single 7,000+ stamp array exceeds
  // TypeScript's union limit even with a contextual type. Concatenating typed
  // chunks preserves every record and its order without parsing data at runtime.
  const terrainChunks: string[] = [];
  if (stamps) {
    for (let offset = 0; offset < stamps.length; offset += 256) {
      terrainChunks.push(
        `${formatComment}const TERRAIN_CHUNK_${terrainChunks.length}: NonNullable<WorldLayout['environment']>['terrainEdits'] = ${JSON.stringify(stamps.slice(offset, offset + 256), null, 2)};\n`,
      );
    }
  }
  const terrain = stamps
    ? `${terrainChunks.join('\n')}\n${formatComment}const WORLD_TERRAIN_EDITS: NonNullable<WorldLayout['environment']>['terrainEdits'] = [${terrainChunks.map((_, index) => `...TERRAIN_CHUNK_${index}`).join(', ')}];\n\n`
    : '';
  const fields = Object.entries(result.layout).map(([key, value]) => {
    const serialized =
      key === 'environment' && stamps
        ? `{\n${Object.entries(result.layout.environment!)
            .map(
              ([name, item]) =>
                `  ${JSON.stringify(name)}: ${name === 'terrainEdits' ? 'WORLD_TERRAIN_EDITS' : JSON.stringify(item, null, 2).replaceAll('\n', '\n  ')}`,
            )
            .join(',\n')}\n}`
        : JSON.stringify(value, null, 2);
    return `  ${JSON.stringify(key)}: ${serialized.replaceAll('\n', '\n  ')}`;
  });
  return `// Generated by scripts/export_world_layout.mjs. Do not edit.\n// Source SHA-256: ${sourceSha256}\nimport type { WorldLayout } from './types';\n\n${terrain}${formatComment}export const WORLD_LAYOUT: WorldLayout = {\n${fields.join(',\n')}\n};\n`;
}
