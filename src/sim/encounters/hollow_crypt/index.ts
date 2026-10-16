// The Hollow Crypt finale (docs/design/dungeon-rework/hollow_crypt.md 5.4, the
// fourth pass): Morthen's entrance at the Rite Ring and the Knellwyrm his
// dying rite summons. One pass per tick over every live crypt claim, after the
// mob AI (called from instances/dungeons.ts updateInstances beside the Bastion
// and Temple encounters), so a rising boss or a wyrm on the wing owns its
// position for the tick the AI already ran.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { bossEngaged, claimBoss, cryptClaims } from './claim';
import { KNELLWYRM_ID, MORTHEN_ID } from './ids';
import { beginCrescendo, startDirge, tickIlvane } from './ilvane';
import { ILVANE_ID } from './ilvane_ids';
import { beginOrgan } from './ilvane_organ';
import { markPyreStrafe, startDreadBellow, tickFinale } from './knellwyrm';
import { beginKnell } from './knellwyrm_knell';
import { beginBridalFreeze, startLadyBar, tickLady } from './lady';
import { LADY_ID } from './lady_ids';
import { beginToll, startMarrowBar, tickMarrow } from './marrow';
import { MARROW_ID } from './marrow_ids';
import { beginRite, sendBoundSoul, startMorthenBar, tickMorthen } from './morthen';
import { candlesLit, lightCandle } from './morthen_candles';
import { markGrasp } from './morthen_grasp';
import { finishRite, tickMorthenRite, wakeRite } from './morthen_rise';

export * from './ids';
export { ILVANE_DEED } from './ilvane';
export * from './ilvane_ids';
export { KNELLWYRM_ARRIVAL_LOG, KNELLWYRM_DEED, MORTHEN_FINALE_YELL } from './knellwyrm';
export { LADY_DEED } from './lady';
export { EMBRACE_LIFT, EMBRACE_REACH, embraceHeight, embraceSlot } from './lady_embrace';
export * from './lady_ids';
export { MARROW_DEED, MARROW_TIDY_RADIUS } from './marrow';
export * from './marrow_ids';
export { MORTHEN_DEED } from './morthen';
export { nameTheDeadOrder } from './morthen_candles';
export { BOUND_SOUL_WALKER, gorgedStacks, soulAlcove } from './morthen_gravecall';
export * from './morthen_ids';
export { MORTHEN_RISE_YELL, playerInRing } from './morthen_rise';

/** One tick of every Hollow Crypt finale. */
export function tickCryptEncounters(ctx: SimContext): void {
  for (const inst of cryptClaims(ctx)) {
    const marrow = claimBoss(ctx, inst, MARROW_ID);
    if (marrow) tickMarrow(ctx, inst, marrow, bossEngaged(marrow));
    const lady = claimBoss(ctx, inst, LADY_ID);
    if (lady) tickLady(ctx, inst, lady, bossEngaged(lady));
    const ilvane = claimBoss(ctx, inst, ILVANE_ID);
    if (ilvane) tickIlvane(ctx, inst, ilvane, bossEngaged(ilvane));
    const morthen = claimBoss(ctx, inst, MORTHEN_ID);
    if (!morthen) continue;
    if (!tickMorthenRite(ctx, inst, morthen)) continue;
    tickMorthen(ctx, inst, morthen, bossEngaged(morthen));
    const st = morthen.cryptRite;
    if (st) tickFinale(ctx, inst, morthen, st);
  }
}

/** `/dev crypt rise [now|skip]` and `/dev crypt trigger <mechanic>`: drive
 *  the bosses and the finale by hand. Returns the log line. */
