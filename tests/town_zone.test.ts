// src/sim/town_zone.ts: the hub-circle "in town" predicate, re-homed from the
// removed Town Focus leaf (its unit cases left with tests/focus.test.ts). The
// town quest rule (src/sim/town_quests.ts) is its remaining consumer.
import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { isInTownZone } from '../src/sim/town_zone';

describe('isInTownZone', () => {
  const zone = ZONES[0];
  const { x, z, radius } = zone.hub;

  it('is true at the hub centre and false far outside it', () => {
    expect(isInTownZone({ x, z }, zone)).toBe(true);
    expect(isInTownZone({ x: x + radius * 10, z }, zone)).toBe(false);
  });

  it('is inclusive on the circle and exclusive just beyond it', () => {
    expect(isInTownZone({ x: x + radius, z }, zone)).toBe(true);
    expect(isInTownZone({ x: x + radius + 0.001, z }, zone)).toBe(false);
    // The diagonal: a square check would admit this point, a circle refuses it.
    expect(isInTownZone({ x: x + radius * 0.8, z: z + radius * 0.8 }, zone)).toBe(false);
  });
});
