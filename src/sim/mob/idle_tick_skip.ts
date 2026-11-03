// The idle-mob throttle: whether a mob's AI tick may be skipped this tick because it is
// idle and outside every player's interest (SimConfig.idleMobTickRadius; the server and
// the offline world pass the interest-drop radius, the RL env its own 80). Moved here
// from the Sim coordinator so a system module can ask the same question the mob loop
// asks (seasonal/scarecrow.ts: a night boss due on his pole while nobody watches,
// mob/slumber.ts settleUnwatchedSlumber). Pure read of the world: zero rng, no writes.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { isInertInstanceCorpse } from './locomotion';

export function shouldSkipIdleMobTick(ctx: SimContext, mob: Entity): boolean {
  const radius = ctx.cfg.idleMobTickRadius ?? 0;
  if (radius <= 0) return false;
  if (mob.dead) {
    // Instance corpse fields (a cleared rift floor's packs) never decay or
    // respawn, so once every dead-branch effect is provably spent the corpse
    // stops paying updateMob. Radius-gated like the live cull: the radius is
    // the interest-drop radius, so a skipped corpse is outside every
    // player's replicated view EXCEPT a viewer's own target (targets get
    // NPC_DROP_RADIUS, slightly wider); that is safe today because the only
    // frozen fields are two timers nothing serializes, and any change to
    // that must re-check this exception. Dead mobs draw no rng, so the skip
    // cannot shift the shared draw order.
    if (!isInertInstanceCorpse(mob)) return false;
  } else if (
    mob.ownerId !== null ||
    mob.aiState !== 'idle' ||
    mob.inCombat ||
    mob.auras.length > 0
  ) {
    return false;
  }
  if (ctx.players.size === 0) return true;
  return !ctx.playerGrid.hasInRadius(mob.pos.x, mob.pos.z, radius);
}
