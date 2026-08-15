// Druid arm of the tank crit-immunity suite. Split from
// tests/tank_crit_immunity.test.ts along class-pair boundaries for CI shard
// balance (a pure move; shared fight helper in tank_crit_immunity_util.ts).

import { describe, expect, it } from 'vitest';
import { critsTaken } from './tank_crit_immunity_util';

describe('tank crit immunity vs mobs (druid)', () => {
  it('a Feral druid in Sloth Form is never critically hit', () => {
    expect(critsTaken({ cls: 'druid', spec: 'feral', form: 'bear_form' }).crits).toBe(0);
  });

  it('a Feral druid OUT of form still eats mob crits: the form is the commitment', () => {
    expect(critsTaken({ cls: 'druid', spec: 'feral' }).crits).toBeGreaterThan(0);
  });
});
