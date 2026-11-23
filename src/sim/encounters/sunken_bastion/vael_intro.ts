// Vael the Fogbinder's entrance on the Beacon Crown. He is not standing on the
// roof when the group climbs the crown stair: he lies BURIED under the flags
// (non-hostile, immune, held by the encounter so the mob AI never pulls or
// moves him). The first living player to step onto the crown wakes him:
//
//   rise    1.2 s  he rises out of the roof (the Emerge rise, as the veil's)
//   speak   1.6 s  he faces the nearest of them and speaks
//   sink    0.8 s  he sinks back under the flags (the Vanish sink)
//   under   0.3 s  he crosses under the roof to the next spot
//
// three times round the Fogbeacon, then one last rise at his own place, a
// last line, and only THERE is he handed back hostile and touchable (the
// ordinary aggro takes it from there). Full entrance 14.5 s, four lines.
// After a wipe he waits out the reset, sinks at his place once nobody living
// stands on the crown, and the next climb plays the short entrance: one rise
// at his place and one line (2.8 s). Pulled before he ever woke (a test, a
// dev jump into the fight) he skips it. Zero rng; every visible beat rides
// existing fields (his cast bars, his height, his Shrouded aura, the yells).

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type VaelIntroState } from '../../types';
import { claimPlayers, clearCastIf, dropAuraById, startBar } from './claim';
import {
  BEACON,
  CROWN,
  VAEL_INTRO_RISE,
  VAEL_INTRO_STOPS,
  VAEL_SHROUDED,
  VAEL_SINK,
  VAEL_TUNING,
} from './ids';
import { VAEL_INTRO_LINES, VAEL_RETURN_LINE, vaelSay } from './vael_lines';

const T = VAEL_TUNING;
const LAST = VAEL_INTRO_STOPS.length - 1;

function freshIntro(): VaelIntroState {
  return { phase: 'buried', played: false, short: false, stop: 0, part: 'rise', t: 0 };
}

/** Hold him for the entrance: inert, non-hostile, untouchable. */
function hold(e: Entity): void {
  e.encounterHeld = true;
  e.damageImmune = true;
  e.hostile = false;
  e.inCombat = false;
  e.aggroTargetId = null;
  e.aiState = 'idle';
  e.autoAttack = false;
  if (!e.auras.some((a) => a.id === VAEL_SHROUDED)) {
    e.auras.push({
      id: VAEL_SHROUDED,
      name: 'Shrouded',
      kind: 'buff_dr',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: 0,
      sourceId: e.id,
      school: 'shadow',
      undispellable: true,
    });
  }
}

/** Hand him back to the fight: hostile and touchable again. */
function release(e: Entity): void {
  e.encounterHeld = false;
  e.damageImmune = false;
  e.hostile = true;
  dropAuraById(e, VAEL_SHROUDED);
  clearCastIf(e, VAEL_INTRO_RISE, VAEL_SINK);
}

/** Stand him at an instance-local spot, `down` yards under the flags. */
function placeAt(
  ctx: SimContext,
  inst: InstanceSlot,
  e: Entity,
  x: number,
  z: number,
  down: number,
): void {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + x, o.z + z);
  e.pos.x = g.x;
  e.pos.y = g.y - down;
  e.pos.z = g.z;
  e.prevPos = { ...e.pos };
  ctx.grid.update(e);
}

/** A living claim player on the crown's floor, inside its rim (the nearest to
 *  `x, z` when several stand there), or null. */
export function playerOnCrown(
  ctx: SimContext,
  inst: InstanceSlot,
  x: number = CROWN.x,
  z: number = CROWN.z,
): Entity | null {
  const o = ctx.instanceOriginOf(inst);
  const floor = ctx.groundPos(o.x + CROWN.x + CROWN.r * 0.6, o.z + CROWN.z).y;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const p of claimPlayers(ctx, inst)) {
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    if (Math.hypot(lx - CROWN.x, lz - CROWN.z) > CROWN.r - T.introTriggerInset) continue;
    if (p.pos.y < floor - 4) continue;
    const d = Math.hypot(lx - x, lz - z);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Turn him to the nearest player on the crown (else toward the beacon). */
function faceCrowd(ctx: SimContext, inst: InstanceSlot, e: Entity): void {
  const o = ctx.instanceOriginOf(inst);
  const lx = e.pos.x - o.x;
  const lz = e.pos.z - o.z;
  const p = playerOnCrown(ctx, inst, lx, lz);
  e.facing = p
    ? Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z)
    : Math.atan2(BEACON.x - lx, BEACON.z - lz);
  e.prevFacing = e.facing;
}

function beginRise(ctx: SimContext, inst: InstanceSlot, e: Entity, st: VaelIntroState): void {
  const spot = VAEL_INTRO_STOPS[st.stop];
  st.part = 'rise';
  st.t = 0;
  placeAt(ctx, inst, e, spot.x, spot.z, 0);
  faceCrowd(ctx, inst, e);
  startBar(e, VAEL_INTRO_RISE, T.veilRiseSeconds, null);
  ctx.emit({
    type: 'spellfx',
    sourceId: e.id,
    targetId: e.id,
    school: 'shadow',
    fx: 'nova',
    ability: VAEL_INTRO_RISE,
  });
}

/** Start the entrance now (a player on the crown, or `/dev bastion trigger intro`). */
export function wakeVael(ctx: SimContext, inst: InstanceSlot, e: Entity): boolean {
  const st = e.vaelIntro;
  if (st?.phase !== 'buried' || e.dead) return false;
  st.phase = 'playing';
  st.stop = st.short ? LAST : 0;
  beginRise(ctx, inst, e, st);
  return true;
}

