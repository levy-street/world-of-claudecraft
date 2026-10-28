// The Masterless Strength's intermissions (docs/design/raid/smith_heart.md
// section 7.5, part 2, the owner's approved design of 28 Oct 2026):
//
//   The thresholds  at 70 and at 40 percent of its health (a damage floor
//                   holds each, so no burst skips one).
//   The stride      it strides into the central ring (`leap`): shielded the
//                   moment it starts (Gathered Strength: nothing harms it,
//                   nobody can target it), never dragged; its bar and its
//                   root are dropped. Through the stride and the call the
//                   quarter rules hold still: the Overload bars neither fill
//                   nor drain nor pulse, the switch mark's clock (and every
//                   player's Vein-Shaken) stops, and Heart Unbound never
//                   ticks.
//   The call        Call of the Quarters, a 40 s channel. A Splinter climbs
//                   out of each awakened quarter: 2 on Normal, 3 on Heroic,
//                   4 on Mythic, the quarters with the fullest Overload bars
//                   (ties: the quarter it stood in last, then clockwise). The
//                   awake quarters are the living Splinters' (the phase
//                   aura's mask: the room and the HUD read it). Every
//                   Splinter alive pulses the raid with Splintered Strength
//                   every 3 s, harder each pulse (final_adds.ts is their
//                   kits).
//   The end         all Splinters dead: the shield breaks at once. The
//                   channel run out: every Splinter still alive pours its
//                   element into the boss for the rest of the fight
//                   (final_last.ts fires them), then the shield breaks.
//   The release     it takes the fight again from the centre and walks out
//                   to its tank; Heart Unbound holds 8 s (`releaseGrace`), so
//                   the centre it was called to never punishes it. Back into
//                   the quarter it last drank it does not root again.
//
// Deterministic: no pick here draws; the only rng draws are the damage
// rolls, in claim-player order.

