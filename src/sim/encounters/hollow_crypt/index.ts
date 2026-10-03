// The Hollow Crypt finale (docs/design/dungeon-rework/hollow_crypt.md 5.4, the
// fourth pass): Morthen's entrance at the Rite Ring and the Knellwyrm his
// dying rite summons. One pass per tick over every live crypt claim, after the
// mob AI (called from instances/dungeons.ts updateInstances beside the Bastion
// and Temple encounters), so a rising boss or a wyrm on the wing owns its
// position for the tick the AI already ran.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { claimBoss, cryptClaims } from './claim';
import { KNELLWYRM_ID, MORTHEN_ID } from './ids';
import { markPyreStrafe, startDreadBellow, tickFinale } from './knellwyrm';
import { finishRite, tickMorthenRite, wakeRite } from './morthen_rise';

export * from './ids';
export { KNELLWYRM_ARRIVAL_LOG, KNELLWYRM_DEED, MORTHEN_FINALE_YELL } from './knellwyrm';
export { MORTHEN_RISE_YELL, playerInRing } from './morthen_rise';

/** One tick of every Hollow Crypt finale. */
export function tickCryptEncounters(ctx: SimContext): void {
  for (const inst of cryptClaims(ctx)) {
    const morthen = claimBoss(ctx, inst, MORTHEN_ID);
    if (!morthen) continue;
    if (!tickMorthenRite(ctx, inst, morthen)) continue;
    const st = morthen.cryptRite;
    if (st) tickFinale(ctx, inst, morthen, st);
  }
}

/** `/dev crypt rise [now|skip]` and `/dev crypt trigger <strafe|bellow>`:
 *  drive the finale by hand. Returns the log line. */
export function cryptDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  const morthen = claimBoss(ctx, inst, MORTHEN_ID);
  if (!morthen) return 'No Morthen in this run.';
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
  if (wyrm.castingAbility !== null || st.strafe) return 'The Knellwyrm is busy; try again.';
  if (what === 'strafe')
    return markPyreStrafe(ctx, inst, wyrm, st) ? 'It marks a Pyre Strafe.' : 'No target.';
  if (what === 'bellow') {
    startDreadBellow(wyrm, st);
    return 'It draws breath for a Dread Bellow.';
  }
  return 'Mechanics: rise, skip, strafe, bellow.';
}
