// Walk-in town buildings. A placed painted building whose model bakes an open
// doorway (a `walkIn` record in a town layout, sim/authored_town_registry.ts)
// is entered the way the same model is as a Studio placement: its record
// collides on the model's own baked walls and furniture
// (authored_town_buildings.ts buildingRecordColliders) instead of one sealed
// box, and the floor and entry step it bakes are walkable ground
// (placement_ramps.ts, beside the placements' decks). Both come from the ONE
// placement this leaf resolves, so the walls, the floor and the drawn model
// cannot drift apart. Pure leaf: no rng, no clock, no SimContext.

import {
  AUTHORED_TOWNS,
  type AuthoredTown,
  type AuthoredTownBuildingRecord,
  authoredTownPromoted,
} from './authored_town_registry';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import { activeFenbridgeBuildingById, activeFenbridgeLayout } from './fenbridge_touchup';
import type { BuildingDef, PlacedAsset, WorldContent } from './types';

/** The height a placed model is normalized to by its largest dimension: a
 *  baked collision row is stored in multiples of that dimension over this
 *  (placed_assets.ts targetHeightFor, the editor's TARGET_HEIGHT). */
const PLACED_TARGET_HEIGHT = 2.2;
const EPSILON = 1e-6;

interface WalkInTown {
  readonly town: AuthoredTown;
  readonly buildings: readonly AuthoredTownBuildingRecord[];
  /** One world box round the town's walk-in buildings' whole models (their
   *  reach, with a yard to spare), where a floor or entry step can stand.
   *  One box PER town: a box spanning two towns would make every ground
   *  query on the road between them consult the deck table. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const WALK_IN_TOWNS: readonly WalkInTown[] = AUTHORED_TOWNS.flatMap((town) => {
  const buildings = town.buildings.filter((building) => building.walkIn === true);
  if (buildings.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const building of buildings) {
    const reach = building.reach;
    const radius = Math.hypot(reach.halfWidth, reach.halfDepth) + 1;
    minX = Math.min(minX, reach.center.x - radius);
    maxX = Math.max(maxX, reach.center.x + radius);
    minZ = Math.min(minZ, reach.center.z - radius);
    maxZ = Math.max(maxZ, reach.center.z + radius);
  }
  return [{ town, buildings, minX, maxX, minZ, maxZ }];
});

let lastFenWalkInLayout: object | null = null;
let lastFenWalkInMinX = 0;
let lastFenWalkInMaxX = -1;
let lastFenWalkInMinZ = 0;
let lastFenWalkInMaxZ = -1;

/** Whether (x, z) lies where a walk-in town floor could stand: the cheap test
 *  that lets a world with no placements skip the deck table everywhere else. */
export function nearTownWalkIn(x: number, z: number): boolean {
  for (const walkIn of WALK_IN_TOWNS) {
    if (x >= walkIn.minX && x <= walkIn.maxX && z >= walkIn.minZ && z <= walkIn.maxZ) return true;
  }
  const fenLayout = activeFenbridgeLayout();
  if (fenLayout === FENBRIDGE_LAYOUT) return false;
  if (fenLayout !== lastFenWalkInLayout) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const building of fenLayout.buildings) {
      if (building.walkIn !== true) continue;
      const reach = building.reach;
      const radius = Math.hypot(reach.halfWidth, reach.halfDepth) + 1;
      minX = Math.min(minX, reach.center.x - radius);
      maxX = Math.max(maxX, reach.center.x + radius);
      minZ = Math.min(minZ, reach.center.z - radius);
      maxZ = Math.max(maxZ, reach.center.z + radius);
    }
    lastFenWalkInLayout = fenLayout;
    lastFenWalkInMinX = minX;
    lastFenWalkInMaxX = maxX;
    lastFenWalkInMinZ = minZ;
    lastFenWalkInMaxZ = maxZ;
  }
  return (
    x >= lastFenWalkInMinX &&
    x <= lastFenWalkInMaxX &&
    z >= lastFenWalkInMinZ &&
    z <= lastFenWalkInMaxZ
  );
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function matchesRecord(record: AuthoredTownBuildingRecord, building: BuildingDef): boolean {
  return (
    sameNumber(record.position.x, building.x) &&
    sameNumber(record.position.z, building.z) &&
    sameNumber(record.nativeDimensions.width, building.w) &&
    sameNumber(record.nativeDimensions.depth, building.d) &&
    sameNumber(record.rotation, building.rot)
  );
}

/** The walk-in record a props record stands for, with its town, or null. */
function walkInRecordFor(
  building: BuildingDef,
  content?: WorldContent,
): { town: AuthoredTown; record: AuthoredTownBuildingRecord } | null {
  if (building.id === undefined) return null;
  for (const walkIn of WALK_IN_TOWNS) {
    const record = walkIn.buildings.find((candidate) => candidate.id === building.id);
    if (!record) continue;
    if (walkIn.town.id === 'fenbridge') {
      const active = activeFenbridgeBuildingById(building.id, content);
      if (active && matchesRecord(active, building)) {
        return { town: walkIn.town, record: active };
      }
    }
    return { town: walkIn.town, record };
  }
  return null;
}

/**
 * The Studio-placement form of a walk-in town record, or null for any other
 * record. A record a custom world moved, turned or resized gets null: its
 * walls and floor are authored around the layout's own anchor, so it falls
 * back to one sealed box rather than leaving invisible walls behind.
 */
export function walkInPlacementFor(
  building: BuildingDef,
  content?: WorldContent,
): PlacedAsset | null {
  const found = walkInRecordFor(building, content);
  if (!found) return null;
  const { record } = found;
  if (!matchesRecord(record, building)) {
    return null;
  }
  const placement = record.placement;
  if (placement.modelSize === undefined) return null;
  return {
    path: record.assetId,
    x: placement.x,
    z: placement.z,
    rotY: placement.rotation,
    scale: (placement.scale * placement.modelSize) / PLACED_TARGET_HEIGHT,
    y: placement.lift,
    collideRadius: 1,
  };
}

/**
 * Every walk-in record a world stands, as placements. A document that owns a
 * town's buildings as its own placements (that town's promoted family, see
 * authored_town_registry.ts) stands its records down, and its placements
 * carry the floors instead.
 */
export function townWalkInPlacements(content: WorldContent): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  for (const building of content.props?.buildings ?? []) {
    const found = walkInRecordFor(building, content);
    if (!found || authoredTownPromoted(content.promotedScenery, found.town)) continue;
    const placement = walkInPlacementFor(building, content);
    if (placement) out.push(placement);
  }
  return out;
}
