import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { COURIER_MAX_LEG_SECONDS } from '../src/sim/courier/motion';
import { COURIER_CAPACITY } from '../src/sim/courier/types';
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
  it('the spell promise pins the live travel duration and selection limit', () => {
    expect(COURIER_MAX_LEG_SECONDS).toBe(15);
    expect(ABILITIES.courier.description).toContain(
      `up to ${COURIER_MAX_LEG_SECONDS} seconds to the bank and up to ${COURIER_MAX_LEG_SECONDS} seconds back`,
    );
    expect(ABILITIES.courier.description).toContain('overflow full bags');
    expect(ABILITIES.courier.description).toContain(`${COURIER_CAPACITY} stacks`);
    expect(ABILITIES.courier.effects).toEqual([]);
  });
});
