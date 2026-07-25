// The Demon Tower: a hand-authored TEN-floor raid ascent, and the only rift that
// is a fixed place rather than a rolled seed.
//
// Every other rift is content the scheduler rolls somewhere in the world. The
// tower is a landmark: one reserved sentinel seed (DEMON_TOWER_SEED) means the
// door in Thornpeak Heights always opens onto the same ten floors, so a raid can
// schedule a night around it. The seed is the whole mechanism, which is what lets
// the tower ride the existing rift runtime (instances, floor progression, boss,
// exit, loot, death rules) without a second dungeon engine: the descriptor stays
// `{seed, baseLevel, floorIndex, origin}` and every host regenerates the floor.
//
// Shape, after Metin2's Demon Tower: each floor is a CIRCULAR arena with a
// Demon Core at the centre that tears wave after wave of demons out of the rift.
// Clear the last wave and the core cracks open into the ascent. The arena
// tightens as you climb (rift/tower_scaling.ts), so the same pack reads as more
// pressure at the top than at the bottom.
//
// Geometry note: the circle is a `shellPolygon`, the existing seam for
// non-rectangular rift rooms. BOTH collision (dungeon_layout.layoutColliders ->
// polygonWallColliders) and the rendered walls derive from that one polygon, so a
// wall you can see is a wall you bump into, with no new geometry seam.
//
// Data-as-code plus one pure builder. All randomness comes from an Rng seeded
// from the descriptor, never the live sim rng, so both hosts build an identical
// tower.

import type { StyleSource } from '../../rift/style';
import { buildStyle, mixSeed } from '../../rift/style';
import {
  clampTowerFloorIndex,
  DEMON_TOWER_CORE_RADIUS,
  DEMON_TOWER_FLOOR_COUNT,
  demonTowerArenaRadius,
  isDemonTowerBossFloor,
} from '../../rift/tower_scaling';
import type { RiftFloorPlan, RiftObjectPlan, RiftSpawn } from '../../rift/types';
import { Rng } from '../../rng';
import type { DelveHazardZone } from '../../types';

export { DEMON_TOWER_FLOOR_COUNT };

/** The reserved seed that IS the Demon Tower. Picked far from the scheduler's
 * rolled range and pinned by tests: a natural portal must never roll it, or the
 * landmark would show up as a random world rift. */
export const DEMON_TOWER_SEED = 0x70b3_0000;

export const DEMON_TOWER_THEME_ID = 'demon_tower';
export const DEMON_TOWER_THEME_NAME = 'The Demon Tower';

/** True for the one descriptor seed that opens the tower. */
export function isDemonTowerSeed(seed: number): boolean {
  return seed >>> 0 === DEMON_TOWER_SEED;
}

/** The tower's proper name. ONE source, so the door tooltip, the rift tracker,
 * and the "you step through" line can never disagree. */
export function demonTowerName(): string {
  return DEMON_TOWER_THEME_NAME;
}

/** Per-floor label, e.g. "The Demon Tower: Floor 7". The summit names itself. */
export function demonTowerFloorName(floorIndex: number): string {
  const k = clampTowerFloorIndex(floorIndex);
  if (k === DEMON_TOWER_FLOOR_COUNT - 1) return `${DEMON_TOWER_THEME_NAME}: The Summit`;
  return `${DEMON_TOWER_THEME_NAME}: Floor ${k + 1}`;
}

/** The tower's colour grade: colder and more starless the higher you climb, so
 * the ascent reads visually and not only on the floor counter. Deliberately not
 * the Infernal Citadel's blood red, so the two demon places never read alike. */
export const DEMON_TOWER_STYLE: StyleSource = {
  kit: 'bastion',
  torch: { flame: 0xff7a3a, emissive: 0xd93a12, light: 0xff8f4a },
  fog: { color: 0x140611, near: 18, far: 96 },
  wallTint: 0x8a5f6b,
  floorTint: 0x6b4550,
  daisRaised: false,
};

/** How many points the arena circle is sampled at. High enough that the wall
 * reads as curved and a body cannot squeeze between two chords. */
const ARENA_SEGMENTS = 48;

/** Signed area of a simple polygon; positive is the CCW winding the shell seam
 * expects (mirrors rift_gen's own check). */
function signedArea(points: ReadonlyArray<{ x: number; z: number }>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/** The arena wall for one floor, as a CCW circular polygon centred on the origin. */
export function demonTowerArenaPolygon(floorIndex: number): Array<{ x: number; z: number }> {
  const radius = demonTowerArenaRadius(floorIndex);
  const points: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < ARENA_SEGMENTS; i++) {
    const angle = (i / ARENA_SEGMENTS) * Math.PI * 2;
    points.push({
      x: Math.round(Math.sin(angle) * radius * 1000) / 1000,
      z: Math.round(Math.cos(angle) * radius * 1000) / 1000,
    });
  }
  return signedArea(points) < 0 ? points.reverse() : points;
}

/** The first floor whose core runs hot enough to spit molten slag. Below this the
 * arena is clean and the demons are the whole fight; from here up the raid also
 * has to keep moving. */
