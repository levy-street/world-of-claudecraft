// The tide-pool summon (q_ps_mother_of_pearl / "Mother of Pearl"). Tidewarden
// Nel's quest grants a reusable Briny Lure on accept (QuestDef.requiredItems,
// so losing it can never strand the quest); USING it while standing at the
// tide pool calls Mister Crabs out of the shallows. Gated on carrying the
// quest, standing at the pool, and the boss not already prowling. The lure is
// never consumed and the summon can be repeated while the quest is active, so
// a wipe (or a kill whose pearl was never looted before the corpse faded)
// always has a retry. The pure check is unit-tested.

import { summonQuestMob } from '../encounters/quest_summon';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

export const CRAB_QUEST_ID = 'q_ps_mother_of_pearl';
export const LURE_ITEM_ID = 'ps_briny_lure';
export const CRAB_MOB_ID = 'mister_crabs';
/** The tide pool on the strand west of the wreck line (Guy's spot). */
export const CRAB_SUMMON_SITE = { x: -398, z: -17 } as const;
/** Must be standing AT the pool: the lesson is "go to the marked spot". */
export const CRAB_SUMMON_RANGE = 8;
/** A raised king returns to the shallows after five minutes, even mid-fight. */
const CRAB_DESPAWN_SECONDS = 5 * 60;

export type CrabSummonReason = 'notOnQuest' | 'questDone' | 'tooFar' | 'alreadyProwling';
export type CrabSummonResult = { ok: true } | { ok: false; reason: CrabSummonReason };

export function crabSummonCheck(opts: {
  questState: 'active' | 'ready' | null;
  distance: number;
  bossAlive: boolean;
}): CrabSummonResult {
  if (opts.questState === null) return { ok: false, reason: 'notOnQuest' };
  // 'ready' means the kill is credited AND the pearl is in hand: nothing
  // left to summon for, so point at the hand-in instead of respawning him.
  if (opts.questState === 'ready') return { ok: false, reason: 'questDone' };
  if (opts.bossAlive) return { ok: false, reason: 'alreadyProwling' };
  if (opts.distance > CRAB_SUMMON_RANGE) return { ok: false, reason: 'tooFar' };
  return { ok: true };
}

const REASON_MESSAGE: Record<CrabSummonReason, string | null> = {
  notOnQuest: null, // no quest: silent, so a stray use is not spammy
  questDone: 'You have what you came for. Tidewarden Nel waits on your prize.',
  tooFar: 'Carry the lure to the tide pool west of the wreck line.',
  alreadyProwling: 'Mister Crabs already prowls the pool!',
};

/** A live Mister Crabs, optionally only the one tapped to `ownerPid`. The
 *  summon gate passes the owner (a shared island: each quest holder raises
 *  and fights their OWN king, never queues behind a stranger's); the coach's
 *  "is he up" read passes no owner and takes any. */
export function liveCrabBoss(entities: Iterable<Entity>, ownerPid?: number): Entity | null {
  for (const e of entities) {
    if (e.kind !== 'mob' || e.templateId !== CRAB_MOB_ID || e.dead) continue;
    if (ownerPid !== undefined && e.tappedById !== ownerPid) continue;
    return e;
  }
  return null;
}

// Using the Briny Lure at the tide pool summons Mister Crabs. The summon
// itself (spawn, tap to the summoner, opening aggro, the yell) is the shared
// summonQuestMob; this handler owns only the island's gates and messages.
export function useBrinyLure(ctx: SimContext, player: Entity, meta: PlayerMeta): void {
  const qp = meta.questLog.get(CRAB_QUEST_ID);
  const questState = qp && (qp.state === 'active' || qp.state === 'ready') ? qp.state : null;
  const check = crabSummonCheck({
    questState,
    distance: dist2d(player.pos, { x: CRAB_SUMMON_SITE.x, y: player.pos.y, z: CRAB_SUMMON_SITE.z }),
    bossAlive: liveCrabBoss(ctx.entities.values(), meta.entityId) !== null,
  });
  if (!check.ok) {
    const message = REASON_MESSAGE[check.reason];
    if (message) ctx.error(meta.entityId, message);
    return;
  }
  summonQuestMob(
    ctx,
    CRAB_MOB_ID,
    { x: CRAB_SUMMON_SITE.x, y: 0, z: CRAB_SUMMON_SITE.z },
    meta.entityId,
    { perOwner: true, hardDespawnSeconds: CRAB_DESPAWN_SECONDS },
  );
}