/** Bury him again for an entrance (the dev replay, and the wipe's rearm). */
export function buryVael(ctx: SimContext, inst: InstanceSlot, e: Entity, short: boolean): void {
  const st = e.vaelIntro ?? freshIntro();
  e.vaelIntro = st;
  st.phase = 'buried';
  st.short = short;
  st.stop = short ? LAST : 0;
  st.part = 'rise';
  st.t = 0;
  hold(e);
  clearCastIf(e, VAEL_INTRO_RISE, VAEL_SINK);
  const spot = VAEL_INTRO_STOPS[st.stop];
  placeAt(ctx, inst, e, spot.x, spot.z, T.buriedDepth);
}

function finish(e: Entity, st: VaelIntroState): void {
  st.phase = 'done';
  st.played = true;
  release(e);
}

/**
 * One tick of Vael's entrance. Returns true while the entrance owns him (the
 * fight's tick must leave him alone), false once he is free to fight.
 */
export function tickVaelIntro(
  ctx: SimContext,
  inst: InstanceSlot,
  e: Entity,
  engaged: boolean,
): boolean {
  let st = e.vaelIntro;
  if (!st) {
    // Already in a fight before his first tick (a test, a dev jump): no entrance.
    if (engaged || e.dead) {
      e.vaelIntro = { ...freshIntro(), phase: 'done', played: true };
      return false;
    }
    buryVael(ctx, inst, e, false);
    st = e.vaelIntro as VaelIntroState;
  }
  if (e.dead) {
    if (e.encounterHeld) release(e);
    st.phase = 'done';
    return false;
  }
  if (st.phase === 'done') return false;
  if (st.phase === 'rearm') {
    // Walking home after a wipe: once he stands idle at his place and nobody
    // living is left on the crown, he sinks for the short entrance.
    if (engaged) {
      // Back in the fight (a brief loss of target, not a wipe): no entrance.
      st.phase = 'done';
      return false;
    }
    if (e.inCombat || e.aiState !== 'idle') return false;
    if (playerOnCrown(ctx, inst)) {
      st.phase = 'done';
      return false;
    }
    buryVael(ctx, inst, e, true);
    return true;
  }
  hold(e);
  if (st.phase === 'buried') {
    const spot = VAEL_INTRO_STOPS[st.stop];
    placeAt(ctx, inst, e, spot.x, spot.z, T.buriedDepth);
    if (playerOnCrown(ctx, inst)) wakeVael(ctx, inst, e);
    return true;
  }
  st.t += DT;
  const spot = VAEL_INTRO_STOPS[st.stop];
  switch (st.part) {
    case 'rise':
      placeAt(ctx, inst, e, spot.x, spot.z, 0);
      faceCrowd(ctx, inst, e);
      if (e.castingAbility === VAEL_INTRO_RISE)
        e.castRemaining = Math.max(0, T.veilRiseSeconds - st.t);
      if (st.t < T.veilRiseSeconds) break;
      clearCastIf(e, VAEL_INTRO_RISE);
      st.part = 'speak';
      st.t = 0;
      vaelSay(ctx, e, st.short ? VAEL_RETURN_LINE : VAEL_INTRO_LINES[st.stop]);
      break;
    case 'speak':
      placeAt(ctx, inst, e, spot.x, spot.z, 0);
      faceCrowd(ctx, inst, e);
      if (st.t < T.introSpeakSeconds) break;
      if (st.stop >= LAST) {
        finish(e, st);
        return false;
      }
      st.part = 'sink';
      st.t = 0;
      startBar(e, VAEL_SINK, T.vanishSeconds, null);
      ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: e.id,
        school: 'shadow',
        fx: 'nova',
        ability: VAEL_SINK,
      });
      break;
    case 'sink':
      placeAt(ctx, inst, e, spot.x, spot.z, 0);
      if (e.castingAbility === VAEL_SINK) e.castRemaining = Math.max(0, T.vanishSeconds - st.t);
      if (st.t < T.vanishSeconds) break;
      clearCastIf(e, VAEL_SINK);
      st.part = 'under';
      st.t = 0;
      st.stop++;
      placeAt(
        ctx,
        inst,
        e,
        VAEL_INTRO_STOPS[st.stop].x,
        VAEL_INTRO_STOPS[st.stop].z,
        T.buriedDepth,
      );
      break;
    case 'under':
      placeAt(ctx, inst, e, spot.x, spot.z, T.buriedDepth);
      if (st.t >= T.introUnderSeconds) beginRise(ctx, inst, e, st);
      break;
  }
  return true;
}

/** His fight ended without his death (a wipe, an evade): arm the short
 *  entrance for the group's next climb. */
export function rearmVaelIntro(e: Entity): void {
  const st = e.vaelIntro;
  if (!st || e.dead) return;
  if (st.phase === 'done') st.phase = 'rearm';
}

/** Skip the entrance: he stands at his place, ready to fight (dev helper). */
export function finishVaelIntro(ctx: SimContext, inst: InstanceSlot, e: Entity): void {
  const st = e.vaelIntro ?? freshIntro();
  e.vaelIntro = st;
  const home = VAEL_INTRO_STOPS[LAST];
  if (!e.dead) placeAt(ctx, inst, e, home.x, home.z, 0);
  finish(e, st);
}
