// The Quartered Isle's position-dependent ground palette. The isle is one
// biome ('quartered'), but its four war-scarred quarters must read as four
// places that bleed into one another rather than one flat tint, so its five
// ground tones are a blend of four sub-palettes weighted by the shared
// quarter field (src/sim/quartered_quarters.ts quarterWeightsAt).
//
// Pure core: no Three, no DOM, no clock. BOTH terrain tiers call it from
// their strip-palette lookup (terrain_chunk_build.ts paletteAt for the near
// chunks, far_terrain_core.ts farPaletteAt for the far vista), so the two
// can never drift. The blend is done in linear light, the space both tiers
// already blend their zone palettes in (THREE.Color under ColorManagement on
// the near side, srgbHexToLinear on the far side).
//
// Cosmetic only: the ground tint carries no gameplay information, and it is
// identical on every graphics tier.

import { CHALLENGERS_RING } from '../sim/quartered_isle_terrain';
import {
  QUARTERED_LANDMARK_BOUNDS,
  type QuarteredLandmarkTint,
  quarteredLandmarkTint,
} from '../sim/quartered_landmarks';
import { type QuarterId, type QuarterWeights, quarterWeightsAt } from '../sim/quartered_quarters';
import type { BiomeId } from '../sim/types';
import { groundPaletteOverrideTable } from './ground_palette_override_core';

export type GroundTriple = [number, number, number];

/** The five ground tones, as sRGB hex (BIOME_PALETTE's shape). */
export interface QuarterGroundHexes {
  readonly grass: number;
  readonly grassDark: number;
  readonly grassYellow: number;
  readonly dirt: number;
  readonly sand: number;
}

/** The five ground tones as linear-light triples, written in place. */
export interface QuarterGroundLinear {
  grass: GroundTriple;
  grassDark: GroundTriple;
  grassYellow: GroundTriple;
  dirt: GroundTriple;
  sand: GroundTriple;
}

const TONES = ['grass', 'grassDark', 'grassYellow', 'dirt', 'sand'] as const;
const QUARTERS: readonly QuarterId[] = ['ice', 'fire', 'earth', 'wind'];

/** Each quarter's own ground. */
export const QUARTER_GROUND_PALETTES: Readonly<Record<QuarterId, QuarterGroundHexes>> = {
  // the Hoarshelf: snowfields under a cold blue cast (the frost inspiration:
  // snow-capped dark rock over still dark water), dark wet rock on the worn
  // ground
  ice: {
    grass: 0xc6dcea,
    grassDark: 0x8ea8c0,
    grassYellow: 0xd8e8f4,
    dirt: 0x48586a,
    sand: 0xb0c6d8,
  },
  // the Cinderscar: red-hot terracotta ground (the fire inspiration), darker
  // where it is scorched and brighter where it catches the melt's glow (the
  // lava itself fills the fissures)
  fire: {
    grass: 0x8e3a26,
    grassDark: 0x5c2218,
    grassYellow: 0xb24e2c,
    dirt: 0x702a1c,
    sand: 0x844034,
  },
  // the Heavestone Wilds: warm wind-rippled sand round stacked sandstone
  // outcrops (the earth inspiration), no green left
  earth: {
    grass: 0xc8925a,
    grassDark: 0xa07040,
    grassYellow: 0xdcac6e,
    dirt: 0x9a6a40,
    sand: 0xd2a066,
  },
  // the Gyre: barren storm-scoured slate
  wind: {
    grass: 0x6a7478,
    grassDark: 0x4a5458,
    grassYellow: 0x8e9690,
    dirt: 0x5e5c5a,
    sand: 0x6a6c6a,
  },
};

/** Each quarter's cliff stone: the colour a steep face takes over the
 *  terrain's own slope rock, so the quarters' crags read as the inspiration's
 *  stone (pale blue-grey columns, dark snowy rock, sandstone, slate). */
export const QUARTER_CLIFF_HEX: Readonly<Record<QuarterId, number>> = {
  ice: 0x4e5c6e,
  fire: 0x6c7288,
  earth: 0xb07448,
  wind: 0x6a7074,
};

/** The share of the terrain's slope rock a quartered cliff tint replaces. */
export const QUARTER_CLIFF_SHARE = 0.85;

