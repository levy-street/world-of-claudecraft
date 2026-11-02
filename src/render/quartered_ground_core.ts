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
  // the Hoarshelf: pale glacier shelf, teal-white ice over grey scree
  ice: {
    grass: 0xdcecee,
    grassDark: 0xb0d0d6,
    grassYellow: 0xcce2e2,
    dirt: 0x86a4ae,
    sand: 0xd8ecec,
  },
  // the Cinderscar: scorched umber soil over cracked basalt; the highlight
  // tone carries the white-gold of the crystal fire near the centre
  fire: {
    grass: 0x7a5c44,
    grassDark: 0x4a3a34,
    grassYellow: 0xd8b878,
    dirt: 0x5a4438,
    sand: 0xa08c74,
  },
  // the Heavestone Wilds: gold woods and dry ochre grassland over heaved stone
  earth: {
    grass: 0xb8a048,
    grassDark: 0x8a7a3c,
    grassYellow: 0xd8bc5c,
    dirt: 0xa07c4c,
    sand: 0xdcc490,
  },
  // the Gyre: cool slate-green storm grass on grey rock
  wind: {
    grass: 0x6a8a72,
    grassDark: 0x4a6a5a,
    grassYellow: 0x92a688,
    dirt: 0x6e6c66,
    sand: 0xc4c4b8,
  },
};

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

/** The Quartered Isle's ground palette at world (x, z), linear light. */
export function quarteredGroundAt(x: number, z: number, out: QuarterGroundLinear) {
  return blendQuarterGround(quarterWeightsAt(x, z), out);
}
