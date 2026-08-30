// The priced throughput lane (item_budget.ts "The throughput lane"): Spell
// Power and Healing Power are budgeted kit-wide, never free. These pins sum
// the SHIPPED item defs for the canonical tier kits and hold them to the lane
// formulas exactly, so an item edit that grows an affix silently reprices the
// caster-vs-melee contract and fails here instead of in a balance study.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { casterLaneSpTotal, healerLaneHpTotal } from '../src/sim/item_budget';

const TIER_LEVEL = 35;

function sp(id: string): number {
  const item = ITEMS[id];
  expect(item, `${id} exists`).toBeDefined();
  return item.spellPower ?? 0;
}

function hp(id: string): number {
  const item = ITEMS[id];
  expect(item, `${id} exists`).toBeDefined();
  return item.healPower ?? 0;
}

// The canonical caster kit: one damage set five-piece (all caster sets carry
// identical affix lines, vesperash stands in), the spell-damage electives and
// jewelry (ring worn twice), and the two-hand staff.
const CASTER_KIT_STAFF = [
  'vesperash_helmet',
  'vesperash_shoulder',
  'vesperash_chest',
  'vesperash_gloves',
  'vesperash_legs',
  'cord_of_the_last_flame',
  'cindersoaked_slippers',
  'locket_of_the_last_flame',
  'circle_of_cinders',
  'circle_of_cinders',
  'forgefire_spire',
];

// The healer kit mirrors it on the Healing Power lane.
const HEALER_KIT_STAFF = [
  'benison_dawnweave_helmet',
  'benison_dawnweave_shoulder',
  'benison_dawnweave_chest',
  'benison_dawnweave_gloves',
  'benison_dawnweave_legs',
  'springbinder_sash',
  'steps_of_quiet_water',
  'heartspring_amulet',
  'loop_of_quiet_springs',
  'loop_of_quiet_springs',
  'staff_of_the_last_spring',
];

describe('the priced Spell Power / Healing Power lane', () => {
  it('the canonical caster kit carries exactly the lane total', () => {
    const total = CASTER_KIT_STAFF.reduce((a, id) => a + sp(id), 0);
    expect(casterLaneSpTotal(TIER_LEVEL)).toBe(86);
    expect(total).toBe(casterLaneSpTotal(TIER_LEVEL));
  });

  it('the one-hand caster build matches the staff build at the weapon slots', () => {
    expect(sp('wand_of_quenched_sparks') + sp('cinder_of_the_first_design')).toBe(
      sp('forgefire_spire'),
    );
  });

  it('the canonical healer kit carries exactly the lane total', () => {
    const total = HEALER_KIT_STAFF.reduce((a, id) => a + hp(id), 0);
    expect(healerLaneHpTotal(TIER_LEVEL)).toBe(172);
    expect(total).toBe(healerLaneHpTotal(TIER_LEVEL));
  });

  it('the one-hand healer build matches the staff build at the weapon slots', () => {
    expect(hp('springtouched_crozier') + hp('orb_of_the_last_spring')).toBe(
      hp('staff_of_the_last_spring'),
    );
  });

  it('every caster set five-piece carries the identical affix line', () => {
    // One lane shape for all caster sets: a drift in any single set silently
    // hands that class a bigger lane than the contract prices.
    const slots = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;
    const reference = slots.map((s) => sp(`vesperash_${s}`));
    expect(reference).toEqual([7, 5, 8, 5, 7]);
    for (const set of [
      'frostquench',
      'gravebrand',
      'hexthread',
      'moonscorch',
      'pyroclast',
      'ruincaller',
      'stormkindled',
    ]) {
      const line = slots.map((s) => sp(`${set}_${s}`));
      expect(line, set).toEqual(reference);
    }
  });
});
