// Paladin arm of the tank crit-immunity suite. Split from
// tests/tank_crit_immunity.test.ts along class-pair boundaries for CI shard
// balance (a pure move; shared fight helper in tank_crit_immunity_util.ts).

import { describe, expect, it } from 'vitest';
import { critsTaken } from './tank_crit_immunity_util';

describe('tank crit immunity vs mobs (paladin)', () => {
  it('a Protection paladin is never critically hit', () => {
    expect(critsTaken({ cls: 'paladin', spec: 'protection' }).crits).toBe(0);
  });

  it('a Retribution paladin still eats mob crits', () => {
    expect(critsTaken({ cls: 'paladin', spec: 'retribution' }).crits).toBeGreaterThan(0);
  });
});
