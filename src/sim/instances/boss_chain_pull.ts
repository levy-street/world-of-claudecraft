// The premature-boss-pull punish, for the dungeons that opt in via
// DungeonDef.bossChainPull.
//
// Classic behavior is that a group can run past trash, pull the final boss, and
// fight it alone. Where a dungeon marks bossChainPull, aggroing its boss instead
// wakes EVERY mob still alive in that instance and sends all of them at the
// puller at once. Skipping trash stops being a shortcut and becomes a wipe, so
// the route has to be cleared on the way in.
//
// The mechanic is self-gating rather than carrying an explicit "is this
// premature" test: it pulls whatever is still alive, so a group that cleared the
// route finds nothing left to pull and the boss fight starts normally. One
// skipped pack is still a skipped pack, and it answers the call.
//
// Pure entity-state mutation on the same fields aggroMob and rallyFleeingAllies
// already set, and it draws NO rng, so the shared draw order (and the parity
// goldens) are untouched. Runs once per boss pull: aggroMob early-returns for a
// boss already in chase/attack, and re-arms if the boss evades and resets.

import { DUNGEONS, MOBS } from '../data';
import { markChainPullInbound } from '../mob/chain_pull_transit';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import type { Entity } from '../types';
import { instanceAt } from './dungeons';

/**
 * Pull every living, idle mob of `boss`'s instance onto `target`.
 *
 * No-ops unless `boss` is a boss-flagged template standing in a claimed
 * instance whose dungeon opted into bossChainPull. Returns the number of mobs
 * newly pulled (0 when the route was already cleared).
 */
export function chainPullInstanceOnBossAggro(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
): number {
  if (!MOBS[boss.templateId]?.boss) return 0;
  const inst = instanceAt(ctx, boss.pos);
  if (!inst || !DUNGEONS[inst.dungeonId]?.bossChainPull) return 0;

  let pulled = 0;
  for (const id of inst.mobIds) {
    const mob = ctx.entities.get(id);
    if (
      !mob ||
      mob.id === boss.id ||
      mob.kind !== 'mob' ||
      mob.dead ||
      !mob.hostile ||
      mob.ownerId !== null ||
      mob.aiState !== 'idle'
    ) {
      continue;
    }
    mob.aiState = 'chase';
    mob.aggroTargetId = target.id;
    mob.inCombat = true;
    // Anchor the leash on the PULLER, not on the mob's own position as a social
    // pull does. Wildheart's route is ~180 yards end to end and
    // DUNGEON_LEASH_DISTANCE is 70, so a mob anchored where it stood would run
    // 70 yards, hit its leash, and evade home without ever reaching the fight,
    // which would quietly turn the whole mechanic into a no-op for the far half
    // of the dungeon. Anchoring on the puller keeps a real leash around the
    // FIGHT: once a mob has arrived it can be dragged 70 yards from the pull
    // point and no further, so the group cannot walk the dungeon out the door.
    //
    // The anchor alone is not enough, and shipping it alone is what broke this
    // mechanic past the shrine: a mob that starts 170 yards from the puller is
    // already outside that same sphere, so the leash prelude evaded it home on
    // its first engaged tick. The inbound flag suspends the soft leash for the
    // crossing and spends itself on arrival (mob/chain_pull_transit.ts).
    mob.leashAnchor = { ...target.pos };
    markChainPullInbound(mob);
    addThreat(mob, target.id, 1); // seed the hate table, as aggroMob does
    pulled++;
  }
  return pulled;
}
