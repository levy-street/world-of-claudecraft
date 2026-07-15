import type { AnimState } from './anim_state';

export interface UpdatableCharacterVisual {
  update(dt: number, state: AnimState, animate: boolean): void;
}

/**
 * Advance the visible rig and keep the hidden base rig's state edges alive.
 * The hidden pass skips mixer integration but still settles deferred sheathe
 * swaps, death edges, and base-state latches before a form is removed.
 */
export function updateActiveAndBaseVisual(
  base: UpdatableCharacterVisual,
  active: UpdatableCharacterVisual,
  dt: number,
  state: AnimState,
  animate: boolean,
): void {
  active.update(dt, state, animate);
  if (active !== base) base.update(dt, state, false);
}
