// The Moonmantle Ray's Heartpearl (MobTemplate.trashKit.temple.pearl, heroic
// only), the trash pass's second wave on the engine's walker (G5,
// kit_walker.ts). The temple's rays carry the drowned folk's pearls as
// hearts: when the ray's Nacre Cocoon (trashKit.carapace, temple_kit.ts)
// BREAKS, the shield spent while it still had time to run, the pearl drops
// out of its chest a few yards behind it and rolls toward another ray or a
// Templeguard of the fight, which it wards on arrival (the kit's `walker`,
// launch 'event'). A player who steps on it first takes it instead, and the
// whole group in reach gains a small nacre mantle. A cocoon that simply runs
// out drops nothing: break it to earn the race.
//
// Run through the Temple extension's upkeep (temple_extension.ts). Zero rng:
// the break is read off the ward's own clock, the roll is the walker's.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { launchWalker } from './kit_walker';
import { TEMPLE_CARAPACE_AURA } from './temple_kit';

/** A ward gone with more than this many seconds still on its clock was
 *  broken, not spent by time (the aura tick and the kit tick may land in
 *  either order, so a timed-out ward is last seen at one or two ticks left). */
export const COCOON_BREAK_SLACK = 3 * DT;

/**
 * One engaged tick of a pearl-bearing ray: watch its cocoon, and the tick it
 * breaks roll the Heartpearl out (heroic only, once a pull). Returns the
 * pearl when one rolled this tick.
 */
export function stepPearl(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): Entity | null {
  if (!kit.temple?.pearl || !kit.walker || kit.walker.launch !== 'event') return null;
  if (inst.difficulty !== 'heroic') return null;
  st.temple ??= {};
  const tst = st.temple;
  if (tst.pearlJudged) return null;
  const ward = mob.auras.find((a) => a.id === TEMPLE_CARAPACE_AURA);
  if (ward) {
    tst.cocoonLeft = ward.remaining;
    return null;
  }
  // No ward: never raised yet, or gone. The cocoon closes after this upkeep
  // in the tick (driver.ts stepCarapace), so one burst the same tick it
  // closed is gone before it was ever seen here: broken with all its time.
  if (!st.carapaced) return null;
  const left = tst.cocoonLeft ?? Number.POSITIVE_INFINITY;
  tst.pearlJudged = true;
  if (left <= COCOON_BREAK_SLACK) return null;
  return launchWalker(ctx, inst, mob, kit.walker);
}
