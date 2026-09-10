import { expect, it } from 'vitest';
import { warriorInsultCue } from '../src/render/ability_vfx/warrior_insult_core';

it('acknowledges the single challenge and area challenge once at release', () => {
  expect(warriorInsultCue('selfCast', 'taunt')).toBe(true);
  expect(warriorInsultCue('shout', 'defiant_bellow')).toBe(true);
});
it('does not repeat swearing on windup, recipient or duplicate phases', () => {
  for (const ability of ['taunt', 'defiant_bellow'])
    for (const fx of ['windup', 'nova', 'cc', 'projectile'])
      expect(warriorInsultCue(fx, ability)).toBe(false);
  expect(warriorInsultCue('shout', 'taunt')).toBe(false);
  expect(warriorInsultCue('selfCast', 'defiant_bellow')).toBe(false);
  for (const ability of ['battle_shout', 'intimidating_shout', undefined])
    for (const fx of ['shout', 'selfCast']) expect(warriorInsultCue(fx, ability)).toBe(false);
});
