// Pure, deterministic placement plan for the open-air Buried Hoard valleys.
// The Three painter consumes this data; keeping the plan here makes the eight
// zone identities, boundary coverage and combat-lane clearance testable in Node.

import type { BiomeId } from '../sim/types';
import {
  CLIFF_SHOULDER_BOOST,
  cliffFaceDepth,
  cliffHeight,
  cliffPerimeter,
  cliffShoulder,
} from './hoard_cliff_mass_core';

export const HOARD_VALLEY_ZONE_IDS = [
  'amberfall',
  'drakelands',
  'frostveil',
  'galecrest',
  'nightbloom',
  'palmreach',
  'willowfen',
  'wraithwood',
] as const;

export type HoardValleyZoneId = (typeof HOARD_VALLEY_ZONE_IDS)[number];
export type HoardValleyDressingKind =
  | 'autumn_tree'
  | 'basalt_spire'
  | 'ice_spire'
  | 'windswept_grass'
  | 'moon_bloom'
  | 'palm'
  | 'reeds'
  | 'dead_tree';

export interface HoardValleyZoneProfile {
  biome: BiomeId;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  groundLight: number;
  cliff: number;
  cliffLight: number;
  trunk: number;
  accent: number;
  dressing: HoardValleyDressingKind;
}

export interface HoardValleyDayNightGrade {
  fog: readonly [number, number, number];
  nightAmt: number;
}

/**
 * MeshBasic keeps valley colors stable across presets, so its material tint
 * carries only the cool night grade. Keep most authored albedo at midnight:
 * combat silhouettes and telegraphs need a readable floor even without lamps.
 */
export function hoardValleySurfaceTint(
  grade: HoardValleyDayNightGrade,
): readonly [number, number, number] {
  const night = Math.max(0, Math.min(1, grade.nightAmt));
  const target: readonly [number, number, number] = [
    0.72 + Math.max(0, Math.min(1, grade.fog[0])) * 0.28,
    0.78 + Math.max(0, Math.min(1, grade.fog[1])) * 0.22,
    0.9 + Math.max(0, Math.min(1, grade.fog[2])) * 0.1,
  ];
  return [1 + (target[0] - 1) * night, 1 + (target[1] - 1) * night, 1 + (target[2] - 1) * night];
}

export const HOARD_VALLEY_ZONE_PROFILES: Record<HoardValleyZoneId, HoardValleyZoneProfile> = {
  amberfall: {
    biome: 'amber',
    fogColor: 0xbca467,
    fogNear: 88,
    fogFar: 224,
    ground: 0x6d5a2d,
    groundLight: 0x927239,
    cliff: 0x66513a,
    cliffLight: 0x8a714d,
    trunk: 0x49351f,
    accent: 0xd18b2e,
    dressing: 'autumn_tree',
  },
  drakelands: {
    biome: 'volcano',
    fogColor: 0x6c4b42,
    fogNear: 74,
    fogFar: 205,
    ground: 0x342f2d,
    groundLight: 0x554239,
    cliff: 0x292729,
    cliffLight: 0x57433d,
    trunk: 0x241b18,
    accent: 0xd65b31,
    dressing: 'basalt_spire',
  },
  frostveil: {
    biome: 'frost',
    fogColor: 0xb8d3db,
    fogNear: 92,
    fogFar: 236,
    ground: 0xc9dae0,
    groundLight: 0xf0f7f6,
    cliff: 0x657985,
    cliffLight: 0x9fb7c1,
    trunk: 0x596672,
    accent: 0x8ee7ff,
    dressing: 'ice_spire',
  },
  galecrest: {
    biome: 'gale',
    fogColor: 0xa2b8b0,
    fogNear: 102,
    fogFar: 246,
    ground: 0x718153,
    groundLight: 0x9aa477,
    cliff: 0x6d716d,
    cliffLight: 0x9aa09b,
    trunk: 0x554735,
    accent: 0xb9d8c4,
    dressing: 'windswept_grass',
  },
  nightbloom: {
    biome: 'night',
    fogColor: 0x43506a,
    fogNear: 86,
    fogFar: 220,
    ground: 0x243b36,
    groundLight: 0x375a4d,
    cliff: 0x303b49,
    cliffLight: 0x59647a,
    trunk: 0x332c42,
    accent: 0xa98fe8,
    dressing: 'moon_bloom',
  },
  palmreach: {
    biome: 'beach',
    fogColor: 0xc9bb86,
    fogNear: 96,
    fogFar: 236,
    ground: 0xb99b5a,
    groundLight: 0xe1c478,
    cliff: 0x866f4b,
    cliffLight: 0xb09561,
    trunk: 0x674823,
    accent: 0x4f8b52,
    dressing: 'palm',
  },
  willowfen: {
    biome: 'fen',
    fogColor: 0x71806a,
    fogNear: 76,
    fogFar: 204,
    ground: 0x48533b,
    groundLight: 0x6b7650,
    cliff: 0x4d5145,
    cliffLight: 0x737767,
    trunk: 0x493b2c,
    accent: 0x8ba662,
    dressing: 'reeds',
  },
  wraithwood: {
    biome: 'haunt',
    fogColor: 0x59665c,
    fogNear: 72,
    fogFar: 198,
    ground: 0x30372d,
    groundLight: 0x465043,
    cliff: 0x41413f,
    cliffLight: 0x63605a,
    trunk: 0x342b29,
    accent: 0x728d72,
    dressing: 'dead_tree',
  },
};