const HAZARD_FROM_FLOOR_INDEX = 5;

/** Molten runoff pooling around the core on the upper floors: four pools on the
 * diagonals, between the core and the wave ring, so they break up the stand-still
 * spots without ever sealing the arena. */
function demonTowerHazards(floorIndex: number): DelveHazardZone[] {
  const k = clampTowerFloorIndex(floorIndex);
  if (k < HAZARD_FROM_FLOOR_INDEX) return [];
  const ring = demonTowerArenaRadius(k) * 0.42;
  const r = 2.6 + (k - HAZARD_FROM_FLOOR_INDEX) * 0.35;
  const pools: DelveHazardZone[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    pools.push({
      x: Math.round(Math.sin(angle) * ring * 1000) / 1000,
      z: Math.round(Math.cos(angle) * ring * 1000) / 1000,
      r,
      rx: r,
      rz: r,
      tier: 'shallow',
    });
  }
  return pools;
}

/** Where the raid arrives: just inside the south wall, clear of the wave ring. */
export function demonTowerEntry(floorIndex: number): { x: number; z: number } {
  return { x: 0, z: -(demonTowerArenaRadius(floorIndex) - 3.5) };
}

/** Build one tower floor. Pure: identical output for identical arguments, and the
 * only randomness is the colour jitter drawn from a descriptor-seeded local Rng.
 *
 * `spawns` is deliberately EMPTY for the wave demons and both bosses: the tower's
 * population arrives wave by wave from rift/tower.ts, not all at once at floor
 * entry like every other rift floor. */
export function buildDemonTowerFloor(
  seed: number,
  baseLevel: number,
  _floorLevel: number,
  floorIndex = 0,
): RiftFloorPlan {
  const k = clampTowerFloorIndex(floorIndex);
  const rng = new Rng(mixSeed(seed, 0x70b3 + k));
  const radius = demonTowerArenaRadius(k);
  const summit = k === DEMON_TOWER_FLOOR_COUNT - 1;

  const polygon = demonTowerArenaPolygon(k);
  const wallX = Math.ceil(radius) + 2;
  const layout = {
    zMin: -Math.ceil(radius) - 2,
    zMax: Math.ceil(radius) + 2,
    sideWallZ: 0,
    sideWallHd: Math.ceil(radius) + 2,
    pillars: [],
    tombs: [],
    stubs: [],
    // The core stands where a normal rift floor would put its boss dais, but it
    // is a SOLID centrepiece rather than a walkable platform: a 5-yard trunk you
    // could walk through is exactly the phantom-wall problem the rift already
    // fixed once. `obstacles` backs it with its measured footprint.
    dais: { x: 0, z: 0, r: DEMON_TOWER_CORE_RADIUS },
    obstacles: [{ x: 0, z: 0, r: DEMON_TOWER_CORE_RADIUS }],
    wallX,
    endWallHw: wallX,
    floorHalfX: wallX,
    doorZ: -Math.ceil(radius),
    shellPolygon: polygon,
    shellPole: { x: 0, z: 0 },
    illusionWalls: [],
  };

  const spawns: RiftSpawn[] = [];

  const objects: RiftObjectPlan[] = [{ kind: 'tower_core', x: 0, z: 0, name: 'Demon Core' }];
  if (summit) {
    // The `chest` marker is where runs.ts tears the exit and the sealed cache
    // open once the Demon Lord falls (it is never spawned as an object itself).
    objects.push({ kind: 'chest', x: 0, z: radius * 0.55, name: 'Tower Cache' });
  } else {
    // The way up, opened by the wave driver when the floor's last demon dies.
    objects.push({ kind: 'descent', x: 0, z: radius * 0.62, name: 'Tower Ascent' });
  }
  // One off-path cache per boss floor, tucked against the wall as a reward for
  // the two hardest fights below the summit.
  if (isDemonTowerBossFloor(k) && !summit) {
    objects.push({ kind: 'treasure', x: -(radius - 4), z: 0, name: "Warden's Cache" });
  }

  return {
    seed: seed >>> 0,
    baseLevel: Math.round(baseLevel),
    floorIndex: k,
    floorCount: DEMON_TOWER_FLOOR_COUNT,
    // Only the summit is a rift "boss floor": its boss death opens the way home
    // and pays out. The floor-5 gatekeeper is gated by the wave driver instead,
    // so it must NOT claim the run's boss slot.
    isBoss: summit,
    authored: true,
    name: demonTowerFloorName(k),
    themeName: DEMON_TOWER_THEME_NAME,
    layout,
    style: buildStyle(rng, DEMON_TOWER_STYLE),
    entry: demonTowerEntry(k),
    spawns,
    objects,
    // The waves ARE this floor's gate: the driver flips puzzleSolved when the
    // last demon (and any released boss) is dead, and the shared rift logic then
    // opens the ascent exactly as it does for a lit set of pylons.
    puzzle: { kind: 'demon_waves', pylonCount: 0 },
    hazards: demonTowerHazards(k),
    iceZone: null,
    rollers: [],
    platform: null,
    gate: null,
  };
}
