// The markers a shift's ending leaves in the world, as a pure leaf the
// renderer, the HUD and the dungeon exit path can import without pulling in
// the run lifecycle: the Defeated aura a lost shift pins on Morthen (drawn as
// the death pose on a living body), and the Staff Exit, the portal a won shift
// opens behind the throne. Type-only imports, no rng.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { TICK_RATE } from '../types';

// The lost shift's scene: Morthen lies defeated this long before the teardown,
// and the client fades to black over the last stretch of it.
export const LOSS_OUTRO_TICKS = 6 * TICK_RATE;
export const LOSS_FADE_TICKS = 2 * TICK_RATE;

export const DEFEATED_AURA_ID = 'gshift_defeated';
export const DEFEATED_AURA_NAME = 'Defeated';
// The Staff Exit is a stock dungeon exit object (portal body, view policy and
// teardown come free); this English name tells it apart for its label.
export const STAFF_EXIT_NAME = 'Staff Exit';

/** The owner lies defeated: drawn in the death pose, though never dead. */
export function isGraveyardShiftDefeated(e: Pick<Entity, 'auras'> | undefined): boolean {
  return !!e?.auras.some((a) => a.id === DEFEATED_AURA_ID);
}

/** The won shift's way out, a dungeon exit object under its own name. */
export function isGraveyardShiftStaffExit(
  e: Pick<Entity, 'templateId' | 'name'> | undefined,
): boolean {
  return e?.templateId === 'dungeon_exit' && e.name === STAFF_EXIT_NAME;
}

// leaveDungeon's first word for a run owner: on a won shift the way out is
// the Staff Exit, which ends the run as a win rather than walking out of it
// (the run would then read as abandoned). Any other moment leaves as usual.
export function graveyardShiftTakesExit(ctx: SimContext, pid: number): boolean {
  const outro = ctx.graveyardShiftRuns.get(pid)?.outro;
  if (outro?.kind !== 'won') return false;
  outro.leaving = true;
  return true;
}
