// The Guardian of the Heat's Live Coals (docs/design/raid/smith_heart.md section
// 7.4; the owner's design of 2026-11-24): Heroic and Mythic only, a healer and
// spacing check through every fighting phase.
//
//   The set      every HEAT_TUNING `coalEvery` s of fighting (the clock stands
//                still while the guardian is sunk: never in an overflow), two
//                hashed players carry a live coal out of the wellspring. Never
//                a tank (the guardian's target, nor anyone wearing Cinder Grip),
//                never one who already carries one. Never as a Wheel of the
//                Hearth begins: it waits while a Wheel is on the floor or due
//                within `coalWheelGap` s, and a Wheel waits that long after it
//                (heat.ts startMechanics reads coalHoldsWheel).
//   The coal     a heal absorb (the `heal_absorb` aura Living Rime rides,
//                combat/heal.ts consumeHealAbsorb) of `coalAbsorb` times the
//                tier's damage factor, and a burn every `coalTick` s while it
//                lasts. Healing through the absorb puts it out.
//   The leap     another living player within `coalLeapR` of the bearer takes
//                it (the nearest; ties by id): the absorb it has LEFT and its
//                fuse go with it (no reset), and the leap strikes them. Just set
//                and after a leap it rests `coalGrace` s (a breath to step out
//                of a clump), and never goes straight back to
//                the one it left within `coalBackGrace` s (no ping-pong).
//   The burst    not out in `coalSeconds`: it bursts on everyone within
//                `coalBurstR` of the bearer, the bearer too (the tier's
//                punishing factor: heavy, never a whole cloth wearer's health).
//   Never a tank  it never leaps onto one either.
//   Off the floor carried off the Hearth's floor alive, it bursts there.
//   Gone         with its bearer's death, and
//                every one goes out as the guardian sinks (nothing of it rides
//                into the lava waves) and at the fight's end.
//
// What the client reads: the one aura (HEAT_AURAS.coal) on the bearer, its
// absorb left in `value`, its whole in `value2`, the fuse in `remaining` and
// `duration` (kept by this module: the aura never runs out on its own), and the
// cues (HEAT_CUES coal, coalLeap, coalOut, coalBurst). No wire or IWorld change.
//
// Deterministic: the picks are hashed, a leap's taker by distance then id; the
// only rng draws are the damage rolls, in player order.

import { DT, type Entity } from '../../types';
import { HEAT_AURAS, HEAT_CUES, HEAT_NAMES, heatHash, HEAT_TUNING as T } from './heat_ids';
import {
  at,
  auraOf,
  beamCue,
  cueAt,
  cueOn,
  damageMult,
  dropAura,
  fireHit,
  type HeatScope,
  livePlayers,
  punishMult,
  roll,
} from './heat_scope';
import type { HeatCoal } from './heat_state';

/** Is `p` one of the fight's tanks: the guardian's target, wearing Cinder
 *  Grip, or having worn it this pull (an off-tank whose stacks ran out between
 *  swaps is still a tank: the bot pass of 2026-11-24 saw a coal set on one
 *  leap straight onto the other in the melee). */
export function coalTank(s: Pick<HeatScope, 'boss' | 'st'>, p: Entity): boolean {
  return (
    p.id === s.boss.aggroTargetId ||
    auraOf(p, HEAT_AURAS.grip) !== undefined ||
    s.st.gripWorn.includes(p.id)
  );
}

/** Note every player wearing Cinder Grip (the fight's tanks, for the picks). */
function noteGrip(s: HeatScope): void {
  for (const p of s.players)
    if (!s.st.gripWorn.includes(p.id) && auraOf(p, HEAT_AURAS.grip) !== undefined)
      s.st.gripWorn.push(p.id);
}

function bearing(s: Pick<HeatScope, 'st'>, pid: number): boolean {
  return s.st.coals.some((c) => c.pid === pid);
}

