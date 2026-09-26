// Nythraxis hazard palettes by colour-vision mode, the pure half.
//
// The classic read (nythraxis_grave_core.ts's owner call) puts every damaging
// Nythraxis floor mechanic in ONE purple family: the Grave Eruption telegraph,
// the Grave Flame and Soulfire pools it leaves, and the Gravefire strip differ
// only by shade, and the Soul Rend marker tells alone from stacked with a
// red/green pair. On a dark crypt floor, with several circles overlapping, a
// player with a colour-vision deficiency (the Discord report: "a giant blob of
// identical colors") loses the edges, and so loses WHERE the next eruption lands.
//
// The colourblind mode keeps every actionable geometry exactly as authored
// (radius, countdown, rim opacity floors: those are gameplay) and swaps ONLY the
// hues, onto the Okabe-Ito set, which was designed to stay separable under
// deuteranopia, protanopia and tritanopia, and spreads the hazards across
// lightness as well as hue so they still separate in greyscale:
//   Grave Eruption (the incoming strike)  yellow rim, white countdown, orange veins
//   Grave Flame (an eruption's residue)   bluish green
//   Soulfire (a Soul Rend pool)           reddish purple
//   Gravefire (the travelling strip)      vermillion
//   Soul Rend alone / stacked             vermillion / sky blue
// The friendly Binding Sigil keeps its classic blue in both modes: it was
// already the one non-danger read and never overlaps the hazards.
//
// This mode is a PLAYER ACCESSIBILITY choice (Options > Interface), never a
// graphics-tier knob: no preset, tier or governor input reaches it
// (docs/design/graphics-settings-fairness.md).
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

import {
  NYTHRAXIS_GRAVE_ERUPTION_PALETTE,
  NYTHRAXIS_GRAVE_FLAME_PALETTE,
  NYTHRAXIS_SOUL_FLAME_PALETTE,
  type NythraxisFlamePalette,
} from './nythraxis_grave_core';
import { NYTHRAXIS_GRAVEFIRE_PALETTE } from './nythraxis_gravefire_core';
import {
  NYTHRAXIS_SOFT_FIRE_RAMPS,
  type NythraxisSoftFireKind,
  type NythraxisSoftFireRamp,
} from './nythraxis_soft_fire_core';
import {
  NYTHRAXIS_SOUL_REND_ALONE_PALETTE,
  NYTHRAXIS_SOUL_REND_STACKED_PALETTE,
  type NythraxisSoulRendMarkerPalette,
} from './nythraxis_soul_rend_marker_core';

/** The meteor telegraph's material slots (mage_ground_fx.ts owns the geometry;
 *  the fire meteor and Grave Eruption map their palettes onto these 1:1). */
export interface MeteorTelegraphPalette {
  footprint: number;
  boundary: number;
  countdown: number;
  vein: number;
  mote: number;
  shard: number;
}

/** `classic`: the owner-called purple family. `colorblind`: the Okabe-Ito swap. */
export type HazardPaletteMode = 'classic' | 'colorblind';

export const HAZARD_PALETTE_MODES: readonly HazardPaletteMode[] = ['classic', 'colorblind'];

/** The Settings boolean maps onto the mode here, so the renderer never sees a bare bool. */
export function hazardPaletteModeOf(colorblindMode: boolean): HazardPaletteMode {
  return colorblindMode ? 'colorblind' : 'classic';
}

/** Okabe-Ito, the colourblind-safe categorical set (Okabe and Ito, 2008). */
export const OKABE_ITO = {
  orange: 0xe69f00,
  skyBlue: 0x56b4e9,
  bluishGreen: 0x009e73,
  yellow: 0xf0e442,
  blue: 0x0072b2,
  vermillion: 0xd55e00,
  reddishPurple: 0xcc79a7,
} as const;

/** Grave Eruption under colourblind mode: the strike that is about to land is
 *  the brightest thing on the floor (yellow rim, white countdown), so it never
 *  hides under the pools it will leave behind. */
export const NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND: MeteorTelegraphPalette = {
  footprint: 0x2a2408,
  boundary: OKABE_ITO.yellow,
  countdown: 0xffffff,
  vein: OKABE_ITO.orange,
  mote: OKABE_ITO.yellow,
  shard: 0xfff8d0,
};

/** Grave Flame under colourblind mode: a deep tint of Okabe-Ito bluish green,
 *  cool and clearly DARKER than the Soulfire it can overlap, so the two pools
 *  also separate in greyscale (the rim opacity floor is untouched). */
export const NYTHRAXIS_GRAVE_FLAME_PALETTE_COLORBLIND: NythraxisFlamePalette = {
  fill: 0x06261a,
  rim: 0x007a5a,
  ember: 0x00664a,
  tongue: 0xbdf5e0,
};

