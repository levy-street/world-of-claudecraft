import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { roadDistance, terrainHeight, waterLevel } from '../sim/world';

// Cliff-scree placement for the renderer's moving detail grid. The rocks are
// tier-gated, walk-through visual dressing, so this policy belongs render-side
// and deliberately does not alter groundHeight or deterministic simulation.

// Placement tunables. These MUST stay identical to the renderer's read of
// them (it imports from here); re-tuning them re-seats every boulder.
export const SCREE_CELL = 6.5; // yards between candidate spots
const PROBE = 1.5; // relief probe reach
const SLOPE_MIN = 0.45; // height delta over PROBE where the cliff band starts
const SLOPE_MAX = 1.6; // past this the face is a sheer smear: rocks would float
const APRON_ELIGIBLE = 0.12; // minimum local incline for cliff-base rubble
const APRON_PROBE = 3; // how far uphill the apron looks for its cliff
const CLIFF_DENSITY = 0.65; // hash acceptance inside the band
const APRON_DENSITY = 0.4; // sparser rubble below it
export const SCREE_SINK = 0.15; // fraction of rock height buried in the ground
const EDGE = 16; // keep-out margin from the world rectangle
const HUB_EXCLUSION_RADIUS = 15; // same radius the grass hub exclusion uses

// Kit rock dimensions at scale 1, baked from the shipped GLBs
// (models/foliage/rock_1..3) via gltf-transform getBounds, kept constant so the
// renderer never parses a model just to recover bounds. The painter derives
// its origin sink from these same rows.
export const SCREE_ROCK_DIMS = [
  { minY: -0.271, maxY: 1.989 },
  { minY: -0.051, maxY: 1.848 },
  { minY: -0.316, maxY: 2.001 },
] as const;

/** Origin y-offset that buries SCREE_SINK of the rock's height at scale 1. */
export function screeSinkY(variant: number): number {
  const d = SCREE_ROCK_DIMS[variant];
  return d.minY + (d.maxY - d.minY) * SCREE_SINK;
}

export interface ScreeSpot {
  x: number;
  z: number;
  /** terrain height at the spot centre */
  baseY: number;
  variant: number;
  scale: number;
  apron: boolean;
  yaw: number;
  /** downhill gradient at the spot (unnormalised), for the visual settle-lean */
  gx: number;
  gz: number;
  /** local relief at the spot, for the visual lean strength */
  slope: number;
}

/**
 * Pack live scree matrices by variant while retaining ascending source-slot
 * order. Empty slots use variant -1. The destination arrays are the backing
 * stores of the three InstancedMeshes, so lowering mesh.count removes empty
 * instances without changing any submitted matrix bytes or live ordering.
 */
export function compactScreeMatrices(
  slotVariants: Int8Array,
  slotMatrices: Float32Array,
  variantMatrices: readonly Float32Array[],
  counts: Uint16Array,
): Uint16Array {
  counts.fill(0);
  for (let slot = 0; slot < slotVariants.length; slot++) {
    const variant = slotVariants[slot];
    if (variant < 0) continue;
    const target = variantMatrices[variant];
    const denseIndex = counts[variant]++;
    const sourceOffset = slot * 16;
    const targetOffset = denseIndex * 16;
    for (let component = 0; component < 16; component++) {
      target[targetOffset + component] = slotMatrices[sourceOffset + component];
    }
  }
  return counts;
}

