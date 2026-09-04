// Pure-leaf pins for The Crown Endures (src/sim/nythraxis_enrage_clock.ts):
// the clock lengths the guide quotes, the warn-mark crossings, the enrage
// tick, and the damage ramp.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_ENRAGE_CALLOUT,
  NYTHRAXIS_ENRAGE_DAMAGE_BONUS,
  NYTHRAXIS_ENRAGE_HASTE_BONUS,
  NYTHRAXIS_ENRAGE_RAMP_STEP,
  NYTHRAXIS_ENRAGE_WARN_CALLOUT,
  NYTHRAXIS_ENRAGE_WARN_SECONDS,
  nythraxisEnrageDamageBonus,
  nythraxisEnrageRampEvery,
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
      360, 300,
    ]);
    expect([...NYTHRAXIS_ENRAGE_WARN_SECONDS]).toEqual([60, 30, 10]);
    expect([NYTHRAXIS_ENRAGE_DAMAGE_BONUS, NYTHRAXIS_ENRAGE_HASTE_BONUS]).toEqual([0.5, 0.5]);
    expect([nythraxisEnrageRampEvery('normal'), nythraxisEnrageRampEvery('heroic')]).toEqual([
      30, 20,
    ]);
    expect(NYTHRAXIS_ENRAGE_RAMP_STEP).toBe(0.25);
    expect(NYTHRAXIS_ENRAGE_WARN_CALLOUT).toEqual({
      60: 'crownEndures60',
      30: 'crownEndures30',
      10: 'crownEndures10',
    });
    expect(NYTHRAXIS_ENRAGE_CALLOUT).toBe('crownEndures');
  });

  it('counts the remaining time down to zero and no further', () => {
    expect(nythraxisEnrageRemaining(0, 'normal')).toBe(360);
    expect(nythraxisEnrageRemaining(100, 'heroic')).toBe(200);
    expect(nythraxisEnrageRemaining(360, 'normal')).toBe(0);
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
    expect(nythraxisEnrageWarnCrossed(0, 340, 'normal')).toBe(60);
    // Landing exactly on a mark counts as crossing it; sitting on it does not.
    expect(nythraxisEnrageWarnCrossed(299, 300, 'normal')).toBe(60);
    expect(nythraxisEnrageWarnCrossed(300, 300, 'normal')).toBeNull();
  });

  it('starts the enrage on the tick the clock runs out, once', () => {
    expect(nythraxisEnrageStarts(359.95, 360, 'normal')).toBe(true);
    expect(nythraxisEnrageStarts(360, 360.05, 'normal')).toBe(false);
    expect(nythraxisEnrageStarts(200, 250, 'normal')).toBe(false);
    expect(nythraxisEnrageStarts(299.95, 300, 'heroic')).toBe(true);
  });

  it('ramps a stack every 30 s (heroic 20 s) after the enrage and prices each stack', () => {
    expect(nythraxisEnrageStacks(359, 'normal')).toBe(0);
    expect(nythraxisEnrageStacks(360, 'normal')).toBe(1);
    expect(nythraxisEnrageStacks(389.99, 'normal')).toBe(1);
    expect(nythraxisEnrageStacks(390, 'normal')).toBe(2);
    expect(nythraxisEnrageStacks(480, 'normal')).toBe(5);
    expect(nythraxisEnrageStacks(300, 'heroic')).toBe(1);
    expect(nythraxisEnrageStacks(319.99, 'heroic')).toBe(1);
    expect(nythraxisEnrageStacks(320, 'heroic')).toBe(2);
    expect(nythraxisEnrageDamageBonus(0)).toBe(0);
    expect(nythraxisEnrageDamageBonus(1)).toBe(0.5);
    expect(nythraxisEnrageDamageBonus(2)).toBe(0.75);
    expect(nythraxisEnrageDamageBonus(5)).toBe(1.5);
  });
});