/** Who a set takes: up to `count` living non-tanks without a coal, hashed. */
export function pickCoalTargets(s: HeatScope, count: number): Entity[] {
  const salt = s.boss.id * 53 + s.st.coalCasts * 17 + 3;
  return livePlayers(s)
    .filter((p) => !coalTank(s, p) && !bearing(s, p.id))
    .map((p) => ({ p, key: heatHash(salt, p.id) }))
    .sort((a, b) => a.key - b.key || a.p.id - b.p.id)
    .slice(0, Math.max(0, count))
    .map((o) => o.p);
}

/** The aura on `p`: `left` of `whole` absorb, `fuse` seconds. False when it
 *  did not take (an immunity). */
function putCoal(s: HeatScope, p: Entity, left: number, whole: number, fuse: number): boolean {
  dropAura(p, HEAT_AURAS.coal);
  s.ctx.applyAura(p, {
    id: HEAT_AURAS.coal,
    name: HEAT_NAMES.coal,
    kind: 'heal_absorb',
    remaining: fuse,
    duration: T.coalSeconds,
    value: left,
    value2: whole,
    sourceId: s.boss.id,
    school: 'fire',
    undispellable: true,
    encounterOwned: true,
  });
  return auraOf(p, HEAT_AURAS.coal) !== undefined;
}

/** The absorb a fresh coal holds on this tier. */
export function coalAbsorb(s: Pick<HeatScope, 'rules' | 'boss'>): number {
  return Math.max(1, Math.round(T.coalAbsorb * damageMult(s)));
}

/** Set the tier's Live Coals now. Returns who took one. Exported for the dev
 *  trigger and the tests. */
export function setCoals(s: HeatScope): Entity[] {
  const st = s.st;
  const targets = pickCoalTargets(s, T.coalTargets);
  st.coalCasts++;
  st.coalAt = st.clock;
  const whole = coalAbsorb(s);
  const out: Entity[] = [];
  for (const p of targets) {
    if (!putCoal(s, p, whole, whole, T.coalSeconds)) continue;
    st.coals.push({
      pid: p.id,
      fuse: T.coalSeconds,
      tick: T.coalTick,
      // A breath to step out of a clump before it can leap at all.
      grace: T.coalGrace,
      prev: null,
      prevGrace: 0,
    });
    beamCue(s, s.boss.id, p.id, HEAT_CUES.coal);
    out.push(p);
  }
  return out;
}

/** Does a Wheel of the Hearth hold the next set back (one on the floor, or
 *  one due within coalWheelGap)? */
function wheelNear(s: HeatScope): boolean {
  return s.st.wheelRounds.length > 0 || s.st.wheelTimer < T.coalWheelGap;
}

/** Does a set this recent hold a due Wheel back (heat.ts startMechanics)? */
export function coalHoldsWheel(st: { clock: number; coalAt: number }): boolean {
  return st.clock - st.coalAt < T.coalWheelGap;
}

/** The player a coal on `bearer` leaps to now, or null: the nearest other
 *  living player within coalLeapR not already carrying one (and not the one
 *  it just left while that one's grace lasts). */
