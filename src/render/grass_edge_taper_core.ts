import type { GrassClearCircle } from '../sim/grass_clear';
import type { BuildingDef } from '../sim/types';
import type { EastbrookGrassExclusion } from './foliage_core';

/**
 * Gradual grass edge taper core: computes a smooth [0, 1] height and width
 * taper factor where meadow grass approaches roads, settlement hubs, town
 * exclusions (buildings, market stalls, service aprons, boardwalks, monuments,
 * noticeboards), and painted grass-clear discs.
 *
 * Instead of terminating at full height at a hard exclusion cliff, grass
 * emerges at ankle/stubble height right at the boundary and rises smoothly
 * across the verge band into the full meadow.
 */

/** Inner road clearance (yards from the road centerline) where blade carpet
 *  and band clusters begin emerging along the terrain road verge. */
export const GRASS_ROAD_INNER_RADIUS = 1.95;

/** Width of the road verge taper band (yards) over which grass rises from
 *  its minimum verge height to full meadow height. */
export const GRASS_ROAD_TAPER_SPAN = 3.6;

/** Inner hub clearing radius (yards from a zone hub center) where blade carpet
 *  and band clusters begin emerging at the edge of the packed hub dirt. */
export const GRASS_HUB_INNER_RADIUS = 13.2;

/** Width of the settlement hub taper band (yards) over which grass rises from
 *  its minimum verge height to full meadow height. */
export const GRASS_HUB_TAPER_SPAN = 5.8;

/** Width of the taper band (yards) outside town exclusions, building
 *  footprints, and painted grass-clear discs. */
export const GRASS_EXCLUSION_TAPER_SPAN = 2.8;

/** Minimum vertical height scale multiplier at the inner edge (taper = 0). */
export const GRASS_EDGE_MIN_HEIGHT_SCALE = 0.14;

/** Minimum horizontal cluster width scale multiplier at the inner edge (taper = 0). */
export const GRASS_EDGE_MIN_WIDTH_SCALE = 0.58;

/** Minimum coverage multiplier at the inner edge (taper = 0) so the very toe
 *  of the verge feathers out in density rather than forming a rigid line. */
export const GRASS_EDGE_MIN_COVERAGE_SCALE = 0.55;

const BUCKET_SIZE = 32;

interface PreparedCircleExclusion {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly innerRadius: number;
}

interface PreparedObbExclusion {
  readonly kind: 'obb';
  readonly x: number;
  readonly z: number;
  readonly padHalfW: number;
  readonly padHalfD: number;
  readonly cos: number;
  readonly sin: number;
}

type PreparedExclusion = PreparedCircleExclusion | PreparedObbExclusion;

export interface GrassEdgeTaperContext {
  readonly zones: readonly { hub: { x: number; z: number } }[];
  readonly townExclusions: readonly EastbrookGrassExclusion[];
  readonly buildings: readonly BuildingDef[];
  readonly grassClear: readonly GrassClearCircle[] | undefined;
  readonly buildingPadding: number;
  readonly roadInnerRadius: number;
  readonly hubInnerRadius: number;
  readonly buckets: ReadonlyMap<number, readonly PreparedExclusion[]>;
}

function packBucketKey(bx: number, bz: number): number {
  return ((bx & 0xffff) << 16) | (bz & 0xffff);
}

function insertIntoBuckets(
  buckets: Map<number, PreparedExclusion[]>,
  item: PreparedExclusion,
  reach: number,
): void {
  const minBx = Math.floor((item.x - reach) / BUCKET_SIZE);
  const maxBx = Math.floor((item.x + reach) / BUCKET_SIZE);
  const minBz = Math.floor((item.z - reach) / BUCKET_SIZE);
  const maxBz = Math.floor((item.z + reach) / BUCKET_SIZE);
  for (let bx = minBx; bx <= maxBx; bx++) {
    for (let bz = minBz; bz <= maxBz; bz++) {
      const key = packBucketKey(bx, bz);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(item);
    }
  }
}

