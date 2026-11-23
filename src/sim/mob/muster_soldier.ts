// A soldier of the Mirefen muster, as the mob AI sees one: somebody who holds his post.
//
// The soldiers are the set dressing of Balgath's warpath (src/sim/mirefen_muster.ts owns
// their lifecycle, stance and cheers; src/sim/content/mirefen_muster.ts their posts). To
// the rest of the mob AI they must be INERT, and inert in a specific way the tests pin:
//   - never hostile, so isHostileTo refuses every player attack, tab-target skips them and
//     taming is impossible (the ambient-horse contract, mob/ambient.ts);
//   - never in combat and never holding a hate table, so a boss slam that kills one cannot
//     start a fight, and no soldier can ever appear on a boss's threat table, loot roster
//     or participant HP scaling (world_boss.ts reads only the BOSS's own tables);
//   - never moving: they stand where the muster posted them until a fist says otherwise.
// Their facing and their braced stance (aggroTargetId pointed at the Foreman, which is
// what the renderer reads to hold a combat idle) are the muster module's to set, so this
// arm deliberately leaves both alone.
//
// Returns before the dispatcher's leaked-mob safety net, exactly like the ambient and
// escort arms, or that net would re-hostile them on their first tick. Draws no rng.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import type { Entity } from '../types';

/** True for a mob the muster posted (MobTemplate.musterSoldier). */
export function isMusterSoldier(mob: Entity): boolean {
  return MOBS[mob.templateId]?.musterSoldier === true;
}

/** One tick of a living soldier: pin him friendly, out of combat and on his post. */
export function holdMusterSoldier(_ctx: SimContext, mob: Entity): void {
  mob.hostile = false;
  mob.inCombat = false;
  mob.aiState = 'idle';
  mob.forcedTargetId = null;
  mob.forcedTargetTimer = 0;
  mob.wanderTarget = null;
  mob.despawnTimer = undefined;
  clearThreat(mob);
}