/** Soulfire under colourblind mode: Okabe-Ito reddish purple, warm and lighter
 *  than the Grave Flame it can overlap. */
export const NYTHRAXIS_SOUL_FLAME_PALETTE_COLORBLIND: NythraxisFlamePalette = {
  fill: 0x2a0f22,
  rim: OKABE_ITO.reddishPurple,
  ember: 0x8a3f6e,
  tongue: 0xffd6ee,
};

/** Gravefire under colourblind mode: vermillion edges on a scorched bed. */
export const NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND = {
  underlay: 0x2a1400,
  glow: 0x7a3200,
  edge: OKABE_ITO.vermillion,
  head: 0xffb070,
  tongue: 0xffb070,
} as const;

/** The soft fire ramps follow each pool's rim hue so the flames read as the
 *  same hazard as the footprint they rise from. */
export const NYTHRAXIS_SOFT_FIRE_RAMPS_COLORBLIND: Readonly<
  Record<NythraxisSoftFireKind, NythraxisSoftFireRamp>
> = {
  grave: { core: 0xd6fff0, body: 0x00a878, tip: 0x063a2a },
  soul: { core: 0xfff0f8, body: 0xe08cc0, tip: 0x3a1030 },
  gravefire: { core: 0xfff0e0, body: 0xff8c2a, tip: 0x3a1800 },
};

/** Soul Rend under colourblind mode: the red/green pair becomes vermillion
 *  (alone: the mark is still yours to share) and sky blue (stacked: safe). */
export const NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND: NythraxisSoulRendMarkerPalette = {
  ring: OKABE_ITO.vermillion,
  fill: 0x5a2200,
  sigil: 0xff9a4a,
};
export const NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND: NythraxisSoulRendMarkerPalette = {
  ring: OKABE_ITO.skyBlue,
  fill: 0x0c2f45,
  sigil: 0xbfe8ff,
};

export function nythraxisGraveEruptionPalette(mode: HazardPaletteMode): MeteorTelegraphPalette {
  return mode === 'colorblind'
    ? NYTHRAXIS_GRAVE_ERUPTION_PALETTE_COLORBLIND
    : NYTHRAXIS_GRAVE_ERUPTION_PALETTE;
}

/** Palette selection stays on the authoritative row kind; the mode only picks the family. */
export function nythraxisFlamePaletteFor(
  kind: 'grave' | 'soul',
  mode: HazardPaletteMode,
): NythraxisFlamePalette {
  if (mode === 'colorblind') {
    return kind === 'soul'
      ? NYTHRAXIS_SOUL_FLAME_PALETTE_COLORBLIND
      : NYTHRAXIS_GRAVE_FLAME_PALETTE_COLORBLIND;
  }
  return kind === 'soul' ? NYTHRAXIS_SOUL_FLAME_PALETTE : NYTHRAXIS_GRAVE_FLAME_PALETTE;
}

export function nythraxisGravefirePalette(
  mode: HazardPaletteMode,
): typeof NYTHRAXIS_GRAVEFIRE_PALETTE | typeof NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND {
  return mode === 'colorblind'
    ? NYTHRAXIS_GRAVEFIRE_PALETTE_COLORBLIND
    : NYTHRAXIS_GRAVEFIRE_PALETTE;
}

export function nythraxisSoftFireRamp(
  kind: NythraxisSoftFireKind,
  mode: HazardPaletteMode,
): NythraxisSoftFireRamp {
  return (mode === 'colorblind' ? NYTHRAXIS_SOFT_FIRE_RAMPS_COLORBLIND : NYTHRAXIS_SOFT_FIRE_RAMPS)[
    kind
  ];
}

export function nythraxisSoulRendPaletteFor(
  partners: number,
  mode: HazardPaletteMode,
): NythraxisSoulRendMarkerPalette {
  if (mode === 'colorblind') {
    return partners > 0
      ? NYTHRAXIS_SOUL_REND_STACKED_PALETTE_COLORBLIND
      : NYTHRAXIS_SOUL_REND_ALONE_PALETTE_COLORBLIND;
  }
  return partners > 0 ? NYTHRAXIS_SOUL_REND_STACKED_PALETTE : NYTHRAXIS_SOUL_REND_ALONE_PALETTE;
}

/** The pooled-material bucket suffix for a mode: the classic bucket keeps its
 *  historical bare key so every existing pool test still addresses it, and the
 *  colourblind materials never recycle into a classic telegraph (or back). */
export function hazardPaletteMaterialSuffix(mode: HazardPaletteMode): string {
  return mode === 'colorblind' ? ':colorblind' : '';
}
