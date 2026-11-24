// The Guardian of the Heat's Live Coal on screen (heat_coal_fx.ts; the sim is
// encounters/smith_heart/heat_coal.ts): how its bearer's arrow, its leap ring
// and its burst's reach read at a moment of the fuse. Pure numbers.
//
//  - The arrow: a molten arrowhead over the bearer's head, pointing down at
//    them, a live coal glowing in its heart. Everyone sees it on every tier
//    (it is who to keep away from and who to heal); its bearer sees their own
//    half again as large. It bobs gently and its coal throbs faster as the
//    fuse runs down (a calm throb at first, never a flash).
//  - The leap ring: the sim's exact leap reach at the bearer's feet, a thin
//    quiet line the whole time (step inside it and the coal is yours).
//  - The burst's reach: the sim's exact burst radius, shown only over the
//    fuse's last `BURST_SHOW` seconds and filling to the burst, so the raid
//    has room to step out without a wide disc round every bearer the whole
//    time.
//
// Three-free, DOM-free, deterministic.

import { HEAT_TUNING as T } from '../../sim/encounters/smith_heart/heat_ids';

/** Seconds before the burst its reach starts to show. */
export const COAL_BURST_SHOW = 4;
/** The arrow's height over the bearer's anchor (yards): over a hunted
 *  chevron (3.4) should both mark one player. */
export const COAL_ARROW_HEIGHT = 4.3;
/** The arrow's size for others, and its bearer's own factor. */
export const COAL_ARROW_SIZE = 1.5;
export const COAL_SELF_SCALE = 1.5;

export interface HeatCoalLook {
  /** The arrow's world size (yards). */
  size: number;
  /** Its height over the anchor, with its bob. */
  height: number;
  /** 0..1 the coal's glow in its heart. */
  glow: number;
  /** 0..1 the burst reach's fill (0: not shown). */
  burstFill: number;
  /** Whether the burst reach shows. */
  burstShown: boolean;
}

/** The fuse's share run out (0 fresh, 1 at the burst). */
export function coalFuseSpent(remaining: number, duration: number): number {
  const d = duration > 1e-6 ? duration : T.coalSeconds;
  return Math.max(0, Math.min(1, 1 - Math.max(0, remaining) / d));
}

/** The coal's look at `clock` with `remaining` of `duration` on its fuse. */
export function coalLook(
  remaining: number,
  duration: number,
  self: boolean,
  clock: number,
  out: HeatCoalLook = {
    size: 0,
    height: 0,
    glow: 0,
    burstFill: 0,
    burstShown: false,
  },
): HeatCoalLook {
  const spent = coalFuseSpent(remaining, duration);
  out.size = COAL_ARROW_SIZE * (self ? COAL_SELF_SCALE : 1);
  out.height = COAL_ARROW_HEIGHT + 0.18 * Math.sin(clock * 3);
  // The throb quickens from about once a second to three times as the fuse runs out.
  const rate = 6 + 14 * spent;
  out.glow = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(clock * rate));
  const left = Math.max(0, remaining);
  out.burstShown = left <= COAL_BURST_SHOW;
  out.burstFill = out.burstShown ? Math.max(0, Math.min(1, 1 - left / COAL_BURST_SHOW)) : 0;
  return out;
}
