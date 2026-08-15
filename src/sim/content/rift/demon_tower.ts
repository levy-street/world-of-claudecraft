// The Demon Tower: three hand-authored raid floors behind one permanent world
// landmark. The reserved seed lets the tower reuse the deterministic rift
// runtime while every floor supplies its own geometry, environment and encounter.

import type { AuthoredDecor } from '../../dungeon_layout';
import { buildStyle, mixSeed } from '../../rift/style';
import { demonTowerFloorProfile } from '../../rift/tower_floors';
import {
  clampTowerFloorIndex,
  DEMON_TOWER_CORE_RADIUS,
  DEMON_TOWER_FLOOR_COUNT,
} from '../../rift/tower_scaling';
import type { RiftFloorPlan, RiftObjectPlan, RiftSpawn } from '../../rift/types';
import { Rng } from '../../rng';
import type { DelveHazardZone } from '../../types';

export { DEMON_TOWER_FLOOR_COUNT };

export const DEMON_TOWER_SEED = 0x70b3_0000;
export const DEMON_TOWER_THEME_ID = 'demon_tower';
export const DEMON_TOWER_THEME_NAME = 'The Demon Tower';

export function isDemonTowerSeed(seed: number): boolean {
  return seed >>> 0 === DEMON_TOWER_SEED;
}

export function demonTowerName(): string {
  return DEMON_TOWER_THEME_NAME;
}

export function demonTowerFloorName(floorIndex: number): string {
  return `${DEMON_TOWER_THEME_NAME}: ${demonTowerFloorProfile(floorIndex).name}`;
}

function signedArea(points: ReadonlyArray<{ x: number; z: number }>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function radialPolygon(
  count: number,
  outerRadius: number,
  innerRadius: number,
  phase = 0,
): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    points.push({ x: round3(Math.sin(angle) * radius), z: round3(Math.cos(angle) * radius) });
  }
  return signedArea(points) < 0 ? points.reverse() : points;
}

/** Collision/render outline. Each floor has a different silhouette and both
 * systems consume this exact polygon. */
export function demonTowerArenaPolygon(floorIndex: number): Array<{ x: number; z: number }> {
  const floor = demonTowerFloorProfile(floorIndex);
  if (floor.arena.shape === 'octagon') {
    return radialPolygon(8, floor.arena.outerRadius, floor.arena.outerRadius, Math.PI / 8);
  }
  if (floor.arena.shape === 'ossuary_cross') {
    return radialPolygon(16, floor.arena.outerRadius, floor.arena.innerRadius, 0);
  }
  return radialPolygon(10, floor.arena.outerRadius, floor.arena.innerRadius, 0);
}

/** Environmental challenge per floor. These remain jumpable rift hazards: the
 * render chooses molten, soul or void palettes from the scene profile. */
export function demonTowerHazards(floorIndex: number): DelveHazardZone[] {
  const k = clampTowerFloorIndex(floorIndex);
  if (k === 0) {
    return [
      { x: -10, z: -2, r: 3, rx: 2.4, rz: 12, tier: 'shallow' },
      { x: 10, z: -2, r: 3, rx: 2.4, rz: 12, tier: 'shallow' },
    ];
  }
  if (k === 1) {
    return [
      { x: -10, z: -10, r: 4.6, rx: 4.6, rz: 4.6, tier: 'deep' },
      { x: 10, z: -10, r: 4.6, rx: 4.6, rz: 4.6, tier: 'deep' },
      { x: -10, z: 10, r: 4.6, rx: 4.6, rz: 4.6, tier: 'deep' },
      { x: 10, z: 10, r: 4.6, rx: 4.6, rz: 4.6, tier: 'deep' },
    ];
  }
  const ring = 20;
  return Array.from({ length: 5 }, (_, i) => {
    const angle = ((i + 0.5) / 5) * Math.PI * 2;
    return {
      x: round3(Math.sin(angle) * ring),
      z: round3(Math.cos(angle) * ring),
      r: 3.2,
      rx: 3.2,
      rz: 3.2,
      tier: 'deep' as const,
    };
  });
}

/** Measured after Tripo normalization. New entries are filled from `inspect`
 * before shipping; walk-through arches and floor decals intentionally omit one. */
const DECOR_RADIUS: Readonly<Record<string, number>> = {
  tower_ring_fin: 1.59,
  tower_gargoyle_perch: 0.6,
  tower_pact_brazier: 0.49,
  tower_bone_banner: 0.58,
  tower_obelisk: 1.03,
  tower_skull_totem: 0.34,
  tower_iron_cage: 1.14,
  tower_chain_pillar: 1.32,
  tower_bone_heap: 0.44,
  tower_spike_cluster: 1.15,
  tower_ember_font: 0.74,
  tower_impaled_banner: 0.85,
  tower_bloodforge_furnace: 2.15,
  tower_bloodforge_anvil: 1.14,
  tower_ossuary_reliquary: 1.16,
  tower_ossuary_bone_organ: 1.11,
  tower_ossuary_chain_pylon: 1.82,
  tower_void_crown_spire: 1.48,
  tower_void_throne: 1.71,
  tower_void_crystal_conduit: 1.43,
  tower_void_banner: 0.71,
  tower_void_floating_shard: 0.94,
};

function decor(key: string, x: number, z: number, yaw = 0): AuthoredDecor {
  return {
    key,
    x,
    z,
    yaw,
    ...(DECOR_RADIUS[key] === undefined ? {} : { r: DECOR_RADIUS[key] }),
  };
}

function ring(key: string, count: number, radius: number, phase = 0): AuthoredDecor[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = phase + (i / count) * Math.PI * 2;
    return decor(
      key,
      round3(Math.sin(angle) * radius),
      round3(Math.cos(angle) * radius),
      angle + Math.PI,
    );
  });
}

