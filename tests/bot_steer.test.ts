import { describe, expect, it } from 'vitest';
import {
  advanceBotSteer,
  BOT_DETOUR_TICKS,
  BOT_STUCK_TICKS,
  freshBotSteer,
} from '../src/sim/bots/steer';

describe('shared bot steering core', () => {
  it('heads straight at the goal while the bot makes progress', () => {
    const st = freshBotSteer();
    for (let i = 0; i < 30; i++) expect(advanceBotSteer(st, i, 0, 1)).toBe(1);
  });

  it('detours perpendicular once wedged, alternating sides with growing legs', () => {
    const st = freshBotSteer();
    advanceBotSteer(st, 0, 0, 0);
    let heading = 0;
    for (let i = 0; i < BOT_STUCK_TICKS; i++) heading = advanceBotSteer(st, 0, 0, 0);
    expect(Math.abs(heading)).toBeCloseTo(Math.PI / 2, 5);
    expect(st.attempts).toBe(1);
    expect(st.detour).toBe(BOT_DETOUR_TICKS);
    const firstSign = st.sign;
    // Ride the leg out while moving, then wedge again: the other side, a longer leg.
    for (let i = 0; i < BOT_DETOUR_TICKS; i++) advanceBotSteer(st, i + 1, 0, 0);
    for (let i = 0; i <= BOT_STUCK_TICKS; i++) advanceBotSteer(st, 99, 0, 0);
    expect(st.sign).toBe(-firstSign);
    expect(st.detour).toBe(BOT_DETOUR_TICKS * 2);
  });

  it('caps an in-flight detour when a caller asks', () => {
    const st = freshBotSteer();
    advanceBotSteer(st, 0, 0, 0);
    for (let i = 0; i < BOT_STUCK_TICKS; i++) advanceBotSteer(st, 0, 0, 0, 5);
    expect(st.detour).toBeLessThanOrEqual(5);
  });
});
