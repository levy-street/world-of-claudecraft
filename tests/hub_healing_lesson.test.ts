// hubHealingAbilityId (sim/tutorial/hub_healing_lesson.ts): which direct heal
// the hub's optional healing lesson points a player at, derived from the live
// class kit. Restricted to druid, shaman, paladin, priest; a mage never
// qualifies, at any level, even hypothetically.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { HUB_HEALING_ELIGIBLE_CLASSES } from '../src/sim/content/practice_dummies';
import {
  hubHealingAbilityId,
  HUB_HEALING_ELIGIBLE_CLASSES as REEXPORTED_ELIGIBLE_CLASSES,
} from '../src/sim/tutorial/hub_healing_lesson';
import type { PlayerClass } from '../src/sim/types';

const ALL_CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

const EXPECTED_HEAL: Partial<Record<PlayerClass, string>> = {
  druid: 'healing_touch',
  shaman: 'healing_wave',
  paladin: 'holy_light',
  priest: 'lesser_heal',
};

describe('hubHealingAbilityId', () => {
  it('re-exports the same eligible-class list content/practice_dummies.ts owns', () => {
    expect(REEXPORTED_ELIGIBLE_CLASSES).toBe(HUB_HEALING_ELIGIBLE_CLASSES);
    expect([...HUB_HEALING_ELIGIBLE_CLASSES].sort()).toEqual(
      ['druid', 'paladin', 'priest', 'shaman'].sort(),
    );
  });

  it('resolves the correct direct heal for each eligible class at level 1, the hub`s own range', () => {
    for (const [cls, abilityId] of Object.entries(EXPECTED_HEAL)) {
      expect(hubHealingAbilityId(cls as PlayerClass, 1)).toBe(abilityId);
      expect(hubHealingAbilityId(cls as PlayerClass, 5)).toBe(abilityId);
      // The resolved ability is always a real, immediate `heal` effect on a
      // friendly-target ability: never a respec, never a HoT.
      const def = ABILITIES[abilityId!];
      expect(def.targetType).toBe('friendly');
      expect(def.effects.some((e) => e.type === 'heal')).toBe(true);
    }
  });

  it('is null for every one of the other five classes, at every level, mage included', () => {
    const ineligible = ALL_CLASSES.filter((c) => !HUB_HEALING_ELIGIBLE_CLASSES.includes(c));
    expect(ineligible).toHaveLength(5);
    expect(ineligible).toContain('mage');
    for (const cls of ineligible) {
      for (const level of [1, 5, 10, 20]) {
        expect(hubHealingAbilityId(cls, level)).toBeNull();
      }
    }
  });

  it('is null before the class has learned ANY direct heal (defensive: never reachable at a real starting level today)', () => {
    for (const cls of HUB_HEALING_ELIGIBLE_CLASSES) {
      expect(hubHealingAbilityId(cls, 0)).toBeNull();
    }
  });

  it('never requires a respec: every eligible class already has it at level 1, the earliest playable level', () => {
    for (const cls of HUB_HEALING_ELIGIBLE_CLASSES) {
      expect(hubHealingAbilityId(cls, 1)).not.toBeNull();
    }
  });
});
