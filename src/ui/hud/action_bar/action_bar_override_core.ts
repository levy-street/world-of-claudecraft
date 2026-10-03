// A temporary kit the normal action bar SHOWS without storing, in the spirit of
// a classic possess bar: while an override is active, slot 0 is the Attack
// toggle, slots 1 to n read the override's actions and every later slot reads
// empty. The saved layout is never touched: ActionBarController reads through
// the override at its slot read and freezes every mutator while one is active,
// so the desktop rows, the touch ring and the radial (which all read their
// slots through the controller) show and cast the kit, and the player's own bar
// comes back untouched. Pure: no DOM, no world.

import type { HotbarAction } from './hotbar';

export interface ActionBarOverride {
  /** The actions of bar slots 1 to n, in order. */
  readonly slots: readonly HotbarAction[];
}

/** The action a bar slot reads under the override (slot 0 is the Attack toggle). */
export function overrideActionForSlot(override: ActionBarOverride, barSlot: number): HotbarAction {
  if (barSlot <= 0) return null;
  return override.slots[barSlot - 1] ?? null;
}