const ENTRY_BODY_CLEARANCE = 2;

function clearTowerEntry(floorIndex: number, items: AuthoredDecor[]): AuthoredDecor[] {
  const entry = demonTowerEntry(floorIndex);
  return items.filter(
    (item) =>
      item.r === undefined ||
      Math.hypot(item.x - entry.x, item.z - entry.z) > item.r + ENTRY_BODY_CLEARANCE,
  );
}

/** Five hero props plus the strongest reusable pieces compose each floor. The
 * lists only share the gameplay Core and the two ascent transitions. */
export function demonTowerDecor(floorIndex: number): AuthoredDecor[] {
  const k = clampTowerFloorIndex(floorIndex);
  if (k === 0) {
    return clearTowerEntry(k, [
      decor('demon_core', 0, 0),
      decor('tower_bloodforge_gate', 0, 26, Math.PI),
      decor('tower_ascent_arch', 0, 21.8, Math.PI),
      decor('tower_bloodforge_chain_gantry', 0, -23, 0),
      decor('tower_bloodforge_furnace', -22, 9, Math.PI / 2),
      decor('tower_bloodforge_furnace', 22, 9, -Math.PI / 2),
      decor('tower_bloodforge_anvil', -14, 25, Math.PI),
      ...ring('tower_bloodforge_slag_vent', 4, 17, Math.PI / 4),
      ...ring('tower_chain_pillar', 4, 28, Math.PI / 4),
      ...ring('tower_pact_brazier', 6, 27, 0),
      ...ring('tower_spike_cluster', 4, 29, Math.PI / 8),
    ]);
  }
  if (k === 1) {
    return clearTowerEntry(k, [
      decor('demon_core', 0, 0),
      decor('tower_ossuary_skull_gate', 0, 25, Math.PI),
      decor('tower_ascent_arch', 0, 21.1, Math.PI),
      decor('tower_ossuary_reliquary', 0, 18, Math.PI),
      decor('tower_ossuary_bone_organ', -22, 0, Math.PI / 2),
      decor('tower_ossuary_bone_organ', 22, 0, -Math.PI / 2),
      ...ring('tower_ossuary_rib_arch', 4, 24, Math.PI / 4),
      ...ring('tower_ossuary_chain_pylon', 4, 17, 0),
      ...ring('tower_bone_banner', 4, 27, Math.PI / 4),
      ...ring('tower_bone_heap', 6, 25, Math.PI / 8),
      ...ring('tower_skull_totem', 4, 28, 0),
      ...ring('tower_gargoyle_perch', 4, 29, Math.PI / 4),
    ]);
  }
  return clearTowerEntry(k, [
    decor('demon_core', 0, 0),
    decor('tower_void_throne', 0, 23, Math.PI),
    ...ring('tower_void_crown_spire', 5, 27.5, 0),
    ...ring('tower_void_crystal_conduit', 5, 18, Math.PI / 5),
    ...ring('tower_void_banner', 5, 25, Math.PI / 5),
    ...ring('tower_void_floating_shard', 5, 14, 0),
    ...ring('tower_obelisk', 5, 24, Math.PI / 5),
    ...ring('tower_rune_slab', 5, 9, 0),
    ...ring('tower_ring_fin', 5, 28, Math.PI / 5),
  ]);
}

export function demonTowerDecorObstacles(
  floorIndex: number,
): Array<{ x: number; z: number; r: number }> {
  return demonTowerDecor(floorIndex)
    .filter((d): d is AuthoredDecor & { r: number } => typeof d.r === 'number')
    .map((d) => ({ x: d.x, z: d.z, r: d.r }));
}

export function demonTowerEntry(floorIndex: number): { x: number; z: number } {
  return { x: 0, z: demonTowerFloorProfile(floorIndex).arena.entryZ };
}

export function buildDemonTowerFloor(
  seed: number,
  baseLevel: number,
  _floorLevel: number,
  floorIndex = 0,
): RiftFloorPlan {
  const k = clampTowerFloorIndex(floorIndex);
  const profile = demonTowerFloorProfile(k);
  const rng = new Rng(mixSeed(seed, 0x70b3 + k));
  const radius = profile.arena.outerRadius;
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
    dais: { x: 0, z: 0, r: DEMON_TOWER_CORE_RADIUS },
    obstacles: [{ x: 0, z: 0, r: DEMON_TOWER_CORE_RADIUS }, ...demonTowerDecorObstacles(k)],
    wallX,
    endWallHw: wallX,
    floorHalfX: wallX,
    doorZ: -Math.ceil(radius),
    shellPolygon: polygon,
    shellPole: { x: 0, z: 0 },
    decor: demonTowerDecor(k),
    illusionWalls: [],
  };
  const spawns: RiftSpawn[] = [];
  const objects: RiftObjectPlan[] = [{ kind: 'tower_core', x: 0, z: 0, name: 'Demon Core' }];
  if (summit) objects.push({ kind: 'chest', x: 0, z: radius * 0.55, name: 'Tower Cache' });
  else objects.push({ kind: 'descent', x: 0, z: radius * 0.68, name: 'Tower Ascent' });

  return {
    seed: seed >>> 0,
    baseLevel: Math.round(baseLevel),
    floorIndex: k,
    floorCount: DEMON_TOWER_FLOOR_COUNT,
    isBoss: summit,
    authored: true,
    name: demonTowerFloorName(k),
    themeName: profile.name,
    layout,
    style: buildStyle(rng, profile.style),
    entry: demonTowerEntry(k),
    spawns,
    objects,
    puzzle: { kind: 'demon_waves', pylonCount: 0 },
    hazards: demonTowerHazards(k),
    iceZone: null,
    rollers: [],
    platform: null,
    gate: null,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
