// The camera's context-aware zoom-out ceiling, as a pure, DOM-free core.
//
// The reworked dungeons' bosses are big (Ysolei stands about 24 yd tall, the
// Knellwyrm about 19), and the ordinary 22 yd ceiling cannot frame one. In a
// PvE boss context (inside a dungeon instance, with a big boss targeted,
// engaged or standing close) the ceiling grows with the boss's drawn height,
// up to BOSS_ZOOM_MAX; out of that context it eases back down to the base.
// It never goes below the base, and it never rises outside a dungeon, so open
// world, battleground and arena play keep today's limit (no PvP scouting edge).
//
// Pure: no DOM, no clock, no world; camera_zoom_wiring.ts feeds it.

/** The everyday zoom-out ceiling (yards). */
export const BASE_ZOOM_MAX = 22;
/** The furthest a boss context can push it. */
export const BOSS_ZOOM_MAX = 40;
/** A boss shorter than this (drawn yards) does not raise the ceiling. */
export const BOSS_ZOOM_MIN_HEIGHT = 7;
/** Yards of ceiling per drawn yard of boss above the floor height. */
const PER_YARD = 1.1;
/** The drawn height the formula counts from. */
const FLOOR_HEIGHT = 6;
/** How fast the ceiling eases back down once the context ends (yards/s). */
export const ZOOM_CEILING_EASE_DOWN = 6;

/** What the camera knows about its context this frame. */
export interface ZoomContext {
  /** The player stands inside a dungeon instance (PvE). */
  inDungeon: boolean;
  /** Drawn heights (yards) of the bosses that count: targeted, engaged or
   *  standing close. */
  bossHeights: readonly number[];
}

/** The ceiling this context asks for (yards). */
export function zoomCeilingFor(ctx: ZoomContext): number {
  if (!ctx.inDungeon) return BASE_ZOOM_MAX;
  let tallest = 0;
  for (const h of ctx.bossHeights) if (Number.isFinite(h) && h > tallest) tallest = h;
  if (tallest < BOSS_ZOOM_MIN_HEIGHT) return BASE_ZOOM_MAX;
  const want = BASE_ZOOM_MAX + (tallest - FLOOR_HEIGHT) * PER_YARD;
  return Math.min(BOSS_ZOOM_MAX, Math.max(BASE_ZOOM_MAX, want));
}

/** Step the live ceiling toward the target: it rises at once (the boss is
 *  there now) and eases back down (no snap of the camera at the kill). */
export function easeZoomCeiling(current: number, target: number, dt: number): number {
  if (target >= current) return target;
  return Math.max(target, current - ZOOM_CEILING_EASE_DOWN * Math.max(0, dt));
}

/** The camera distance under a ceiling: pulled in with it, never pushed out. */
export function clampCamDist(dist: number, ceiling: number): number {
  return Math.min(dist, ceiling);
}
