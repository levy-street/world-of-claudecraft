// Character XP for gathering and crafting actions. Two independently tuned
// curves, both following the same classic green/gray shape as combat XP
// (types.ts mobXpValue/zeroDiff): full or scaled-up XP against content at or
// above the player's level, linearly reduced below it, and zero once the
// content is `zeroDiff(playerLevel)` or more levels below the player (the
// gray band). Kept separate from mobXpValue on purpose: a node/recipe isn't
// a mob, and gathering/crafting are lower-effort, repeatable actions with no
// miss/death risk, so both bases are tuned well under the kill-XP curve.
//
// Base constants are a first-pass tuning value, not a balance number pulled
// from a classic-era formula reference (unlike combat math elsewhere in this
// repo): there is no equivalent real-MMO gathering/crafting XP table to
// match against. Adjust GATHER_XP_BASE/GATHER_XP_PER_LEVEL and
// CRAFT_XP_BASE/CRAFT_XP_PER_LEVEL directly once real playtesting data
// exists; the shape (green/gray falloff) should not change.
//
// Pure, no randomness, zero DOM/browser/Three.js imports (src/sim/ purity,
// guarded by tests/architecture.test.ts).

import { zeroDiff } from '../types';

const GATHER_XP_BASE = 10;
const GATHER_XP_PER_LEVEL = 2;

const CRAFT_XP_BASE = 20;
const CRAFT_XP_PER_LEVEL = 4;

function professionActionXp(base: number, contentLevel: number, playerLevel: number): number {
  const diff = contentLevel - playerLevel;
  if (diff >= 0) {
    return Math.round(base * (1 + 0.05 * Math.min(diff, 4)));
  }
  const zd = zeroDiff(playerLevel);
  if (-diff >= zd) return 0; // gray: no XP from trivial content
  return Math.round(base * (1 - -diff / zd));
}

// XP for one gathering-node harvest (gathering.ts harvestNode).
export function gatherActionXp(nodeLevel: number, playerLevel: number): number {
  return professionActionXp(
    GATHER_XP_BASE + GATHER_XP_PER_LEVEL * nodeLevel,
    nodeLevel,
    playerLevel,
  );
}

// XP for one successful craft (crafting.ts resolveCraftForRecipe).
export function craftActionXp(recipeLevel: number, playerLevel: number): number {
  return professionActionXp(
    CRAFT_XP_BASE + CRAFT_XP_PER_LEVEL * recipeLevel,
    recipeLevel,
    playerLevel,
  );
}
