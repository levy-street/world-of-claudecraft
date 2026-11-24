// The Quartered Isle's landmark set dressing as plain numbers: where every
// modeled ice spire and floating isle goes. Three-free and DOM-free so a Vitest
// pins the layout without a renderer (quartered_landmark_dressing.ts is the
// thin consumer that instances the meshes).
//
// Every shape is read from the sim leaf src/sim/quartered_landmarks.ts, the
// same numbers the terrain carves the crevasses and the shelf from, so the dressing moves with the landforms instead of drifting off them.
// Cosmetic only: nothing here feeds a collider or the sim.
//
// Seating follows the den-seat rule in ember_features.ts: a spire stands on
// the LOWEST of a few probes under its footprint, so a spire on a slope never
// floats on its downhill side. (The Cinderscar's burnways carry the fissure
// melt, quartered_fissure_lava_core.ts, and the lakes' rims the generated
// snow outcrops, content/quartered_spires.ts.)

import { QUARTERED_ISLE_ROADS } from '../sim/content/quartered_isle_ways';
import { CHALLENGERS_RING, RIVALMOOT_HILL } from '../sim/quartered_isle_terrain';
import { HOARSHELF_CREVASSES, quarteredLandmarkClears } from '../sim/quartered_landmarks';
import { dominantQuarterAt } from '../sim/quartered_quarters';
import { isleFissureAt, placedSpots } from '../sim/quartered_shatter';
import { hash2 } from '../sim/rng';
import { WATER_LEVEL } from '../sim/world';
import { FROST_ICE_TINTS } from './frost_ice_fields_core';
import { type FloatingIslesPlan, planFloatingIsles } from './quartered_floating_debris_core';

type GroundAt = (x: number, z: number) => number;

/** How far a crevasse spire stands off the crack's line: past the trench's
 *  2.4yd lip, so it stands on the shelf and never in the fall. */
export const CREVASSE_OFFSET_MIN = 3;
export const CREVASSE_OFFSET_MAX = 4;

/** Spires below this are standing in the sea (the frost fields' water cut). */
const SPIRE_WATER_FLOOR = -3;

export interface QuarteredSpireSite {
  x: number;
  y: number;
  z: number;
  /** non-uniform scale on the normalized spire, so no two read as copies */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  tiltAxisYaw: number;
  tint: number;
  /** which cull cluster draws it: a frozen lake's ring, the crevasse shelf,
   *  or the open Hoarshelf's west or east half */
  cluster: 'lake' | 'crevasse' | 'shelfWest' | 'shelfEast';
  /** for a lake ring spire, its index into QUARTERED_FROZEN_LAKES (0 is the
   *  Rimeglass); -1 otherwise */
  lake: number;
}

export interface QuarteredLandmarkDressingPlan {
  spires: QuarteredSpireSite[];
  /** the floating isles north of the Gyre, their chains and their cloud bank
   *  (quartered_floating_debris_core.ts) */
  debris: FloatingIslesPlan;
}

/** The lowest ground under a footprint of radius `r` (centre plus four
 *  probes), so the base is buried on a slope instead of hanging off it. */
function seatLowest(groundAt: GroundAt, x: number, z: number, r: number): number {
  let lo = groundAt(x, z);
  lo = Math.min(lo, groundAt(x + r, z), groundAt(x - r, z), groundAt(x, z + r), groundAt(x, z - r));
  return lo;
}

// The three variant silhouettes the Frostveil fields use (frost_ice_fields.ts),
// so the isle's ice reads as the same material family.
const SPIRE_VARIANTS = [
  [1, 1, 1],
  [0.78, 1.12, 0.86],
  [1.08, 0.86, 0.72],
] as const;

function spireSite(
  groundAt: GroundAt,
  x: number,
  z: number,
  ordinal: number,
  salt: number,
  cluster: QuarteredSpireSite['cluster'],
  scale = 0.7 + hash2(ordinal, salt, 5101) * 0.6,
): QuarteredSpireSite | null {
  // the spire's base is about half its scale across; sink a hand into the
  // lowest probe so the foot never shows a gap
  const ground = seatLowest(groundAt, x, z, 0.5 * scale);
  if (ground < SPIRE_WATER_FLOOR) return null;
  const variant = SPIRE_VARIANTS[(ordinal + salt) % SPIRE_VARIANTS.length];
  return {
    x,
    y: ground - 0.12,
    z,
    sx: scale * variant[0],
    sy: scale * variant[1],
    sz: scale * variant[2],
    yaw: hash2(salt, ordinal, 5111) * Math.PI * 2,
    tilt: (hash2(ordinal, salt, 5121) - 0.5) * 0.4,
    tiltAxisYaw: hash2(ordinal, salt, 5131) * Math.PI * 2,
    tint: FROST_ICE_TINTS[Math.floor(hash2(ordinal, salt, 5141) * FROST_ICE_TINTS.length)],
    cluster,
    lake: -1,
  };
}

