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

import { demonTowerDecorObstacles, demonTowerHazards } from '../content/rift/demon_tower';
import { DEMON_TOWER_FLOORS, demonTowerFloorProfile } from './tower_floors';
import {
  clampTowerFloorIndex,
  DEMON_TOWER_CORE_RADIUS,
  demonTowerArenaRadius,
} from './tower_scaling';

/** Where a wave's demons stand, instance-local. */
export interface DemonTowerWaveSpawn {
  templateId: string;
  x: number;
  z: number;
  lieutenant?: boolean;
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
  'tower_gloom_bat',
  'tower_imp',
  'tower_cinder_crawler',
  'tower_hellhound',
  'tower_bone_acolyte',
  'tower_pact_reaver',
  'tower_shade_dancer',
  'tower_brimstone_zealot',
  'tower_flame_herald',
  'tower_soulbinder',
  'tower_rot_hulk',
  'tower_iron_defiler',
  'tower_blood_matron',
  'tower_abyss_knight',
  'tower_void_sentinel',
  'tower_dread_harbinger',
];

/** Derived from the same tuple that owns floor count and encounters. */
export const DEMON_TOWER_BOSS_BY_FLOOR: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(DEMON_TOWER_FLOORS.map((floor, index) => [index, floor.bossId])),
);

export const DEMON_TOWER_GATEKEEPER = 'tower_boss_gatekeeper';
export const DEMON_TOWER_LORD = 'tower_boss_demon_lord';

/** Unique authored wave roster for a floor, preserving encounter order. */
export function demonTowerRosterWindow(floorIndex: number): string[] {
  const ids = demonTowerFloorProfile(floorIndex).waves.flatMap((wave) =>
    wave.map((member) => member.templateId),
  );
  return [...new Set(ids)];
}

/** Radius the wave ring stands on: inside the wall, outside the core, so demons
 * never spawn inside the centrepiece or clipped into the arena shell. */
export function demonTowerRingRadius(floorIndex: number): number {
  return demonTowerArenaRadius(floorIndex) * 0.62;
}

/** The full wave plan for one floor. Deterministic in (floorIndex) alone. */
export function demonTowerWavePlan(floorIndex: number): DemonTowerWave[] {
  const k = clampTowerFloorIndex(floorIndex);
  const floor = demonTowerFloorProfile(k);
  const radius = demonTowerRingRadius(k);
  const waves: DemonTowerWave[] = [];
  for (let w = 0; w < floor.waves.length; w++) {
    const members = floor.waves[w];
    const total = members.reduce((sum, member) => sum + member.count, 0);
    const spawns: DemonTowerWaveSpawn[] = [];
    let cursor = 0;
    for (const member of members) {
      for (let n = 0; n < member.count; n++, cursor++) {
        const authored = towerFormationPosition(k, w, cursor, total, radius);
        const pos = safeTowerSpawnPosition(k, authored);
        spawns.push({
          templateId: member.templateId,
          x: pos.x,
          z: pos.z,
          ...(member.lieutenant ? { lieutenant: true } : {}),
        });
      }
    }
    waves.push({
      index: w,
      spawns,
      releasesBoss: w === floor.waves.length - 1,
    });
  }
  return waves;
}

/** Rotate a formation slot in bounded deterministic steps until it clears every
 * actionable footprint. Curated layouts can evolve without silently placing a
 * demon inside a new hazard or solid landmark. */
export function safeTowerSpawnPosition(
  floorIndex: number,
  authored: { x: number; z: number },
): { x: number; z: number } {
  const hazards = demonTowerHazards(floorIndex);
  const obstacles = demonTowerDecorObstacles(floorIndex);
  const bodyRadius = 1.5;
  for (let attempt = 0; attempt < 32; attempt++) {
    const angle = (attempt * Math.PI) / 16;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const candidate = {
      x: round3(authored.x * cos - authored.z * sin),
      z: round3(authored.x * sin + authored.z * cos),
    };
    if (Math.hypot(candidate.x, candidate.z) <= DEMON_TOWER_CORE_RADIUS + bodyRadius) continue;
    if (
      obstacles.some(
        (obstacle) =>
          Math.hypot(candidate.x - obstacle.x, candidate.z - obstacle.z) <= obstacle.r + bodyRadius,
      )
    ) {
      continue;
    }
    if (
      hazards.some((hazard) => {
        const rx = (hazard.rx ?? hazard.r) + bodyRadius;
        const rz = (hazard.rz ?? hazard.r) + bodyRadius;
        const dx = (candidate.x - hazard.x) / rx;
        const dz = (candidate.z - hazard.z) / rz;
        return dx * dx + dz * dz <= 1;
      })
    ) {
      continue;
    }
    return candidate;
  }
  return authored;
}

function towerFormationPosition(
  floorIndex: number,
  waveIndex: number,
  index: number,
  total: number,
  radius: number,
): { x: number; z: number } {
  if (floorIndex === 0) {
    // Bloodforge: alternating inner/outer forge rings leave readable slag lanes.
    const angle = (waveIndex % 2) * (Math.PI / total) + (index / total) * Math.PI * 2;
    const r = radius * (index % 2 === 0 ? 1 : 0.76);
    return { x: round3(Math.sin(angle) * r), z: round3(Math.cos(angle) * r) };
  }
  if (floorIndex === 1) {
    // Ossuary: packs march down four arms of the cross instead of materialising
    // in a circle, making target priority and bridge control visible.
    const arm = index % 4;
    const lane = Math.floor(index / 4);
    const d = radius * (0.72 + lane * 0.18);
    const lateral = (waveIndex % 2 === 0 ? -1 : 1) * (1.6 + lane * 0.8);
    if (arm === 0) return { x: round3(lateral), z: round3(d) };
    if (arm === 1) return { x: round3(d), z: round3(-lateral) };
    if (arm === 2) return { x: round3(-lateral), z: round3(-d) };
    return { x: round3(-d), z: round3(lateral) };
  }
  // Void Crown: five petals, offset each wave so the safe sector rotates.
  const petal = index % 5;
  const lane = Math.floor(index / 5);
  const angle = ((petal + waveIndex * 0.5) / 5) * Math.PI * 2;
  const r = radius * (0.78 + lane * 0.16);
  return { x: round3(Math.sin(angle) * r), z: round3(Math.cos(angle) * r) };
}

/** Which boss a floor releases, or null when it is not a boss floor. */
export function demonTowerBossFor(floorIndex: number): string | null {
  const k = clampTowerFloorIndex(floorIndex);
  return DEMON_TOWER_BOSS_BY_FLOOR[k] ?? null;
}

/** Total demons a floor sends across every wave (the HUD's "N left" denominator
 * and what the deed progress counts). */
export function demonTowerFloorDemonCount(floorIndex: number): number {
  return demonTowerWavePlan(floorIndex).reduce((sum, wave) => sum + wave.spawns.length, 0);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
