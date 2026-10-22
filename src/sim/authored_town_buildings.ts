// Whether a ZonePropsDef building record IS one of the authored towns'
// (Eastbrook Vale / Fenbridge / Highwatch, sim/authored_town_registry.ts)
// rebuild buildings, the sim-side twin of the render predicates in the town
// views, so
// colliders.ts (which must not import src/render) can stand a town
// building's record collider down when the document owns that building as a
// placement (promotedScenery.authoredTowns). Matching is by the same
// coordinate/dimension/rotation identity the render predicates use.

import { bakedBoxesForPath } from './asset_collision';
import {
  AUTHORED_TOWN_BUILDINGS,
  AUTHORED_TOWNS,
  type AuthoredTownBuildingRecord,
  authoredTownPromoted,
} from './authored_town_registry';
import type { Collider } from './collider_shapes';
import { emitPlacementBoxes } from './colliders_authored/placement_colliders';
import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { walkInPlacementFor } from './town_walk_in';
import type { BuildingDef, PromotedScenery } from './types';
import { terrainHeight } from './world';
import { civicGroundY } from './world_layout/civic';

const EPSILON = 1e-6;

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/**
 * The solid annexes of a placed town building (a bell tower, a strongroom, a
 * forge shelter, a stall counter: the towns' makePlacedBuilding, see
 * sim/authored_town_registry.ts), for a record that still stands where the
 * layout put it. A record a custom world moved, resized or turned carries no
 * annex: the boxes are authored around the model's own anchor and would be
 * left behind as invisible walls.
 */
export function placedBuildingAnnexes(
  building: BuildingDef,
): AuthoredTownBuildingRecord['annexes'] {
  if (building.id === undefined) return [];
  for (const candidate of AUTHORED_TOWN_BUILDINGS) {
    if (candidate.id !== building.id) continue;
    return sameNumber(candidate.position.x, building.x) &&
      sameNumber(candidate.position.z, building.z) &&
      sameNumber(candidate.nativeDimensions.width, building.w) &&
      sameNumber(candidate.nativeDimensions.depth, building.d) &&
      sameNumber(candidate.rotation, building.rot)
      ? candidate.annexes
      : [];
  }
  return [];
}

/**
 * The movement colliders of one asset-backed (or legacy house / inn) building
 * record: the full-height box on its authored footprint, then one more for
 * each annex. `groundAt` anchors each box's pass-under floor on its own
 * ground, so a mover deep in a tube or carve walks beneath surface props
 * instead of hitting invisible walls.
 *
 * A walk-in record (town_walk_in.ts) collides instead on its model's own
 * baked boxes, the asset rows a Studio placement of the model reads, through
 * the same emitter (a document-level bake or authored prisms are not
 * consulted), so its open doorway lets a player in; its annexes are part of
 * that bake. Those boxes stand on the TERRAIN under the model's anchor (the
 * placement rule), never on `groundAt`, which already carries the building's
 * own floor deck. With no `seed` the record keeps its sealed box.
 */
export function buildingRecordColliders(
  building: BuildingDef,
  cameraTopY: number,
  groundAt: (x: number, z: number) => number,
  seed?: number,
): Collider[] {
  const walkIn = seed === undefined ? null : walkInPlacementFor(building);
  const baked = walkIn ? bakedBoxesForPath(walkIn.path) : null;
  if (walkIn && seed !== undefined && baked && baked.length > 0) {
    const walls: Collider[] = [];
    const seat = walkIn.detached ? (walkIn.groundY ?? 0) : terrainHeight(walkIn.x, walkIn.z, seed);
    emitPlacementBoxes(walls, walkIn, baked, seat);
    return walls;
  }
  const base = groundAt(building.x, building.z);
  const seat = civicGroundY(building.id, building, groundAt, base);
  const out: Collider[] = [
    {
      type: 'obb',
      x: building.x,
      z: building.z,
      hw: building.w / 2,
      hd: building.d / 2,
      rot: building.rot,
      cameraTopY: seat === base ? cameraTopY : cameraTopY + seat - base,
      underY: seat,
    },
  ];
  for (const annex of placedBuildingAnnexes(building)) {
    out.push({
      type: 'obb',
      x: annex.center.x,
      z: annex.center.z,
      hw: annex.halfWidth,
      hd: annex.halfDepth,
      rot: annex.rotation,
      cameraTopY,
      underY: groundAt(annex.center.x, annex.center.z),
    });
  }
  return out;
}

function matchesRecord(candidate: AuthoredTownBuildingRecord, building: BuildingDef): boolean {
  return (
    candidate.kind === building.kind &&
    sameNumber(candidate.position.x, building.x) &&
    sameNumber(candidate.position.z, building.z) &&
    sameNumber(candidate.nativeDimensions.width, building.w) &&
    sameNumber(candidate.nativeDimensions.depth, building.d) &&
    sameNumber(candidate.rotation, building.rot)
  );
}

/** True when this props record is an authored-town rebuild building. */
export function isAuthoredTownBuildingDef(building: BuildingDef): boolean {
  return AUTHORED_TOWN_BUILDINGS.some((candidate) => matchesRecord(candidate, building));
}

/**
 * True when the DOCUMENT owns this props record as a placement, so its record
 * collider stands down and the placement's own collision is the only one: a
 * rebuild building under its town's promoted family (authoredTowns for
 * Eastbrook and Fenbridge, highwatchTown for Highwatch), the Eastbrook Weekly
 * Vault under promotedScenery.eastbrookVault. The built-in world carries no
 * promoted scenery, so it answers false for every record.
 */
export function promotedTownBuildingStandsDown(
  promoted: PromotedScenery | undefined,
  building: BuildingDef,
): boolean {
  if (!promoted) return false;
  if (promoted.eastbrookVault === true && building.id === EASTBROOK_LAYOUT.weeklyVault.id) {
    return true;
  }
  return AUTHORED_TOWNS.some(
    (town) =>
      authoredTownPromoted(promoted, town) &&
      town.buildings.some((candidate) => matchesRecord(candidate, building)),
  );
}