import { HEART_ROOM, type SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import { DT } from '../../types';
import { clearCastIf, startBar } from '../sunken_bastion/claim';
import { addBody, addHit, dropAdd, phaseRules, raiseSplinter } from './final_adds';
import { clearFist } from './final_heat';
import { FINAL_AURAS, FINAL_CASTS, FINAL_NAMES } from './final_ids';
import {
  FINAL_PHASE_AURAS as A,
  ALL_QUARTERS_MASK,
  FINAL_PHASE_CASTS as C,
  FINAL_STAGE_CODES,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  pickAddQuarters,
  pouredAuraId,
  FINAL_PHASE_CUES as Q,
  quarterBit,
  splinterScale,
} from './final_phase_ids';
import { endRoot } from './final_rules';
import {
  auraOf,
  cueAt,
  cueOn,
  dropAura,
  dropFightObject,
  type FinalScope,
  livePlayers,
  putMarker,
  raidWarn,
  roll,
} from './final_scope';
import type { FinalPhaseState } from './final_state';

/** A fresh part-2 state (the pull's). */
export function freshPhase(): FinalPhaseState {
  return {
    stage: 'fight',
    intermissions: 0,
    leapClock: 0,
    callLeft: 0,
    adds: [],
    splinterPulses: 0,
    splinterTimer: 0,
    rings: [],
    coals: [],
    poured: { breath: 0, quench: 0, hammer: 0, heat: 0 },
    pouredClock: { breath: 0, quench: 0, hammer: 0, heat: 0 },
    unboundGrace: 0,
    finalClock: 0,
    mixTurn: 0,
    mixTimer: 0,
    fury: 0,
    furyTimer: 0,
    furyWarned: false,
  };
}

/** Do the quarter rules hold still now (the stride, the call)? */
export function rulesFrozen(s: Pick<FinalScope, 'st'>): boolean {
  const g = s.st.phase.stage;
  return g === 'leap' || g === 'call' || g === 'finalLeap';
}

/** The health at or under which a share is reached (a damage floor holds
 *  the boss exactly there). */
export function shareHp(maxHp: number, share: number): number {
  return Math.ceil(maxHp * share);
}

// ---- the stance ---------------------------------------------------------------------------

/** Shielded: nobody's target, nothing harms it, no swing. The mob AI
 *  re-hostiles it before the encounter's pass, so this runs every tick. */
export function holdShielded(s: FinalScope): void {
  const b = s.boss;
  b.hostile = false;
  b.damageImmune = true;
  b.swingTimer = Math.max(b.swingTimer, 0.6);
}

/** Out of its shield: a target again. */
export function dropShield(s: Pick<FinalScope, 'boss'>): void {
  const b = s.boss;
  b.hostile = true;
  b.damageImmune = false;
  dropAura(b, A.shield);
}

/** The centre of the Anvil, world yards on the floor. */
function centre(s: FinalScope): { x: number; y: number; z: number } {
  const o = s.ctx.instanceOriginOf(s.inst);
  return s.ctx.groundPos(o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
}

/** Pin the boss on the centre (the call, the final phase). */
export function pinCentre(s: FinalScope): void {
  const c = centre(s);
  const b = s.boss;
  if (b.pos.x === c.x && b.pos.z === c.z) return;
  b.pos = { ...c };
  s.ctx.rebucket(b);
}

/** Anything it was doing goes: its bar and the bar's footprint, its root. */
export function dropWhatItHeld(s: FinalScope): void {
  const st = s.st;
  endRoot(s);
  if (st.bar) {
    st.bar = null;
    st.boltTarget = null;
    clearFist(s);
    if (st.anvil) dropFightObject(s.ctx, s.inst, st.anvil.objectId);
    st.anvil = null;
  }
  clearCastIf(s.boss, FINAL_CASTS.fist, FINAL_CASTS.bolt, FINAL_CASTS.anvil);
}

// ---- the stride ---------------------------------------------------------------------------

/** One tick of the stride into the centre: true once it stands there. */
export function stepStride(s: FinalScope): boolean {
  const ph = s.st.phase;
  const b = s.boss;
  ph.leapClock += DT;
  const c = centre(s);
  const dx = c.x - b.pos.x;
  const dz = c.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  const step = P.leapSpeed * DT;
  if (d <= step || ph.leapClock >= P.leapMaxSeconds - 1e-9) {
    b.prevPos = { ...b.pos };
    b.pos = { ...c };
    s.ctx.rebucket(b);
    return true;
  }
  b.facing = Math.atan2(dx, dz);
  const next = s.ctx.groundPos(b.pos.x + (dx / d) * step, b.pos.z + (dz / d) * step);
  b.pos = next;
  s.ctx.rebucket(b);
  return false;
}

/** The stride begins (an intermission's, or the final phase's). */
export function beginStride(s: FinalScope, stage: 'leap' | 'finalLeap'): void {
  const st = s.st;
  const ph = st.phase;
  dropWhatItHeld(s);
  ph.stage = stage;
  ph.leapClock = 0;
  st.zone = 'ring';
  holdShielded(s);
  if (!auraOf(s.boss, A.shield))
    putMarker(s.boss, A.shield, N.shield, 3600, s.boss.id, { permanent: true, school: 'arcane' });
  cueAt(s, Q.leap, HEART_ROOM.x, HEART_ROOM.z, 16, 'arcane');
}

// ---- the intermission -----------------------------------------------------------------------

/** An intermission begins (`n` 1 at 70 percent, 2 at 40). Exported for the
 *  dev verb. */
export function beginIntermission(s: FinalScope, n: 1 | 2): void {
  const ph = s.st.phase;
  ph.intermissions = Math.max(ph.intermissions, n);
  beginStride(s, 'leap');
  raidWarn(
    s,
    'intermission',
    'The Masterless Strength gathers its strength in the centre! Its Splinters rise: kill them before the call ends!',
  );
}

/** The call begins: the Splinters rise, the channel, the shield. Exported
 *  for the tests. */
export function beginCall(s: FinalScope): SmithHeartVein[] {
  const st = s.st;
  const ph = st.phase;
  ph.stage = 'call';
  ph.callLeft = P.callSeconds;
  ph.splinterPulses = 0;
  ph.splinterTimer = P.riseSeconds + P.splinterEvery;
  const veins = pickAddQuarters(st.overload, st.lastQuarter, phaseRules(s).adds);
  for (const v of veins) raiseSplinter(s, v);
  startBar(s.boss, C.call, P.callSeconds, null, true);
  cueOn(s, s.boss, Q.shield, 'arcane');
  return veins;
}

/** Splintered Strength: every risen Splinter strikes the whole raid, harder
 *  each pulse of this call. Returns how many pulsed. */
export function pulseSplinters(s: FinalScope): number {
  const ph = s.st.phase;
  const k = ph.splinterPulses++;
  let n = 0;
  for (const a of ph.adds) {
    const e = addBody(s, a);
    if (!e || a.rise > 0) continue;
    n++;
    cueOn(s, e, Q.splinter, 'arcane');
    for (const p of livePlayers(s))
      addHit(
        s,
        e,
        p,
        Math.round(roll(s, P.splinterMin, P.splinterMax) * splinterScale(k)),
        N.splinter,
        'arcane',
      );
  }
  return n;
}

/** One tick of the call: the channel, the Splinters, their raid damage, its
 *  end. */
export function stepCall(s: FinalScope): void {
  const ph = s.st.phase;
  holdShielded(s);
  pinCentre(s);
  ph.callLeft = Math.max(0, ph.callLeft - DT);
  const b = s.boss;
  if (b.castingAbility === C.call) b.castRemaining = ph.callLeft;
  ph.splinterTimer -= DT;
  if (ph.splinterTimer <= 1e-9) {
    ph.splinterTimer = P.splinterEvery;
    pulseSplinters(s);
  }
  if (ph.adds.length === 0) {
    endCall(s);
    return;
  }
  if (ph.callLeft <= 1e-9) endCall(s);
}

/** The call ends: every Splinter still alive pours its element into the
 *  boss (none when all died first), then the shield breaks. Returns the
 *  elements poured. Exported for the dev verb. */
export function endCall(s: FinalScope): SmithHeartVein[] {
  const ph = s.st.phase;
  const poured: SmithHeartVein[] = [];
  for (const a of ph.adds) {
    const e = addBody(s, a);
    if (!e) continue;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: e.id,
      targetId: s.boss.id,
      school: 'arcane',
      fx: 'beam',
      ability: Q.pour,
    });
    ph.poured[a.vein]++;
    ph.pouredClock[a.vein] = 0;
    poured.push(a.vein);
    dropAdd(s, a);
  }
  ph.adds = [];
  if (poured.length > 0)
    raidWarn(
      s,
      'poured',
      'The Splinters pour into the Masterless Strength! Their elements stay with it to the end!',
    );
  release(s);
  return poured;
}

