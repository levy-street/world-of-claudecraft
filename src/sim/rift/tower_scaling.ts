// Demon Tower tuning adapters. The authored values live beside each floor's
// geometry and encounter in tower_floors.ts; this leaf keeps the existing
// public API used by the runtime and tests.

import { DEMON_TOWER_FLOORS, demonTowerFloorProfile } from './tower_floors';

/** Exactly three authored raid floors. */
export const DEMON_TOWER_FLOOR_COUNT = DEMON_TOWER_FLOORS.length;

/** Hard ceiling on live demons. Curated packs stay well below it; summoned adds
 * share the same cap during boss phases. */
export const DEMON_TOWER_MAX_LIVE_DEMONS = 18;

export interface DemonTowerFloorTuning {
  floor: number;
  healthMultiplier: number;
  damageMultiplier: number;
  addDamageMultiplier: number;
  armorMultiplier: number;
  waveCount: number;
  /** Largest authored wave, used by HUD/tests rather than to synthesize packs. */
  packSize: number;
  mechanicLimit: number;
}

export function clampTowerFloorIndex(floorIndex: number): number {
  if (!Number.isFinite(floorIndex)) return 0;
  return Math.max(0, Math.min(DEMON_TOWER_FLOOR_COUNT - 1, Math.floor(floorIndex)));
}

export function demonTowerFloorTuning(floorIndex: number): DemonTowerFloorTuning {
  const k = clampTowerFloorIndex(floorIndex);
  const floor = demonTowerFloorProfile(k);
  return {
    floor: k + 1,
    ...floor.tuning,
    waveCount: floor.waves.length,
    packSize: Math.max(
      ...floor.waves.map((wave) => wave.reduce((sum, member) => sum + member.count, 0)),
    ),
  };
}

/** Every authored floor culminates in a bespoke boss encounter. */
export function isDemonTowerBossFloor(floorIndex: number): boolean {
  return Number.isInteger(floorIndex) && floorIndex >= 0 && floorIndex < DEMON_TOWER_FLOOR_COUNT;
}

export const DEMON_TOWER_BOSS_FLOORS: ReadonlySet<number> = new Set(
  DEMON_TOWER_FLOORS.map((_, index) => index),
);

/** Collision radius of the shared Demon Core. Measured from the shipped GLB. */
export const DEMON_TOWER_CORE_RADIUS = 2.74;

/** Outer footprint radius. Individual polygons may pull their concave bays in
 * to `innerRadius`; collision and render both consume the actual polygon. */
export function demonTowerArenaRadius(floorIndex: number): number {
  return demonTowerFloorProfile(floorIndex).arena.outerRadius;
}
