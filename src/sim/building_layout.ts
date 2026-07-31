import type { BuildingDef } from './types';

export type BuildingGroundAt = (x: number, z: number) => number;

export interface BuildingTerrainEnvelope {
  entranceWorld: { x: number; z: number };
  entranceGroundY: number;
  minGroundY: number;
  maxGroundY: number;
  modelBottomY: number;
  cameraTopY: number;
  foundationSkirtDepth: number;
}

/** Shared authored dimensions and placement data for Eastbrook's civic landmark. */
export const EASTBROOK_GRAND_ARMOURY = {
  landmark: 'eastbrook_grand_armoury',
  lot: {
    x: 17.5,
    z: -5.5,
    w: 13,
    d: 9,
    rot: -Math.PI / 2,
  },
  nativeBounds: { width: 13, height: 16.35, depth: 9 },
  foundationDepth: 1.35,
  aboveGradeHeight: 15,
  modelUnitsPerWorldYard: 1,
  frontApproachWorld: { x: 12, z: -5.5 },
} as const;

/** Half-yard samples are deterministic, include every OBB edge/corner, and are
 *  fine enough to follow the editor's localized terrain stamps without turning
 *  one startup-time landmark measurement into per-frame work. */
export const BUILDING_TERRAIN_SAMPLE_STEP = 0.5;

// Total by construction: a new BuildingDef kind must declare its height here
// rather than silently inheriting a default. hollow* is the Veiled Hollow set.
const BUILDING_CAMERA_HEIGHT: Readonly<Record<BuildingDef['kind'], number>> = {
  house: 8,
  inn: 7.8,
  chapel: 10.8,
  hollowHouse: 8,
  hollowInn: 8.5,
  hollowChapel: 10.5,
  hollowSmith: 6.2,
  hollowMarket: 5.2,
};

/** Narrow the landmark-tagged inn record without changing its rested-XP kind. */
export function isEastbrookGrandArmoury(
  building: BuildingDef,
): building is BuildingDef & { landmark: 'eastbrook_grand_armoury' } {
  return building.landmark === EASTBROOK_GRAND_ARMOURY.landmark;
}

/** Visual height above the authored lot grade, shared by render and collision. */
export function buildingCameraHeight(building: BuildingDef): number {
  return isEastbrookGrandArmoury(building)
    ? EASTBROOK_GRAND_ARMOURY.aboveGradeHeight
    : (building.height ?? BUILDING_CAMERA_HEIGHT[building.kind]);
}

/** Vertical model offset from terrain sampled at the building center. */
export function buildingGroundOffset(building: BuildingDef): number {
  return isEastbrookGrandArmoury(building) ? -EASTBROOK_GRAND_ARMOURY.foundationDepth : 0;
}

/** Transform one authored building-local point using the same rotation.y
 *  convention as Three and the movement collider. */
export function buildingLocalToWorld(
  building: BuildingDef,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const cos = Math.cos(building.rot);
  const sin = Math.sin(building.rot);
  return {
    x: building.x + localX * cos + localZ * sin,
    z: building.z - localX * sin + localZ * cos,
  };
}

/** Measure the complete rotated lot in a fixed order. The entrance remains
 *  seated at local +Z grade; terrain below the baked foundation is covered by
 *  a render-only solid skirt down to the sampled minimum. */
export function buildingTerrainEnvelope(
  building: BuildingDef,
  groundAt: BuildingGroundAt,
): BuildingTerrainEnvelope {
  const xSteps = Math.max(1, Math.ceil(building.w / BUILDING_TERRAIN_SAMPLE_STEP));
  const zSteps = Math.max(1, Math.ceil(building.d / BUILDING_TERRAIN_SAMPLE_STEP));
  let minGroundY = Infinity;
  let maxGroundY = -Infinity;

  for (let zIndex = 0; zIndex <= zSteps; zIndex++) {
    const localZ = -building.d / 2 + (building.d * zIndex) / zSteps;
    for (let xIndex = 0; xIndex <= xSteps; xIndex++) {
      const localX = -building.w / 2 + (building.w * xIndex) / xSteps;
      const world = buildingLocalToWorld(building, localX, localZ);
      const groundY = groundAt(world.x, world.z);
      minGroundY = Math.min(minGroundY, groundY);
      maxGroundY = Math.max(maxGroundY, groundY);
    }
  }

  const entranceWorld = buildingLocalToWorld(building, 0, building.d / 2);
  const entranceGroundY = groundAt(entranceWorld.x, entranceWorld.z);
  const foundationDepth = isEastbrookGrandArmoury(building)
    ? EASTBROOK_GRAND_ARMOURY.foundationDepth
    : 0;
  const modelBottomY = entranceGroundY - foundationDepth;
  return {
    entranceWorld,
    entranceGroundY,
    minGroundY,
    maxGroundY,
    modelBottomY,
    cameraTopY: entranceGroundY + buildingCameraHeight(building),
    foundationSkirtDepth: Math.max(0, modelBottomY - minGroundY),
  };
}

/** Rest-area slack outside an inn footprint. The armoury's much larger garrison
 *  keeps a narrow threshold halo so the neighboring card table is not resting. */
export function buildingRestPadding(building: BuildingDef): number {
  return isEastbrookGrandArmoury(building) ? 0.9 : 2;
}

/** Point-in-authored-building OBB test with optional outward footprint padding. */
export function buildingContainsPoint(
  building: BuildingDef,
  x: number,
  z: number,
  padding = 0,
): boolean {
  const dx = x - building.x;
  const dz = z - building.z;
  const cos = Math.cos(-building.rot);
  const sin = Math.sin(-building.rot);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return (
    Math.abs(localX) <= building.w / 2 + padding && Math.abs(localZ) <= building.d / 2 + padding
  );
}

/**
 * The rebuilt Eastbrook inn opts into the collider-correct transform. Keep the
 * historical transform for every unrelated inn so a town-layout change cannot
 * move established rest areas elsewhere in the world.
 */
export function buildingContainsRestPoint(
  building: BuildingDef,
  x: number,
  z: number,
  padding = 0,
): boolean {
  if (building.id === 'eastbrook_inn') return buildingContainsPoint(building, x, z, padding);

  const dx = x - building.x;
  const dz = z - building.z;
  const cos = Math.cos(-building.rot);
  const sin = Math.sin(-building.rot);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return (
    Math.abs(localX) <= building.w / 2 + padding && Math.abs(localZ) <= building.d / 2 + padding
  );
}
