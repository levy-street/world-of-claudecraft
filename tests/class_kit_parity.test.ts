import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';

describe('Priest and Shaman kit parity additions', () => {
  it('brings Priest and Shaman to twelve learnable abilities through level 20', () => {
    expect(abilitiesKnownAt('priest', 20).map((entry) => entry.def.id)).toEqual([
      'smite',
      'lesser_heal',
      'power_word_fortitude',
      'shadow_word_pain',
      'power_word_shield',
      'renew',
      'mind_blast',
      'inner_fire',
      'heal',
      'mind_flay',
      'flash_heal',
      'holy_fire',
    ]);
    expect(abilitiesKnownAt('shaman', 20).map((entry) => entry.def.id)).toEqual([
      'lightning_bolt',
      'rockbiter_weapon',
      'healing_wave',
      'earth_shock',
      'lightning_shield',
      'flame_shock',
      'flametongue_weapon',
      'frostbrand_weapon',
      'frost_shock',
      'ghost_wolf',
      'lesser_healing_wave',
      'stormstrike',
    ]);
  });

  it('gates the new abilities at their intended early-game levels', () => {
    expect(abilitiesKnownAt('priest', 11).some((entry) => entry.def.id === 'inner_fire')).toBe(
      false,
    );
    expect(abilitiesKnownAt('priest', 12).some((entry) => entry.def.id === 'inner_fire')).toBe(
      true,
    );
    expect(abilitiesKnownAt('priest', 19).some((entry) => entry.def.id === 'holy_fire')).toBe(
      false,
    );
    expect(abilitiesKnownAt('priest', 20).some((entry) => entry.def.id === 'holy_fire')).toBe(true);
    expect(
      abilitiesKnownAt('shaman', 19).some((entry) => entry.def.id === 'lesser_healing_wave'),
    ).toBe(false);
    expect(
      abilitiesKnownAt('shaman', 20).some((entry) => entry.def.id === 'lesser_healing_wave'),
    ).toBe(true);
  });

  it('uses only existing ability effect primitives for the new spells', () => {
    expect(ABILITIES.inner_fire).toMatchObject({
      class: 'priest',
      requiresTarget: false,
      effects: [{ type: 'selfBuff', kind: 'buff_armor', value: 25, duration: 1800 }],
    });
    expect('targetType' in ABILITIES.inner_fire).toBe(false);
    expect(ABILITIES.holy_fire.effects).toEqual([
      { type: 'directDamage', min: 55, max: 65 },
      { type: 'dot', total: 24, duration: 8, interval: 2 },
    ]);
    expect(ABILITIES.lesser_healing_wave).toMatchObject({
      class: 'shaman',
      targetType: 'friendly',
      requiresTarget: true,
      effects: [{ type: 'heal', min: 115, max: 135 }],
    });
  });

  it('keeps the class ability lists backed by concrete ability definitions', () => {
    for (const classId of ['priest', 'shaman'] as const) {
      const missing = CLASSES[classId].abilities.filter((id) => ABILITIES[id] === undefined);
      expect(missing).toEqual([]);
    }
  });
});