/** The share of the slope's rock photo layer a quartered crag keeps on the
 *  textured tier. That layer takes only a third of the ground tint, so at full
 *  weight every crag on the isle drew as the same pale grey stone whatever its
 *  quarter; held to this share, the face shows its quarter's stone with the
 *  photo's grain breaking it up. */
export const QUARTER_CLIFF_ROCK_SPLAT = 0.3;

/** The blended cliff stone at (x, z) as a linear-light triple, written into
 *  `out` (weighted by the quarter field like the ground). */
export function quarteredCliffAt(x: number, z: number, out: GroundTriple): GroundTriple {
  const w = sharpenQuarterWeights(quarterWeightsAt(x, z));
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (const q of QUARTERS) {
    const c = CLIFF_LINEAR[q];
    out[0] += c[0] * w[q];
    out[1] += c[1] * w[q];
    out[2] += c[2] * w[q];
  }
  return out;
}

/** sRGB hex to a linear-light triple (the same transfer far_terrain_core.ts
 *  srgbHexToLinear and THREE.Color.setHex apply). */
export function quarterHexToLinear(hex: number): GroundTriple {
  const conv = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [conv((hex >> 16) & 0xff), conv((hex >> 8) & 0xff), conv(hex & 0xff)];
}

// The four sub-palettes converted once, at module load.
const LINEAR: Readonly<Record<QuarterId, Readonly<Record<(typeof TONES)[number], GroundTriple>>>> =
  {
    ice: toLinear(QUARTER_GROUND_PALETTES.ice),
    fire: toLinear(QUARTER_GROUND_PALETTES.fire),
    earth: toLinear(QUARTER_GROUND_PALETTES.earth),
    wind: toLinear(QUARTER_GROUND_PALETTES.wind),
  };

const CLIFF_LINEAR: Readonly<Record<QuarterId, GroundTriple>> = {
  ice: quarterHexToLinear(QUARTER_CLIFF_HEX.ice),
  fire: quarterHexToLinear(QUARTER_CLIFF_HEX.fire),
  earth: quarterHexToLinear(QUARTER_CLIFF_HEX.earth),
  wind: quarterHexToLinear(QUARTER_CLIFF_HEX.wind),
};

function toLinear(p: QuarterGroundHexes): Record<(typeof TONES)[number], GroundTriple> {
  return {
    grass: quarterHexToLinear(p.grass),
    grassDark: quarterHexToLinear(p.grassDark),
    grassYellow: quarterHexToLinear(p.grassYellow),
    dirt: quarterHexToLinear(p.dirt),
    sand: quarterHexToLinear(p.sand),
  };
}

/** A fresh zeroed output palette (allocate once, reuse in hot loops). */
export function makeQuarterGroundLinear(): QuarterGroundLinear {
  return {
    grass: [0, 0, 0],
    grassDark: [0, 0, 0],
    grassYellow: [0, 0, 0],
    dirt: [0, 0, 0],
    sand: [0, 0, 0],
  };
}

/** Blend the four sub-palettes by `w` (weights summing to 1) into `out`. */
export function blendQuarterGround(
  w: QuarterWeights,
  out: QuarterGroundLinear,
): QuarterGroundLinear {
  for (const tone of TONES) {
    const o = out[tone];
    o[0] = 0;
    o[1] = 0;
    o[2] = 0;
    for (const q of QUARTERS) {
      const k = w[q];
      if (k <= 0) continue;
      const c = LINEAR[q][tone];
      o[0] += c[0] * k;
      o[1] += c[1] * k;
      o[2] += c[2] * k;
    }
  }
  return out;
}

/** True when a zone's ground should blend by quarter: its biome is the
 *  Quartered Isle's and no palette-lab override is active for it (a lab look
 *  replaces the blend with its one flat row, the way it does for every other
 *  zone). */
export function quarteredBlendActive(zoneId: string, biome: BiomeId): boolean {
  return biome === 'quartered' && !groundPaletteOverrideTable()?.[zoneId];
}