function crevasseSpires(groundAt: GroundAt, out: QuarteredSpireSite[]): void {
  HOARSHELF_CREVASSES.forEach((line, ci) => {
    const a = line[0];
    const b = line[line.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const count = 1;
    // the first side alternates crack to crack, then spire to spire
    const firstSide = hash2(ci, 4, 5311) < 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      // evenly along the crack's deep middle, never on its stepping ends
      const along = ((i + 1) / (count + 1) + (hash2(ci, i, 5321) - 0.5) * 0.12) * len;
      const side = i % 2 === 0 ? firstSide : -firstSide;
      const offset =
        CREVASSE_OFFSET_MIN + hash2(ci, i, 5331) * (CREVASSE_OFFSET_MAX - CREVASSE_OFFSET_MIN);
      // the perpendicular to (ux, uz) in the ground plane
      const x = a.x + ux * along - uz * offset * side;
      const z = a.z + uz * along + ux * offset * side;
      const site = spireSite(groundAt, x, z, ci * 8 + i, 2, 'crevasse');
      if (site) out.push(site);
    }
  });
}

/** How many spires the open Hoarshelf aims for, beyond the cracks: a few
 *  glacier spikes over the snowfields, thinned so the quarter reads as the
 *  frost inspiration's snowy rock round dark water (the lakes' rims are the
 *  generated snow outcrops, content/quartered_spires.ts). */
export const SHELF_SPIRE_TARGET = 6;
/** The shelf spires' scale on the normalized 3.2yd spire: always taller than
 *  the tarn ring's 0.7 to 1.3, the tallest towering at about 14yd. */
export const SHELF_SCALE_MIN = 1.5;
export const SHELF_SCALE_MAX = 4.4;
/** The placement rules, in yards. */
export const SHELF_ROAD_CLEAR = 8;
export const SHELF_FISSURE_CLEAR = 3;
export const SHELF_SPOT_CLEAR = 20;
export const SHELF_DRY_MARGIN = 0.5;
/** Spires keep this much air between their bases (plus their own radii), so
 *  the field reads as separate spikes and never a fused wall. */
const SHELF_SPACING = 7;
const SHELF_STEP = 8;
/** Kept off the arena (inside its rim's crest) and the town's rise. */
const SHELF_CRATER_CLEAR = CHALLENGERS_RING.rimR + 6;
/** Kept this far off each crater ramp's notch, out past the rim's foot. */
const SHELF_RAMP_CLEAR = 4;

/** True where a spire of radius `r` would stand on or over a crater ramp:
 *  the notch runs out to the rim's outer foot, past the crater clear. */
function onCraterRamp(x: number, z: number, r: number): boolean {
  const dx = x - CHALLENGERS_RING.x;
  const dz = z - CHALLENGERS_RING.z;
  return CHALLENGERS_RING.ramps.some((deg) => {
    const a = (deg * Math.PI) / 180;
    const along = dx * Math.cos(a) + dz * Math.sin(a);
    const across = Math.abs(-dx * Math.sin(a) + dz * Math.cos(a));
    return (
      along > CHALLENGERS_RING.rampFrom - r &&
      along < CHALLENGERS_RING.rampTo + SHELF_RAMP_CLEAR + r &&
      across < CHALLENGERS_RING.rampHalfW + SHELF_RAMP_CLEAR + r
    );
  });
}
const SHELF_TOWN_CLEAR = RIVALMOOT_HILL.footR;

type Pt = { readonly x: number; readonly z: number };

/** Distance from (x, z) to the nearest road segment. */
export function quarteredRoadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of QUARTERED_ISLE_ROADS) {
    for (let k = 0; k + 1 < road.length; k++) {
      const a = road[k];
      const b = road[k + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const u = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
      best = Math.min(best, Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u)));
    }
  }
  return best;
}

/** True when no fissure cuts within `r` of (x, z): the centre and sixteen
 *  bearings at four radii out to r, dense enough that a fissure's narrowest
 *  neck (wider than any gap between probes) cannot slip between them. */
function fissureFree(x: number, z: number, r: number): boolean {
  if (isleFissureAt(x, z, 1) > 0) return false;
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (r * ring) / 4;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (isleFissureAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 1) > 0) return false;
    }
  }
  return true;
}

/** True when no landmark clear (the Gyre path, the beds, the tarn, the glass)
 *  touches the spire's base: its centre and four probes at its radius. */
function landmarkFree(x: number, z: number, r: number): boolean {
  return (
    !quarteredLandmarkClears(x, z) &&
    !quarteredLandmarkClears(x + r, z) &&
    !quarteredLandmarkClears(x - r, z) &&
    !quarteredLandmarkClears(x, z + r) &&
    !quarteredLandmarkClears(x, z - r)
  );
}

