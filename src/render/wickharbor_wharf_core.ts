// The Wickharbor ferry wharf's pure decision (the painter is wickharbor_wharf.ts): which named
// parts of the one Blender model a graphics tier keeps. Three-, DOM- and i18n-free.
//
// Fairness (docs/design/graphics-settings-fairness.md): everything a player walks on, bumps
// into or steers by is kept on EVERY tier: the plank field, its frame and piles, the flight,
// every rail, every lantern (the landmarks that read the wharf at a distance) and the cargo
// and bollards the sim collides with. A lower preset sheds only dressing nothing collides
// with: the fender piles, rings, bolts and iron bands below medium, the rope coils, sacks,
// bucket, oars and net below high. The tier is the STATIC effects tier (GFX.effectsTier),
// never the frame-rate governor.

import type { GfxTier } from './gfx';

/** Walkable structure, solids and landmarks: never shed. */
export const WICKHARBOR_WHARF_CRITICAL_PARTS = [
  'WharfDeck',
  'WharfFrame',
  'WharfFlight',
  'WharfRails',
  'WharfLanterns',
  'WharfCargo',
] as const;
/** Medium and up: fender piles, mooring rings, bolts, iron bands. */
export const WICKHARBOR_WHARF_TRIM_PARTS = ['WharfTrim'] as const;
/** High and up: rope coils, sacks, a bucket, oars, a net. */
export const WICKHARBOR_WHARF_OPTIONAL_PARTS = ['WharfClutter'] as const;

const TIER_RANK: Readonly<Record<GfxTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** The model's named parts a tier draws. */
export function wickharborWharfParts(tier: GfxTier): readonly string[] {
  const rank = TIER_RANK[tier];
  const parts: string[] = [...WICKHARBOR_WHARF_CRITICAL_PARTS];
  if (rank >= TIER_RANK.medium) parts.push(...WICKHARBOR_WHARF_TRIM_PARTS);
  if (rank >= TIER_RANK.high) parts.push(...WICKHARBOR_WHARF_OPTIONAL_PARTS);
  return parts;
}
