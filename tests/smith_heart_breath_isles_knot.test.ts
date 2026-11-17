// The Islands of the Wind and the Knotted Gale never overlap (the owner's
// call of 2026-11-17: a carrier rode off to an isle and the ball burst): the
// isles wait for the ball to be thrown or to burst, and no ball falls while
// the isles are up.

import { describe, expect, it } from 'vitest';
import { BREATH_DIFFICULTY } from '../src/sim/encounters/smith_heart';
import { clearHeart } from '../src/sim/encounters/smith_heart/breath_heart';
import { breathFight } from './helpers/breath_fight';

function heroic() {
  const f = breathFight(6, 23);
  expect(f.dev('/dev heart breath heroic')).toBe(true);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  // Hold the raid on a calm Cornice: only the two mechanics' clocks matter.
  st.wind.phase = 'calm';
  st.wind.remaining = 999;
  st.inhaleTimer = 999;
  st.skyTimer = 999;
  st.blowTimer = 999;
  st.circleTimer = 999;
  return { f, st };
}

describe('the isles and the Knotted Gale never overlap', () => {
  it('a crossed isle mark waits while a ball is in play, then wakes the round', () => {
    const { f, st } = heroic();
    expect(f.dev('/dev heart breath heart')).toBe(true);
    expect(st.heart).not.toBeNull();
    const b = f.boss();
    b.hp = Math.round(b.maxHp * (BREATH_DIFFICULTY.heroic.isleAt[0] - 0.02));
    f.tick(20, true);
    expect(st.isles.round).toBeNull();
    // The ball gone (thrown or burst; its burst's blast is the Knotted
    // Gale's own test): the round is free to begin.
    clearHeart(f.sim.ctx, f.inst, st);
    let woke = false;
    for (let i = 0; i < 20 * 10 && !woke; i++) {
      f.tick(1, true);
      woke = st.isles.round !== null;
    }
    expect(st.heart).toBeNull();
    expect(woke).toBe(true);
  });

  it('no ball falls while the isles are up', () => {
    const { f, st } = heroic();
    expect(f.dev('/dev heart breath isles')).toBe(true);
    expect(st.isles.round).not.toBeNull();
    st.heartTimer = 0;
    f.tick(20 * 3, true);
    expect(st.heart).toBeNull();
  });
});
