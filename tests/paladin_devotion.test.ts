import { describe, expect, it } from 'vitest';
import { createPlayer } from '../src/sim/entity';
import {
  ASCENSION_CHARGES,
  ASCENSION_DEVOTION_BANK_CAP,
  ASCENSION_DURATION,
  activateDivineAscension,
  canActivateDivineAscension,
  consumeAscensionCharge,
  devotionGainForAbility,
  devotionGenerationTriggered,
  grantDevotion,
  grantDevotionFromBlock,
  isAscensionEmpoweredAbility,
  isDivineAscensionActive,
  MAX_DEVOTION,
  spendDevotion,
  updatePaladinDevotion,
} from '../src/sim/paladin_devotion';

function paladin() {
  return createPlayer(1, 'paladin', { x: 0, y: 0, z: 0 }, 'Aurelia');
}

describe('paladin Devotion core', () => {
  it('caps Devotion at 20 and activates a five-charge, 45-second Ascension', () => {
    const player = paladin();
    expect(grantDevotion(player, 99)).toBe(MAX_DEVOTION);
    expect(canActivateDivineAscension(player)).toBe(true);

    expect(activateDivineAscension(player)).toBe(true);
    expect(player.paladinDevotion).toMatchObject({
      value: 0,
      ascensionCharges: ASCENSION_CHARGES,
      ascensionRemaining: ASCENSION_DURATION,
    });
    expect(isDivineAscensionActive(player)).toBe(true);
  });

  it('lets every specialization and an unspecialized Paladin generate from damage or healing', () => {
    for (const spec of ['holy', 'protection', 'retribution'] as const) {
      expect(
        devotionGenerationTriggered(spec, 'test_attack', { damage: true, healing: false }),
      ).toBe(true);
      expect(devotionGenerationTriggered(spec, 'test_heal', { damage: false, healing: true })).toBe(
        true,
      );
      expect(devotionGainForAbility(spec, 'hammer_of_grace')).toBe(1);
      expect(devotionGainForAbility(spec, 'holy_light')).toBe(1);
      expect(devotionGainForAbility(spec, 'flash_of_light')).toBe(1);
    }
    expect(devotionGenerationTriggered(null, 'holy_light', { damage: false, healing: true })).toBe(
      true,
    );
    expect(devotionGainForAbility(null, 'hammer_of_grace')).toBe(1);
    expect(devotionGainForAbility(null, 'holy_light')).toBe(1);
    expect(devotionGainForAbility(null, 'flash_of_light')).toBe(1);
    expect(devotionGainForAbility(null, 'lay_on_hands')).toBe(1);
  });

  it('blocks all Devotion while Ascension is active', () => {
    const player = paladin();
    grantDevotion(player, MAX_DEVOTION);
    activateDivineAscension(player);

    grantDevotion(player, MAX_DEVOTION);
    expect(ASCENSION_DEVOTION_BANK_CAP).toBe(0);
    expect(player.paladinDevotion?.value).toBe(0);
  });

  it('spends Devotion atomically and refuses an unaffordable cost', () => {
    const player = paladin();
    grantDevotion(player, 3);
    expect(spendDevotion(player, 4)).toBe(false);
    expect(player.paladinDevotion?.value).toBe(3);
    expect(spendDevotion(player, 3)).toBe(true);
    expect(player.paladinDevotion?.value).toBe(0);
  });

  it('only consumes charges for explicitly empowered abilities of the chosen spec', () => {
    const player = paladin();
    grantDevotion(player, MAX_DEVOTION);
    activateDivineAscension(player);

    expect(consumeAscensionCharge(player, 'holy', 'mending_light')).toBe(false);
    expect(consumeAscensionCharge(player, 'retribution', 'final_edict')).toBe(true);
    expect(player.paladinDevotion?.ascensionCharges).toBe(ASCENSION_CHARGES - 1);
    expect(consumeAscensionCharge(player, 'holy', 'final_edict')).toBe(false);
  });

  it('defines generation and charge spenders explicitly for every specialization', () => {
    expect([
      devotionGainForAbility('holy', 'holy_light'),
      devotionGainForAbility('holy', 'mercy_lance'),
      devotionGainForAbility('holy', 'dawns_embrace'),
      devotionGainForAbility('holy', 'radiant_chorus'),
      devotionGainForAbility('holy', 'solar_invocation'),
    ]).toEqual([1, 1, 1, 1, 1]);
    expect([
      devotionGainForAbility('protection', 'vowkeeper_strike'),
      devotionGainForAbility('protection', 'bastion_rite'),
      devotionGainForAbility('protection', 'sunward_disc'),
      devotionGainForAbility('protection', 'bastion_sweep'),
    ]).toEqual([1, 0, 1, 1]);
    expect([
      devotionGainForAbility('retribution', 'final_edict'),
      devotionGainForAbility('retribution', 'dawnfall'),
      devotionGainForAbility('retribution', 'hammer_of_wrath'),
    ]).toEqual([1, 1, 1]);

    expect(
      ['mercy_lance', 'dawns_embrace', 'radiant_chorus', 'solar_invocation'].every((id) =>
        isAscensionEmpoweredAbility('holy', id),
      ),
    ).toBe(true);
    expect(
      [
        'vowkeeper_strike',
        'bastion_rite',
        'sunward_disc',
        'bastion_sweep',
        'holy_shield',
        'consecration',
        'oath_chain',
        'veilbound_march',
      ].every((id) => isAscensionEmpoweredAbility('protection', id)),
    ).toBe(true);
    expect(
      ['final_edict', 'dawnfall', 'faithforged_guard', 'hammer_of_wrath'].every((id) =>
        isAscensionEmpoweredAbility('retribution', id),
      ),
    ).toBe(true);
    expect(devotionGainForAbility('retribution', 'faithforged_guard')).toBe(0);
    expect(isAscensionEmpoweredAbility('holy', 'guardian_covenant')).toBe(false);
    expect(isAscensionEmpoweredAbility('protection', 'guardian_covenant')).toBe(false);
    expect(isAscensionEmpoweredAbility('retribution', 'guardian_covenant')).toBe(true);
    expect(isAscensionEmpoweredAbility('retribution', 'avenging_wrath')).toBe(false);
    expect(isAscensionEmpoweredAbility('holy', 'holy_light')).toBe(false);
  });

  it('ends Ascension on the last charge or at 45 seconds', () => {
    const spent = paladin();
    grantDevotion(spent, MAX_DEVOTION);
    activateDivineAscension(spent);
    for (let i = 0; i < ASCENSION_CHARGES; i++) {
      expect(consumeAscensionCharge(spent, 'retribution', 'final_edict')).toBe(true);
    }
    expect(isDivineAscensionActive(spent)).toBe(false);

    const expired = paladin();
    grantDevotion(expired, MAX_DEVOTION);
    activateDivineAscension(expired);
    updatePaladinDevotion(expired, ASCENSION_DURATION);
    expect(expired.paladinDevotion?.ascensionCharges).toBe(0);
    expect(isDivineAscensionActive(expired)).toBe(false);
  });

  it('rate-limits block generation and never loses Devotion over time', () => {
    const player = paladin();
    expect(grantDevotionFromBlock(player)).toBe(true);
    expect(grantDevotionFromBlock(player)).toBe(false);

    updatePaladinDevotion(player, 6);
    expect(grantDevotionFromBlock(player)).toBe(true);
    expect(player.paladinDevotion?.value).toBe(2);

    updatePaladinDevotion(player, 3_600);
    expect(player.paladinDevotion?.value).toBe(2);
  });

  it('resets the whole cycle on death and ignores non-paladins', () => {
    const player = paladin();
    grantDevotion(player, MAX_DEVOTION);
    activateDivineAscension(player);
    player.dead = true;
    updatePaladinDevotion(player, 0.05);
    expect(player.paladinDevotion).toMatchObject({
      value: 0,
      ascensionCharges: 0,
      ascensionRemaining: 0,
    });

    const warrior = createPlayer(2, 'warrior', { x: 0, y: 0, z: 0 }, 'Bjorn');
    expect(grantDevotion(warrior, 3)).toBe(0);
    expect(activateDivineAscension(warrior)).toBe(false);
  });
});
