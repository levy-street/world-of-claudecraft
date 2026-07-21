// One shared 10-per-60s pacing budget for crafting, disenchant, enchant-apply,
// and salvage (Professions 2.0 Phase 12c: the #1301 craft-output throttle
// widened into the single action window every paced profession resolver
// draws from). The backing field keeps its historical craftThrottle name on
// PlayerMeta to spare save/wire/pin churn: the name is legacy, the budget is
// shared. Window-reset semantics are unchanged from crafting.ts's original
// withinCraftThrottle: the window advances/resets against sim time as a side
// effect exactly like a real rolling window would, and a denial never spends
// budget.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged.

import {
  CRAFT_THROTTLE_MAX_PER_WINDOW,
  CRAFT_THROTTLE_WINDOW_SECONDS,
} from '../content/professions';
import type { PlayerMeta } from '../sim';

// Re-exported under their historical names so consumers (and the throttle
// suite's pins) can read the shared budget through this module without a
// rename rippling into the content constants.
export { CRAFT_THROTTLE_MAX_PER_WINDOW, CRAFT_THROTTLE_WINDOW_SECONDS };

/** Whether `meta`'s rolling shared-action window still has room for one more
 *  paced profession action, advancing/resetting the window against `now`
 *  (sim time, deterministic) as a side effect exactly like a real rolling
 *  window would. A maxed specialist is capped at
 *  `CRAFT_THROTTLE_MAX_PER_WINDOW` successful actions per
 *  `CRAFT_THROTTLE_WINDOW_SECONDS`, regardless of skill or material supply. */
export function withinActionThrottle(meta: PlayerMeta, now: number): boolean {
  if (now - meta.craftThrottle.windowStart >= CRAFT_THROTTLE_WINDOW_SECONDS) {
    meta.craftThrottle.windowStart = now;
    meta.craftThrottle.count = 0;
  }
  return meta.craftThrottle.count < CRAFT_THROTTLE_MAX_PER_WINDOW;
}

/** Spend one unit of the shared window's budget: called on SUCCESS only (a
 *  denial, throttled or otherwise, never spends budget). */
export function recordAction(meta: PlayerMeta): void {
  meta.craftThrottle.count += 1;
}
