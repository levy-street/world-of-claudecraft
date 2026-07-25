// The Demon Tower wave scheduler: where a wave's demons stand, which templates
// they are, and when the floor is done sending them.
//
// Metin2's Demon Tower is a wave-clear ascent, not a room you sweep once: the
// core in the middle of the arena keeps tearing demons out of the rift until the
// floor's last wave falls. This module owns that plan as PURE data. The runtime
// driver (rift/tower.ts) decides WHEN to release each wave from live instance
// state; everything about WHAT a wave is lives here, so a Vitest can pin the
// composition and the ring geometry without a Sim.
//
// Ring placement, and why it is a ring: the demons erupt from the core and the
// raid fights outward from the middle, so a wave is laid out on a circle
// concentric with the arena. The angular offset is derived from (floorIndex,
// waveIndex), never from rng, so both hosts and every client agree on where a
// wave stood without any of it crossing the wire.
//
// Pure leaf: no SimContext, no rng, no state.

import {
  clampTowerFloorIndex,
  DEMON_TOWER_FLOOR_COUNT,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from './tower_scaling';

/** Where a wave's demons stand, instance-local. */
export interface DemonTowerWaveSpawn {
  templateId: string;
  x: number;
  z: number;
}

export interface DemonTowerWave {
  /** 0-based index within the floor. */
  index: number;
  spawns: DemonTowerWaveSpawn[];
  /** True for the final wave of a boss floor: this one releases the boss. */
  releasesBoss: boolean;
}

/** The demon roster, weakest first. A floor draws from a WINDOW of this list, so
 * the enemies visibly change as you climb instead of the same imps scaling up.
 * Every id must exist in MOBS (pinned by tests/demon_tower_content.test.ts). */
export const DEMON_TOWER_ROSTER: readonly string[] = [
  'tower_imp',
  'tower_hellhound',
  'tower_pact_reaver',
  'tower_brimstone_zealot',
  'tower_soulbinder',
  'tower_iron_defiler',
  'tower_abyss_knight',
  'tower_dread_harbinger',
];

/** The two bosses: the mid-tower gatekeeper (floor 5) and the summit (floor 10). */
export const DEMON_TOWER_GATEKEEPER = 'tower_boss_gatekeeper';
export const DEMON_TOWER_LORD = 'tower_boss_demon_lord';

/** The roster slice floor `k` pulls from: a two-wide window that slides up the
 * list as the tower climbs, so floor 1 fights imps and hounds while floor 10
 * fights abyss knights and harbingers. */
export function demonTowerRosterWindow(floorIndex: number): string[] {
  const k = clampTowerFloorIndex(floorIndex);
  const span = DEMON_TOWER_ROSTER.length - 1; // last valid start index
  const start = Math.min(span, Math.round((k / (DEMON_TOWER_FLOOR_COUNT - 1)) * span));
  const end = Math.min(DEMON_TOWER_ROSTER.length, start + 2);
  return DEMON_TOWER_ROSTER.slice(start, end);
}

/** Radius the wave ring stands on: inside the wall, outside the core, so demons
 * never spawn inside the centrepiece or clipped into the arena shell. */
export function demonTowerRingRadius(floorIndex: number): number {
  return demonTowerArenaRadius(floorIndex) * 0.62;
}

/** The full wave plan for one floor. Deterministic in (floorIndex) alone. */
export function demonTowerWavePlan(floorIndex: number): DemonTowerWave[] {
  const k = clampTowerFloorIndex(floorIndex);
  const tuning = demonTowerFloorTuning(k);
  const tier = demonTowerRosterWindow(k);
  const radius = demonTowerRingRadius(k);
  const bossFloor = isDemonTowerBossFloor(k);
  const waves: DemonTowerWave[] = [];
  for (let w = 0; w < tuning.waveCount; w++) {
    const spawns: DemonTowerWaveSpawn[] = [];
    // Stagger each wave's ring by a half step so successive waves do not land on
    // the exact footprints the last one died on.
    const offset = ((k * 7 + w * 5) % 12) * ((Math.PI * 2) / 24);
    for (let i = 0; i < tuning.packSize; i++) {
      const angle = offset + (i / tuning.packSize) * Math.PI * 2;
      spawns.push({
        templateId: tier[i % tier.length],
        x: round3(Math.sin(angle) * radius),
        z: round3(Math.cos(angle) * radius),
      });
    }
    waves.push({
      index: w,
      spawns,
      releasesBoss: bossFloor && w === tuning.waveCount - 1,
    });
  }
  return waves;
}

/** Which boss a floor releases, or null when it is not a boss floor. */
export function demonTowerBossFor(floorIndex: number): string | null {
  const k = clampTowerFloorIndex(floorIndex);
  if (!isDemonTowerBossFloor(k)) return null;
  return k === DEMON_TOWER_FLOOR_COUNT - 1 ? DEMON_TOWER_LORD : DEMON_TOWER_GATEKEEPER;
}

/** Total demons a floor sends across every wave (the HUD's "N left" denominator
 * and what the deed progress counts). */
export function demonTowerFloorDemonCount(floorIndex: number): number {
  return demonTowerWavePlan(floorIndex).reduce((sum, wave) => sum + wave.spawns.length, 0);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
