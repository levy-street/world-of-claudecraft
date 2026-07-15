// The Frostreach Frontier: a factionless, always-on open-world PvP zone in a
// far-off x-band. Everyone inside the band is hostile to everyone else (no teams,
// no color); killing the frost rares that roam it drops honor AND hero points,
// and hero points buy the Season 1 item-level 31 PvP set from the hub vendor.
//
// This module is the single source of the band geometry + reward constants;
// every other slice (hostility, content, vendor, UI) imports from here and never
// redefines. Pure and deterministic: no DOM, no rng, no wall-clock.
//
// Placement: the band sits at x >= FRONTIER_X_MIN, past the yumi maze band
// (YUMI_BAND_X_MAX = 12000) and well short of the Vale Cup practice pitches
// (x = 30000), so it never overlaps another instance band.

/** Band start. Any x at or past this is inside the Frontier (see isFrontierPos). */
export const FRONTIER_X_MIN = 14000;
/** Band end; the frost tundra spans this width in x. */
export const FRONTIER_X_MAX = 20000;

/** The one safe hub, at the shallow mouth of the band: vendor, turn-in, graveyard.
 *  PvP damage never lands inside FRONTIER_HUB_RADIUS of it. */
export const FRONTIER_HUB = { x: FRONTIER_X_MIN + 40, z: 0 } as const;
export const FRONTIER_HUB_RADIUS = 34;

/** Where the enter teleport drops you: just inside the band, at the hub. */
export const FRONTIER_ENTRY = { x: FRONTIER_HUB.x, z: FRONTIER_HUB.z } as const;

/** True when x is inside the Frontier band. */
export function isFrontierPos(x: number): boolean {
  return x >= FRONTIER_X_MIN && x < FRONTIER_X_MAX;
}

/** Depth into the band (0 at the mouth). Deeper is deadlier and richer. */
export function frontierDepth(x: number): number {
  return Math.max(0, x - FRONTIER_X_MIN);
}

/** True when the point is within the safe hub perimeter (no PvP damage there). */
export function inFrontierHub(x: number, z: number): boolean {
  const dx = x - FRONTIER_HUB.x;
  const dz = z - FRONTIER_HUB.z;
  return dx * dx + dz * dz <= FRONTIER_HUB_RADIUS * FRONTIER_HUB_RADIUS;
}

// --- Reward constants (routed through grantHonor / grantHeroPoints) -----------

/** Honor for a frost-rare kill (personal-loot-style participation eligibility). */
export const FRONTIER_RARE_HONOR = 15;
/** Hero points for a frost-rare kill: the Season 1 gear currency. */
export const FRONTIER_RARE_HERO_POINTS = 3;
/** The open-world player-kill honor premium (2x the Fiesta kill base). */
export const FRONTIER_KILL_HONOR_MULT = 2;
/** Honor for completing a Frontier daily quest. */
export const FRONTIER_DAILY_HONOR = 100;