/** The spire's base radius at a scale (the normalized spire's foot is about
 *  half its scale across; the widest variant stretches it by 1.08). */
export function shelfSpireRadius(scale: number): number {
  return 0.55 * scale;
}

/** The scale of the shelf spire at a grid cell: most stand two or three
 *  times the tarn ring, and about one in five towers as a glacier spike. */
function shelfScale(ci: number, cj: number): number {
  const h = hash2(ci, cj, 5501);
  const t = h < 0.8 ? (h / 0.8) * 0.45 : 0.55 + ((h - 0.8) / 0.2) * 0.45;
  return SHELF_SCALE_MIN + (SHELF_SCALE_MAX - SHELF_SCALE_MIN) * t;
}

/** The open Hoarshelf: spires across the ice quarter, on a jittered grid
 *  ordered by a hash and accepted until the target, each one passing every
 *  placement rule (dry ground, clear of the roads, the fissures, the content
 *  spots and the landmarks) and spaced off every spire already placed. */
function shelfSpires(groundAt: GroundAt, out: QuarteredSpireSite[]): void {
  const spots: readonly Pt[] = placedSpots();
  const cand: { x: number; z: number; ci: number; cj: number; order: number }[] = [];
  for (let ci = 0; ci * SHELF_STEP < 500; ci++) {
    for (let cj = 0; cj * SHELF_STEP < 420; cj++) {
      const x = -250 + (ci + 0.2 + 0.6 * hash2(ci, cj, 5511)) * SHELF_STEP;
      const z = 1980 + (cj + 0.2 + 0.6 * hash2(ci, cj, 5521)) * SHELF_STEP;
      if (dominantQuarterAt(x, z) !== 'ice') continue;
      cand.push({ x, z, ci, cj, order: hash2(ci, cj, 5531) });
    }
  }
  cand.sort((a, b) => a.order - b.order);
  const radiusOf = (s: QuarteredSpireSite) => shelfSpireRadius(Math.max(s.sx, s.sz));
  let taken = 0;
  for (const c of cand) {
    if (taken >= SHELF_SPIRE_TARGET) return;
    const scale = shelfScale(c.ci, c.cj);
    const r = shelfSpireRadius(scale);
    if (c.x - r < -250 || c.x + r > 250 || c.z - r < 1980 || c.z + r > 2400) continue;
    if (Math.hypot(c.x - CHALLENGERS_RING.x, c.z - CHALLENGERS_RING.z) < SHELF_CRATER_CLEAR + r)
      continue;
    if (onCraterRamp(c.x, c.z, r)) continue;
    if (Math.hypot(c.x - RIVALMOOT_HILL.x, c.z - RIVALMOOT_HILL.z) < SHELF_TOWN_CLEAR + r) continue;
    if (quarteredRoadDistance(c.x, c.z) < SHELF_ROAD_CLEAR + r) continue;
    if (spots.some((p) => Math.hypot(c.x - p.x, c.z - p.z) < SHELF_SPOT_CLEAR)) continue;
    if (out.some((s) => Math.hypot(c.x - s.x, c.z - s.z) < SHELF_SPACING + r + radiusOf(s))) {
      continue;
    }
    // the costlier terrain rules last: the lowest ground under the base must
    // stand clear of the sea, and no landmark or fissure may touch it
    if (seatLowest(groundAt, c.x, c.z, r) <= WATER_LEVEL + SHELF_DRY_MARGIN) continue;
    if (!landmarkFree(c.x, c.z, r)) continue;
    if (!fissureFree(c.x, c.z, SHELF_FISSURE_CLEAR + r)) continue;
    const cluster = c.x < 0 ? 'shelfWest' : 'shelfEast';
    const site = spireSite(groundAt, c.x, c.z, c.ci * 64 + c.cj, 3, cluster, scale);
    if (!site) continue;
    // a tall spike leans less, or its tip would swing far off its base
    site.tilt *= 0.5;
    out.push(site);
    taken++;
  }
}

/**
 * Every spire and floating isle the isle's landmark dressing draws. `groundAt` is
 * the finished terrain sampler (the caller passes terrainHeight, as the frost
 * fields and the Drakelands lava do). Deterministic: no rng, only fixed hashes.
 */
export function planQuarteredLandmarkDressing(groundAt: GroundAt): QuarteredLandmarkDressingPlan {
  const spires: QuarteredSpireSite[] = [];
  crevasseSpires(groundAt, spires);
  // after the cracks, so the open shelf spaces itself off the spires already
  // standing there
  shelfSpires(groundAt, spires);
  return { spires, debris: planFloatingIsles(groundAt) };
}