/** The landmark surfaces laid over the quarter blend where a landmark's
 *  ground shows (sim/quartered_landmarks.ts quarteredLandmarkTint): the
 *  frozen lakes' deep clear ice (under the ice sheet the landmark dressing
 *  lays on each, so the lake reads as blue depth through glass) and the
 *  crevasses' blue, the burnways' ember beds, the
 *  Glassfield's dark glass with its white-gold sheen, the Hammer's Cut and
 *  the Heaved Slabs' bare ochre stone, and the Fireice Rift's basalt walls. */
type SurfaceKey = Exclude<keyof QuarteredLandmarkTint, 'fissure'>;
export const LANDMARK_GROUND_PALETTES: Readonly<Record<SurfaceKey, QuarterGroundHexes>> = {
  ice: {
    grass: 0x6cb4d6,
    grassDark: 0x3a82b2,
    grassYellow: 0x9cd6ec,
    dirt: 0x2e6c98,
    sand: 0x84c4de,
  },
  ember: {
    grass: 0xe2602a,
    grassDark: 0x8a2a14,
    grassYellow: 0xffb050,
    dirt: 0x5a2414,
    sand: 0xff8c3a,
  },
  // (the sheen tone is kept dark: at a bright gold it took over the whole
  // field on the textured tier and the glass read as khaki mud)
  glass: {
    grass: 0x2a2a38,
    grassDark: 0x1a1a24,
    grassYellow: 0x4c4862,
    dirt: 0x343044,
    sand: 0x3c3a50,
  },
  stone: {
    grass: 0xb07a44,
    grassDark: 0x8a5a34,
    grassYellow: 0xc89a5a,
    dirt: 0x7a5030,
    sand: 0xd0a874,
  },
  basalt: {
    grass: 0x3a3634,
    grassDark: 0x2a2624,
    grassYellow: 0x5a4a40,
    dirt: 0x302a28,
    sand: 0x4a4440,
  },
  // worn flagstone, a cool mid grey: paler than the crater's basalt and
  // unlike any quarter's own ground, so the town reads as laid stone (a warm
  // grey read as the Wilds' sand under the isle's light)
  moot: {
    grass: 0x74777e,
    grassDark: 0x54575e,
    grassYellow: 0x8a8d94,
    dirt: 0x4c4f56,
    sand: 0x82858c,
  },
};
const LANDMARK_KEYS: readonly SurfaceKey[] = ['ice', 'ember', 'glass', 'stone', 'basalt', 'moot'];
const LANDMARK_LINEAR = {
  ice: toLinear(LANDMARK_GROUND_PALETTES.ice),
  ember: toLinear(LANDMARK_GROUND_PALETTES.ember),
  glass: toLinear(LANDMARK_GROUND_PALETTES.glass),
  stone: toLinear(LANDMARK_GROUND_PALETTES.stone),
  basalt: toLinear(LANDMARK_GROUND_PALETTES.basalt),
  moot: toLinear(LANDMARK_GROUND_PALETTES.moot),
};
const tintScratch: QuarteredLandmarkTint = {
  fissure: 0,
  ice: 0,
  ember: 0,
  glass: 0,
  stone: 0,
  basalt: 0,
  moot: 0,
};

/** The shattered ground's fissure floors, one per quarter, blended by the
 *  same quarter weights as the ground: molten orange and red down the
 *  Cinderscar's cracks (its walls glow round the lava sheet laid in them),
 *  deep glacial blue in the Hoarshelf's, dark umber raw earth in the Wilds',
 *  violet storm-light in the Gyre's (the design's key art). */
export const FISSURE_GROUND_PALETTES: Readonly<Record<QuarterId, QuarterGroundHexes>> = {
  ice: {
    grass: 0x1e5088,
    grassDark: 0x0e2c56,
    grassYellow: 0x4a92c8,
    dirt: 0x163c6a,
    sand: 0x2e6ca4,
  },
  fire: {
    grass: 0xf05a14,
    grassDark: 0xa82808,
    grassYellow: 0xffb040,
    dirt: 0xd0400e,
    sand: 0xff8a2a,
  },
  earth: {
    grass: 0x4a3420,
    grassDark: 0x2a1c12,
    grassYellow: 0x6a4c2c,
    dirt: 0x3a2818,
    sand: 0x5a4430,
  },
  wind: {
    grass: 0x5a4a8a,
    grassDark: 0x2a2448,
    grassYellow: 0xa898e0,
    dirt: 0x3a3262,
    sand: 0x7a6cb0,
  },
};
const FISSURE_LINEAR: Readonly<
  Record<QuarterId, Readonly<Record<(typeof TONES)[number], GroundTriple>>>
