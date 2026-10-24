// The Sunken Bastion boss encounters (docs/design/dungeon-rework/
// sunken_bastion.md): Knight-Commander Olen, the Gaol Turnkey (the gaol's
// miniboss), Gaoler Ossick and Vael the Fogbinder. One pass per tick over every live Bastion claim, after the mob AI
// (called from instances/dungeons.ts updateInstances, beside the trash kit),
// so a planted charge, a pinned veil or a hauled player owns its position for
// the tick the AI already moved it.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { bastionClaims, bossEngaged, claimBoss } from './claim';
import { tickGhostCaptain } from './ghost_captain';
import { OLEN_ID, OSSICK_ID, TURNKEY_ID, TURRETBACK_ID, VAEL_ID } from './ids';
import { beginOath, startOlenBar, tickOlen } from './olen';
import { startDrownedAnchor, startShacklePair, tickOssick } from './ossick';
import { startIronCage, tickTurnkey } from './turnkey';
import { startShadowstep, tickVael } from './vael';
import { buryVael, finishVaelIntro } from './vael_intro';
import { startVeilGather } from './vael_veil_gather';

export { pickMarkTargets } from './claim';
export { startGhostCaptainMove, TURRETBACK_DEED } from './ghost_captain';
export * from './ghost_captain_ids';
export * from './ids';
export { OLEN_DEED, OLEN_VIGIL_MAX } from './olen';
export { cagedBy, tryCageStruggle } from './turnkey';
export { beaconLamp } from './vael';
export { playerOnCrown } from './vael_intro';
export { VAEL_INTRO_LINES, VAEL_RETURN_LINE, VAEL_VEIL_LINES } from './vael_lines';
export { bastionWardHitPoints } from './ward_hits';

/** One tick of every Sunken Bastion boss fight. */
export function tickBastionEncounters(ctx: SimContext): void {
  for (const inst of bastionClaims(ctx)) {
    const olen = claimBoss(ctx, inst, OLEN_ID);
    if (olen) tickOlen(ctx, inst, olen, bossEngaged(olen));
    const turnkey = claimBoss(ctx, inst, TURNKEY_ID);
    if (turnkey) tickTurnkey(ctx, inst, turnkey, bossEngaged(turnkey));
    const ossick = claimBoss(ctx, inst, OSSICK_ID);
    if (ossick) tickOssick(ctx, inst, ossick, bossEngaged(ossick));
    const vael = claimBoss(ctx, inst, VAEL_ID);
    if (vael) tickVael(ctx, inst, vael, bossEngaged(vael));
    const captain = claimBoss(ctx, inst, TURRETBACK_ID);
    if (captain) tickGhostCaptain(ctx, inst, captain, bossEngaged(captain));
  }
}

/** `/dev bastion trigger <brine|bulwark|sentence|oath|cage|anchor|shackle|veil|
 *  reap|surge|intro|introshort|introskip>`: fire an engaged boss's mechanic now (the intro ones
 *  bury Vael for his full or short entrance, or skip it). Returns the log line. */
export function bastionDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  if (what === 'brine' || what === 'bulwark' || what === 'sentence' || what === 'oath') {
    const olen = claimBoss(ctx, inst, OLEN_ID);
    const st = olen?.bastionFight;
    if (!olen || st?.kind !== 'olen') return 'Pull Olen first.';
    if (what === 'oath') {
      if (!beginOath(ctx, inst, olen, st)) return 'Olen has already sworn his Oath this fight.';
      return 'Olen kneels: the Unbroken Oath.';
    }
    if (st.bar || olen.castingAbility !== null) return 'Olen is busy; try again.';
    return startOlenBar(ctx, inst, olen, st, what) ? `Olen begins: ${what}.` : 'No target.';
  }
  if (what === 'cage') {
    const turnkey = claimBoss(ctx, inst, TURNKEY_ID);
    const st = turnkey?.bastionFight;
    if (!turnkey || st?.kind !== 'turnkey') return 'Pull the Gaol Turnkey first.';
    if (turnkey.castingAbility !== null) return 'The Turnkey is busy; try again.';
    return startIronCage(ctx, inst, turnkey, st) ? 'The Turnkey drops an Iron Cage.' : 'No target.';
  }
  if (what === 'anchor' || what === 'shackle') {
    const ossick = claimBoss(ctx, inst, OSSICK_ID);
    const st = ossick?.bastionFight;
    if (!ossick || st?.kind !== 'ossick') return 'Pull Ossick first.';
    if (ossick.castingAbility !== null) return 'Ossick is busy; try again.';
    if (what === 'anchor')
      return startDrownedAnchor(ctx, inst, ossick, st) ? 'Ossick hurls his anchor.' : 'No target.';
    return startShacklePair(ctx, inst, ossick, st) ? 'Ossick throws the shackles.' : 'No pair.';
  }
  if (what === 'reap') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    const st = vael?.bastionFight;
    if (!vael || st?.kind !== 'vael' || st.veil || st.reap || st.gather) return 'Pull Vael first.';
    return startShadowstep(ctx, inst, vael, st) ? 'Vael sinks into the shadows.' : 'No target.';
  }
  if (what === 'veil') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    const st = vael?.bastionFight;
    if (!vael || st?.kind !== 'vael' || st.veil || st.gather) return 'Pull Vael first.';
    if (st.reap) return 'Vael is crossing the shadows; try again.';
    startVeilGather(ctx, inst, vael, st);
    return 'The fog gathers on the crown.';
  }
  if (what === 'intro' || what === 'introshort' || what === 'introskip') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    if (!vael || vael.dead) return 'Vael is not standing.';
    if (bossEngaged(vael)) return 'Vael is fighting; wipe or reset first.';
    if (what === 'introskip') {
      finishVaelIntro(ctx, inst, vael);
      return 'Vael stands at his place, ready.';
    }
    // Buried: the next tick with a player on the crown plays the entrance.
    buryVael(ctx, inst, vael, what === 'introshort');
    return 'Vael waits under the crown: step onto it.';
  }
  if (what === 'surge') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    const st = vael?.bastionFight;
    if (!vael || st?.kind !== 'vael') return 'Pull Vael first.';
    st.surgeTimer = 0;
    return 'Vael draws a Mist Surge.';
  }
  return 'Mechanics: brine, bulwark, sentence, oath, cage, anchor, shackle, veil, reap, surge, intro, introshort, introskip.';
}
