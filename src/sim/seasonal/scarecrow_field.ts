// Where Old Thatchgrin's pumpkin patch lies: resolved against the LIVE world, never a
// hand-placed coordinate, so a rework of Eastbrook or of the meadow moves the field with
// it instead of leaving the boss standing in a new building.
//
// The anchor is Boar Meadow, the open grassland past Eastbrook's east edge (its POI on the
// Vale's zone record). Candidates walk out from it on rings, each ring starting on the far
// side from town, and the first one that passes every check is the field:
//   - inside Eastbrook Vale, and well clear of the town itself (a field boss never fights
//     on the square);
//   - the whole fight disc clear: no static collider (`isBlocked`, the movement query), no
//     water, gentle relief (a scythe fight on a cliff is no fight);
//   - off the roads by more than the disc, so nobody walking to Fenbridge is pulled;
//   - clear of every mob camp and every placed NPC, so neither wanders into his kit.
// A world where nothing passes gets no field and no boss (tests/gourdlight_scarecrow.test.ts
// fails on that against the shipped world, so the gate catches a rework that breaks it).
//
// Pure and deterministic: no rng, no clock. Memoized per (seed, content generation).

import type { Collider } from '../collider_shapes';
import { isBlocked, queryOpenWorldColliders } from '../colliders';
import { TOWN_RADIUS } from '../content/zone1';
import { getActiveWorldContent, getContentGeneration, OVERWORLD_GRAVEYARDS, zoneAt } from '../data';
import { groundHeight, roadDistance, WATER_LEVEL } from '../world';

export const SCARECROW_FIELD_ZONE = 'eastbrook_vale';
export const SCARECROW_FIELD_ANCHOR_POI = 'boar_meadow';

/** The fight's radius: the disc that must be clear, flat and dry (yards). */
export const SCARECROW_FIELD_RADIUS = 12;
/** How far the town's own disc (the hub radius) must be from the field's centre. */
export const SCARECROW_FIELD_TOWN_CLEARANCE = TOWN_RADIUS + 30;
/** The field's centre keeps this far from the nearest painted road. */
export const SCARECROW_FIELD_ROAD_CLEARANCE = SCARECROW_FIELD_RADIUS + 6;
/** ...and this far from the CENTRE of any mob camp. The open meadows of the Vale are where
 *  its camps graze (Boar Meadow is his), so the field may share a camp's outskirts, never
 *  its heart: the boars there are level 2 and trivial to the level 20s he is for, so they
 *  never join his fight, and his kit only ever strikes players. */
export const SCARECROW_FIELD_CAMP_CLEARANCE = 12;
/** ...and from any placed NPC. */
export const SCARECROW_FIELD_NPC_CLEARANCE = 30;
/** Highest-minus-lowest ground across the disc (yards). */
export const SCARECROW_FIELD_MAX_RELIEF = 3;
/** Open sky round the fight: no tree, rock or wall inside this (yards), so a camera
 *  pulled back to take in a boss three players tall never sits inside a crown. */
export const SCARECROW_FIELD_OPEN_RADIUS = 22;
/** ...no shore inside this (a field, not a beach)... */
export const SCARECROW_FIELD_SHORE_CLEARANCE = 24;
/** ...and no graveyard nearer than this (a fresh ghost must not run back into him). */
export const SCARECROW_FIELD_GRAVEYARD_CLEARANCE = 60;

const RING_STEP = 5;
const RING_MAX = 140;
const ANGLE_STEPS = 24;
const SAMPLE_RINGS = [0, 4, 8, 12] as const;
const SAMPLE_SPOKES = 8;

export interface ScarecrowField {
  x: number;
  z: number;
  /** Where he faces at rest: back toward the town, watching the road he guards it from. */
  facing: number;
}

export interface ScarecrowFieldCheck {
  zone: boolean;
  /** Colliders (trees, rocks, walls) inside SCARECROW_FIELD_OPEN_RADIUS. `camp` is the
   *  distance to the nearest camp's centre. */
  obstacles: number;
  shore: boolean;
  graveyard: number;
  town: boolean;
  clear: boolean;
  dry: boolean;
  relief: number;
  road: number;
  camp: number;
  npc: number;
}

