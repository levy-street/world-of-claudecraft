import { describe, expect, it } from 'vitest';
import { type CharacterWeaponAura, characterWeaponAuraInto } from '../src/render/character_effects';
import type { Entity } from '../src/sim/types';

// This projection only consumes the live aura collection, not the actor rig.
function actor(...ids: string[]): Entity {
  return { auras: ids.map((id) => ({ id, kind: 'imbue', remaining: 1800 })) } as Entity;
}

describe('Shaman held weapon presentation ownership', () => {
  it.each(['rockbiter_weapon', 'flametongue_weapon', 'galeheart_weapon', 'lifespring_weapon'])(
    '%s cannot add a legacy whole-blade tint over its persistent held detail',
    (id) => {
      const scratch: CharacterWeaponAura = { color: 0x123456, tip: true };
      expect(characterWeaponAuraInto(actor(id), scratch)).toBeNull();
      expect(scratch).toEqual({ color: 0x123456, tip: true });
    },
  );

  it.each([
    ['sanguine_aura', 0xff4636, false],
    ['deadly_poison', 0x58d63c, false],
    ['instant_poison', 0x8fd455, true],
    ['frostbrand_weapon', 0xbfe4ff, false],
  ] as const)(
    'preserves the existing %s overlay and its scope after a Shaman aura',
    (id, color, tip) => {
      const scratch: CharacterWeaponAura = { color: 0, tip: false };
      const result = characterWeaponAuraInto(actor('flametongue_weapon', id), scratch);
      expect(result).toBe(scratch);
      expect(result).toEqual({ color, tip });
    },
  );

  it('does not reorder unrelated buffs or hide the first legitimate overlay', () => {
    const scratch: CharacterWeaponAura = { color: 0, tip: false };
    expect(
      characterWeaponAuraInto(
        actor('instant_poison', 'flametongue_weapon', 'deadly_poison'),
        scratch,
      ),
    ).toEqual({ color: 0x8fd455, tip: true });
    expect(characterWeaponAuraInto(actor(), scratch)).toBeNull();
  });
});
