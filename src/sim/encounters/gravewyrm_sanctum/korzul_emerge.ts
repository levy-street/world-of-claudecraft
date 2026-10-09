// Korzul's Break Free (design 6.3), the cinematic of his waking, driven on
// his body along the plan in korzul_emerge_plan.ts: the Calving Face bursts
// and he tears out of it at its foot (Break Free's bar), climbs, glides over
// the lake to the arena centre and drops onto it. Through it he is out of
// reach the way his flights are (G26 on mob/flight.ts: `hostile` false and
// `damageImmune` every tick, his swing held), no strike, no plate burns, no
// quench-water, and every clock of his kit waits.
//
// The wake is NOT a pull (the playtest: he must never rush the player who
// woke him). In the ice he is held by the encounter (Entity.encounterHeld:
// the mob AI never scans, pulls or moves him, nothing can target him). Any
// living claim player out on the plates within KORZUL_WAKE_RADIUS of the
// centre wakes him: the cinematic plays OUT of combat (`waking`), and at the
// touchdown he is handed back, hostile, standing on the centre (his new
// home) in 'ready', facing the shore. Only then does the ordinary pull take
// him: a player inside his aggro radius, or a hit. The Hollow Ward seals and
// the chain pull answers at THAT pull, as for any boss. A wipe sends him home
// to the centre, ready again; the cinematic never replays.
//
// While he is held nothing pulls him: not a hit, not his aggro radius, not a
// premature boss chain pull (the mob AI's encounterHeld arm clears any aggro
// before the encounter pass). Only a pull driven straight through the
// encounter tick (the tests' harness) still plays the cinematic as the fight's
// opening and lands him in his fight. At the touchdown, a player already
// standing inside his aggro radius of the centre (18 yd; the landing shove only
// clears his body) pulls him on the next tick: that is the ordinary pull, not
// the wake.
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

/** The wake's trigger: is a living claim player out on the plates, inside
 *  the wake ring? It grants NO aggro: the caller starts the cinematic out of
 *  combat. */
export function wakeKorzul(ctx: SimContext, inst: InstanceSlot, boss: Entity): boolean {
  if (boss.dead || boss.hp <= 0 || boss.inCombat) return false;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const at = localOf(ctx, inst, p);
    if (inKorzulWakeRing(at.x, at.z)) return true;
  }
  return false;
}

/** Hold him in the ice: the encounter owns him (no aggro scan, no target, no
 *  damage) until the wake hands him back. */
export function holdInIce(boss: Entity): void {
  boss.encounterHeld = true;
  boss.damageImmune = true;
  boss.hostile = false;
}

/** Awake and free on the centre, out of his fight: handed back to the mob AI,
 *  hostile and in reach, his home the arena centre (an evade walks him back
 *  there). */
export function standReady(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  st.phase = 'ready';
  st.waking = false;
  boss.encounterHeld = false;
  releaseAloft(boss);
  homeOnCentre(ctx, inst, boss);
}

/** Free of the ice, his home is the arena centre. */
function homeOnCentre(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const o = ctx.instanceOriginOf(inst);
  boss.spawnPos = ctx.groundPos(o.x + KORZUL_EMERGE_TO.x, o.z + KORZUL_EMERGE_TO.z);
}

/** The ice bursts (Break Free's bar) and the cinematic begins: a wake
 *  (`waking`, out of combat) or a forced pull's opening. */
export function startEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  waking = false,
): void {
  // The face still holds him: he tears out at its foot. Already free (a
  // re-pull after a wipe): he plays it from where he stands.
  const inIce = storyStep(ctx, inst) < 8;
  st.emergeFrom = inIce ? { ...KORZUL_EMERGE_FROM } : localOf(ctx, inst, boss);
  st.phase = 'emerge';
  st.waking = waking;
  st.pt = 0;
  st.plantedAt = null;
  // A wake keeps him held through the flight (no aggro scan mid-air).
  boss.encounterHeld = waking;
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

/** He is on the centre and in reach: his fight begins (`fight`), or he
 *  stands ready, out of it (a wake). */
function endEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  fight: boolean,
): void {
  const to = KORZUL_EMERGE_TO;
  placeFlier(ctx, inst, boss, to.x, to.z, floorUnder(ctx, inst, to.x, to.z));
  clearCastIf(boss, KORZUL_BREAK_FREE);
  boss.encounterHeld = false;
  releaseAloft(boss);
  st.pt = 0;
  st.plantedAt = null;
  st.emergeFrom = null;
  if (fight) {
    st.phase = 'ground';
    st.waking = false;
    homeOnCentre(ctx, inst, boss);
    return;
  }
  standReady(ctx, inst, boss, st);
  // He lands looking down the lake at the shore the group came from.
  boss.facing = Math.PI;
  boss.prevFacing = Math.PI;
}

/** One tick of the cinematic. Returns true on the tick he touches down;
 *  `fight`: land him in his fight (a forced pull), else ready. */
export function stepEmerge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  fight = true,
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
  endEmerge(ctx, inst, boss, st, fight);
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
  endEmerge(ctx, inst, boss, st, true);
}
