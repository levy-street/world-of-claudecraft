// The Proving Shore's isolated presentation scope.
//
// A brand new player's very first load should stream ONE SMALL ISLAND, not the
// continent it happens to sit beside. Today it streams both: the island
// arrival at (-281, -18) sits 101 yd from Eastbrook Vale's rectangle, inside
// the 160 yd arrival-neighbour radius, so the vale's terrain, water, props and
// foliage are all prepared behind the loading screen before a tutorial player
// sees anything. Worse, every cell of the world grid starts life "pending"
// (terrain.ts groundPending.fill(1)), and the outdoor fog clamp pins the
// horizon at the nearest pending cell (chunk_residency_core.ts), so the
// unbuilt mainland walls the island in at roughly 93 yd of visibility.
//
// Nothing here touches the SIM. The world content, the colliders, the quest
// rail and the server's authority are all unchanged, so a player who rings the
// ferry bell crosses into an ordinary, fully streamed Eastbrook. This module
// decides only what the CLIENT bothers to stream, to keep pending, and to draw
// while the player stands on the island. That is why isolation can key on
// nothing but position: there is no state to migrate, and the ferry crossing
// is a teleport rather than a walk, so the scope flips once with the ride.
//
// Three consumers, one decision each:
//   render/terrain.ts   a cell this scope will never build is NOT pending, so
//                       the residency clamp stops seeing the mainland and the
//                       horizon opens over the sea.
//   render/renderer.ts  the streaming lane only queues island zones.
//   render/far_terrain  the horizon haze band starts over the strait instead
//                       of at a fraction of the view envelope, so the far
//                       shore reads as distance rather than as a flat pale
//                       cutout with crisp trees on it.
//
// Pure: no Three, no DOM, no wall clock, no rng. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts); driven directly by
// tests/island_isolation_core.test.ts.

import { isOnProvingShore } from '../sim/content/proving_shore';

/** The island's zone id, the one zone an isolated scope streams. */
export const ISLAND_ZONE_ID = 'proving_shore';

/** How far past the island's own rectangle the panorama's ground reaches.
 *  Wide enough that the horizon is open sea in every direction (the island's
 *  playable ground spans roughly 120 yd of a 360 yd rectangle), and small
 *  enough that the far mesh plans four tiles rather than the continent's
 *  twelve. */
export const ISLAND_VISTA_MARGIN_YD = 600;

/** The island's zone rectangle, mirrored from the content constant that
 *  isOnProvingShore tests (proving_shore.ts PROVING_SHORE_RECT is private, and
 *  a render core must not import sim internals beyond the predicate).
 *  tests/island_isolation_core.test.ts pins these against the predicate. */
export const ISLAND_RECT = { minX: -540, maxX: -180, minZ: -180, maxZ: 180 } as const;

/**
 * Does the client scope its streaming to the island right now?
 *
 * Position alone, deliberately: the island is ringed by open water and the way
 * off it is the ferry bell's teleport, so a player is either on the shore or
 * somewhere else entirely. A swimmer who strikes out east for the mainland
 * leaves the rectangle and gets ordinary streaming back, which is the right
 * answer for someone actually heading there.
 */
export function islandIsolationActive(x: number, z: number): boolean {
  return isOnProvingShore(x, z);
}

/**
 * Is this zone worth streaming under the isolated scope? Only the island's
 * own zone: every other rectangle is across the water, hidden behind the
 * panorama, and unreachable without the ferry.
 */
export function islandScopeStreamsZone(zoneId: string): boolean {
  return zoneId === ISLAND_ZONE_ID;
}

/**
 * The zones worth streaming from this position: the world's own list,
 * narrowed to the island while the player stands on the Proving Shore.
 * Generic over the zone shape so the renderer's ZoneDef list and a test's
 * fixtures both fit without the core importing render types.
 */
