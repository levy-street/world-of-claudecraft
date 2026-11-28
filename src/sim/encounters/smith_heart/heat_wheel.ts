// The Guardian of the Heat's Wheel of the Hearth (docs/design/raid/smith_heart.md
// section 7.4), every tier, every fighting phase (the rework of 2026-11-18: on Normal
// the fight never made anyone move). Jose's call of 2026-11-25 (in place of the even
// quarters of the same day): four 45 degree wedges over the shore IN FRONT of the
// guardian (toward the door) and the same four mirrored BEHIND it
// (heat_ids.ts WHEEL_ARCS_DEG). On each side three turn red and erupt and one stays
// dark and safe; the front's safe wedge and the back's are picked apart (hashed, each
// its own salt), so the melee behind and the ranged in front each read their own side.
// The tier's rounds run back to back (three, Mythic four): as one round's fire falls,
// the next round's wedges already show, each side's safe wedge one or two over from
// its last (never round the far side of the wellspring), so the raid crosses the
// moment the fire dies down.
//
//   A round  each red slice warns the tier's `wheel.warn` s (Normal 5, Heroic 3.5,
//            Mythic 3), erupts (a near-lethal blow to whoever stands in it, past the
//            wellspring's lip), and burns `wheelBurn` s more; the way to the next
//            round's safe slice (wheelCrossing) only flares `wheelDouse` s and goes
//            out, so the next safe slice reads safe and the raid crosses at once,
//            with the tier's whole warning to do it.
//   A run    the tier's `wheel.every` s apart, never over a Wakefire run (each waits
//            out the other, heat.ts) nor a Basalt Fist (heat_fist.ts floorHoldsFist).
//
// Wakefire moves the raid in and out; the Wheel moves it round the wellspring.
// Deterministic: the safe slices are hashed; the only rng draws are the damage rolls,
// in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT } from '../../types';
import { wellDistance, wheelSliceAt } from './heat_geometry';
import {
  HEAT_CUES,
  HEAT_NAMES,
  heatHash,
  HEAT_TUNING as T,
  WHEEL_SIDE,
  WHEEL_SLICES,
  wheelTemplate,
} from './heat_ids';
import {
  at,
  cueAt,
  damageMult,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  punishMult,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatWheelRound } from './heat_state';
import { heatSay } from './heat_voice';

/** One side's `rounds` safe wedges for run `run` (0 to 3 on that side): each
 *  one or two over from the last (hashed), never the same, never off the
 *  side's ends (no wrap round the wellspring). `salt` keeps the two sides'
 *  picks apart. Pure. */
export function wheelSideSafes(run: number, rounds: number, salt: number): number[] {
  const out: number[] = [];
  let at0 = heatHash(run, 41 + salt) % WHEEL_SIDE;
  out.push(at0);
  for (let i = 1; i < rounds; i++) {
    const step = 1 + (heatHash(run * 7 + i, 43 + salt) % 2);
    const up = at0 + step;
    const down = at0 - step;
    const goUp = up < WHEEL_SIDE && (down < 0 || heatHash(run + i, 47 + salt) % 2 === 0);
    at0 = goUp ? up : down;
    out.push(at0);
  }
  return out;
}

/** Run `run`'s `rounds` safe wedges in front (0 to 3) and behind (4 to 7),
 *  each side's its own pick. Pure. */
export function wheelSafes(run: number, rounds: number): { front: number[]; back: number[] } {
  return {
    front: wheelSideSafes(run, rounds, 0),
    back: wheelSideSafes(run, rounds, 19).map((i) => i + WHEEL_SIDE),
  };
}

/** The wedges the raid crosses from round safe wedge `from` to the next, `to`
 *  (the same side): any wedge between them, then `to` itself. Pure. */
export function wheelCrossing(from: number, to: number): number[] {
  if (from === to) return [];
  const out: number[] = [];
  const step = to > from ? 1 : -1;
  for (let slice = from + step; slice !== to; slice += step) out.push(slice);
  out.push(to);
  return out;
}

function beginRound(s: HeatScope, safe: number, safeBack: number): void {
  const warn = s.rules.wheel.warn;
  const reds: number[] = [];
  const redSlices: number[] = [];
  const spawn = (slice: number, state: 'warn' | 'safe') =>
    spawnFightObject(
      s.ctx,
      s.inst,
      wheelTemplate(slice, state, warn),
      HEAT_NAMES.wheel,
      HEARTH_WELL.x,
      HEARTH_WELL.z,
      T.wheelOuter,
    ).id;
  for (let slice = 0; slice < WHEEL_SLICES; slice++) {
    if (slice === safe || slice === safeBack) continue;
    reds.push(spawn(slice, 'warn'));
    redSlices.push(slice);
  }
  s.st.wheelRounds.push({
    safe,
    safeBack,
    state: 'warn',
    remaining: warn,
    tick: 0,
    reds,
    redSlices,
    safeId: spawn(safe, 'safe'),
    safeBackId: spawn(safeBack, 'safe'),
    doused: [],
    douse: 0,
  });
}

