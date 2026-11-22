// Meadow stones, the pure half: where the small weathered boulders of a
// painterly meadow sit. Cosmetic scatter only (no collision, no sim record):
// shin-high stones a player walks past, the way the art bible's Eastbrook dots
// its fields with dark rounded rocks (docs/design/art-direction.md). The sim's
// own rocks (src/sim/world.ts decorations) are separate and keep their colliders.
//
// Deterministic from the world seed through the same hash grid as the ground
// dressing, and gated by the dressing's filters (hubs, camps, roads, water,
// cuts, slopes), so a stone never lands in a town, on a road or in a lake.
// Three-free so a plain Vitest drives it.

import { getActiveWorldContent, zoneAt } from '../sim/data';
import { roadDistance, terrainCutAtHeight, terrainHeight, WATER_LEVEL } from '../sim/world';
import { hashAt, insideDressingExclusion } from './foliage_core';

/** The zones that grow meadow stones (the art bible's painterly meadow). */
export const MEADOW_STONE_ZONES: ReadonlySet<string> = new Set(['eastbrook_vale']);

/** Grid step in yards and the share of cells that hold a stone. */
export const MEADOW_STONE_STEP = 7;
export const MEADOW_STONE_DENSITY = 0.2;

/** One stone: position, a uniform-ish size, a yaw and one of the shape variants. */
export interface MeadowStone {
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Vertical squash (stones sit low and wide). */
  squash: number;
  yaw: number;
  variant: number;
}

/** How many distinct boulder shapes the painter builds. */
export const MEADOW_STONE_VARIANTS = 3;

const SLOPE_EPS = 1.2;
const MAX_SLOPE = 0.45;

function tooSteep(x: number, z: number, seed: number): boolean {
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * SLOPE_EPS) > MAX_SLOPE;
}

/** Every meadow stone in the active world, in grid order. */
export function generateMeadowStones(seed: number): MeadowStone[] {
  const out: MeadowStone[] = [];
  const content = getActiveWorldContent();
  if (content.decorationsMode === 'empty') return out;
  for (const zone of content.zones) {
    if (!MEADOW_STONE_ZONES.has(zone.id)) continue;
    const xMin = zone.xMin ?? -400;
    const xMax = zone.xMax ?? 400;
    for (
      let gx = Math.ceil(xMin / MEADOW_STONE_STEP) * MEADOW_STONE_STEP;
      gx < xMax;
      gx += MEADOW_STONE_STEP
    ) {
      for (
        let gz = Math.ceil(zone.zMin / MEADOW_STONE_STEP) * MEADOW_STONE_STEP;
        gz < zone.zMax;
        gz += MEADOW_STONE_STEP
      ) {
        if (hashAt(gx, gz, 211) > MEADOW_STONE_DENSITY) continue;
        const x = gx + (hashAt(gx, gz, 212) - 0.5) * MEADOW_STONE_STEP;
        const z = gz + (hashAt(gx, gz, 213) - 0.5) * MEADOW_STONE_STEP;
        if (zoneAt(x, z).id !== zone.id) continue;
        if (insideDressingExclusion(content.zones, content.camps, x, z)) continue;
        if (roadDistance(x, z) < 4.5) continue;
        const h = terrainHeight(x, z, seed);
        if (h < WATER_LEVEL + 1.2) continue;
        if (terrainCutAtHeight(x, z, h)) continue;
        if (tooSteep(x, z, seed)) continue;
        // Mostly knee-high, now and then a bigger boulder, like a painter's field:
        // big enough to show over the meadow grass.
        const big = hashAt(gx, gz, 214) < 0.18;
        const scale = (big ? 1.0 : 0.55) + hashAt(gx, gz, 215) * (big ? 0.45 : 0.3);
        out.push({
          x,
          y: h,
          z,
          scale,
          squash: 0.55 + hashAt(gx, gz, 216) * 0.25,
          yaw: hashAt(gx, gz, 217) * Math.PI * 2,
          variant: Math.floor(hashAt(gx, gz, 218) * MEADOW_STONE_VARIANTS) % MEADOW_STONE_VARIANTS,
        });
      }
    }
  }
  return out;
}