/** The shield breaks: it takes the fight again and walks out to its tank,
 *  Heart Unbound held a while. */
export function release(s: FinalScope): void {
  const ph = s.st.phase;
  ph.stage = 'fight';
  ph.callLeft = 0;
  ph.unboundGrace = P.releaseGrace;
  clearCastIf(s.boss, C.call);
  dropShield(s);
  s.st.pulseTimer = Math.max(s.st.pulseTimer, 2);
  cueOn(s, s.boss, Q.release, 'arcane');
  raidWarn(s, 'release', 'The shield breaks! Drag the Masterless Strength out of the centre!');
}

// ---- the thresholds ----------------------------------------------------------------------

/** The thresholds in the fight: the next intermission, or (both done) the
 *  final phase's stride. */
export function watchThresholds(s: FinalScope): void {
  const ph = s.st.phase;
  if (ph.stage !== 'fight') return;
  const b = s.boss;
  if (ph.intermissions < P.intermissionAt.length) {
    if (b.hp <= shareHp(b.maxHp, P.intermissionAt[ph.intermissions]))
      beginIntermission(s, (ph.intermissions + 1) as 1 | 2);
    return;
  }
  if (b.hp <= shareHp(b.maxHp, P.finalAt)) beginFinalStride(s);
}

/** The final phase's stride begins (it ends standing in the centre). */
export function beginFinalStride(s: FinalScope): void {
  s.st.phase.intermissions = P.intermissionAt.length;
  beginStride(s, 'finalLeap');
  raidWarn(s, 'final', 'The Masterless Strength strides into the heart of the Anvil!');
}

