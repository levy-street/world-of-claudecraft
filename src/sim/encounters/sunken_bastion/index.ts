// The Sunken Bastion boss encounters (docs/design/dungeon-rework/
// sunken_bastion.md): Knight-Commander Olen, the Gaol Turnkey (the gaol's
// miniboss), Gaoler Ossick and Vael the Fogbinder. One pass per tick over every live Bastion claim, after the mob AI
// (called from instances/dungeons.ts updateInstances, beside the trash kit),
// so a planted charge, a pinned veil or a hauled player owns its position for
// the tick the AI already moved it.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { bastionClaims, bossEngaged, claimBoss, grantClaimDeed } from './claim';
import { OLEN_ID, OSSICK_ID, TURNKEY_ID, TURRETBACK_ID, VAEL_ID } from './ids';
import { markOathboundCharge, tickOlen } from './olen';
import { startDrownedAnchor, startShacklePair, tickOssick } from './ossick';
import { startIronCage, tickTurnkey } from './turnkey';
import { startFogVeil, startShadowstep, tickVael } from './vael';

export { pickMarkTargets } from './claim';
export * from './ids';
export { pickChargeTarget, standingButtresses } from './olen';
export { cagedBy, tryCageStruggle } from './turnkey';
export { beaconLamp } from './vael';
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
    const hermit = claimBoss(ctx, inst, TURRETBACK_ID);
    if (hermit) watchHermit(ctx, inst, hermit);
  }
}

export const TURRETBACK_DEED = 'dgn_turretback';

/** The Turretback Hermit: note a withdraw this pull; slain without one, the
 *  Eviction Notice deed goes to the claim. */
function watchHermit(ctx: SimContext, inst: InstanceSlot, hermit: Entity): void {
  const st = hermit.bastionFight?.kind === 'hermit' ? hermit.bastionFight : null;
  if (hermit.dead) {
    if (st) {
      if (!st.withdrew) grantClaimDeed(ctx, inst, TURRETBACK_DEED);
      hermit.bastionFight = undefined;
    }
    return;
  }
  if (!bossEngaged(hermit)) {
    if (st) hermit.bastionFight = undefined;
    return;
  }
  const withdrew = hermit.trashKit?.withdrawn === true;
  if (!st) hermit.bastionFight = { kind: 'hermit', withdrew };
  else if (withdrew) st.withdrew = true;
}

/** `/dev bastion trigger <charge|cage|anchor|shackle|veil|reap|surge>`: fire an
 *  engaged boss's mechanic now. Returns the log line. */
export function bastionDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  if (what === 'charge') {
    const olen = claimBoss(ctx, inst, OLEN_ID);
    const st = olen?.bastionFight;
    if (!olen || st?.kind !== 'olen' || st.lane || st.dash) return 'Pull Olen first.';
    if (olen.castingAbility !== null) return 'Olen is busy; try again.';
    return markOathboundCharge(ctx, inst, olen, st) ? 'Olen marks his charge.' : 'No target.';
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
    if (!vael || st?.kind !== 'vael' || st.veil || st.reap) return 'Pull Vael first.';
    return startShadowstep(ctx, inst, vael, st) ? 'Vael sinks into the shadows.' : 'No target.';
  }
  if (what === 'veil') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    const st = vael?.bastionFight;
    if (!vael || st?.kind !== 'vael' || st.veil) return 'Pull Vael first.';
    startFogVeil(ctx, inst, vael, st);
    return 'Vael melts into the fog.';
  }
  if (what === 'surge') {
    const vael = claimBoss(ctx, inst, VAEL_ID);
    const st = vael?.bastionFight;
    if (!vael || st?.kind !== 'vael') return 'Pull Vael first.';
    st.surgeTimer = 0;
    return 'Vael draws a Mist Surge.';
  }
  return 'Mechanics: charge, cage, anchor, shackle, veil, reap, surge.';
}
