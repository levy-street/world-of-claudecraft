// The Smith's Heart raid bots' reaction model (scripts/lib/heart_raid_reaction.mjs):
// a bot notices a fresh floor hazard a human-ish moment after it appears, and
// now and then late; the same rolls replay the same reactions.

import { describe, expect, it } from 'vitest';
import { createReaction, REACTION_DEFAULTS } from '../scripts/lib/heart_raid_reaction.mjs';

/** A fixed sequence of rolls, cycled. */
function rolls(...xs: number[]) {
  let i = 0;
  return () => xs[i++ % xs.length];
}

describe('heart raid reaction model', () => {
  it('notices a hazard only after the rolled reaction time', () => {
    // delay roll 0.5 -> 450 ms; slip roll 0.9 -> no slip
    const r = createReaction(rolls(0.5, 0.9));
    expect(r.noticed('mage', 7, 1000)).toBe(false);
    expect(r.noticed('mage', 7, 1449)).toBe(false);
    expect(r.noticed('mage', 7, 1450)).toBe(true);
    expect(r.slips()).toBe(0);
  });

  it('keeps the window inside the competent band', () => {
    const lo = createReaction(rolls(0, 0.99));
    const hi = createReaction(rolls(0.999999, 0.99));
    expect(lo.noticed('a', 1, 0)).toBe(false);
    expect(lo.noticed('a', 1, REACTION_DEFAULTS.minMs)).toBe(true);
    expect(hi.noticed('a', 1, 0)).toBe(false);
    expect(hi.noticed('a', 1, REACTION_DEFAULTS.maxMs - 1)).toBe(false);
    expect(hi.noticed('a', 1, REACTION_DEFAULTS.maxMs)).toBe(true);
  });

  it('a slip adds the late window on top', () => {
    // delay 0 -> 250 ms, slip roll 0 -> slips, slip length roll 0 -> +900 ms
    const r = createReaction(rolls(0, 0, 0));
    expect(r.noticed('tank', 3, 0)).toBe(false);
    expect(r.noticed('tank', 3, 1149)).toBe(false);
    expect(r.noticed('tank', 3, 1150)).toBe(true);
    expect(r.slips()).toBe(1);
  });

  it('each bot reacts on its own clock, and a hazard without an id is always seen', () => {
    const r = createReaction(rolls(0, 0.9, 0.999999, 0.9));
    expect(r.noticed('a', 5, 0)).toBe(false);
    expect(r.noticed('b', 5, 0)).toBe(false);
    expect(r.noticed('a', 5, 300)).toBe(true);
    expect(r.noticed('b', 5, 300)).toBe(false);
    expect(r.noticed('b', 5, 650)).toBe(true);
    expect(r.noticed('a', undefined, 0)).toBe(true);
    expect(r.noticed('a', null, 0)).toBe(true);
  });

  it('is deterministic for a given roll sequence and forgets pruned hazards', () => {
    const seq = [0.1, 0.5, 0.7, 0.02, 0.3, 0.8];
    const a = createReaction(rolls(...seq));
    const b = createReaction(rolls(...seq));
    const at = (r: ReturnType<typeof createReaction>) =>
      [1, 2, 3].map((id) => {
        for (let t = 0; t < 5000; t += 10) if (r.noticed('x', id, t)) return t;
        return -1;
      });
    expect(at(a)).toEqual(at(b));
    a.prune(new Set([2]));
    // hazard 1 forgotten: asked again it rolls a fresh reaction from now
    expect(a.noticed('x', 1, 100000)).toBe(false);
    expect(a.noticed('x', 2, 100000)).toBe(true);
  });
});
