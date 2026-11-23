// Every realm's water has its own character: the tropical lagoon is clear
// enough to read the sand three yards down, the marsh is a tea-dark murk you
// cannot see a hand through, the northern sea runs choppy and white-capped,
// the alpine tarn sits still and glassy. This core holds that table and bakes
// it into a world-space field (the same idea as biome_haze_field_core.ts), so
// the water surface reads the character of the PLACE each pixel lies in: a
// lake across a border shows its own water, and a border cross-fades over a
// hundred yards instead of drawing a line. Pure and Three-free; the texture is
// water_character_field.ts.
//
// Four numbers per realm drive the physics, three colours drive the look:
//   deep     the light the water body scatters back up (sRGB), its "colour"
//   shallow  the tint shallow water lays over the seabed it shows (sRGB); the
//            glow of a lit crest is derived from it and deep in the shader
//   absorb   light lost per world unit of path, red, green, blue: clarity
//   chop     wave-slope scale: 1 is the open sea, under 1 sheltered water
//   foam     whitecap and surf scale

import type { BiomeId } from '../../sim/types';

export interface WaterCharacter {
  deep: number;
  shallow: number;
  absorb: readonly [number, number, number];
  chop: number;
  foam: number;
}

/** The open sea of the starter coasts: deep blue water, clear, a light chop. */
const OPEN_SEA: WaterCharacter = {
  deep: 0x0d3a5a,
  shallow: 0x2d8a86,
  absorb: [0.42, 0.11, 0.075],
  chop: 1,
  foam: 1,
};
const TROPICAL: WaterCharacter = {
  deep: 0x0a4c75,
  shallow: 0x2cb8ac,
  absorb: [0.34, 0.06, 0.05],
  chop: 0.85,
  foam: 0.9,
};

export const WATER_CHARACTERS: Readonly<Record<BiomeId, WaterCharacter>> = {
  vale: OPEN_SEA,
  beach: TROPICAL,
  desert: { ...OPEN_SEA, deep: 0x123f5e, shallow: 0x3b9a92 },
  // Sheltered marsh water with Eastbrook's blue-teal colour profile.
  marsh: {
    deep: 0x0d3a5a,
    shallow: 0x2d8a86,
    absorb: [0.48, 0.14, 0.095],
    chop: 0.45,
    foam: 0.3,
  },
  fen: {
    deep: 0x1e2e26,
    shallow: 0x4e6a44,
    absorb: [0.8, 0.42, 0.6],
    chop: 0.4,
    foam: 0.3,
  },
  // Still alpine tarns: very clear, glassy, cold blue-green.
  peaks: {
    deep: 0x0b3a4e,
    shallow: 0x2e8e92,
    absorb: [0.44, 0.1, 0.08],
    chop: 0.6,
    foam: 0.6,
  },
  frost: {
    deep: 0x0d3c5c,
    shallow: 0x4cb6d2,
    absorb: [0.5, 0.11, 0.06],
    chop: 0.75,
    foam: 0.9,
  },
  gale: {
    deep: 0x0b3350,
    shallow: 0x2f8a8c,
    absorb: [0.46, 0.13, 0.09],
    chop: 1.45,
    foam: 1.7,
  },
  jungle: TROPICAL,
  garden: {
    deep: 0x0e465a,
    shallow: 0x3aa294,
    absorb: [0.4, 0.1, 0.085],
    chop: 0.6,
    foam: 0.6,
  },
  amber: {
    deep: 0x173a3e,
    shallow: 0x4f856a,
    absorb: [0.52, 0.22, 0.26],
    chop: 0.7,
    foam: 0.7,
  },
  dusk: {
    deep: 0x18244e,
    shallow: 0x4a6aa4,
    absorb: [0.5, 0.3, 0.15],
    chop: 0.6,
    foam: 0.6,
  },
  night: {
    deep: 0x0f1c44,
    shallow: 0x355c8e,
    absorb: [0.55, 0.25, 0.12],
    chop: 0.5,
    foam: 0.5,
  },
  haunt: {
    deep: 0x13221f,
    shallow: 0x3c5a4c,
    absorb: [0.85, 0.48, 0.58],
    chop: 0.5,
    foam: 0.4,
  },
  // Ash-grey volcanic water, sulphur-green where it is shallow.
  ember: {
    deep: 0x232f2a,
    shallow: 0x6e7c46,
    absorb: [0.72, 0.46, 0.72],
    chop: 0.8,
    foam: 0.6,
  },
  volcano: {
    deep: 0x232f2a,
    shallow: 0x6e7c46,
    absorb: [0.72, 0.46, 0.72],
    chop: 0.8,
    foam: 0.6,
  },
  cave: {
    deep: 0x0c1e26,
    shallow: 0x2c5a5e,
    absorb: [0.6, 0.25, 0.2],
    chop: 0.3,
    foam: 0.3,
  },
};

/** Zones whose water is not their biome's (the Farshore isle is a tropic in a vale band). */
export const ZONE_WATER_CHARACTERS: Readonly<Record<string, WaterCharacter>> = {
  farshore_isle: { ...TROPICAL, deep: 0x0a5282, shallow: 0x30c2b8 },
};