export function createGrassEdgeTaperContext(
  zones: readonly { hub: { x: number; z: number } }[],
  townExclusions: readonly EastbrookGrassExclusion[],
  buildings: readonly BuildingDef[],
  grassClear: readonly GrassClearCircle[] | undefined,
  buildingPadding = 0.85,
  roadInnerRadius = GRASS_ROAD_INNER_RADIUS,
  hubInnerRadius = GRASS_HUB_INNER_RADIUS,
): GrassEdgeTaperContext {
  const buckets = new Map<number, PreparedExclusion[]>();
  const span = GRASS_EXCLUSION_TAPER_SPAN;

  for (let i = 0; i < townExclusions.length; i++) {
    const ex = townExclusions[i];
    if (ex.kind === 'circle') {
      const innerRadius = ex.radius + buildingPadding;
      insertIntoBuckets(
        buckets,
        { kind: 'circle', x: ex.x, z: ex.z, innerRadius },
        innerRadius + span,
      );
    } else {
      const padHalfW = ex.halfWidth + buildingPadding;
      const padHalfD = ex.halfDepth + buildingPadding;
      insertIntoBuckets(
        buckets,
        {
          kind: 'obb',
          x: ex.x,
          z: ex.z,
          padHalfW,
          padHalfD,
          cos: Math.cos(ex.rotation),
          sin: Math.sin(ex.rotation),
        },
        Math.hypot(padHalfW, padHalfD) + span,
      );
    }
  }

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const padHalfW = b.w * 0.5 + 0.85;
    const padHalfD = b.d * 0.5 + 0.85;
    insertIntoBuckets(
      buckets,
      {
        kind: 'obb',
        x: b.x,
        z: b.z,
        padHalfW,
        padHalfD,
        cos: Math.cos(b.rot),
        sin: Math.sin(b.rot),
      },
      Math.hypot(padHalfW, padHalfD) + span,
    );
  }

  if (grassClear) {
    for (let i = 0; i < grassClear.length; i++) {
      const c = grassClear[i];
      insertIntoBuckets(buckets, { kind: 'circle', x: c.x, z: c.z, innerRadius: c.r }, c.r + span);
    }
  }

  return {
    zones,
    townExclusions,
    buildings,
    grassClear,
    buildingPadding,
    roadInnerRadius,
    hubInnerRadius,
    buckets,
  };
}

export function createWorldGrassEdgeTaperContext(
  content: {
    readonly zones: readonly { hub: { x: number; z: number } }[];
    readonly props: { readonly buildings: readonly BuildingDef[] };
    readonly grassClear?: readonly GrassClearCircle[];
  },
  townExclusions: readonly EastbrookGrassExclusion[],
  buildingPadding = 0.85,
  roadInnerRadius = GRASS_ROAD_INNER_RADIUS,
  hubInnerRadius = GRASS_HUB_INNER_RADIUS,
): GrassEdgeTaperContext {
  return createGrassEdgeTaperContext(
    content.zones,
    townExclusions,
    content.props.buildings,
    content.grassClear,
    buildingPadding,
    roadInnerRadius,
    hubInnerRadius,
  );
}

const tuftScaleScratch: [number, number] = [1, 1];

/** Apply edge width and height taper to a card-tuft instance's scale. */
export function taperTuftScales(
  ctx: GrassEdgeTaperContext,
  x: number,
  z: number,
  roadDist: number,
  r: number,
  lush: boolean,
  lushness: number,
  out: [number, number] = tuftScaleScratch,
): [number, number] {
  const baseSx = ((lush ? 0.74 : 0.82) + r * (lush ? 0.96 : 1.04)) * (0.75 + lushness * 0.55);
  const taper = grassEdgeTaperAt(ctx, x, z, roadDist);
  out[0] = baseSx * grassEdgeWidthScale(taper);
  out[1] = baseSx * (0.75 + lushness * 0.25) * grassEdgeHeightScale(taper);
  return out;
}

export function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Smooth [0, 1] taper factor from distance to the nearest road centerline. */
export function roadEdgeTaper(
  roadDist: number,
  innerRadius = GRASS_ROAD_INNER_RADIUS,
  span = GRASS_ROAD_TAPER_SPAN,
): number {
  if (roadDist <= innerRadius) return 0;
  if (span <= 0 || roadDist >= innerRadius + span) return 1;
  return smoothstep01((roadDist - innerRadius) / span);
}