/** Every measurement the resolver makes at one candidate (the test reads it too). */
export function measureScarecrowField(seed: number, x: number, z: number): ScarecrowFieldCheck {
  const world = getActiveWorldContent();
  const zone = world.zones.find((zn) => zn.id === SCARECROW_FIELD_ZONE);
  const hub = zone?.hub;
  let clear = true;
  let dry = true;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of SAMPLE_RINGS) {
    const spokes = r === 0 ? 1 : SAMPLE_SPOKES;
    for (let k = 0; k < spokes; k++) {
      const a = (k / SAMPLE_SPOKES) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      if (isBlocked(seed, px, pz, 0.6)) clear = false;
      const h = groundHeight(px, pz, seed);
      if (h < WATER_LEVEL + 0.5) dry = false;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const open = SCARECROW_FIELD_OPEN_RADIUS;
  const near: Collider[] = [];
  queryOpenWorldColliders(seed, x - open, z - open, x + open, z + open, near);
  let obstacles = 0;
  // a gated set (the event's own dressing, a docked ship) is not the land: never counted
  for (const c of near)
    if (c.gate === undefined && Math.hypot(c.x - x, c.z - z) < open) obstacles++;
  let shore = false;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = SCARECROW_FIELD_SHORE_CLEARANCE;
    if (groundHeight(x + Math.sin(a) * r, z + Math.cos(a) * r, seed) < WATER_LEVEL + 0.5)
      shore = true;
  }
  let graveyard = Number.POSITIVE_INFINITY;
  for (const g of world.services?.graveyards ?? OVERWORLD_GRAVEYARDS) {
    graveyard = Math.min(graveyard, Math.hypot(g.x - x, g.z - z));
  }
  let camp = Number.POSITIVE_INFINITY;
  for (const c of world.camps) {
    camp = Math.min(camp, Math.hypot(c.center.x - x, c.center.z - z));
  }
  let npc = Number.POSITIVE_INFINITY;
  for (const def of Object.values(world.npcs)) {
    if (!def.pos || def.dynamic) continue;
    npc = Math.min(npc, Math.hypot(def.pos.x - x, def.pos.z - z));
  }
  return {
    zone: zoneAt(x, z).id === SCARECROW_FIELD_ZONE,
    obstacles,
    shore,
    graveyard,
    town: hub
      ? Math.hypot(hub.x - x, hub.z - z) - hub.radius >= SCARECROW_FIELD_TOWN_CLEARANCE
      : true,
    clear,
    dry,
    relief: hi - lo,
    road: roadDistance(x, z),
    camp,
    npc,
  };
}

export function scarecrowFieldPasses(check: ScarecrowFieldCheck): boolean {
  return (
    check.zone &&
    check.obstacles === 0 &&
    !check.shore &&
    check.graveyard >= SCARECROW_FIELD_GRAVEYARD_CLEARANCE &&
    check.town &&
    check.clear &&
    check.dry &&
    check.relief <= SCARECROW_FIELD_MAX_RELIEF &&
    check.road >= SCARECROW_FIELD_ROAD_CLEARANCE &&
    check.camp >= SCARECROW_FIELD_CAMP_CLEARANCE &&
    check.npc >= SCARECROW_FIELD_NPC_CLEARANCE
  );
}

// One answer per (active content, seed), like the decor layout's memo: two worlds on
// different seeds in one process never evict each other's field.
const memo = new WeakMap<object, Map<string, ScarecrowField | null>>();

/** The field, or null when the world has no spot that passes. */
export function resolveScarecrowField(seed: number): ScarecrowField | null {
  const content = getActiveWorldContent();
  let bySeed = memo.get(content);
  if (!bySeed) {
    bySeed = new Map();
    memo.set(content, bySeed);
  }
  const key = `${seed}:${getContentGeneration()}`;
  if (bySeed.has(key)) return bySeed.get(key) ?? null;
  const zone = getActiveWorldContent().zones.find((zn) => zn.id === SCARECROW_FIELD_ZONE);
  const anchor = zone?.pois?.find((p) => p.id === SCARECROW_FIELD_ANCHOR_POI) ?? zone?.hub;
  let field: ScarecrowField | null = null;
  if (zone?.hub && anchor) {
    const hub = zone.hub;
    // Ring zero is the anchor itself; every ring starts on the bearing AWAY from town.
    const away = Math.atan2(anchor.x - hub.x, anchor.z - hub.z);
    search: for (let r = 0; r <= RING_MAX; r += RING_STEP) {
      const steps = r === 0 ? 1 : ANGLE_STEPS;
      for (let k = 0; k < steps; k++) {
        // 0, +1, -1, +2, -2 ... steps either side of the away bearing
        const offset = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
        const a = away + (offset / ANGLE_STEPS) * Math.PI * 2;
        const x = anchor.x + Math.sin(a) * r;
        const z = anchor.z + Math.cos(a) * r;
        if (!scarecrowFieldPasses(measureScarecrowField(seed, x, z))) continue;
        field = { x, z, facing: Math.atan2(hub.x - x, hub.z - z) };
        break search;
      }
    }
  }
  bySeed.set(key, field);
  return field;
}
