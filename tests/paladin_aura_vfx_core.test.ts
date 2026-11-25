import { describe, expect, it } from 'vitest';
import { hasAuthoredPaladinAura } from '../src/render/paladin_aura_vfx_core';

describe('authored Paladin aura ownership', () => {
  it.each([
    ['guardian_covenant', 'Guardian Covenant'],
    ['faithforged_guard', 'Debt of Light'],
    ['sun_gods_verdict', 'Verdict of the Sun God'],
    ['beacon_of_light', 'Beacon of Light'],
  ])('claims %s by ID or legacy name', (abilityId, name) => {
    expect(hasAuthoredPaladinAura({ abilityId, name: 'localized' })).toBe(true);
    expect(hasAuthoredPaladinAura({ name })).toBe(true);
    expect(hasAuthoredPaladinAura({ abilityId: 'unrelated', name })).toBe(false);
  });

  it.each([
    'avenging_wrath',
    'avenging_wrath_buff_healing_done',
    'solar_step',
    'divine_protection',
    'sacred_form',
    'life_covenant',
    'aegis_first_dawn_dr:994',
    'aegis_first_dawn_speed',
    'bastion_rite_buff_block',
    'holy_shield_absorb',
    'veilbound_march_armor',
    'vowkeeper_strike_absorb',
  ])('claims %s, whose own visual announces it', (abilityId) => {
    expect(hasAuthoredPaladinAura({ abilityId, name: 'localized' })).toBe(true);
  });

  it('leaves other auras on their normal path', () => {
    expect(hasAuthoredPaladinAura({ abilityId: 'divine_shield', name: 'Divine Shield' })).toBe(
      false,
    );
    // A different ability that merely shares a prefix is not claimed.
    expect(hasAuthoredPaladinAura({ abilityId: 'solar_stepping', name: 'x' })).toBe(false);
    // The party auras pass on, so their rings are drawn after this check.
    expect(hasAuthoredPaladinAura({ abilityId: 'grace_devotion', name: 'x' })).toBe(false);
    expect(hasAuthoredPaladinAura({ abilityId: 'retribution_aura', name: 'x' })).toBe(false);
  });
});
