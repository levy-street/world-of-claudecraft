// Wickharbor's wooden harbor's pure decision (the painter is wickharbor_harbor.ts): which named
// parts of the one Blender model a graphics tier keeps. Three-, DOM- and i18n-free.
//
// Fairness (docs/design/graphics-settings-fairness.md): everything a player walks on, bumps
// into or steers by is kept on EVERY tier: the plank fields, their frame and piles, the stairs,
// every rail, every lantern (the landmarks that read the harbor at a distance) and the cargo
// the sim collides with. A lower preset sheds only dressing nothing collides with: the fender
// piles, rings, cleats, bolts and iron straps below medium, the rope coils, crab pots, sacks,
// net, oars and bucket below high. The tier is the STATIC effects tier (GFX.effectsTier),
// never the frame-rate governor.

import type { GfxTier } from './gfx';

/** Walkable structure, solids and landmarks: never shed. */
export const WICKHARBOR_HARBOR_CRITICAL_PARTS = [
  'HarborDecks',
  'HarborFrame',
  'HarborStairs',
  'HarborRails',
  'HarborLanterns',
  'HarborCargo',
] as const;
/** Medium and up: fender piles, mooring rings, cleats, bolts, iron straps. */
export const WICKHARBOR_HARBOR_TRIM_PARTS = ['HarborTrim'] as const;
/** High and up: rope coils, crab pots, sacks, a net, oars, a bucket. */
export const WICKHARBOR_HARBOR_OPTIONAL_PARTS = ['HarborClutter'] as const;

const TIER_RANK: Readonly<Record<GfxTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** The model's named parts a tier draws. */
export function wickharborHarborParts(tier: GfxTier): readonly string[] {
  const rank = TIER_RANK[tier];
  const parts: string[] = [...WICKHARBOR_HARBOR_CRITICAL_PARTS];
  if (rank >= TIER_RANK.medium) parts.push(...WICKHARBOR_HARBOR_TRIM_PARTS);
  if (rank >= TIER_RANK.high) parts.push(...WICKHARBOR_HARBOR_OPTIONAL_PARTS);
  return parts;
}
