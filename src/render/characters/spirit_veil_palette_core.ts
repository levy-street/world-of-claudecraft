// The spirit veil's looks: one palette per veil user, and what a rig keeps
// while it wears one.
//
// A palette is uniform VALUES on the veil's shared programs (ghost_veil.ts),
// never a new program key, so every user draws the same pinned family
// (spirit_veil_family_core.ts). Colours are sRGB hex; three converts them to
// the working space.
//
// Three-free and deterministic: tests drive it directly.

export type SpiritVeilPalette =
  | 'spirit'
  | 'wolf'
  | 'march'
  | 'stealth-rogue'
  | 'stealth-other'
  | 'moonkin'
  | 'soul-rend';

export interface SpiritVeilPaletteValues {
  tint: number;
  deep: number;
  rim: number;
  /** Past 1 the rim blooms on the composer tiers and saturates on the direct
   *  ones. */
  rimStrength: number;
  /** The body's alpha; the rim always rises to 1. */
  opacity: number;
  /** Height in yards over which the body fades up from its darker feet. */
  rise: number;
  /** Vertex ripple amplitude, replayed by the depth pre-pass. */
  shimmer: number;
  /** 0: the monochrome veil (deep to tint by texel luminance); 1: the rig's
   *  own colours (map, source colour and outfit dye) under the same rise,
   *  bands and rim. */
  keepColor: number;
  /** Depth of the rising bands: 0 is a still body. */
  band: number;
}

export const SPIRIT_VEIL_PALETTES: Readonly<
  Record<SpiritVeilPalette, Readonly<SpiritVeilPaletteValues>>
> = {
  // A released spirit (e.ghost), the Pale Keeper and the quest visions.
  spirit: {
    tint: 0x7cade1,
    deep: 0x213055,
    rim: 0x90c0ff,
    rimStrength: 2.69,
    opacity: 0.24,
    rise: 1.1,
    shimmer: 0.012,
    keepColor: 0,
    band: 0.3,
  },
  // The shaman's Ghost Wolf: a living combatant, never the dead blue.
  wolf: {
    tint: 0xb1a99a,
    deep: 0x787878,
    rim: 0xa3a39e,
    rimStrength: 1.15,
    opacity: 0.23,
    rise: 0.72,
    shimmer: 0,
    keepColor: 1,
    band: 0.3,
  },
  // The protection paladin's Veilbound March: holy gold.
  march: {
    tint: 0xffe2a0,
    deep: 0x5a4420,
    rim: 0xffd27a,
    rimStrength: 1.03,
    opacity: 0.12,
    rise: 0.6,
    shimmer: 0.01,
    keepColor: 1,
    band: 0.22,
  },
  // The rogue's Duskveil and Smokefade.
  'stealth-rogue': {
    tint: 0x6b7690,
    deep: 0x854686,
    rim: 0x9f3e2d,
    rimStrength: 2.55,
    opacity: 0.08,
    rise: 1.1,
    shimmer: 0,
    keepColor: 0.65,
    band: 0,
  },
  // The druid cat's Stalk and the mage's Greater Invisibility.
  'stealth-other': {
    tint: 0x6b7690,
    deep: 0x0d1018,
    rim: 0x725d4f,
    rimStrength: 0.21,
    opacity: 0.31,
    rise: 0.49,
    shimmer: 0,
    keepColor: 0.58,
    band: 0.36,
  },
  // The balance druid's Moonwing Form (no rig of its own: the druid's body).
  moonkin: {
    tint: 0x9373dd,
    deep: 0x3a2270,
    rim: 0xc9b8f5,
    rimStrength: 0.45,
    opacity: 0.71,
    rise: 1.1,
    shimmer: 0,
    keepColor: 0,
    band: 0.3,
  },
  // Nythraxis' Soul Rend mark, on whichever body the raider wears.
  'soul-rend': {
    tint: 0x552a2a,
    deep: 0x2b0303,
    rim: 0x930b0b,
    rimStrength: 1.07,
    opacity: 0.8,
    rise: 0.81,
    shimmer: 0,
    keepColor: 0,
    band: 1,
  },
};

/** What a veiled rig keeps. The class halo is hidden under every palette. */
export interface SpiritVeilPolicy {
  castsShadow: boolean;
  /** The weapon-skin VFX parts and their light; hidden, the light is held at
   *  intensity 0 and stays counted. */
  weaponVfx: boolean;
}

export const SPIRIT_VEIL_POLICY: Readonly<Record<SpiritVeilPalette, Readonly<SpiritVeilPolicy>>> = {
  spirit: { castsShadow: false, weaponVfx: false },
  wolf: { castsShadow: false, weaponVfx: false },
  march: { castsShadow: false, weaponVfx: true },
  'stealth-rogue': { castsShadow: false, weaponVfx: false },
  'stealth-other': { castsShadow: false, weaponVfx: false },
  moonkin: { castsShadow: true, weaponVfx: true },
  'soul-rend': { castsShadow: false, weaponVfx: true },
};
