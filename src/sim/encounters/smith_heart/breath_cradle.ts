// The Thunder's Cradle (the Guardian of the Breath's phase 2, docs/design/
// raid/smith_heart.md section 7.2), CHANNELED since the team's feedback of
// 2026-11-03:
//
//   The bar       a 1.5 s bar at a hashed player.
//   The lift      it lands: that player is lifted into the storm (carried, an
//                 unbreakable stun) over a gather circle; heroic and mythic
//                 trap two more (hashed among the rest), each over a circle
//                 of their own, so the raid runs to split between them.
//   The channel   the guardian then CHANNELS the cradle for its hold (a real
//                 channel bar every client mirrors): planted, no swing, and
//                 no other bar begins while it runs.
//   The discharge the channel ends: each circle's discharge is split
//                 between everyone under it, its own lifted player counted.
//                 Fewer than the tier wants under one: each share there is
//                 heavier, and the backlash rolls over the whole Cornice.
//   Cut short     a channel cut by anything (an evade, a reset) sets every
//                 lifted body down with no discharge.
//
// Zero rng in every pick (hashed marks); the draws are the damage rolls.

import { carryBody, setDownBody } from '../../carried_body';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_NAMES,
  BREATH_OBJECTS,
  cradleShare,
  BREATH_TUNING as T,
  timedTemplate,
} from './breath_ids';
import {
  type BreathScope,
  beginBar,
  dropAura,
  dropBreathObject,
  livePlayers,
  living,
  local,
  pickMarks,
  roll,
  spawnBreathObject,
} from './breath_scope';
import type { BreathCradle, BreathFightState } from './breath_state';
import { breathSay } from './breath_voice';

/** Players nothing else may mark while the cradle holds them. */
export function cradled(st: BreathFightState): number[] {
  return st.cradles.map((c) => c.playerId);
}

/** Begin the Cradle's bar on a hashed player (never one already held, nor
 *  the marked conductor). Exported for the dev trigger. */
export function startCradle(s: BreathScope): boolean {
  if (s.st.cradles.length > 0) return false;
  const busy = new Set(s.st.drawn ? [s.st.drawn.playerId] : []);
  const [t] = pickMarks(s, 1, busy);
  if (!t) return false;
  beginBar(s, BREATH_CASTS.cradle, T.cradleCast, t.id);
  s.st.cradleTimer = T.cradleEvery;
  return true;
}