export interface HoardValleyPoint {
  x: number;
  z: number;
}

export interface HoardValleyLayoutInput {
  zMin: number;
  zMax: number;
  wallX?: number;
  floorHalfX?: number;
  shellPolygon?: readonly HoardValleyPoint[];
  dais: { x: number; z: number; r: number };
}

export interface HoardValleyGroundStrip {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  color: number;
}

export interface HoardValleyRockPlacement extends HoardValleyPoint {
  y: number;
  /** Explicit centre height. Absent on the classic full-height wall rocks, whose
   *  centre is derived from their scale; set on rocks embedded in the cliff body. */
  centerY?: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yaw: number;
  color: number;
  revealShoulder: boolean;
}

export interface HoardValleyDressingPlacement extends HoardValleyPoint {
  y: number;
  scale: number;
  yaw: number;
  kind: HoardValleyDressingKind;
}

export interface HoardValleyPlan {
  zone: HoardValleyZoneProfile;
  /** The room outline the cliff body follows. */
  outline: readonly HoardValleyPoint[];
  seed: number;
  ground: HoardValleyGroundStrip[];
  cliffs: HoardValleyRockPlacement[];
  dressing: HoardValleyDressingPlacement[];
  revealZ: number;
  centerClearHalfWidth: number;
}

function hash(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function mixColor(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * t);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function polygonFor(layout: HoardValleyLayoutInput): readonly HoardValleyPoint[] {
  if (layout.shellPolygon && layout.shellPolygon.length >= 3) return layout.shellPolygon;
  const halfX = layout.floorHalfX ?? layout.wallX ?? 22;
  return [
    { x: -halfX, z: layout.zMin },
    { x: halfX, z: layout.zMin },
    { x: halfX, z: layout.zMax },
    { x: -halfX, z: layout.zMax },
  ];
}

/** Horizontal span through a simple room shell. The valley shells are x-monotone at each z. */
export function hoardValleySpanAtZ(
  layout: HoardValleyLayoutInput,
  z: number,
): { minX: number; maxX: number } {
  const polygon = polygonFor(layout);
  const xs: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a.z === b.z) continue;
    const low = Math.min(a.z, b.z);
    const high = Math.max(a.z, b.z);
    if (z < low || z >= high) continue;
    const t = (z - a.z) / (b.z - a.z);
    xs.push(a.x + (b.x - a.x) * t);
  }
  if (xs.length < 2) {
    const halfX = layout.floorHalfX ?? layout.wallX ?? 22;
    return { minX: -halfX, maxX: halfX };
  }
  xs.sort((a, b) => a - b);
  return { minX: xs[0], maxX: xs[xs.length - 1] };
}