export function streamableZones<T extends { id: string }>(
  zones: readonly T[],
  playerX: number,
  playerZ: number,
): T[] {
  if (!islandIsolationActive(playerX, playerZ)) return [...zones];
  return zones.filter((zone) => islandScopeStreamsZone(zone.id));
}

/**
 * The far-vista ground rect for the panorama: the island's rectangle grown by
 * the sea margin. Fed to planFarTiles in place of the world bounds, so the
 * backdrop mesh covers the island and the water around it instead of the whole
 * continent.
 */
export function islandVistaBounds(): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  return {
    minX: ISLAND_RECT.minX,
    maxX: ISLAND_RECT.maxX,
    minZ: ISLAND_RECT.minZ,
    maxZ: ISLAND_RECT.maxZ,
  };
}

/**
 * The horizon haze band for an isolated island view.
 *
 * Lifting the fog wall showed the far shore, and the far shore looked wrong:
 * a flat pale strip of ground with fully saturated trees standing on it. The
 * cause is that the aerial haze field (biome_haze_field) tints TERRAIN and
 * WATER from 110 units out but never touches foliage or props, which is
 * invisible on the mainland where the ground between you and the horizon
 * fades continuously, and glaring across a strait where hazed ground meets
 * unhazed trees with nothing in between. Scene fog covers everything, so a
 * band placed over the strait restores one consistent aerial perspective and
 * the far coast reads as distance again.
 *
 * The ordinary band is a fraction of the whole view envelope, roughly 920
 * units out on this tier, because the far mesh normally paints ranges that
 * ARE that distant. Nothing across the strait is remotely that far, which is
 * why the envelope band left it untouched.
 *
 * The near edge is measured, not chosen: the nearest dry mainland ground is
 * 133 units from the arrival, and the island's own ground reaches 203 units
 * along its northern spit, so no radius separates them cleanly. 130 puts
 * every piece of the far shore inside the band with a yard or two of margin,
 * and the island ground it also catches is that same northern spit, seen
 * across the same water, which wants the same aerial cue anyway. Everything
 * the coached run actually uses (the camp, the strand, the Gauntlet lanes,
 * the pearl cove) sits well inside 130 units of the arrival and is never
 * touched. tests/island_isolation_core.test.ts re-measures both distances
 * from the live terrain rather than trusting these numbers.
 *
 * The FAR edge was 900 and is now 420, because 900 was tuned from the
 * arrival and the camp tells a different story: Dawnrest sits 152 units from
 * the mainland, where a 130-to-900 ramp applies about 3% haze. The far shore
 * came out uniformly pale with no depth gradient at all, and read as
 * geometry that had failed to load rather than as distance (CX). 420 gives
 * the same band a real falloff across the strait from both viewpoints, and
 * still sits far short of the view envelope, so the horizon melts into the
 * sky instead of hitting a wall.
 */
export const ISLAND_HAZE_NEAR_YD = 130;
export const ISLAND_HAZE_FAR_YD = 420;

export function islandHorizonHaze(): { near: number; far: number } {
  return { near: ISLAND_HAZE_NEAR_YD, far: ISLAND_HAZE_FAR_YD };
}

/**
 * The residency question, asked per chunk cell: should this cell count as
 * PENDING ground for the fog clamp?
 *
 * Under the isolated scope a cell owned by any other zone will never be built
 * while the player is here, so calling it pending is a lie that costs the
 * player their horizon. Off the island the answer is unchanged, which is what
 * keeps this a scope rather than a behaviour change: the clamp still pins the
 * fog at genuinely unbuilt ground everywhere else in the world.
 *
 * `ownedByScope` is passed in already resolved rather than looked up here:
 * the caller walks this per cell inside the clamp's grid scan, and the owning
 * rectangle is fixed for the life of the view, so it is precomputed once.
 */
export function cellCountsAsPending(
  owedGeometry: boolean,
  ownedByScope: boolean,
  isolated: boolean,
): boolean {
  if (!owedGeometry) return false;
  return !isolated || ownedByScope;
}
