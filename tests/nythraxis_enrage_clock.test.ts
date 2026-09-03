// Pure-leaf pins for The Crown Endures (src/sim/nythraxis_enrage_clock.ts):
// the clock lengths the guide quotes, the warn-mark crossings, the enrage
// tick, and the damage ramp.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_ENRAGE_CALLOUT,
  NYTHRAXIS_ENRAGE_DAMAGE_BONUS,
  NYTHRAXIS_ENRAGE_HASTE_BONUS,
  NYTHRAXIS_ENRAGE_RAMP_EVERY,
  NYTHRAXIS_ENRAGE_RAMP_STEP,
  NYTHRAXIS_ENRAGE_WARN_CALLOUT,
  NYTHRAXIS_ENRAGE_WARN_SECONDS,
  nythraxisEnrageDamageBonus,
  nythraxisEnrageRemaining,
  nythraxisEnrageSeconds,
  nythraxisEnrageStacks,
  nythraxisEnrageStarts,
  nythraxisEnrageWarnCrossed,
} from '../src/sim/nythraxis_enrage_clock';
import { DT } from '../src/sim/types';

describe('Nythraxis The Crown Endures', () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect([nythraxisEnrageSeconds('normal'), nythraxisEnrageSeconds('heroic')]).toEqual([
      420, 360,
    ]);
    expect([...NYTHRAXIS_ENRAGE_WARN_SECONDS]).toEqual([60, 30, 10]);
    expect([NYTHRAXIS_ENRAGE_DAMAGE_BONUS, NYTHRAXIS_ENRAGE_HASTE_BONUS]).toEqual([0.5, 0.5]);
    expect([NYTHRAXIS_ENRAGE_RAMP_EVERY, NYTHRAXIS_ENRAGE_RAMP_STEP]).toEqual([30, 0.25]);
    expect(NYTHRAXIS_ENRAGE_WARN_CALLOUT).toEqual({
      60: 'crownEndures60',
      30: 'crownEndures30',
      10: 'crownEndures10',
    });
    expect(NYTHRAXIS_ENRAGE_CALLOUT).toBe('crownEndures');
  });

  it('counts the remaining time down to zero and no further', () => {
    expect(nythraxisEnrageRemaining(0, 'normal')).toBe(420);
    expect(nythraxisEnrageRemaining(100, 'heroic')).toBe(260);
    expect(nythraxisEnrageRemaining(420, 'normal')).toBe(0);
    expect(nythraxisEnrageRemaining(999, 'normal')).toBe(0);
  });

  it('reports each warning mark exactly once as a 20 Hz clock crosses it', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const limit = nythraxisEnrageSeconds(difficulty);
      const seen: number[] = [];
      let elapsed = 0;
      while (elapsed < limit + 1) {
        const next = elapsed + DT;
        const mark = nythraxisEnrageWarnCrossed(elapsed, next, difficulty);
        if (mark !== null) seen.push(mark);
        elapsed = next;
      }
      expect(seen, difficulty).toEqual([60, 30, 10]);
    }
    // A single long step reports the first mark it crossed.
    expect(nythraxisEnrageWarnCrossed(0, 400, 'normal')).toBe(60);
    // Landing exactly on a mark counts as crossing it; sitting on it does not.
    expect(nythraxisEnrageWarnCrossed(359, 360, 'normal')).toBe(60);
    expect(nythraxisEnrageWarnCrossed(360, 360, 'normal')).toBeNull();
  });

  it('starts the enrage on the tick the clock runs out, once', () => {
    expect(nythraxisEnrageStarts(419.95, 420, 'normal')).toBe(true);
    expect(nythraxisEnrageStarts(420, 420.05, 'normal')).toBe(false);
    expect(nythraxisEnrageStarts(300, 350, 'normal')).toBe(false);
    expect(nythraxisEnrageStarts(359.95, 360, 'heroic')).toBe(true);
  });

  it('ramps one stack every thirty seconds after the enrage and prices each stack', () => {
    expect(nythraxisEnrageStacks(419, 'normal')).toBe(0);
    expect(nythraxisEnrageStacks(420, 'normal')).toBe(1);
    expect(nythraxisEnrageStacks(449.99, 'normal')).toBe(1);
    expect(nythraxisEnrageStacks(450, 'normal')).toBe(2);
    expect(nythraxisEnrageStacks(540, 'normal')).toBe(5);
    expect(nythraxisEnrageStacks(360, 'heroic')).toBe(1);
    expect(nythraxisEnrageDamageBonus(0)).toBe(0);
    expect(nythraxisEnrageDamageBonus(1)).toBe(0.5);
    expect(nythraxisEnrageDamageBonus(2)).toBe(0.75);
    expect(nythraxisEnrageDamageBonus(5)).toBe(1.5);
  });
});
