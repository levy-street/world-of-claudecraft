// The raid atlas's palette: the CSS tokens it reads (src/styles/tokens.css,
// `--color-raid-atlas-*`) by role, plus the font roles, and a tiny
// deterministic hash the art uses for its hand-drawn jitter. The painter
// resolves the tokens once (a 2D canvas cannot read a custom property) and
// hands the resolved strings down; nothing here touches a host.

import type { SmithHeartVein } from '../../../sim/content/smith_heart_layout';
import type { RaidAtlasPinColor } from './raid_atlas_pins_core';
import type { RaidAtlasArea } from './raid_atlas_plan_core';

export const RAID_ATLAS_COLOR_TOKENS = {
  parchment: '--color-raid-atlas-parchment',
  parchmentLight: '--color-raid-atlas-parchment-light',
  parchmentDark: '--color-raid-atlas-parchment-dark',
  stain: '--color-raid-atlas-stain',
  ink: '--color-raid-atlas-ink',
  inkSoft: '--color-raid-atlas-ink-soft',
  abyss: '--color-raid-atlas-abyss',
  rock: '--color-raid-atlas-rock',
  areaHammer: '--color-raid-atlas-area-hammer',
  areaRing: '--color-raid-atlas-area-ring',
  areaBreath: '--color-raid-atlas-area-breath',
  areaQuench: '--color-raid-atlas-area-quench',
  areaHeat: '--color-raid-atlas-area-heat',
  areaHeart: '--color-raid-atlas-area-heart',
  veinHammer: '--color-raid-atlas-vein-hammer',
  veinBreath: '--color-raid-atlas-vein-breath',
  veinQuench: '--color-raid-atlas-vein-quench',
  veinHeat: '--color-raid-atlas-vein-heat',
  heartGlow: '--color-raid-atlas-heart-glow',
  glow: '--color-raid-atlas-glow',
  frameDark: '--color-raid-atlas-frame-dark',
  frameMid: '--color-raid-atlas-frame-mid',
  goldDeep: '--color-raid-atlas-gold-deep',
  gold: '--color-raid-atlas-gold',
  goldLight: '--color-raid-atlas-gold-light',
  goldWhite: '--color-raid-atlas-gold-white',
  boss: '--color-raid-atlas-boss',
  bossEngaged: '--color-raid-atlas-boss-engaged',
  dead: '--color-raid-atlas-dead',
  portal: '--color-raid-atlas-portal',
  pinGold: '--color-raid-atlas-pin-gold',
  pinRed: '--color-raid-atlas-pin-red',
  pinBlue: '--color-raid-atlas-pin-blue',
  pinGreen: '--color-raid-atlas-pin-green',
  pinPurple: '--color-raid-atlas-pin-purple',
  pinWhite: '--color-raid-atlas-pin-white',
} as const;

export type RaidAtlasColorRole = keyof typeof RAID_ATLAS_COLOR_TOKENS;
export type RaidAtlasColors = Record<RaidAtlasColorRole, string>;

export const RAID_ATLAS_FONT_TOKENS = {
  display: '--font-display',
  serif: '--font-serif',
} as const;
export type RaidAtlasFonts = Record<keyof typeof RAID_ATLAS_FONT_TOKENS, string>;

export function areaColorRole(area: RaidAtlasArea): RaidAtlasColorRole {
  switch (area) {
    case 'hammer':
      return 'areaHammer';
    case 'ring':
      return 'areaRing';
    case 'breath':
      return 'areaBreath';
    case 'quench':
      return 'areaQuench';
    case 'heat':
      return 'areaHeat';
    default:
      return 'areaHeart';
  }
}

export function veinColorRole(vein: SmithHeartVein): RaidAtlasColorRole {
  switch (vein) {
    case 'hammer':
      return 'veinHammer';
    case 'breath':
      return 'veinBreath';
    case 'quench':
      return 'veinQuench';
    default:
      return 'veinHeat';
  }
}

export function pinColorRole(color: RaidAtlasPinColor): RaidAtlasColorRole {
  switch (color) {
    case 'gold':
      return 'pinGold';
    case 'red':
      return 'pinRed';
    case 'blue':
      return 'pinBlue';
    case 'green':
      return 'pinGreen';
    case 'purple':
      return 'pinPurple';
    default:
      return 'pinWhite';
  }
}

/** Deterministic hash in [0, 1) of two integers (the art's jitter; no rng). */
export function atlasHash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