export function coalLeapTarget(s: HeatScope, coal: HeatCoal, bearer: Entity): Entity | null {
  if (coal.grace > 1e-9) return null;
  const here = at(s, bearer);
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const q of livePlayers(s)) {
    // Never onto a tank (the reviews of 2026-11-24: the melee stands by them).
    if (q.id === bearer.id || bearing(s, q.id) || coalTank(s, q)) continue;
    if (coal.prev === q.id && coal.prevGrace > 1e-9) continue;
    const there = at(s, q);
    const d = Math.hypot(there.x - here.x, there.z - here.z);
    if (d > T.coalLeapR + 1e-9) continue;
    if (d < bestD - 1e-9) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

/** The coal leaps from `from` to `to` with what it has left. False when it
 *  did not take (it stays where it was). */
function leap(s: HeatScope, coal: HeatCoal, from: Entity, to: Entity): boolean {
  const aura = auraOf(from, HEAT_AURAS.coal);
  const left = aura ? aura.value : coalAbsorb(s);
  const whole = aura?.value2 ?? coalAbsorb(s);
  if (!putCoal(s, to, left, whole, coal.fuse)) return false;
  dropAura(from, HEAT_AURAS.coal);
  coal.prev = from.id;
  coal.prevGrace = T.coalBackGrace;
  coal.pid = to.id;
  coal.grace = T.coalGrace;
  s.st.coalLeaps++;
  beamCue(s, from.id, to.id, HEAT_CUES.coalLeap);
  fireHit(s, to, roll(s, T.coalLeapMin, T.coalLeapMax), HEAT_NAMES.coal);
  return true;
}

/** The fuse is out: the coal bursts round its bearer. Returns who it struck. */
export function burstCoal(s: HeatScope, bearer: Entity): Entity[] {
  dropAura(bearer, HEAT_AURAS.coal);
  s.st.coals = s.st.coals.filter((c) => c.pid !== bearer.id);
  s.st.coalBursts++;
  const here = at(s, bearer);
  cueAt(s, HEAT_CUES.coalBurst, here.x, here.z, T.coalBurstR);
  const hit = livePlayers(s).filter((p) => {
    const there = at(s, p);
    return Math.hypot(there.x - here.x, there.z - here.z) <= T.coalBurstR + 1e-9;
  });
  for (const p of hit)
    fireHit(s, p, roll(s, T.coalBurstMin, T.coalBurstMax, punishMult(s)), HEAT_NAMES.coalBurst);
  return hit;
}

/** One tick of the Live Coals: the set when due, each coal's burn, leap,
 *  going out and burst. Runs only while the guardian fights (heat.ts calls it
 *  in the `fight` stage). */
export function stepCoals(s: HeatScope): void {
  const st = s.st;
  noteGrip(s);
  if (s.rules.liveCoal) {
    st.coalTimer = Math.max(0, st.coalTimer - DT);
    if (st.coalTimer <= 1e-9 && !wheelNear(s)) {
      st.coalTimer = T.coalEvery;
      setCoals(s);
    }
  }
  if (st.coals.length === 0) return;
  const onFloor = new Set(s.players.map((p) => p.id));
  for (const coal of [...st.coals]) {
    if (!st.coals.includes(coal)) continue;
    const p = s.ctx.entities.get(coal.pid);
    if (!p || p.dead || p.ghost) {
      if (p) dropAura(p, HEAT_AURAS.coal);
      st.coals = st.coals.filter((c) => c !== coal);
      continue;
    }
    if (!onFloor.has(p.id)) {
      // Carried off the Hearth's floor alive: it bursts on its bearer there
      // (never a way to shed it), and on anyone still near.
      burstCoal(s, p);
      fireHit(s, p, roll(s, T.coalBurstMin, T.coalBurstMax, punishMult(s)), HEAT_NAMES.coalBurst);
      continue;
    }
    const aura = auraOf(p, HEAT_AURAS.coal);
    if (!aura) {
      // Healed through (the absorb drained to nothing): it goes out.
      st.coals = st.coals.filter((c) => c !== coal);
      st.coalOuts++;
      cueOn(s, p, HEAT_CUES.coalOut);
      continue;
    }
    coal.grace = Math.max(0, coal.grace - DT);
    coal.prevGrace = Math.max(0, coal.prevGrace - DT);
    coal.fuse -= DT;
    if (coal.fuse <= 1e-9) {
      burstCoal(s, p);
      continue;
    }
    let bearer = p;
    const to = coalLeapTarget(s, coal, p);
    if (to && leap(s, coal, p, to)) bearer = to;
    coal.tick -= DT;
    if (coal.tick <= 1e-9) {
      coal.tick += T.coalTick;
      fireHit(s, bearer, roll(s, T.coalBurnMin, T.coalBurnMax), HEAT_NAMES.coal);
    }
    // The clock is this module's: the aura shows it and never lapses first.
    const shown = auraOf(bearer, HEAT_AURAS.coal);
    if (shown) shown.remaining = Math.max(DT * 2, coal.fuse);
  }
}

/** Every coal goes out, nothing bursting (the guardian sinks, a wipe, the
 *  kill). */
export function clearCoals(s: Pick<HeatScope, 'ctx' | 'st'>): void {
  for (const c of s.st.coals) {
    const p = s.ctx.entities.get(c.pid);
    if (p) dropAura(p, HEAT_AURAS.coal);
  }
  s.st.coals = [];
}
