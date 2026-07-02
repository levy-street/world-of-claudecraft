import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { hasExplicitAbilityIcon } from '../src/ui/icons';
import { PET_ACTION_ICONS } from '../src/ui/pet_action_icons';

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