const hash = (i: number, j: number, k: number): number => {
  let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function computeSpot(seed: number, ci: number, cj: number): ScreeSpot | null {
  const r1 = hash(ci, cj, 1);
  // density gate up front: the cheapest reject, and APRON_DENSITY sits
  // under CLIFF_DENSITY so a cell that fails here can never place at all
  if (r1 >= CLIFF_DENSITY) return null;
  const x = ci * SCREE_CELL + (hash(ci, cj, 2) - 0.5) * SCREE_CELL * 0.9;
  const z = cj * SCREE_CELL + (hash(ci, cj, 3) - 0.5) * SCREE_CELL * 0.9;
  if (Math.abs(x) > WORLD_MAX_X - EDGE || z < WORLD_MIN_Z + EDGE || z > WORLD_MAX_Z - EDGE) {
    return null;
  }
  const h = terrainHeight(x, z, seed);
  if (h < waterLevel() + 0.5) return null; // shorelines keep their own dressing
  // local relief: max height delta over four short probes, the same signal
  // the terrain shader's slope treatment keys from
  const hE = terrainHeight(x + PROBE, z, seed);
  const hW = terrainHeight(x - PROBE, z, seed);
  const hS = terrainHeight(x, z + PROBE, seed);
  const hN = terrainHeight(x, z - PROBE, seed);
  const slope = Math.max(Math.abs(hE - h), Math.abs(hW - h), Math.abs(hS - h), Math.abs(hN - h));
  if (slope > SLOPE_MAX) return null;
  // uphill direction from the probe stencil; doubles as the lean direction
  const gx = hE - hW;
  const gz = hS - hN;
  const glen = Math.hypot(gx, gz);
  let apron = false;
  if (slope < SLOPE_MIN) {
    // Scree apron: a moderate incline directly below a cliff collects its
    // fallen rock. Probe uphill and require a genuine band there; flats
    // and gentle meadows (no meaningful gradient) never qualify.
    if (slope < APRON_ELIGIBLE || glen < 1e-4 || r1 >= APRON_DENSITY) return null;
    const ux = x + (gx / glen) * APRON_PROBE;
    const uz = z + (gz / glen) * APRON_PROBE;
    const uh = terrainHeight(ux, uz, seed);
    const uSlope = Math.max(
      Math.abs(terrainHeight(ux + PROBE, uz, seed) - uh),
      Math.abs(terrainHeight(ux - PROBE, uz, seed) - uh),
      Math.abs(terrainHeight(ux, uz + PROBE, seed) - uh),
      Math.abs(terrainHeight(ux, uz - PROBE, seed) - uh),
    );
    if (uSlope < SLOPE_MIN || uSlope > SLOPE_MAX) return null;
    apron = true;
  }
  if (roadDistance(x, z) < 3) return null;
  for (const zone of getActiveWorldContent().zones) {
    const dx = x - zone.hub.x;
    const dz = z - zone.hub.z;
    if (dx * dx + dz * dz < HUB_EXCLUSION_RADIUS * HUB_EXCLUSION_RADIUS) return null;
  }
  const variant = Math.min(
    SCREE_ROCK_DIMS.length - 1,
    Math.floor(hash(ci, cj, 4) * SCREE_ROCK_DIMS.length),
  );
  // Tier-gated dressing has no collider, so it must remain visibly small
  // enough to read as loose walk-through rubble rather than as a wall.
  const scale = apron ? 0.25 + hash(ci, cj, 5) * 0.2 : 0.3 + hash(ci, cj, 5) * 0.25;
  const yaw = hash(ci, cj, 6) * Math.PI * 2;
  return {
    x,
    z,
    baseY: h,
    variant,
    scale,
    apron,
    yaw,
    gx,
    gz,
    slope,
  };
}

export function screeSpotAt(seed: number, ci: number, cj: number): ScreeSpot | null {
  return computeSpot(seed, ci, cj);
}

/** Every spot whose centre lies inside the bounds (renderer/tools/tests). */
export function screeSpotsInBounds(
  seed: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): ScreeSpot[] {
  const out: ScreeSpot[] = [];
  for (
    let cj = Math.floor(bounds.minZ / SCREE_CELL);
    cj <= Math.ceil(bounds.maxZ / SCREE_CELL);
    cj++
  ) {
    for (
      let ci = Math.floor(bounds.minX / SCREE_CELL);
      ci <= Math.ceil(bounds.maxX / SCREE_CELL);
      ci++
    ) {
      const spot = screeSpotAt(seed, ci, cj);
      if (!spot) continue;
      if (
        spot.x >= bounds.minX &&
        spot.x < bounds.maxX &&
        spot.z >= bounds.minZ &&
        spot.z < bounds.maxZ
      ) {
        out.push(spot);
      }
    }
  }
  return out;
}
