// Pure core for REMOTE precipitation: the decisions that let a player see a
// neighbouring realm's weather from outside it, not only the weather over
// their own head.
//
// The problem it solves. Weather.ts pools one particle cloud in a box riding
// the camera, and picked its precipitation from the biome under the PLAYER:
// standing in the Amberfall at the Frostveil border, the Frostveil's snow
// simply did not exist until you crossed the line, and then the whole sky
// turned on at once, the same all-at-once swap the biome haze field removed
// from the ground colours.
//
// Two pure decisions fix it, both driven by an injected `biomeAt` sampler so
// a Vitest can drive a synthetic world:
//   - remotePrecipPlan: which precipitation the camera box should run. The
//     player's own biome still wins when it precipitates; otherwise the box is
//     scanned for the nearest weathered cell, so a border vantage runs the
//     neighbour's weather.
//   - precipSpawnXZ: WHERE a particle may (re)spawn. When the plan is remote,
//     every spawn rejection-samples into a cell whose biome carries the mode,
//     so the snow falls over the Frostveil's side of the border and not over
//     the player. Particles drift a few yards across the line before they
//     wrap, which reads as wind, not as a bug.
//
// The per-biome mapping lives here too (extracted from weather.ts) so the
// weather system, the renderer's haze presets (the baked far-range weather
// veil in biome_haze_field_core.ts) and the tests all share one table.

import type { BiomeId } from '../sim/types';

export type PrecipMode = 'snow' | 'rain';

/** Which precipitation a biome carries. The one authoritative table: peaks
 *  and frost snow, marsh and haunt rain, everything else stays clear. */
export function precipForBiome(biome: BiomeId): PrecipMode | null {
  if (biome === 'peaks' || biome === 'frost') return 'snow';
  if (biome === 'marsh' || biome === 'haunt') return 'rain';
  return null;
}

export interface RemotePrecipPlan {
  mode: PrecipMode | null;
  /** True when the biome under the camera itself precipitates: the whole box
   *  qualifies and spawn masking is skipped entirely (the pre-remote fast
   *  path, byte-identical behaviour to the old player-biome rule). */
  local: boolean;
}

/** Samples per axis when scanning the camera box for weathered cells. 7x7
 *  over a 140 yard box is a tap every 20 yards, comfortably inside the
 *  narrowest zone band, and 49 biomeAt taps at the plan cadence is noise. */
export const PRECIP_SCAN_GRID = 7;

/**
 * Which precipitation the camera box should run. Own biome first; otherwise
 * the NEAREST weathered sample in the box wins (nearest, not majority: a
 * sliver of the Frostveil at the box corner should already snow, that is the
 * approach the effect exists for).
 */
export function remotePrecipPlan(
  camX: number,
  camZ: number,
  hx: number,
  hz: number,
  biomeAt: (x: number, z: number) => BiomeId,
): RemotePrecipPlan {
  const own = precipForBiome(biomeAt(camX, camZ));
  if (own) return { mode: own, local: true };
  let mode: PrecipMode | null = null;
  let bestD = Infinity;
  for (let i = 0; i < PRECIP_SCAN_GRID; i++) {
    const x = camX + (((i + 0.5) / PRECIP_SCAN_GRID) * 2 - 1) * hx;
    for (let j = 0; j < PRECIP_SCAN_GRID; j++) {
      const z = camZ + (((j + 0.5) / PRECIP_SCAN_GRID) * 2 - 1) * hz;
      const sample = precipForBiome(biomeAt(x, z));
      if (!sample) continue;
      const d = (x - camX) * (x - camX) + (z - camZ) * (z - camZ);
      if (d < bestD) {
        bestD = d;
        mode = sample;
      }
    }
  }
  return { mode, local: false };
}

/** Rejection-sampling budget per spawn. Ten tries finds a cell in all but the
 *  thinnest slivers; a miss returns null and the caller leaves the particle
 *  where it wrapped (one stray flake near a border, invisible in practice,
 *  and the next wrap tries again). */
export const PRECIP_SPAWN_TRIES = 10;

/**
 * A spawn xz inside the camera box whose biome carries `mode`, or null when
 * the sampling budget misses. `rand01` is the caller's own deterministic rng
 * (weather.ts's mulberry32), so seeding stays in the caller's hands.
 */
export function precipSpawnXZ(
  rand01: () => number,
  camX: number,
  camZ: number,
  hx: number,
  hz: number,
  mode: PrecipMode,
  biomeAt: (x: number, z: number) => BiomeId,
): { x: number; z: number } | null {
  for (let t = 0; t < PRECIP_SPAWN_TRIES; t++) {
    const x = camX + (rand01() * 2 - 1) * hx;
    const z = camZ + (rand01() * 2 - 1) * hz;
    if (precipForBiome(biomeAt(x, z)) === mode) return { x, z };
  }
  return null;
}
