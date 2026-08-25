// Which button the Proving Shore teaches each class. The point of deriving
// this from the live kit is that a kit edit moves the lesson with it, so
// these tests assert the DERIVATION's properties against the kit rather than
// re-listing the answers (a hand-written expected map here would rot exactly
// as fast as the hand-written map the module exists to avoid).

import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { isAttackAbility, startingAttackFor } from '../src/sim/tutorial/starting_attack';
import type { PlayerClass } from '../src/sim/types';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

describe('startingAttackFor', () => {
  it('finds a real level-1 attack for EVERY class', () => {
    // The reason this module exists: the CX ask was "which classes have no
    // offensive spell at level 1", and the answer was paladin (nothing at
    // all) and warrior (rage it does not have). Paladin was fixed at the
    // source; if any class ever regresses to nothing, the ability drill
    // silently degrades to pointing at the autoattack, so pin it here.
    expect(CLASS_IDS.length).toBeGreaterThanOrEqual(9);
    for (const cls of CLASS_IDS) {
      const s = startingAttackFor(cls);
      expect(s.abilityId, `${cls} has no level-1 attack`).not.toBeNull();
      expect(s.isAutoAttack, cls).toBe(false);
      expect(s.slot, cls).toBe('slot1');
    }
  });

  it('only ever names an ability the class actually knows at level 1', () => {
    for (const cls of CLASS_IDS) {
      const id = startingAttackFor(cls).abilityId;
      if (!id) continue;
      const known = abilitiesKnownAt(cls, 1).map((k) => k.def.id);
      expect(known, `${cls} does not know ${id} at level 1`).toContain(id);
      expect(ABILITIES[id].class, `${id} is not a ${cls} ability`).toBe(cls);
    }
  });

  it('only ever names an ability that damages a hostile target', () => {
    for (const cls of CLASS_IDS) {
      const id = startingAttackFor(cls).abilityId;
      if (!id) continue;
      expect(isAttackAbility(id), `${cls}: ${id}`).toBe(true);
      expect(ABILITIES[id].targetType, `${cls}: ${id}`).not.toBe('friendly');
    }
  });

  it('never names a press the player cannot make standing still', () => {
    // A stealth opener and a combo finisher are both real level-1 buttons a
    // rogue owns, and both refuse when they walk up to an effigy.
    for (const cls of CLASS_IDS) {
      const id = startingAttackFor(cls).abilityId;
      if (!id) continue;
      expect(ABILITIES[id].requiresStealth, `${cls}: ${id}`).toBeFalsy();
      expect(ABILITIES[id].spendsCombo, `${cls}: ${id}`).toBeFalsy();
    }
    // Decisive for the rogue specifically: their kit HAS both traps, so a
    // naive "first attack in the list" answer would pick one of them.
    const rogueKit = abilitiesKnownAt('rogue', 1).map((k) => k.def);
    expect(rogueKit.some((d) => d.requiresStealth)).toBe(true);
    expect(rogueKit.some((d) => d.spendsCombo)).toBe(true);
    expect(startingAttackFor('rogue').abilityId).toBe('sinister_strike');
  });

  it('flags exactly the classes whose resource bar starts empty', () => {
    for (const cls of CLASS_IDS) {
      const s = startingAttackFor(cls);
      const startsEmpty = CLASSES[cls].resourceType === 'rage';
      const expected = startsEmpty && s.resourceCost > 0;
      expect(s.needsResourceFirst, `${cls}`).toBe(expected);
    }
    // Warrior is the live case the ability drill's rage loan exists for.
    const warrior = startingAttackFor('warrior');
    expect(warrior.needsResourceFirst).toBe(true);
    expect(warrior.resourceCost).toBeGreaterThan(0);
    // A mana class walks in able to press its button, so no loan.
    expect(startingAttackFor('mage').needsResourceFirst).toBe(false);
  });

  it('reports the cost the loan has to cover', () => {
    const warrior = startingAttackFor('warrior');
    const def = ABILITIES[warrior.abilityId as string];
    expect(warrior.resourceCost).toBe(def.cost);
  });
});

describe('isAttackAbility', () => {
  it('rejects heals, buffs and summons, accepts damage', () => {
    expect(isAttackAbility('holy_light')).toBe(false);
    expect(isAttackAbility('battle_shout')).toBe(false);
    expect(isAttackAbility('summon_imp')).toBe(false);
    expect(isAttackAbility('fireball')).toBe(true);
    expect(isAttackAbility('sinister_strike')).toBe(true);
  });

  it('is false for an unknown id rather than throwing', () => {
    expect(isAttackAbility('no_such_ability')).toBe(false);
  });
});
