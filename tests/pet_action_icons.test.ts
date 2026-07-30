import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { hasExplicitAbilityIcon } from '../src/ui/icons';
import { PET_ACTION_ICONS, petFeedButtonState } from '../src/ui/pet_action_icons';

// Regression guard for "Repeated icons on hunter class": the pet action bar used to pass
// class ability ids to the icon resolver, so pet buttons borrowed other classes' spell
// art (a hunter's aggressive stance == their own Rapid Fire; "Heal Pet" == the druid
// magic heal). Each pet action must have its OWN dedicated icon recipe instead.
describe('pet action bar icons', () => {
  const iconIds = Object.values(PET_ACTION_ICONS);

  it('defines an icon for every pet action', () => {
    expect(iconIds.length).toBeGreaterThan(0);
  });

  it('never reuses a class ability id (the repeated-icon bug)', () => {
    const abilityIds = new Set(Object.keys(ABILITIES));
    const borrowed = iconIds.filter((id) => abilityIds.has(id));
    expect(borrowed, 'pet actions must use dedicated icons, not class ability art').toEqual([]);
  });

  it('gives every pet action its own explicit recipe (no procedural fallback)', () => {
    const missing = iconIds.filter((id) => !hasExplicitAbilityIcon(id));
    expect(missing, 'add these ids to ABILITY_RECIPES in src/ui/icons.ts').toEqual([]);
  });

  it('uses a distinct icon id per pet action', () => {
    expect(new Set(iconIds).size).toBe(iconIds.length);
  });
});

// The Feed Pet button used to look identically clickable whether or not it
// could actually do anything, so a hunter with a full-health pet or no food
// saw an inert button with no explanation. petFeedButtonState is the pure
// decision the button's disabled state and tooltip now render from.
describe('petFeedButtonState', () => {
  it('disables with the full-HP reason when the pet is already topped up, even with food on hand', () => {
    expect(petFeedButtonState(100, 100, true)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledFullHp',
    });
  });

  it('disables with the no-food reason when the pet is hurt but no food is eligible', () => {
    expect(petFeedButtonState(40, 100, false)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledNoFood',
    });
  });

  it('is enabled with no reason when the pet is hurt and food is available', () => {
    expect(petFeedButtonState(40, 100, true)).toEqual({ disabled: false, reasonKey: null });
  });

  it('does not read a zero maxHp as full health (guards the petMaxHp > 0 clause)', () => {
    // Before the pet's stats resolve, maxHp can momentarily be 0; petHp >= maxHp
    // would then falsely report "full health". The guard skips the full-HP
    // branch so it falls through to the food check instead.
    expect(petFeedButtonState(0, 0, false)).toEqual({
      disabled: true,
      reasonKey: 'hudChrome.petFeed.disabledNoFood',
    });
    expect(petFeedButtonState(0, 0, true)).toEqual({ disabled: false, reasonKey: null });
  });
});
