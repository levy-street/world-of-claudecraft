// The Guardian of the Heat's Wheel of the Hearth (docs/design/raid/smith_heart.md
// section 7.4), every tier, every fighting phase (the rework of 2026-11-18: on Normal
// the fight never made anyone move): the shore round the wellspring is cut in four
// slices. Three turn red and erupt; one stays dark and safe. The tier's rounds run back
// to back (three, Mythic four): as one round's fire falls, the next round's slices
// already show, its safe slice somewhere else, so the raid crosses the moment the fire
// dies down.
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

/** Run `run`'s `rounds` safe slices: each a hashed one or two slices from the last,
 *  never the same, always on the shore. Pure. */
export function wheelSafes(run: number, rounds: number): number[] {
  const out: number[] = [];
  let at0 = heatHash(run, 41) % WHEEL_SLICES;
  out.push(at0);
  for (let i = 1; i < rounds; i++) {
    const step = 1 + (heatHash(run * 7 + i, 43) % 2);
    const up = at0 + step;
    const down = at0 - step;
    const goUp = up < WHEEL_SLICES && (down < 0 || heatHash(run + i, 47) % 2 === 0);
    at0 = goUp ? up : down;
    out.push(at0);
  }
  return out;
}

/** The slices the raid crosses from round safe slice `from` to the next, `to`:
 *  any slice between them (the short way, over the shore: the safe slices never
 *  wrap round behind the altar-stone), then `to` itself. Pure. */
export function wheelCrossing(from: number, to: number): number[] {
  const out: number[] = [];
  const step = to > from ? 1 : -1;
  for (let slice = from + step; slice !== to; slice += step) out.push(slice);
  out.push(to);
  return out;
}

function beginRound(s: HeatScope, safe: number): void {
  const warn = s.rules.wheel.warn;
  const reds: number[] = [];
  for (let slice = 0; slice < WHEEL_SLICES; slice++) {
    if (slice === safe) continue;
    reds.push(
      spawnFightObject(
        s.ctx,
        s.inst,
        wheelTemplate(slice, 'warn', warn),
        HEAT_NAMES.wheel,
        HEARTH_WELL.x,
        HEARTH_WELL.z,
        T.wheelOuter,
      ).id,
    );
  }
  const safeId = spawnFightObject(
    s.ctx,
    s.inst,
    wheelTemplate(safe, 'safe', warn),
    HEAT_NAMES.wheel,
    HEARTH_WELL.x,
    HEARTH_WELL.z,
    T.wheelOuter,
  ).id;
  s.st.wheelRounds.push({
    safe,
    state: 'warn',
    remaining: warn,
    tick: 0,
    reds,
    safeId,
    doused: [],
    douse: 0,
  });
}

/** Begin a Wheel of the Hearth now. Exported for the dev trigger. */
export function startWheel(s: HeatScope): void {
  const st = s.st;
  st.wheelTimer = s.rules.wheel.every;
  st.wheelSafes = wheelSafes(st.wheelRuns, s.rules.wheel.rounds);
  st.wheelRuns++;
  beginRound(s, st.wheelSafes[0]);
  st.wheelNext = 1;
  heatSay(s, s.boss, 'wheel');
}

/** The players in a red slice of `round` now: on the shore, not in its safe
 *  slice (nor, with `burning`, in a slice already put out). */
function inRed(s: HeatScope, round: HeatWheelRound, burning = false) {
  return livePlayers(s).filter((p) => {
    const here = at(s, p);
    if (wellDistance(here.x, here.z) < HEARTH_WELL.r) return false;
    const slice = wheelSliceAt(here.x, here.z);
    return slice !== round.safe && !(burning && round.doused.includes(slice));
  });
}

/** Red object `i`'s slice: the reds are every slice but the safe one, in order. */
function redSlice(round: HeatWheelRound, i: number): number {
  return i < round.safe ? i : i + 1;
}

function setReds(s: HeatScope, round: HeatWheelRound): void {
  round.reds.forEach((id, i) => {
    const e = s.ctx.entities.get(id);
    if (!e) return;
    const slice = redSlice(round, i);
    const seconds = round.doused.includes(slice) ? T.wheelDouse : T.wheelBurn;
    e.templateId = wheelTemplate(slice, 'burn', seconds);
  });
}

/** Put out the doused slices' fire (their objects go; they burn nobody). */
function douse(s: HeatScope, round: HeatWheelRound): void {
  round.reds.forEach((id, i) => {
    if (round.doused.includes(redSlice(round, i))) dropFightObject(s.ctx, s.inst, id);
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
        round.doused = wheelCrossing(round.safe, st.wheelSafes[st.wheelNext]);
        round.douse = T.wheelDouse;
      }
      setReds(s, round);
      dropFightObject(s.ctx, s.inst, round.safeId);
      cueAt(s, HEAT_CUES.ignite, HEARTH_WELL.x, HEARTH_WELL.z, T.wheelOuter);
      for (const p of inRed(s, round))
        fireHit(
          s,
          p,
          roll(s, T.wheelMin, T.wheelMax, punishMult(s) * s.rules.wheel.hit),
          HEAT_NAMES.wheel,
        );
      keep.push(round);
      if (st.wheelNext < st.wheelSafes.length) beginRound(s, st.wheelSafes[st.wheelNext++]);
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
    if (round.state === 'warn') dropFightObject(s.ctx, s.inst, round.safeId);
  }
  s.st.wheelRounds = [];
  s.st.wheelSafes = [];
  s.st.wheelNext = 0;
}
