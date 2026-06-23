import { describe, it, expect } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';
import { petBarIconIds, petHealIcon, PET_STANCE_ICONS, PET_OWNER_CLASSES } from '../src/ui/pet_bar_icons';

// A pet-bar action must never reuse an icon the owning class also shows on its own
// action bar: that renders as a confusing on-screen duplicate (the Hunter's
// aggressive stance used to borrow `rapid_fire`, one of its own shots; the Warlock's
// pet heal borrowed its own `drain_life`).
describe('pet bar icons', () => {
  it('no pet action reuses an ability the owner has on their own bar', () => {
    const collisions: string[] = [];
    for (const cls of PET_OWNER_CLASSES) {
      const owned = new Set(CLASSES[cls].abilities);
      for (const icon of petBarIconIds(cls)) {
        if (owned.has(icon)) collisions.push(`${cls}: pet icon "${icon}" is also a class ability`);
      }
    }
    expect(collisions, collisions.join('\n')).toEqual([]);
  });

  it('the Hunter feed-pet icon is the dedicated food icon, not a borrowed heal spell', () => {
    expect(petHealIcon('hunter')).toBe('feed_pet');
    expect(petHealIcon('warlock')).toBe('mend_demon');
    expect(hasExplicitAbilityIcon('feed_pet')).toBe(true);
    expect(hasExplicitAbilityIcon('mend_demon')).toBe(true);
    // The old leaf heal art (Druid `rejuvenation`) must not be what feeds the pet.
    expect(JSON.stringify(abilityIconRecipe('feed_pet')))
      .not.toBe(JSON.stringify(abilityIconRecipe('rejuvenation')));
  });

  it('every pet stance icon has an explicit, distinct recipe', () => {
    const ids = Object.values(PET_STANCE_ICONS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(hasExplicitAbilityIcon(id)).toBe(true);
  });
});