/** First broad sightline after the narrow entry gorge. */
export function hoardValleyRevealZ(layout: HoardValleyLayoutInput): number {
  const step = Math.max(1, (layout.zMax - layout.zMin) / 80);
  let maxWidth = 0;
  for (let z = layout.zMin + step; z < layout.zMax; z += step) {
    const span = hoardValleySpanAtZ(layout, z);
    maxWidth = Math.max(maxWidth, span.maxX - span.minX);
  }
  const threshold = maxWidth * 0.68;
  const searchStart = layout.zMin + Math.min(18, (layout.zMax - layout.zMin) * 0.18);
  for (let z = searchStart; z < layout.zMax; z += step) {
    const span = hoardValleySpanAtZ(layout, z);
    if (span.maxX - span.minX >= threshold) return z;
  }
  return layout.zMin + (layout.zMax - layout.zMin) * 0.35;
}

function buildGround(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
): HoardValleyGroundStrip[] {
  const depth = layout.zMax - layout.zMin;
  const stripDepth = 2.5;
  const count = Math.max(1, Math.ceil(depth / stripDepth));
  const strips: HoardValleyGroundStrip[] = [];
  for (let i = 0; i < count; i++) {
    const z0 = layout.zMin + (i / count) * depth;
    const z1 = layout.zMin + ((i + 1) / count) * depth;
    const z = (z0 + z1) * 0.5;
    const span = hoardValleySpanAtZ(layout, z);
    const inset = 0.35;
    strips.push({
      x: (span.minX + span.maxX) * 0.5,
      z,
      halfX: Math.max(0.5, (span.maxX - span.minX) * 0.5 - inset),
      halfZ: (z1 - z0) * 0.54,
      color: mixColor(zone.ground, zone.groundLight, 0.12 + hash(seed, i, 3) * 0.28),
    });
  }
  return strips;
}

/** The rock detail layer of the wall. The continuous body (hoard_cliff_mass_core)
 *  is the wall; these are formations EMBEDDED in it, sized and placed from the
 *  same height field so nothing can float:
 *   - primaries: big rocks sunk into the face, only their fronts showing;
 *   - crowns: rocks buried in the plateau that break up the skyline;
 *   - seams: small rocks pressed into the face between the primaries. */
function buildCliffs(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
  revealZ: number,
): HoardValleyRockPlacement[] {
  const perimeter = cliffPerimeter(polygonFor(layout));
  const rocks: HoardValleyRockPlacement[] = [];
  let serial = 0;
  for (const edge of perimeter.edges) {
    const ax = (edge.b.x - edge.a.x) / edge.length;
    const az = (edge.b.z - edge.a.z) / edge.length;
    const count = Math.max(1, Math.ceil(edge.length / 3.8));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const baseX = edge.a.x + (edge.b.x - edge.a.x) * t;
      const baseZ = edge.a.z + (edge.b.z - edge.a.z) * t;
      const s = edge.start + edge.length * t;
      const revealShoulder = cliffShoulder(baseX, baseZ, revealZ);
      const wall =
        cliffHeight(seed, s, perimeter.length) * (revealShoulder ? CLIFF_SHOULDER_BOOST : 1);
      const place = (
        along: number,
        depth: number,
        centerY: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number,
      ): void => {
        const index = serial++;
        rocks.push({
          x: baseX + edge.nx * depth + ax * along,
          y: centerY,
          centerY,
          z: baseZ + edge.nz * depth + az * along,
          scaleX,
          scaleY,
          scaleZ,
          yaw: hash(seed, index, 17) * Math.PI * 2,
          color: mixColor(zone.cliff, zone.cliffLight, 0.08 + hash(seed, index, 18) * 0.4),
          revealShoulder,
        });
      };
      const index = serial;
      // Primary: tall, its foot under the floor, its back half inside the face.
      const reach = 0.62 + hash(seed, index, 12) * 0.34;
      const primaryHalf = (wall * reach + 1.4) / 2;
      const girth = 2.2 + hash(seed, index, 14) * 1.7;
      place(
        (hash(seed, index, 11) - 0.5) * 1.6,
        cliffFaceDepth(seed, s, perimeter.length, reach * 0.5) + girth * 0.42,
        primaryHalf - 1.4,
        girth,
        primaryHalf,
        girth * (0.8 + hash(seed, index, 16) * 0.4),
      );
      // Crown: two thirds of it inside the plateau, the rest is the skyline.
      const crownHalf = 1.6 + hash(seed, index, 21) * 2.4;
      const crownGirth = 2.4 + hash(seed, index, 22) * 2.2;
      place(
        (hash(seed, index, 23) - 0.5) * 2.4,
        4.2 + hash(seed, index, 24) * 3.2,
        wall - crownHalf * 0.34,
        crownGirth,
        crownHalf,
        crownGirth * (0.8 + hash(seed, index, 25) * 0.5),
      );
      // Seam filler: small, pressed into the face at mid height.
      const seamAt = 0.22 + hash(seed, index, 31) * 0.5;
      const seamSize = 1.0 + hash(seed, index, 32) * 1.1;
      place(
        1.9 + (hash(seed, index, 33) - 0.5) * 1.2,
        cliffFaceDepth(seed, s, perimeter.length, seamAt) + seamSize * 0.3,
        wall * seamAt,
        seamSize * 1.25,
        seamSize,
        seamSize * 1.1,
      );
    }
  }
  return rocks;
}

