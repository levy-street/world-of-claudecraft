// The Guardian of the Heat's Wheel of the Hearth (docs/design/raid/smith_heart.md
// section 7.4), Mythic, phases 2 and 3: the shore round the wellspring is cut in four
// slices. Three turn red and erupt; one stays dark and safe. Three rounds run back to
// back: as one round's fire falls, the next round's slices already show, its safe
// slice somewhere else, so the raid crosses the moment the fire dies down.
//
//   A round  each red slice warns `wheelWarn` s, erupts (a near-lethal blow to whoever
//            stands in it, past the wellspring's lip), and burns `wheelBurn` s more.
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
  WHEEL_ROUNDS,
  WHEEL_SLICES,
  wheelTemplate,
} from './heat_ids';
import {
  at,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  raidWarn,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatWheelRound } from './heat_state';

/** Run `run`'s safe slices: each a hashed one or two slices from the last, never the
 *  same, always on the shore. Pure. */
export function wheelSafes(run: number): number[] {
  const out: number[] = [];
  let at0 = heatHash(run, 41) % WHEEL_SLICES;
  out.push(at0);
  for (let i = 1; i < WHEEL_ROUNDS; i++) {
    const step = 1 + (heatHash(run * 7 + i, 43) % 2);
    const up = at0 + step;
    const down = at0 - step;
    const goUp = up < WHEEL_SLICES && (down < 0 || heatHash(run + i, 47) % 2 === 0);
    at0 = goUp ? up : down;
    out.push(at0);
  }
  return out;
}

function beginRound(s: HeatScope, safe: number): void {
  const reds: number[] = [];
  for (let slice = 0; slice < WHEEL_SLICES; slice++) {
    if (slice === safe) continue;
    reds.push(
      spawnFightObject(
        s.ctx,
        s.inst,
        wheelTemplate(slice, 'warn', T.wheelWarn),
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
    wheelTemplate(safe, 'safe', T.wheelWarn),
    HEAT_NAMES.wheel,
    HEARTH_WELL.x,
    HEARTH_WELL.z,
    T.wheelOuter,
  ).id;
  s.st.wheelRounds.push({
    safe,
    state: 'warn',
    remaining: T.wheelWarn,
    tick: 0,
    reds,
    safeId,
  });
}

/** Begin a Wheel of the Hearth now. Exported for the dev trigger. */
export function startWheel(s: HeatScope): void {
  const st = s.st;
  st.wheelTimer = T.wheelEvery;
  st.wheelSafes = wheelSafes(st.wheelRuns);
  st.wheelRuns++;
  beginRound(s, st.wheelSafes[0]);
  st.wheelNext = 1;
  raidWarn(s, s.boss, 'wheel', 'The Hearth turns! Get to the dark slice!');
}

/** The players in a red slice of `round` now: on the shore, not in its safe slice. */
function inRed(s: HeatScope, round: HeatWheelRound) {
  return livePlayers(s).filter((p) => {
    const here = at(s, p);
    return (
      wellDistance(here.x, here.z) >= HEARTH_WELL.r && wheelSliceAt(here.x, here.z) !== round.safe
    );
  });
}

function setReds(s: HeatScope, round: HeatWheelRound): void {
  round.reds.forEach((id, i) => {
    const e = s.ctx.entities.get(id);
    if (!e) return;
    // The reds are every slice but the safe one, in order.
    const slice = i < round.safe ? i : i + 1;
    e.templateId = wheelTemplate(slice, 'burn', T.wheelBurn);
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
      setReds(s, round);
      dropFightObject(s.ctx, s.inst, round.safeId);
      cueAt(s, HEAT_CUES.ignite, HEARTH_WELL.x, HEARTH_WELL.z, T.wheelOuter);
      for (const p of inRed(s, round))
        fireHit(s, p, roll(s, T.wheelMin, T.wheelMax), HEAT_NAMES.wheel);
      keep.push(round);
      if (st.wheelNext < st.wheelSafes.length) beginRound(s, st.wheelSafes[st.wheelNext++]);
      continue;
    }
    if (round.remaining <= 1e-9) {
      for (const id of round.reds) dropFightObject(s.ctx, s.inst, id);
      continue;
    }
    round.tick -= DT;
    if (round.tick <= 1e-9) {
      round.tick += T.wheelTick;
      for (const p of inRed(s, round))
        fireHit(s, p, roll(s, T.wheelBurnMin, T.wheelBurnMax), HEAT_NAMES.wheel);
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
