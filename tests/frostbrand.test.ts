import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';

describe('Frostbrand Weapon (retired shaman frost imbue)', () => {
  it('retains its pure-data definition for save compatibility', () => {
    const def = ABILITIES.frostbrand_weapon;
    expect(def).toBeDefined();
    expect(def.class).toBe('shaman');
    expect(def.school).toBe('frost');
    expect(def.learnLevel).toBe(5);
    expect(def.requiresTarget).toBe(false);
    expect(def.effects).toEqual([{ type: 'imbue', bonus: 8, duration: 300 }]);
    // Rank 2 at level 20 raises the per-swing bonus to 13.
    expect(def.ranks?.[0]).toMatchObject({ rank: 2, level: 20 });
  });

  it('is no longer offered by any v0.29 shaman specialization', () => {
    for (const spec of ['elemental', 'enhancement', 'restoration']) {
      const mods = computeTalentModifiers('shaman', { spec, rows: {} }, 20);
      expect(
        abilitiesKnownAt('shaman', 20, mods).some((k) => k.def.id === 'frostbrand_weapon'),
      ).toBe(false);
    }
  });
});
