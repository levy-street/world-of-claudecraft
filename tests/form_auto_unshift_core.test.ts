// The pure half of auto-unshift (src/sim/combat/form_auto_unshift.ts): which
// button, worn against which form, leaves the form instead of being refused.
//
// The cast gate and the action bar both ask this one predicate, so the whole
// value of pinning it is that the two can never answer differently. The druid
// roster below is spelled out rather than derived, because "is this a heal or a
// nuke" is a judgement about each button: a new druid ability that lands on the
// wrong side of it should fail here and make its author say which side it is on.

import { describe, expect, it } from 'vitest';
import {
  isFormToggleAbility,
  isHealingOrDamagingAbility,
  willAutoUnshift,
  wireParkedMana,
} from '../src/sim/combat/form_auto_unshift';
import { ABILITIES } from '../src/sim/data';
import type { AuraKind } from '../src/sim/types';

const wearing = (kind: AuraKind) => [{ kind }];

/** Every druid button that leaves the form when pressed: the caster kit, plus
 *  the transforms an action replacement swaps in (Moonsurge, Sunwake,
 *  Overbloom). Anything absent must have a reason, and the split assertions
 *  below name the reasons this list depends on. */
const AUTO_UNSHIFTING_DRUID_ABILITIES = [
  'healing_touch',
  'hurricane',
  'insect_swarm',
  'moonfire',
  'moonlash',
  'moonseed',
  'overbloom',
  'regrowth',
  'rejuvenation',
  'starfire',
  'sunlance',
  'swiftmend',
  'tranquility',
  'wrath',
];

function druidAbilityIds(): string[] {
  return Object.values(ABILITIES)
    .filter((def) => def.class === 'druid')
    .map((def) => def.id)
    .sort();
}

describe('willAutoUnshift', () => {
  it('pins the full druid roster that auto-unshifts from Bruin Form', () => {
    const unshifting = druidAbilityIds().filter((id) =>
      willAutoUnshift(wearing('form_bear'), ABILITIES[id]),
    );
    expect(unshifting).toEqual([...AUTO_UNSHIFTING_DRUID_ABILITIES].sort());
    // Vacuity floor: the roster is a real slice of the class, not everything
    // and not nothing.
    expect(druidAbilityIds().length).toBeGreaterThan(unshifting.length + 20);
  });

  it('answers the same for all three druid forms', () => {
    for (const kind of ['form_bear', 'form_cat', 'form_travel'] as const) {
      const unshifting = druidAbilityIds().filter((id) =>
        willAutoUnshift(wearing(kind), ABILITIES[id]),
      );
      expect(unshifting).toEqual([...AUTO_UNSHIFTING_DRUID_ABILITIES].sort());
    }
  });

  it('never fires out of form, in a caster form, or in the mage Ember Form', () => {
    // form_moonkin keeps the caster kit, so nothing there is ever refused and
    // nothing there may be shifted out of; form_fireball is authored as a hard
    // "cannot attack or cast" transform and keeps its refusal.
    for (const auras of [[], wearing('form_moonkin'), wearing('form_fireball')]) {
      for (const id of AUTO_UNSHIFTING_DRUID_ABILITIES) {
        expect(willAutoUnshift(auras, ABILITIES[id])).toBe(false);
      }
    }
  });

  it('refuses a form-locked, a form-usable, and a form-toggle button', () => {
    // The three exemptions, one case each, so a dropped clause in the predicate
    // cannot hide behind the other two.
    expect(ABILITIES.maul.requiresForm).toBe('bear'); // form-locked
    expect(willAutoUnshift(wearing('form_bear'), ABILITIES.maul)).toBe(false);

    expect(ABILITIES.frenzied_regeneration.requiresForm).toBe('bear');
    expect(willAutoUnshift(wearing('form_bear'), ABILITIES.frenzied_regeneration)).toBe(false);

    expect(ABILITIES.feral_charge.usableInForm).toBe(true); // form-usable
    expect(willAutoUnshift(wearing('form_bear'), ABILITIES.feral_charge)).toBe(false);

    expect(isFormToggleAbility(ABILITIES.cat_form)).toBe(true); // form toggle
    expect(willAutoUnshift(wearing('form_bear'), ABILITIES.cat_form)).toBe(false);
  });

  it('leaves buffs, crowd control, and utility refused', () => {
    for (const id of ['mark_of_the_wild', 'thorns', 'innervate', 'hibernate', 'typhoon']) {
      expect(willAutoUnshift(wearing('form_bear'), ABILITIES[id])).toBe(false);
    }
  });

  it('classifies by the button, not by the rank the caster trained', () => {
    // Entangling Roots is a root at every rank and grows a damage-over-time
    // component at rank 3. Reading the rank-resolved effects would start
    // dropping a druid's form at level 14 for a button that never dropped it
    // before, so the definition is what decides.
    const roots = ABILITIES.entangling_roots;
    expect(roots.ranks?.some((r) => r.effects?.some((e) => e.type === 'dot'))).toBe(true);
    expect(isHealingOrDamagingAbility(roots)).toBe(false);
    expect(willAutoUnshift(wearing('form_bear'), roots)).toBe(false);
  });
});

describe('isHealingOrDamagingAbility', () => {
  it('reads a consumeAura payload rather than the effect name', () => {
    // Swiftmend is neither a `heal` nor a `directDamage` effect: it spends a
    // heal-over-time. Classifying it off the effect TYPE alone would leave the
    // one instant heal a druid can reach for in an emergency still refused.
    const swiftmend = ABILITIES.swiftmend;
    expect(swiftmend.effects.every((e) => e.type === 'consumeAura')).toBe(true);
    expect(isHealingOrDamagingAbility(swiftmend)).toBe(true);

    expect(
      isHealingOrDamagingAbility({
        ...swiftmend,
        effects: [{ type: 'consumeAura', auraKind: 'hot' }],
      }),
    ).toBe(false);
  });

  it('separates damage from healing from neither', () => {
    expect(isHealingOrDamagingAbility(ABILITIES.wrath)).toBe(true); // damage
    expect(isHealingOrDamagingAbility(ABILITIES.healing_touch)).toBe(true); // healing
    expect(isHealingOrDamagingAbility(ABILITIES.mark_of_the_wild)).toBe(false); // neither
  });
});

describe('wireParkedMana', () => {
  it('never reports more mana than the caster actually has parked', () => {
    // The whole point of the field: the bar must not light a slot the server
    // will refuse. Rounding would, at every fractional pool just under a cost.
    for (const parked of [0, 0.9, 24.6, 25, 25.4, 25.5, 999.99]) {
      expect(wireParkedMana(parked)).toBeLessThanOrEqual(parked);
      expect(Number.isInteger(wireParkedMana(parked))).toBe(true);
    }
    expect(wireParkedMana(24.6)).toBe(24); // Math.round would say 25
    expect(wireParkedMana(25.5)).toBe(25); // ...and 26
  });

  it('agrees with the server test exactly at a cost boundary', () => {
    // A 25-cost heal against a 24.6 pool: the sim gate compares the raw pool and
    // refuses, so the mirrored pool has to refuse too.
    const cost = ABILITIES.healing_touch.cost;
    expect(Number.isInteger(cost)).toBe(true);
    expect(wireParkedMana(cost - 0.4) < cost).toBe(cost - 0.4 < cost);
    expect(wireParkedMana(cost + 0.4) < cost).toBe(cost + 0.4 < cost);
  });
});
