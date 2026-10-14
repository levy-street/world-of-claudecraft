// The committed-tank roster raid encounters exclude from their non-tank
// mechanics (Ignivar's Brand of the Pyre, Varkhul's non-tank majors and the
// Master's Assembly add hand-off). The per-player rule is the shared
// isCommittedTank predicate (combat/tank_crit_immunity.ts), so it is form and
// posture aware: a Wildfang druid counts only in Bruin Form and a Warspirit
// shaman only in the Stonebound posture, never by the spec role alone.
// Draws no rng and reads only live SimContext views.

import { isCommittedTank } from '../combat/tank_crit_immunity';
import type { SimContext } from '../sim_context';

/** Entity ids of every connected player who is a committed tank right now. */
export function committedTankIds(ctx: Pick<SimContext, 'players' | 'entities'>): Set<number> {
  const result = new Set<number>();
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player && isCommittedTank(player, meta)) result.add(meta.entityId);
  }
  return result;
}