function pointInPolygon(point: HoardValleyPoint, polygon: readonly HoardValleyPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function buildDressing(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
  low: boolean,
  centerClearHalfWidth: number,
): HoardValleyDressingPlacement[] {
  const polygon = polygonFor(layout);
  const depth = layout.zMax - layout.zMin;
  const target = low ? 10 : Math.min(46, 20 + Math.round(depth / 7));
  const placements: HoardValleyDressingPlacement[] = [];
  // Both presets search the same candidate stream so their first ten hero anchors agree.
  for (let attempt = 0; attempt < 46 * 12 && placements.length < target; attempt++) {
    const z = layout.zMin + 13 + hash(seed, attempt, 31) * Math.max(1, depth - 22);
    const side = hash(seed, attempt, 32) < 0.5 ? -1 : 1;
    const span = hoardValleySpanAtZ(layout, z);
    const halfWidth = (span.maxX - span.minX) * 0.5;
    const center = (span.minX + span.maxX) * 0.5;
    if (halfWidth < centerClearHalfWidth + 3.5) continue;
    const x =
      center +
      side *
        (centerClearHalfWidth +
          2.5 +
          hash(seed, attempt, 33) * Math.max(0.5, halfWidth - centerClearHalfWidth - 5));
    if (!pointInPolygon({ x, z }, polygon)) continue;
    if (Math.hypot(x - layout.dais.x, z - layout.dais.z) < layout.dais.r + 7) continue;
    if (placements.some((other) => Math.hypot(x - other.x, z - other.z) < 3.4)) continue;
    placements.push({
      x,
      y: 0,
      z,
      scale: 0.72 + hash(seed, attempt, 34) * 0.86,
      yaw: hash(seed, attempt, 35) * Math.PI * 2,
      kind: zone.dressing,
    });
  }
  return placements;
}

export function buildHoardValleyPlan(input: {
  layout: HoardValleyLayoutInput;
  zoneId: HoardValleyZoneId;
  seed: number;
  low: boolean;
  /** A boss room's own palette (hoard_room_themes_core.ts) replaces the dig site's. */
  profile?: HoardValleyZoneProfile;
}): HoardValleyPlan {
  const zone = input.profile ?? HOARD_VALLEY_ZONE_PROFILES[input.zoneId];
  const revealZ = hoardValleyRevealZ(input.layout);
  const centerClearHalfWidth = 8;
  return {
    zone,
    outline: polygonFor(input.layout),
    seed: input.seed,
    ground: buildGround(input.layout, zone, input.seed),
    cliffs: buildCliffs(input.layout, zone, input.seed, revealZ),
    dressing: buildDressing(input.layout, zone, input.seed, input.low, centerClearHalfWidth),
    revealZ,
    centerClearHalfWidth,
  };
}

export function isHoardValleyZoneId(value: string): value is HoardValleyZoneId {
  return (HOARD_VALLEY_ZONE_IDS as readonly string[]).includes(value);
}

export function hoardValleyProfile(zoneId: HoardValleyZoneId): HoardValleyZoneProfile {
  return HOARD_VALLEY_ZONE_PROFILES[zoneId];
}