// ---- what holds still ---------------------------------------------------------------------

/** Through the stride and the call every player's Vein-Shaken holds its
 *  clock (the switch mark is frozen with the bars). */
export function holdShaken(s: FinalScope): void {
  for (const p of s.players) {
    const a = auraOf(p, FINAL_AURAS.shaken);
    if (a) a.remaining = Math.min(a.duration, a.remaining + DT);
  }
}

// ---- what every client reads --------------------------------------------------------------

/** The awake quarters now: the living Splinters' through a call, all four in
 *  the final phase, none else. */
export function awakeMask(s: Pick<FinalScope, 'ctx' | 'st'>): number {
  const ph = s.st.phase;
  if (ph.stage === 'final') return ALL_QUARTERS_MASK;
  let m = 0;
  for (const a of ph.adds) if (addBody(s, a)) m |= quarterBit(a.vein);
  return m;
}

/** Write the stage, the mask, the clock and the poured elements onto the
 *  boss's auras (only when they change). */
export function showPhase(s: FinalScope): void {
  const ph = s.st.phase;
  const b = s.boss;
  const code = FINAL_STAGE_CODES[ph.stage];
  const mask = awakeMask(s);
  const seconds =
    ph.stage === 'call'
      ? Math.ceil(ph.callLeft)
      : ph.stage === 'final'
        ? Math.max(0, Math.ceil(P.enrageAfter - ph.finalClock))
        : 0;
  const alive = ph.adds.filter((a) => addBody(s, a)).length;
  const a = auraOf(b, A.phase);
  if (!a) {
    putMarker(b, A.phase, FINAL_NAMES.state, 3600, b.id, {
      permanent: true,
      value: code,
      value2: mask,
      value3: seconds,
      stacks: alive,
      school: 'arcane',
    });
  } else {
    if (a.value !== code) a.value = code;
    if (a.value2 !== mask) a.value2 = mask;
    if (a.value3 !== seconds) a.value3 = seconds;
    if (a.stacks !== alive) a.stacks = alive;
  }
  for (const v of HEART_QUARTER_ORDER) {
    const n = ph.poured[v];
    if (n <= 0) continue;
    const id = pouredAuraId(v);
    const p = auraOf(b, id);
    if (!p) putMarker(b, id, N.poured[v], 3600, b.id, { permanent: true, stacks: n, value: n });
    else if (p.stacks !== n) {
      p.stacks = n;
      p.value = n;
    }
  }
}

/** Every part-2 aura off the boss and its stance whole (the fight's end). */
export function clearPhaseAuras(s: Pick<FinalScope, 'boss'>): void {
  const b = s.boss;
  dropAura(b, A.phase);
  dropAura(b, A.shield);
  dropAura(b, A.fury);
  for (const v of HEART_QUARTER_ORDER) dropAura(b, pouredAuraId(v));
  clearCastIf(b, C.call);
  b.damageFloorHp = undefined;
  if (b.damageImmune) {
    b.damageImmune = false;
    b.hostile = true;
  }
}

/** The floor that holds the next threshold (none once the final phase has
 *  begun). */
export function holdThreshold(s: FinalScope): void {
  const ph = s.st.phase;
  const b = s.boss;
  let share: number | null = null;
  if (ph.stage !== 'final' && ph.stage !== 'finalLeap') {
    share =
      ph.intermissions < P.intermissionAt.length ? P.intermissionAt[ph.intermissions] : P.finalAt;
  }
  const want = share === null ? undefined : shareHp(b.maxHp, share);
  if (b.damageFloorHp !== want) b.damageFloorHp = want;
}