export function cryptDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  if (what === 'dirge' || what === 'organ' || what === 'crescendo') {
    const ilvane = claimBoss(ctx, inst, ILVANE_ID);
    const st = ilvane?.cryptBossFight;
    if (!ilvane || st?.kind !== 'ilvane') return 'Pull Cantor Ilvane first.';
    if (what === 'crescendo')
      return beginCrescendo(ilvane, st)
        ? 'Ilvane swells into her Crescendo.'
        : 'She is in it already.';
    if (st.organ || ilvane.castingAbility !== null) return 'Ilvane is busy; try again.';
    if (what === 'organ')
      return beginOrgan(ilvane, st) ? 'Ilvane rises for the Bone Organ.' : 'No.';
    return startDirge(ctx, inst, ilvane, st) ? 'Ilvane begins the Dirge of the Hollow.' : 'No.';
  }
  if (what === 'lament' || what === 'embrace' || what === 'freeze') {
    const lady = claimBoss(ctx, inst, LADY_ID);
    const st = lady?.cryptBossFight;
    if (!lady || st?.kind !== 'lady') return 'Pull the Lady of the Bonechill first.';
    if (what === 'freeze')
      return beginBridalFreeze(ctx, inst, lady, st)
        ? 'The Lady draws breath: the Bridal Freeze.'
        : 'The ravine is frozen already (or she is busy).';
    if (st.bar || st.embrace || lady.castingAbility !== null) return 'The Lady is busy; try again.';
    return startLadyBar(ctx, inst, lady, st, what) ? `The Lady begins: ${what}.` : 'No target.';
  }
  if (what === 'shovel' || what === 'grave' || what === 'blow' || what === 'toll') {
    const marrow = claimBoss(ctx, inst, MARROW_ID);
    const st = marrow?.cryptBossFight;
    if (!marrow || st?.kind !== 'marrow') return 'Pull Sexton Marrow first.';
    if (what === 'toll')
      return beginToll(ctx, inst, marrow, st)
        ? 'Marrow strides to the bell rope.'
        : 'Marrow is ringing already.';
    if (st.bar || st.toll || marrow.castingAbility !== null) return 'Marrow is busy; try again.';
    const bar = what === 'grave' ? 'measure' : what === 'shovel' ? 'shovel' : 'blow';
    return startMarrowBar(ctx, inst, marrow, st, bar) ? `Marrow begins: ${what}.` : 'No target.';
  }
  const morthen = claimBoss(ctx, inst, MORTHEN_ID);
  if (!morthen) return 'No Morthen in this run.';
  if (
    what === 'pulse' ||
    what === 'gravecall' ||
    what === 'rite' ||
    what === 'candle' ||
    what === 'reap' ||
    what === 'grasp'
  )
    return morthenDevTrigger(ctx, inst, morthen, what);
  if (what === 'rise') {
    tickMorthenRite(ctx, inst, morthen);
    return wakeRite(ctx, inst, morthen)
      ? 'The rite wakes under the ring.'
      : 'Morthen has risen already.';
  }
  if (what === 'skip') {
    finishRite(ctx, inst, morthen);
    return 'Morthen stands ready at the altar.';
  }
  const wyrm = claimBoss(ctx, inst, KNELLWYRM_ID);
  const st = wyrm?.knellwyrmFight;
  if (!wyrm || !st) return 'Pull the Knellwyrm first.';
  if (wyrm.castingAbility !== null || st.strafe || st.knell)
    return 'The Knellwyrm is busy; try again.';
  if (what === 'knell')
    return beginKnell(ctx, inst, wyrm, st)
      ? 'It takes wing: Burning Knell (heroic only on its own).'
      : 'It cannot take wing now.';
  if (what === 'strafe')
    return markPyreStrafe(ctx, inst, wyrm, st) ? 'It marks a Pyre Strafe.' : 'No target.';
  if (what === 'bellow') {
    startDreadBellow(wyrm, st);
    return 'It draws breath for a Dread Bellow.';
  }
  return 'Mechanics: shovel, grave, blow, toll, lament, embrace, freeze, dirge, organ, crescendo, rise, skip, pulse, gravecall, rite, candle, reap, grasp, strafe, bellow, knell.';
}

/** `/dev crypt trigger <pulse|gravecall|rite|candle|reap|grasp>`: Morthen's kit now. */
function morthenDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  morthen: Entity,
  what: string,
): string {
  const st = morthen.cryptBossFight;
  if (morthen.dead || st?.kind !== 'morthen')
    return 'Pull Morthen first (/dev crypt pull morthen).';
  if (what === 'rite')
    return beginRite(ctx, inst, morthen, st)
      ? 'Morthen raises the Unquiet Ward: relight the candles.'
      : 'The Rite has come already this fight.';
  if (what === 'candle') {
    if (st.act !== 'rite') return 'No Rite: /dev crypt trigger rite first.';
    // The next candle the group would light (the Ledger's on heroic).
    const i =
      st.order.length > 0
        ? (st.order[st.litOrder.length] ?? -1)
        : st.candles.findIndex((c) => !c.lit);
    if (i < 0) return 'Every candle burns.';
    lightCandle(ctx, inst, morthen, st, i, null);
    return `Candle ${i + 1} relit (${candlesLit(st)} of 4).`;
  }
  if (what === 'gravecall') {
    sendBoundSoul(ctx, inst, morthen, st);
    return 'A Bound Soul rises from its alcove.';
  }
  if (what === 'grasp')
    return markGrasp(ctx, inst, morthen, st) > 0 ? 'Grasp of the Grave.' : 'No one to grasp.';
  if (st.bar || morthen.castingAbility !== null) return 'Morthen is busy; try again.';
  if (what === 'reap') st.act = st.act === 'calling' ? 'last_rites' : st.act;
  return startMorthenBar(ctx, inst, morthen, st, what === 'reap' ? 'reap' : 'pulse')
    ? `Morthen begins: ${what}.`
    : 'Not now (the Rite holds him).';
}