/** Smooth [0, 1] taper factor from distance to the nearest zone hub center. */
export function hubEdgeTaper(
  zones: readonly { hub: { x: number; z: number } }[],
  x: number,
  z: number,
  innerRadius = GRASS_HUB_INNER_RADIUS,
  span = GRASS_HUB_TAPER_SPAN,
): number {
  if (span <= 0) return 1;
  const outer = innerRadius + span;
  const outerSq = outer * outer;
  const innerSq = innerRadius * innerRadius;
  let minDistSq = outerSq;
  for (let i = 0; i < zones.length; i++) {
    const hub = zones[i].hub;
    const dx = x - hub.x;
    const dz = z - hub.z;
    if (Math.abs(dx) >= outer || Math.abs(dz) >= outer) continue;
    const dSq = dx * dx + dz * dz;
    if (dSq <= innerSq) return 0;
    if (dSq < minDistSq) minDistSq = dSq;
  }
  if (minDistSq >= outerSq) return 1;
  return smoothstep01((Math.sqrt(minDistSq) - innerRadius) / span);
}

/** Smooth [0, 1] taper factor outside town exclusions (OBBs and circles). */
export function townExclusionEdgeTaper(
  exclusions: readonly EastbrookGrassExclusion[],
  x: number,
  z: number,
  padding: number,
  span = GRASS_EXCLUSION_TAPER_SPAN,
): number {
  if (span <= 0 || exclusions.length === 0) return 1;
  let minClear = span;
  for (let i = 0; i < exclusions.length; i++) {
    const ex = exclusions[i];
    const dx = x - ex.x;
    const dz = z - ex.z;
    if (ex.kind === 'circle') {
      const inner = ex.radius + padding;
      const outer = inner + minClear;
      if (Math.abs(dx) >= outer || Math.abs(dz) >= outer) continue;
      const dSq = dx * dx + dz * dz;
      if (dSq >= outer * outer) continue;
      if (dSq <= inner * inner) return 0;
      const clear = Math.sqrt(dSq) - inner;
      if (clear < minClear) minClear = clear;
      continue;
    }
    const padHalfW = ex.halfWidth + padding;
    const padHalfD = ex.halfDepth + padding;
    const maxSpan = padHalfW + padHalfD + minClear;
    if (Math.abs(dx) >= maxSpan || Math.abs(dz) >= maxSpan) continue;
    const cos = Math.cos(ex.rotation);
    const sin = Math.sin(ex.rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const qx = Math.abs(localX) - padHalfW;
    const qz = Math.abs(localZ) - padHalfD;
    if (qx >= minClear || qz >= minClear) continue;
    if (qx <= 0 && qz <= 0) return 0;
    const clear = qx > 0 && qz > 0 ? Math.hypot(qx, qz) : Math.max(qx, qz);
    if (clear < minClear) minClear = clear;
  }
  if (minClear >= span) return 1;
  return smoothstep01(minClear / span);
}

/** Smooth [0, 1] taper factor outside placed building footprints. */
export function buildingFootprintEdgeTaper(
  buildings: readonly BuildingDef[],
  x: number,
  z: number,
  padding: number,
  span = GRASS_EXCLUSION_TAPER_SPAN,
): number {
  if (span <= 0 || buildings.length === 0) return 1;
  let minClear = span;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const dx = x - b.x;
    const dz = z - b.z;
    const padHalfW = b.w * 0.5 + padding;
    const padHalfD = b.d * 0.5 + padding;
    const maxSpan = padHalfW + padHalfD + minClear;
    if (Math.abs(dx) >= maxSpan || Math.abs(dz) >= maxSpan) continue;
    const cos = Math.cos(b.rot);
    const sin = Math.sin(b.rot);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const qx = Math.abs(localX) - padHalfW;
    const qz = Math.abs(localZ) - padHalfD;
    if (qx >= minClear || qz >= minClear) continue;
    if (qx <= 0 && qz <= 0) return 0;
    const clear = qx > 0 && qz > 0 ? Math.hypot(qx, qz) : Math.max(qx, qz);
    if (clear < minClear) minClear = clear;
  }
  if (minClear >= span) return 1;
  return smoothstep01(minClear / span);
}