/** Lift one player over a circle of its own. */
function lift(s: BreathScope, t: Entity): BreathCradle | null {
  if (!living(t) || t.carriedBy !== undefined) return null;
  const at = local(s.ctx, s.inst, t);
  const e = spawnBreathObject(
    s.ctx,
    s.inst,
    timedTemplate(BREATH_OBJECTS.cradlePrefix, T.cradleHold),
    BREATH_NAMES.cradle,
    at.x,
    at.z,
    T.cradleR,
  );
  carryBody(t, e.id);
  s.ctx.applyAura(t, {
    id: BREATH_AURAS.cradled,
    name: BREATH_NAMES.cradle,
    kind: 'stun',
    remaining: T.cradleHold + 0.5,
    duration: T.cradleHold + 0.5,
    value: 0,
    sourceId: s.boss.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  return { playerId: t.id, objectId: e.id, x: at.x, z: at.z, remaining: T.cradleHold };
}

/** The bar lands: its player and (heroic, mythic) more are lifted, and the
 *  guardian begins the channel that holds them. */
export function landCradle(s: BreathScope, targetId: number | null): void {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!living(t)) return;
  const first = lift(s, t);
  if (!first) return;
  s.st.cradles.push(first);
  const busy = new Set<number>([t.id]);
  if (s.st.drawn) busy.add(s.st.drawn.playerId);
  for (const p of pickMarks(s, s.rules.cradleCount - 1, busy)) {
    const c = lift(s, p);
    if (c) s.st.cradles.push(c);
  }
  // The channel: planted, nothing else cast while it holds them.
  beginBar(s, BREATH_CASTS.cradleHold, T.cradleHold, null);
  s.boss.channeling = true;
  s.st.gap = 0;
  breathSay(s, s.boss, 'guardian', 'cradle');
}

/** Is the guardian channeling the cradle now? */
export function cradleChanneling(s: BreathScope): boolean {
  return s.st.bar?.castId === BREATH_CASTS.cradleHold;
}

/** The lifted bodies hang over their circles; a channel that ended without
 *  its landing (cut) sets them down with no discharge. */
export function stepCradles(s: BreathScope): void {
  const st = s.st;
  if (st.cradles.length === 0) return;
  if (!cradleChanneling(s)) {
    releaseCradles(s.ctx, s.inst, st);
    return;
  }
  s.boss.swingTimer = Math.max(s.boss.swingTimer, 0.6);
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const c of st.cradles) {
    c.remaining = Math.max(0, c.remaining - DT);
    const t = s.ctx.entities.get(c.playerId);
    if (!t || t.dead || t.carriedBy !== c.objectId) continue;
    const floor = s.ctx.groundPos(o.x + c.x, o.z + c.z).y;
    const k = Math.min(1, (T.cradleHold - c.remaining) / 0.8);
    t.pos.x = o.x + c.x;
    t.pos.z = o.z + c.z;
    t.pos.y = floor + T.cradleLift * k * k * (3 - 2 * k);
    s.ctx.rebucket(t);
  }
}

/** The channel ran out: every circle discharges. Returns each circle's
 *  soakers, in lift order (the tests read it). */
export function dischargeCradles(s: BreathScope): Entity[][] {
  const st = s.st;
  const o = s.ctx.instanceOriginOf(s.inst);
  const out: Entity[][] = [];
  let short = false;
  for (const c of st.cradles) {
    const lifted = s.ctx.entities.get(c.playerId);
    const under = livePlayers(s).filter((p) => {
      if (p.id === c.playerId) return true;
      if (st.cradles.some((q) => q.playerId === p.id)) return false;
      const at = local(s.ctx, s.inst, p);
      return Math.hypot(at.x - c.x, at.z - c.z) <= T.cradleR;
    });
    if (lifted && !lifted.dead && !under.includes(lifted)) under.push(lifted);
    const share = cradleShare(under.length, s.rules.cradleSoakers, s.rules.cradleTotal);
    if (share.backlash) short = true;
    s.ctx.emit({
      type: 'spellfxAt',
      x: o.x + c.x,
      z: o.z + c.z,
      school: 'nature',
      fx: 'burst',
      radius: T.cradleR,
      ability: BREATH_CUES.discharge,
    });
    for (const p of under)
      s.ctx.dealDamage(
        s.boss,
        p,
        Math.max(1, Math.round(share.each * s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1))),
        false,
        'nature',
        BREATH_NAMES.cradle,
        'hit',
        true,
      );
    out.push(under);
  }
  if (short)
    for (const p of livePlayers(s))
      s.ctx.dealDamage(
        s.boss,
        p,
        roll(s, T.backlashMin, T.backlashMax),
        false,
        'nature',
        BREATH_NAMES.backlash,
        'hit',
        true,
      );
  releaseCradles(s.ctx, s.inst, st);
  return out;
}

/** Set every lifted body down and take the circles away. */
export function releaseCradles(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  const o = ctx.instanceOriginOf(inst);
  for (const c of st.cradles) {
    const t = ctx.entities.get(c.playerId);
    if (t && t.carriedBy === c.objectId) {
      setDownBody(t, ctx.groundPos(o.x + c.x, o.z + c.z).y);
      ctx.rebucket(t);
    }
    if (t) dropAura(t, BREATH_AURAS.cradled);
    dropBreathObject(ctx, inst, c.objectId);
  }
  st.cradles = [];
}