/** Begin a Wheel of the Hearth now. Exported for the dev trigger. */
export function startWheel(s: HeatScope): void {
  const st = s.st;
  st.wheelTimer = s.rules.wheel.every;
  const safes = wheelSafes(st.wheelRuns, s.rules.wheel.rounds);
  st.wheelSafes = safes.front;
  st.wheelSafesBack = safes.back;
  st.wheelRuns++;
  beginRound(s, st.wheelSafes[0], st.wheelSafesBack[0]);
  st.wheelNext = 1;
  heatSay(s, s.boss, 'wheel');
}

/** The players in a red wedge of `round` now: on the shore, in neither safe
 *  wedge (nor, with `burning`, in a wedge already put out). */
function inRed(s: HeatScope, round: HeatWheelRound, burning = false) {
  return livePlayers(s).filter((p) => {
    const here = at(s, p);
    if (wellDistance(here.x, here.z) < HEARTH_WELL.r) return false;
    const slice = wheelSliceAt(here.x, here.z);
    if (slice === round.safe || slice === round.safeBack) return false;
    return !(burning && round.doused.includes(slice));
  });
}

function setReds(s: HeatScope, round: HeatWheelRound): void {
  round.reds.forEach((id, i) => {
    const e = s.ctx.entities.get(id);
    if (!e) return;
    const slice = round.redSlices[i];
    const seconds = round.doused.includes(slice) ? T.wheelDouse : T.wheelBurn;
    e.templateId = wheelTemplate(slice, 'burn', seconds);
  });
}

/** Put out the doused wedges' fire (their objects go; they burn nobody). */
function douse(s: HeatScope, round: HeatWheelRound): void {
  round.reds.forEach((id, i) => {
    if (round.doused.includes(round.redSlices[i])) dropFightObject(s.ctx, s.inst, id);
  });
}

/** One tick of the Wheel: each round's warning, eruption and burn; each eruption
 *  shows the next round. */
export function stepWheel(s: HeatScope): void {
  const st = s.st;
  if (st.wheelRounds.length === 0) return;
  const keep: HeatWheelRound[] = [];
  // Rounds begun this tick wait for the next (the loop walks a copy).
  const rounds = st.wheelRounds;
  st.wheelRounds = keep;
  for (const round of rounds) {
    round.remaining -= DT;
    if (round.state === 'warn') {
      if (round.remaining > 1e-9) {
        keep.push(round);
        continue;
      }
      round.state = 'burn';
      round.remaining = T.wheelBurn;
      round.tick = T.wheelTick;
      if (st.wheelNext < st.wheelSafes.length) {
        round.doused = [
          ...wheelCrossing(round.safe, st.wheelSafes[st.wheelNext]),
          ...wheelCrossing(round.safeBack, st.wheelSafesBack[st.wheelNext]),
        ];
        round.douse = T.wheelDouse;
      }
      setReds(s, round);
      dropFightObject(s.ctx, s.inst, round.safeId);
      dropFightObject(s.ctx, s.inst, round.safeBackId);
      cueAt(s, HEAT_CUES.ignite, HEARTH_WELL.x, HEARTH_WELL.z, T.wheelOuter);
      for (const p of inRed(s, round))
        fireHit(
          s,
          p,
          roll(s, T.wheelMin, T.wheelMax, punishMult(s) * s.rules.wheel.hit),
          HEAT_NAMES.wheel,
        );
      keep.push(round);
      if (st.wheelNext < st.wheelSafes.length) {
        beginRound(s, st.wheelSafes[st.wheelNext], st.wheelSafesBack[st.wheelNext]);
        st.wheelNext++;
      }
      continue;
    }
    if (round.remaining <= 1e-9) {
      for (const id of round.reds) dropFightObject(s.ctx, s.inst, id);
      continue;
    }
    if (round.douse > 0) {
      round.douse -= DT;
      if (round.douse <= 1e-9) {
        round.douse = 0;
        douse(s, round);
      }
    }
    round.tick -= DT;
    if (round.tick <= 1e-9) {
      round.tick += T.wheelTick;
      for (const p of inRed(s, round, true))
        fireHit(
          s,
          p,
          roll(s, T.wheelBurnMin, T.wheelBurnMax, damageMult(s) * s.rules.wheel.hit),
          HEAT_NAMES.wheel,
        );
    }
    keep.push(round);
  }
}

/** Every slice off the floor and the run ended. */
export function clearWheel(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  for (const round of s.st.wheelRounds) {
    for (const id of round.reds) dropFightObject(s.ctx, s.inst, id);
    if (round.state === 'warn') {
      dropFightObject(s.ctx, s.inst, round.safeId);
      dropFightObject(s.ctx, s.inst, round.safeBackId);
    }
  }
  s.st.wheelRounds = [];
  s.st.wheelSafes = [];
  s.st.wheelSafesBack = [];
  s.st.wheelNext = 0;
}