> = {
  ice: toLinear(FISSURE_GROUND_PALETTES.ice),
  fire: toLinear(FISSURE_GROUND_PALETTES.fire),
  earth: toLinear(FISSURE_GROUND_PALETTES.earth),
  wind: toLinear(FISSURE_GROUND_PALETTES.wind),
};
const fissureScratch = makeQuarterGroundLinear();

/** Lay the quarter-coloured fissure floor over a palette by `k`. */
export function overlayFissureGround(
  w: QuarterWeights,
  k: number,
  out: QuarterGroundLinear,
): QuarterGroundLinear {
  if (k <= 0) return out;
  for (const tone of TONES) {
    const f = fissureScratch[tone];
    f[0] = 0;
    f[1] = 0;
    f[2] = 0;
    for (const q of QUARTERS) {
      const wq = w[q];
      if (wq <= 0) continue;
      const c = FISSURE_LINEAR[q][tone];
      f[0] += c[0] * wq;
      f[1] += c[1] * wq;
      f[2] += c[2] * wq;
    }
    const o = out[tone];
    o[0] += (f[0] - o[0]) * k;
    o[1] += (f[1] - o[1]) * k;
    o[2] += (f[2] - o[2]) * k;
  }
  return out;
}

/** Lay the landmark surfaces over a blended palette, each by its own weight. */
export function overlayLandmarkGround(
  tint: QuarteredLandmarkTint,
  out: QuarterGroundLinear,
): QuarterGroundLinear {
  for (const key of LANDMARK_KEYS) {
    const k = tint[key];
    if (k <= 0) continue;
    const pal = LANDMARK_LINEAR[key];
    for (const tone of TONES) {
      const o = out[tone];
      const c = pal[tone];
      o[0] += (c[0] - o[0]) * k;
      o[1] += (c[1] - o[1]) * k;
      o[2] += (c[2] - o[2]) * k;
    }
  }
  return out;
}

/** The power the ground's quarter weights are raised to before blending.
 *  The shared field's borders are wide, soft Gaussians (right for scatter and
 *  weather), but two grounds mixed half and half are a mud neither quarter
 *  owns: snow and red rock made khaki. Sharpened, each quarter keeps its own
 *  ground up to a narrow border. */
export const QUARTER_GROUND_SHARPEN = 3;

const sharpScratch: QuarterWeights = { ice: 0, fire: 0, earth: 0, wind: 0 };

/** `w` raised to QUARTER_GROUND_SHARPEN and renormalized (into a shared
 *  scratch: copy it to keep it). */
export function sharpenQuarterWeights(w: QuarterWeights): QuarterWeights {
  let sum = 0;
  for (const q of QUARTERS) {
    const v = w[q] ** QUARTER_GROUND_SHARPEN;
    sharpScratch[q] = v;
    sum += v;
  }
  for (const q of QUARTERS) sharpScratch[q] /= sum;
  return sharpScratch;
}

/** Half the width, yards, over which two of the arena floor's wedges blend. */
export const ARENA_SEAM_SOFT = 2;
/** The scorched line down each seam: full dark inside the first distance,
 *  gone by the second (yards from the seam). */
export const ARENA_SEAM_SCAR: readonly [number, number] = [0.6, 2.4];
/** How far the scar pulls the floor toward ARENA_SCAR_HEX. */
export const ARENA_SCAR_SHARE = 0.8;
export const ARENA_SCAR_HEX = 0x1c1a1e;
const ARENA_SCAR_LINEAR = quarterHexToLinear(ARENA_SCAR_HEX);

