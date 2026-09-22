// The balance beam's tuning CONTRACT (src/sim/lance_balance_core.ts).
//
// These tests hold the constants to playability claims instead of pinning their values,
// because the values will be re-felt: the set must be winnable by an ordinary reactive
// player and losable by an idle one, across many session seeds, or the mechanic is either
// a dice roll or a formality. The stand-in for "an ordinary reactive player" is a bang-bang
// controller with a deliberate 150ms reaction delay: it holds the strafe key against the
// beam's drift the way a human does, three ticks late.
import { describe, expect, it } from 'vitest';
import {
  freshLanceBalance,
  LANCE_SET_SECONDS,
  LANCE_WINDOW_SECONDS,
  lanceFumbled,
  shockLanceBalance,
  stepLanceBalance,
} from '../src/sim/lance_balance_core';
import { DT } from '../src/sim/types';

const TICKS = Math.round(1 / DT);
/** Three ticks: 150ms, an ordinary human reaction to a visible meter. */
const REACTION_TICKS = 3;

/** Run one braced set under a delayed bang-bang controller; seconds survived. */
function playSet(seed: number, seconds: number, shockAt?: number): number {
  let s = freshLanceBalance(seed);
  let lean: -1 | 0 | 1 = 0;
  const history: number[] = [];
  for (let i = 0; i < seconds * TICKS; i++) {
    // The controller sees the beam REACTION_TICKS ago and pushes against it.
    history.push(s.balance + s.velocity * 0.25);
    const seen = history[Math.max(0, history.length - 1 - REACTION_TICKS)];
    lean = seen > 0.05 ? 1 : seen < -0.05 ? -1 : 0;
    if (shockAt !== undefined && i === Math.round(shockAt * TICKS)) {
      s = shockLanceBalance(s, 0.9);
    }
    s = stepLanceBalance(s, lean, seed);
    if (lanceFumbled(s)) return i * DT;
  }
  return seconds;
}

/** Run one braced set with no hands on the beam; seconds survived. */
function idleSet(seed: number, seconds: number): number {
  let s = freshLanceBalance(seed);
  for (let i = 0; i < seconds * TICKS; i++) {
    s = stepLanceBalance(s, 0, seed);
    if (lanceFumbled(s)) return i * DT;
  }
  return seconds;
}

describe('the tuning contract', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 977);

  it('a reactive player survives the full set on every seed', () => {
    for (const seed of SEEDS) {
      const survived = playSet(seed, LANCE_SET_SECONDS + LANCE_WINDOW_SECONDS);
      expect(survived, `seed ${seed} fumbled at ${survived}s`).toBe(
        LANCE_SET_SECONDS + LANCE_WINDOW_SECONDS,
      );
    }
  });

  it('an idle brace is not a strategy: nearly every seed fails, and fails early', () => {
    // The contract is deliberately STATISTICAL, not absolute. The wander is a value noise,
    // and one seed in a few dozen produces a stretch that happens to act as a stabilizing
    // controller; chasing an absolute guarantee means distorting the physics that make the
    // beam feel fair. What the design needs is that letting go cannot be farmed: the seed
    // is the brace tick (unchoosable), so a rare coast is a slot machine with no lever.
    const fails = SEEDS.map((seed) => idleSet(seed, LANCE_SET_SECONDS));
    const coasted = fails.filter((f) => f >= LANCE_SET_SECONDS).length;
    expect(
      coasted,
      `${coasted}/${SEEDS.length} seeds coasted a whole idle set`,
    ).toBeLessThanOrEqual(2);
    const sorted = [...fails].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)], 'median idle fumble time').toBeLessThan(4);
  });

  it('a slam shock is a real event but a reacting player rides it out', () => {
    let rode = 0;
    for (const seed of SEEDS) {
      if (playSet(seed, LANCE_SET_SECONDS, 2.5) === LANCE_SET_SECONDS) rode++;
    }
    // Most shocks are survivable with hands on the beam; a shock that always fumbles
    // makes the boss's own attacks an uncounterable veto on the mechanic.
    expect(rode / SEEDS.length).toBeGreaterThan(0.7);
  });

  it('is deterministic per seed, tick for tick', () => {
    const run = () => {
      let s = freshLanceBalance(42);
      const out: number[] = [];
      for (let i = 0; i < 60; i++) {
        s = stepLanceBalance(s, i % 5 === 0 ? 1 : 0, 42);
        out.push(s.balance);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('the beam genuinely wanders between seeds', () => {
    const at = (seed: number) => {
      let s = freshLanceBalance(seed);
      for (let i = 0; i < 40; i++) s = stepLanceBalance(s, 0, seed);
      return s.balance;
    };
    expect(at(1)).not.toBeCloseTo(at(2), 4);
  });
});
