import { expect, it } from 'vitest';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { ABILITIES } from '../src/sim/data';

const HEROIC_LEAP_LABEL = ABILITIES.heroic_leap.name;

it('returns true for an ordinary weapon hit (positive control)', () => {
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      null,
      false,
      ABILITIES.slam.name,
      'slam',
    ),
  ).toBe(true);
});

it('suppresses attack animation for Heroic Leap landing damage supplied via primaryAbilityId', () => {
  // Player source, visual absent (the same kind is used for local and remote players).
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      null,
      false,
      null,
      'heroic_leap',
    ),
  ).toBe(false);
  // NPC source, visual absent.
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'mob', castingAbility: null },
      null,
      false,
      null,
      'heroic_leap',
    ),
  ).toBe(false);
  // Player source, native clip still active.
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      { hasAttackClipOverride: () => false, isPerformingAbility: true },
      false,
      null,
      'heroic_leap',
    ),
  ).toBe(false);
  // NPC source, native clip still active.
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'mob', castingAbility: null },
      { hasAttackClipOverride: () => false, isPerformingAbility: true },
      false,
      null,
      'heroic_leap',
    ),
  ).toBe(false);
});

it('suppresses attack animation for Heroic Leap landing damage supplied via display label', () => {
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      null,
      false,
      HEROIC_LEAP_LABEL,
    ),
  ).toBe(false);
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'mob', castingAbility: null },
      null,
      false,
      HEROIC_LEAP_LABEL,
    ),
  ).toBe(false);
});

it('explicit unrelated primaryAbilityId takes precedence over Heroic Leap display label', () => {
  expect(
    damageEventStartsAttackAnimation(
      { kind: 'player', castingAbility: null },
      null,
      false,
      HEROIC_LEAP_LABEL,
      'slam',
    ),
  ).toBe(true);
});
