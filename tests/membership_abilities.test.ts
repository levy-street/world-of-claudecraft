import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { COURIER_CAPACITY, COURIER_SPEED } from '../src/sim/courier/types';
import { membershipAbilities } from '../src/sim/membership_abilities';
import type { PlayerClass } from '../src/sim/types';

describe('membership spell grant', () => {
  it.each(Object.keys(CLASSES) as PlayerClass[])(
    'grants Courier to %s only with membership',
    (cls) => {
      const base = abilitiesKnownAt(cls, 1);
      const active = membershipAbilities(base, true);
      expect(active.filter((ability) => ability.def.id === 'courier')).toHaveLength(1);
      expect(base.some((ability) => ability.def.id === 'courier')).toBe(false);
      expect(
        membershipAbilities(active, true).filter((ability) => ability.def.id === 'courier'),
      ).toHaveLength(1);
      expect(membershipAbilities(active, false)).toEqual(base);
    },
  );
  it('the spell promise pins the live travel speed and selection limit', () => {
    expect(COURIER_SPEED).toBe(7 * 2.5);
    expect(ABILITIES.courier.description).toContain('250%');
    expect(ABILITIES.courier.description).toContain(`${COURIER_CAPACITY} stacks`);
    expect(ABILITIES.courier.effects).toEqual([]);
  });
});