export function waterCharacterFor(zoneId: string, biome: BiomeId): WaterCharacter {
  return ZONE_WATER_CHARACTERS[zoneId] ?? WATER_CHARACTERS[biome] ?? OPEN_SEA;
}

/** One sRGB channel (0..1) to linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** An sRGB hex colour as linear rgb. */
export function hexToLinear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

/** The field's texel layers: what each RGBA carries. */
export const WATER_FIELD_LAYERS = 3;

/**
 * The twelve numbers one character becomes in the field, layer by layer:
 *   0: deep (linear rgb), chop
 *   1: absorb (rgb), foam
 *   2: shallow (linear rgb), unused
 */
export function waterCharacterTexels(c: WaterCharacter): Float32Array {
  const out = new Float32Array(WATER_FIELD_LAYERS * 4);
  out.set([...hexToLinear(c.deep), c.chop], 0);
  out.set([...c.absorb, c.foam], 4);
  out.set([...hexToLinear(c.shallow), 1], 8);
  return out;
}

/** World units per field texel, and how far past the world rect it reaches. */
export const WATER_FIELD_CELL = 24;
export const WATER_FIELD_MARGIN = 480;
/** 1-2-1 blur passes: with the sampler's own filtering a border cross-fades over about 50 units. */
export const WATER_FIELD_BLUR_PASSES = 1;

export interface WaterFieldLayout {
  minX: number;
  minZ: number;
  width: number;
  height: number;
  cell: number;
}

/** A zone's footprint (a strip zone has no x bounds and spans the strip). */
export interface WaterFieldZoneRect {
  xMin?: number;
  xMax?: number;
  zMin: number;
  zMax: number;
}

/**
 * The field's grid over a map's zones plus a margin, so the sea outside the
 * world clamps to its nearest coast's water. Taken from the zones of the map
 * that is ACTIVE when the water builds (a Studio map can reach far past the
 * built-in world).
 */
export function waterFieldLayout(
  zones: readonly WaterFieldZoneRect[],
  stripMinX: number,
  stripMaxX: number,
): WaterFieldLayout {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const zone of zones) {
    x0 = Math.min(x0, zone.xMin ?? stripMinX);
    x1 = Math.max(x1, zone.xMax ?? stripMaxX);
    z0 = Math.min(z0, zone.zMin);
    z1 = Math.max(z1, zone.zMax);
  }
  if (!Number.isFinite(x0)) {
    x0 = stripMinX;
    x1 = stripMaxX;
    z0 = 0;
    z1 = WATER_FIELD_CELL;
  }
  const minX = x0 - WATER_FIELD_MARGIN;
  const minZ = z0 - WATER_FIELD_MARGIN;
  const width = Math.ceil((x1 + WATER_FIELD_MARGIN - minX) / WATER_FIELD_CELL);
  const height = Math.ceil((z1 + WATER_FIELD_MARGIN - minZ) / WATER_FIELD_CELL);
  return { minX, minZ, width, height, cell: WATER_FIELD_CELL };
}

/**
 * Rasterize and blur the field: layer-major float data (layer, row, column,
 * RGBA), each texel the character of the place at its centre. `characterAt`
 * is injected (the Three half passes the zone lookup) so the bake is testable
 * against any map.
 */
export function buildWaterCharacterField(
  layout: WaterFieldLayout,
  characterAt: (x: number, z: number) => WaterCharacter,
): Float32Array {
  const { width, height } = layout;
  const plane = width * height * 4;
  let data = new Float32Array(plane * WATER_FIELD_LAYERS);
  const cache = new Map<WaterCharacter, Float32Array>();
  for (let row = 0; row < height; row++) {
    const z = layout.minZ + (row + 0.5) * layout.cell;
    for (let col = 0; col < width; col++) {
      const x = layout.minX + (col + 0.5) * layout.cell;
      const character = characterAt(x, z);
      let texels = cache.get(character);
      if (!texels) {
        texels = waterCharacterTexels(character);
        cache.set(character, texels);
      }
      const t = (row * width + col) * 4;
      for (let layer = 0; layer < WATER_FIELD_LAYERS; layer++) {
        for (let k = 0; k < 4; k++) data[layer * plane + t + k] = texels[layer * 4 + k];
      }
    }
  }
  // Separable 1-2-1 blur, clamped at the edges, every layer at once.
  const scratch = new Float32Array(data.length);
  for (let pass = 0; pass < WATER_FIELD_BLUR_PASSES; pass++) {
    for (const horizontal of [true, false]) {
      for (let layer = 0; layer < WATER_FIELD_LAYERS; layer++) {
        const base = layer * plane;
        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const prev = horizontal
              ? row * width + Math.max(0, col - 1)
              : Math.max(0, row - 1) * width + col;
            const next = horizontal
              ? row * width + Math.min(width - 1, col + 1)
              : Math.min(height - 1, row + 1) * width + col;
            const here = row * width + col;
            for (let k = 0; k < 4; k++) {
              scratch[base + here * 4 + k] =
                (data[base + prev * 4 + k] +
                  2 * data[base + here * 4 + k] +
                  data[base + next * 4 + k]) *
                0.25;
            }
          }
        }
      }
      data = scratch.slice();
    }
  }
  return data;
}
