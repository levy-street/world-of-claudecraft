// The Guardian of the Quench's Mythic interphase (docs/design/raid/smith_heart.md
// section 7.3, "The Blades Hunt"): once, at a quarter health, it stands with its arms
// raised, past all harm and striking no one (a 20 s bar), while the four blades cross
// the lake again and again: a slash every 1.5 s at first and every second by the end,
// each down a line through a player (the tank too), fixed where it is drawn, 1 s before
// the blade flies. The cold does not rise and the ice does not strain while it lasts,
// so the only job is to dodge.
//
// Zero rng in the picks (hashed); the draws are the damage rolls, in player order.

import { DT } from '../../types';
import { QUENCH_CASTS, quenchHash, QUENCH_TUNING as T } from './quench_ids';
import { beginBar, dropFightObject, livePlayers, type QuenchScope, raidWarn } from './quench_scope';
import { clearSlashes, flyLine, landLine, launchLine, openLine } from './quench_slash';
import type { QuenchFightState } from './quench_state';
import { quenchSay } from './quench_voice';

/** Is the interphase due (Mythic, a quarter health, once, no blade in mid-flight)? */
export function flurryDue(s: QuenchScope, free: boolean): boolean {
  const st = s.st;
  return (
    s.rules.flurry &&
    free &&
    st.half === 'awake' &&
    !st.flurryDone &&
    st.flurry === null &&
    s.boss.hp <= s.boss.maxHp * T.flurryAt &&
    st.slash?.phase !== 'fly'
  );
}

/** It begins. Exported for the dev trigger. */
export function startFlurry(s: QuenchScope): boolean {
  const st = s.st;
  if (st.flurry || st.half !== 'awake' || st.slash?.phase === 'fly') return false;
  clearSlashes(s, st);
  st.flurryDone = true;
  st.flurry = { lines: [], gap: 0 };
  s.boss.damageImmune = true;
  beginBar(s, QUENCH_CASTS.flurry, T.flurrySeconds, s.boss.facing);
  raidWarn(s, s.boss, 'flurry', 'Every blade hunts at once! Dodge the lines!');
  quenchSay(s, s.boss, 'flurry');
  return true;
}

/** The next awake blade not already on a line. */
function freeBlade(s: QuenchScope, busy: readonly number[]): number {
  const st = s.st;
  for (let tries = 0; tries < st.blades.length; tries++) {
    const i = st.slashes++ % st.blades.length;
    if (st.blades[i].awake && !busy.includes(i)) return i;
  }
  return -1;
}

/** One tick: a new line when it is time, and every line along. */
export function stepFlurry(s: QuenchScope): void {
  const fl = s.st.flurry;
  if (!fl) return;
  fl.gap -= DT;
  const left = s.boss.castRemaining;
  // No line that could not land before the bar ends.
  if (fl.gap <= 1e-9 && left > T.flurryAim + T.slashFly) {
    const k = 1 - left / T.flurrySeconds;
    fl.gap = T.flurryGapStart + (T.flurryGapEnd - T.flurryGapStart) * k;
    const live = livePlayers(s);
    const blade = freeBlade(
      s,
      fl.lines.map((l) => l.blade),
    );
    if (live.length > 0 && blade >= 0) {
      s.st.casts++;
      const target = live[quenchHash(s.boss.id * 31 + 11, s.st.casts) % live.length];
      fl.lines.push(openLine(s, blade, target, T.flurryAim));
    }
  }
  const keep = [];
  for (const line of fl.lines) {
    line.remaining -= DT;
    if (line.phase === 'aim') {
      if (line.remaining <= 1e-9) launchLine(s, line);
      keep.push(line);
      continue;
    }
    flyLine(s, line);
    if (line.remaining <= 1e-9) landLine(s, line);
    else keep.push(line);
  }
  fl.lines = keep;
}

/** Its bar is over (or cut): every line still out comes down, the guardian can be hurt
 *  again, the rounds of marks take up. */
export function endFlurry(s: QuenchScope): void {
  const fl = s.st.flurry;
  if (!fl) return;
  for (const line of fl.lines) {
    if (line.phase === 'fly') {
      line.remaining = 0;
      flyLine(s, line);
    }
    landLine(s, line);
  }
  s.st.flurry = null;
  s.boss.damageImmune = false;
  s.st.slashTimer = T.slashAfterWake;
}

/** The lines' objects go (a reset, the fall); the blades sink with the fight. */
export function clearFlurry(s: Pick<QuenchScope, 'ctx' | 'inst'>, st: QuenchFightState): void {
  if (!st.flurry) return;
  for (const line of st.flurry.lines) dropFightObject(s.ctx, s.inst, line.laneId);
  st.flurry = null;
}