function smooth(edge0: number, edge1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const arenaScratch: QuarterWeights = { ice: 0, fire: 0, earth: 0, wind: 0 };

/** The Challenger's Ring's floor, quartered: each wedge wears the ground of
 *  the quarter its ramp climbs out to (CHALLENGERS_RING.ramps: the Hoarshelf
 *  south, the Cinderscar east, the Wilds west, the Gyre north), split down
 *  the diagonals between the ramps. Returns the share (0 to 1) of the wedge
 *  weights written into `out` that replaces the land's own quarter field:
 *  1 on the floor, fading out up the crater wall, 0 beyond it. `scar` (0 to
 *  1) is the scorched seam between two wedges. */
export function arenaQuarterWeights(
  x: number,
  z: number,
  out: QuarterWeights,
): { share: number; scar: number } {
  const a = CHALLENGERS_RING;
  const dx = x - a.x;
  const dz = z - a.z;
  const r = Math.hypot(dx, dz);
  const share = 1 - smooth(a.floorR, a.wallR + 2, r);
  if (share <= 0) return { share: 0, scar: 0 };
  // signed distance to the nearer diagonal: positive in the east and west wedges
  const d = (Math.abs(dx) - Math.abs(dz)) / Math.SQRT2;
  const side = smooth(-ARENA_SEAM_SOFT, ARENA_SEAM_SOFT, d);
  const east = smooth(-ARENA_SEAM_SOFT, ARENA_SEAM_SOFT, dx);
  const north = smooth(-ARENA_SEAM_SOFT, ARENA_SEAM_SOFT, dz);
  out.fire = side * east;
  out.earth = side * (1 - east);
  out.wind = (1 - side) * north;
  out.ice = (1 - side) * (1 - north);
  const scar = (1 - smooth(ARENA_SEAM_SCAR[0], ARENA_SEAM_SCAR[1], Math.abs(d))) * share;
  return { share, scar };
}

/** The Quartered Isle's ground palette at world (x, z), linear light: the
 *  four quarters blended by position (the arena floor by its own wedges),
 *  then the landmark surfaces over it. */
export function quarteredGroundAt(x: number, z: number, out: QuarterGroundLinear) {
  let w = sharpenQuarterWeights(quarterWeightsAt(x, z));
  const arena = arenaQuarterWeights(x, z, arenaScratch);
  if (arena.share > 0) {
    const k = arena.share;
    w = {
      ice: w.ice + (arenaScratch.ice - w.ice) * k,
      fire: w.fire + (arenaScratch.fire - w.fire) * k,
      earth: w.earth + (arenaScratch.earth - w.earth) * k,
      wind: w.wind + (arenaScratch.wind - w.wind) * k,
    };
  }
  blendQuarterGround(w, out);
  if (arena.scar > 0) {
    const k = arena.scar * ARENA_SCAR_SHARE;
    for (const tone of TONES) {
      const o = out[tone];
      o[0] += (ARENA_SCAR_LINEAR[0] - o[0]) * k;
      o[1] += (ARENA_SCAR_LINEAR[1] - o[1]) * k;
      o[2] += (ARENA_SCAR_LINEAR[2] - o[2]) * k;
    }
  }
  quarteredLandmarkTint(x, z, tintScratch);
  overlayFissureGround(w, tintScratch.fissure, out);
  return overlayLandmarkGround(tintScratch, out);
}

/** The terrain mesh spacing (yards) over the isle, per tier. The shattered
 *  ground's fissure walls, plate edges and scars turn over a few yards, so the
 *  world's ordinary bands (up to 2.6yd high, 6.5yd low) would cut their
 *  corners and leave the drawn ground standing above or below the ground the
 *  sim walks players on. Cosmetic fidelity only: the sim's own height is the
 *  same on every tier. */
export const QUARTERED_MESH_SPACING = { high: 1.2, low: 2.4 } as const;

/** The finest mesh spacing the isle asks of a terrain chunk at (x0, z0) of
 *  `size` yards, or Infinity when the chunk lies off the isle (render/terrain.ts
 *  detailSpacingAt takes the min with its band). */
export function quarteredMeshSpacing(
  x0: number,
  z0: number,
  size: number,
  lowGfx: boolean,
): number {
  const b = QUARTERED_LANDMARK_BOUNDS;
  if (x0 + size < b.minX || x0 > b.maxX || z0 + size < b.minZ || z0 > b.maxZ) return Infinity;
  return lowGfx ? QUARTERED_MESH_SPACING.low : QUARTERED_MESH_SPACING.high;
}
