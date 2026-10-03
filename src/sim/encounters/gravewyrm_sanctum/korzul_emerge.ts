// Korzul's Break Free (design 6.3), the cinematic of his pull, driven on his
// body along the plan in korzul_emerge_plan.ts: the Calving Face bursts and
// he tears out of it at its foot (Break Free's bar), climbs, glides over the
// lake to the arena centre and drops onto it. Only the touchdown begins his
// fight: until then he is out of reach the way his flights are (G26 on
// mob/flight.ts: in combat, his threat kept, `hostile` false and
// `damageImmune` every tick, his swing held), no strike, no plate burns, no
// quench-water, and every clock of his kit waits.
//
// The pull: the template's own aggro, a hit, or any living claim player out
// on the plates within KORZUL_WAKE_RADIUS of the centre (an ordinary aggro,
// so the chain pull and the Hollow Ward's seal behave as for any pull). With
// the face still whole he starts at its foot (KORZUL_EMERGE_FROM); once the
// ice is gone (story step 8: a re-pull after a wipe) he plays it from where
// he stands.
//
// Every visible state rides existing fields: the bar, `pos` (`pos.y` the
// height), `facing`, one `nova` spellfx at the touchdown. Zero rng.

import { applyKnockback } from '../../knockback';
import { floorUnder, holdAloft, placeFlier, releaseAloft } from '../../mob/flight';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity } from '../../types';
import { KORZUL_TOUCHDOWN } from './boss_ids';
import { claimPlayers, clearCastIf, localOf, startBar } from './claim';
import { KORZUL_BREAK_FREE } from './ids';
import {
  emergeFacing,
  emergePose,
  inKorzulWakeRing,
  KORZUL_EMERGE,
  KORZUL_EMERGE_FROM,
  KORZUL_EMERGE_SECONDS,
  KORZUL_EMERGE_TO,
  KORZUL_LANDING_REACH,
  KORZUL_LANDING_SHOVE,
} from './korzul_emerge_plan';
import type { KorzulFightState } from './korzul_state';
import { storyStep } from './story';

/** His sim-English line as the face bursts (re-localized by the client's
 *  EXACT matcher, src/ui/sim_i18n.ts). */
export const KORZUL_BREAK_FREE_LOG =
  'The Calving Face bursts apart! Korzul the Gravewyrm tears himself free of the ice.';

/** Put him where the plan has him at `t`. */
function poseAt(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  const from = st.emergeFrom ?? KORZUL_EMERGE_FROM;
  const p = emergePose(st.pt, from);
  placeFlier(ctx, inst, boss, p.x, p.z, floorUnder(ctx, inst, p.x, p.z) + p.h);
  const yaw = emergeFacing(from);
  if (yaw !== null) boss.facing = yaw;
}

/** The pull's trigger: the first living claim player (claim order) out on
 *  the plates wakes an idle Korzul through the ordinary aggro. Returns true
 *  when he woke. */
export function wakeKorzul(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  if (boss.dead || boss.hp <= 0 || boss.aiState !== 'idle' || boss.inCombat) return false;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const at = localOf(ctx, inst, p);
    if (inKorzulWakeRing(at.x, at.z) && ctx.aggroMob(boss, p, false)) return true;
  }
  return false;
}

/** The pull: the ice bursts (Break Free's bar) and the cinematic begins. */
export function startEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  // The face still holds him: he tears out at its foot. Already free (a
  // re-pull after a wipe): he plays it from where he stands.
  const inIce = storyStep(ctx, inst) < 8;
  st.emergeFrom = inIce ? { ...KORZUL_EMERGE_FROM } : localOf(ctx, inst, boss);
  st.phase = 'emerge';
  st.pt = 0;
  st.plantedAt = null;
  holdAloft(boss);
  poseAt(ctx, inst, boss, st);
  // Hidden until the burst: no streak across the lake from where he lay.
  boss.prevPos = { ...boss.pos };
  boss.prevFacing = boss.facing;
  startBar(boss, KORZUL_BREAK_FREE, KORZUL_EMERGE.burst, null);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: KORZUL_BREAK_FREE,
  });
  if (inIce)
    ctx.emit({ type: 'log', text: KORZUL_BREAK_FREE_LOG, color: '#ff9a4a', entityId: boss.id });
}

/** He is on the centre and in reach: the fight begins. */
function endEmerge(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  const to = KORZUL_EMERGE_TO;
  placeFlier(ctx, inst, boss, to.x, to.z, floorUnder(ctx, inst, to.x, to.z));
  clearCastIf(boss, KORZUL_BREAK_FREE);
  releaseAloft(boss);
  st.phase = 'ground';
  st.pt = 0;
  st.plantedAt = null;
  st.emergeFrom = null;
}

/** One tick of the cinematic. Returns true on the tick he touches down. */
export function stepEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): boolean {
  holdAloft(boss);
  st.pt += DT;
  if (boss.castingAbility === KORZUL_BREAK_FREE) {
    boss.castRemaining = Math.max(0, KORZUL_EMERGE.burst - st.pt);
    if (st.pt >= KORZUL_EMERGE.burst - 1e-9) clearCastIf(boss, KORZUL_BREAK_FREE);
  }
  if (st.pt < KORZUL_EMERGE_SECONDS - 1e-9) {
    poseAt(ctx, inst, boss, st);
    return false;
  }
  endEmerge(ctx, inst, boss, st);
  // The touchdown: the ice under him groans (a frost burst on the centre)
  // and whoever stood under him is thrown clear. No damage.
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: KORZUL_TOUCHDOWN,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > KORZUL_LANDING_REACH) continue;
    applyKnockback(ctx, boss, p, KORZUL_LANDING_SHOVE);
  }
  return true;
}

/** Skip whatever is left of the cinematic (dev triggers): he stands on the
 *  centre, in reach, his fight begun. No fx, no shove. */
export function skipEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  endEmerge(ctx, inst, boss, st);
}
