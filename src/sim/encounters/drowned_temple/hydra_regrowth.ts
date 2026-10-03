// The Mere Hydra's regrowth (sixth pass): a fallen head grows back 20 s after
// it fell while any other head still lives (at half its health, back in the
// fight on the same foe), so the group must bring the three down close
// together. The last head standing ends it: nothing grows back once all three
// are down. A wipe grows every fallen head back whole for the next attempt.
//
// A regrown head paid its XP, loot and kill credit on its first death
// (Entity.regrown, read by combat/damage.ts handleDeath), so the regrowth is
// never a farm. Zero rng.

import { cancelCorpseHarvestForCorpse } from '../../professions/corpse_harvest_session';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import type { Entity, HydraFightState } from '../../types';
import { HYDRA_REGROWTH, HYDRA_TUNING } from './ids';

const T = HYDRA_TUNING;

/** The line every player in the claim reads as a head grows back. */
export const HYDRA_REGROWTH_LOG = 'A severed head of the Mere Hydra grows back!';

/** Stand a fallen head back up at `share` of its health (no reward twice). */
export function regrowHead(ctx: SimContext, head: Entity, share: number): void {
  // A harvest reservation on the corpse never survives onto the living head.
  cancelCorpseHarvestForCorpse(ctx, head);
  head.corpseHarvestState = undefined;
  head.dead = false;
  head.regrown = true;
  head.hp = Math.max(1, Math.round(head.maxHp * share));
  head.lootable = false;
  head.loot = null;
  head.lootRecipientIds = undefined;
  head.harvestClaimedBy = null;
  head.tappedById = null;
  head.bossDamagers.clear();
  head.auras = [];
  head.castingAbility = null;
  head.castRemaining = 0;
  head.castTotal = 0;
  head.castTargetId = null;
  head.channeling = false;
  head.aiState = 'idle';
  head.aggroTargetId = null;
  head.inCombat = false;
  head.pos = { ...head.spawnPos, y: ctx.groundPos(head.spawnPos.x, head.spawnPos.z).y };
  head.prevPos = { ...head.pos };
  ctx.rebucket(head);
}

/** Grow back every head that has lain long enough while another lives.
 *  Returns how many grew back this tick. */
export function stepRegrowth(
  ctx: SimContext,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
): number {
  const living = heads.filter((h): h is Entity => h !== null && !h.dead);
  if (living.length === 0) return 0;
  let grown = 0;
  heads.forEach((h, i) => {
    const fell = st.diedAt[i];
    if (!h?.dead || fell === null || ctx.time - fell < T.regrowAfter) return;
    regrowHead(ctx, h, T.regrowShare);
    st.diedAt[i] = null;
    // Back into the same fight, on the same foe, with the pack's hate.
    const sibling = living[0];
    const foe =
      sibling.aggroTargetId !== null ? (ctx.entities.get(sibling.aggroTargetId) ?? null) : null;
    if (foe && !foe.dead) {
      ctx.aggroMob(h, foe, false);
      for (const [id, amount] of sibling.threat) addThreat(h, id, amount);
    }
    ctx.emit({
      type: 'spellfx',
      sourceId: h.id,
      targetId: h.id,
      school: 'nature',
      fx: 'nova',
      ability: HYDRA_REGROWTH,
    });
    ctx.emit({ type: 'log', text: HYDRA_REGROWTH_LOG, color: '#ff9f6a', entityId: h.id });
    grown++;
  });
  return grown;
}
