import { describe, expect, it } from 'vitest';
import { isControllableOwnedPet, ownedCombatSourceOwnerId } from '../src/ui/pet_entity';

describe('Priest guardian HUD contract', () => {
  it('never exposes a guardian through pet controls or the pet target menu', () => {
    expect(
      isControllableOwnedPet({ kind: 'mob', ownerId: 7, templateId: 'guardian_tithefiend' }, 7),
    ).toBe(false);
    expect(
      isControllableOwnedPet({ kind: 'mob', ownerId: 7, templateId: 'warlock_voidwalker' }, 7),
    ).toBe(true);
    expect(
      isControllableOwnedPet({ kind: 'mob', ownerId: 8, templateId: 'warlock_voidwalker' }, 7),
    ).toBe(false);
  });

  it('credits both guardians and normal pets to their owner for player combat feedback', () => {
    expect(
      ownedCombatSourceOwnerId({ kind: 'mob', ownerId: 7, templateId: 'guardian_tithefiend' }),
    ).toBe(7);
    expect(ownedCombatSourceOwnerId({ kind: 'mob', ownerId: 7, templateId: 'forest_wolf' })).toBe(
      7,
    );
    expect(
      ownedCombatSourceOwnerId({ kind: 'player', ownerId: null, templateId: 'hunter' }),
    ).toBeNull();
  });
});