/** Smooth [0, 1] taper factor outside painted grass-clear discs. */
export function grassClearEdgeTaper(
  regions: readonly GrassClearCircle[] | undefined,
  x: number,
  z: number,
  span = GRASS_EXCLUSION_TAPER_SPAN,
): number {
  if (!regions || regions.length === 0 || span <= 0) return 1;
  let minClear = span;
  for (let i = 0; i < regions.length; i++) {
    const c = regions[i];
    const dx = x - c.x;
    const dz = z - c.z;
    const outer = c.r + minClear;
    if (Math.abs(dx) >= outer || Math.abs(dz) >= outer) continue;
    const dSq = dx * dx + dz * dz;
    if (dSq >= outer * outer) continue;
    if (dSq <= c.r * c.r) return 0;
    const clear = Math.sqrt(dSq) - c.r;
    if (clear < minClear) minClear = clear;
  }
  if (minClear >= span) return 1;
  return smoothstep01(minClear / span);
}

function preparedBucketEdgeTaper(
  buckets: ReadonlyMap<number, readonly PreparedExclusion[]>,
  x: number,
  z: number,
  span: number,
): number {
  const list = buckets.get(packBucketKey(Math.floor(x / BUCKET_SIZE), Math.floor(z / BUCKET_SIZE)));
  if (!list) return 1;
  let minClear = span;
  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    const dx = x - ex.x;
    const dz = z - ex.z;
    if (ex.kind === 'circle') {
      const outer = ex.innerRadius + minClear;
      if (Math.abs(dx) >= outer || Math.abs(dz) >= outer) continue;
      const dSq = dx * dx + dz * dz;
      if (dSq >= outer * outer) continue;
      if (dSq <= ex.innerRadius * ex.innerRadius) return 0;
      const clear = Math.sqrt(dSq) - ex.innerRadius;
      if (clear < minClear) minClear = clear;
      continue;
    }
    const maxSpan = ex.padHalfW + ex.padHalfD + minClear;
    if (Math.abs(dx) >= maxSpan || Math.abs(dz) >= maxSpan) continue;
    const localX = dx * ex.cos - dz * ex.sin;
    const localZ = dx * ex.sin + dz * ex.cos;
    const qx = Math.abs(localX) - ex.padHalfW;
    const qz = Math.abs(localZ) - ex.padHalfD;
    if (qx >= minClear || qz >= minClear) continue;
    if (qx <= 0 && qz <= 0) return 0;
    const clear = qx > 0 && qz > 0 ? Math.hypot(qx, qz) : Math.max(qx, qz);
    if (clear < minClear) minClear = clear;
  }
  if (minClear >= span) return 1;
  return smoothstep01(minClear / span);
}

/** Combined [0, 1] edge taper across road, hub, town, building, and grass-clear boundaries. */
export function grassEdgeTaperAt(
  ctx: GrassEdgeTaperContext,
  x: number,
  z: number,
  roadDist: number,
): number {
  let taper = roadEdgeTaper(roadDist, ctx.roadInnerRadius);
  if (taper <= 0) return 0;
  const hubT = hubEdgeTaper(ctx.zones, x, z, ctx.hubInnerRadius);
  if (hubT < taper) {
    taper = hubT;
    if (taper <= 0) return 0;
  }
  const bucketT = preparedBucketEdgeTaper(ctx.buckets, x, z, GRASS_EXCLUSION_TAPER_SPAN);
  if (bucketT < taper) taper = bucketT;
  return taper;
}

/** Vertical height scale multiplier in [GRASS_EDGE_MIN_HEIGHT_SCALE, 1]. */
export function grassEdgeHeightScale(taper: number): number {
  const u = taper <= 0 ? 0 : taper >= 1 ? 1 : taper;
  return GRASS_EDGE_MIN_HEIGHT_SCALE + (1 - GRASS_EDGE_MIN_HEIGHT_SCALE) * u;
}

/** Horizontal cluster width scale multiplier in [GRASS_EDGE_MIN_WIDTH_SCALE, 1]. */
export function grassEdgeWidthScale(taper: number): number {
  const u = taper <= 0 ? 0 : taper >= 1 ? 1 : taper;
  return GRASS_EDGE_MIN_WIDTH_SCALE + (1 - GRASS_EDGE_MIN_WIDTH_SCALE) * Math.sqrt(u);
}

/** Coverage multiplier in [GRASS_EDGE_MIN_COVERAGE_SCALE, 1] for the outer toe of a verge. */
export function grassEdgeCoverageScale(taper: number): number {
  return (
    GRASS_EDGE_MIN_COVERAGE_SCALE + (1 - GRASS_EDGE_MIN_COVERAGE_SCALE) * smoothstep01(taper / 0.35)
  );
}
