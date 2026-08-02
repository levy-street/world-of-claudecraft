// Warrior arm of the tank crit-immunity suite. Split from
// tests/tank_crit_immunity.test.ts along class-pair boundaries for CI shard
// balance (a pure move; shared fight helper in tank_crit_immunity_util.ts).

import { describe, expect, it } from 'vitest';
import { critsTaken } from './tank_crit_immunity_util';

describe('tank crit immunity vs mobs (warrior)', () => {
  it('a Protection warrior is never critically hit', () => {
    expect(critsTaken({ cls: 'warrior', spec: 'prot' }).crits).toBe(0);
  });

  it('an Arms warrior still eats mob crits (the roll is alive)', () => {
    expect(critsTaken({ cls: 'warrior', spec: 'arms' }).crits).toBeGreaterThan(0);
  });
});
