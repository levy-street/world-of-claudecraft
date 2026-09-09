// v0.42.0 class balance (docs/design/class-balance-v042.md): the offense-only
// spec tuning table src/sim/spec_output_tuning.ts is a pure leaf (no Sim/
// SimContext/rng), so it is exercised directly with narrow ability/mods
// shapes rather than a full Sim.
import { describe, expect, it } from 'vitest';
import { PYRE_AURA_DAMAGE } from '../src/sim/combat/destruction';
import {
  disciplineWandOffenseMultiplier,
  isPhysicalBucketAbility,
  offensiveAbilityBonus,
  petOffenseMultiplier,
  primaryHealingMultiplier,
} from '../src/sim/spec_output_tuning';
import type { AbilityDef, PlayerClass } from '../src/sim/types';

function ability(cls: PlayerClass, school: AbilityDef['school'], scalesWith?: 'ranged') {
  return { class: cls, school, scalesWith };
}

function mods(spec: string | null) {
  return { spec };
}

describe('offensiveAbilityBonus', () => {
  it('gives Wildfang (druid/feral) the offensive physical bonus on a physical ability', () => {
    expect(offensiveAbilityBonus(ability('druid', 'physical'), mods('feral'))).toBeCloseTo(0.15);
  });

  it('gives Thundercall (shaman/elemental) the offensive spell bonus on a non-physical ability', () => {
    expect(offensiveAbilityBonus(ability('shaman', 'nature'), mods('elemental'))).toBeCloseTo(0.13);
  });

  it('gives Ruination (warlock/destruction) the offensive spell bonus, not the physical bucket', () => {
    expect(offensiveAbilityBonus(ability('warlock', 'fire'), mods('destruction'))).toBeCloseTo(
      0.11,
    );
    expect(offensiveAbilityBonus(ability('warlock', 'physical'), mods('destruction'))).toBe(0);
  });

  it('gives Necromancy (warlock/demonology) the offensive spell bonus', () => {
    expect(offensiveAbilityBonus(ability('warlock', 'shadow'), mods('demonology'))).toBeCloseTo(
      0.22,
    );
  });

  it('gives Knifework (rogue/assassination) the offensive physical bonus', () => {
    expect(offensiveAbilityBonus(ability('rogue', 'physical'), mods('assassination'))).toBeCloseTo(
      0.1,
    );
  });

  it('gives no bonus to a different rogue spec on the same physical ability', () => {
    expect(offensiveAbilityBonus(ability('rogue', 'physical'), mods('combat'))).toBe(0);
    expect(offensiveAbilityBonus(ability('rogue', 'physical'), mods('subtlety'))).toBe(0);
  });

  it('gives Fieldcraft (hunter/survival) the offensive bonus on a ranged ability regardless of school', () => {
    expect(
      offensiveAbilityBonus(ability('hunter', 'nature', 'ranged'), mods('survival')),
    ).toBeCloseTo(0.15);
  });

  it('gives Coldsight (hunter/marksmanship) its own, smaller offensive bonus', () => {
    expect(
      offensiveAbilityBonus(ability('hunter', 'nature', 'ranged'), mods('marksmanship')),
    ).toBeCloseTo(0.1);
  });

  it('gives Doctrine (priest/discipline) the offensive bonus on both buckets (covers Hymn/Smite, hostile Scouring Mercy, Mindfracture, Dirge, and wand output)', () => {
    expect(offensiveAbilityBonus(ability('priest', 'holy'), mods('discipline'))).toBeCloseTo(0.3);
    expect(offensiveAbilityBonus(ability('priest', 'physical'), mods('discipline'))).toBeCloseTo(
      0.3,
    );
  });

  it('gives no bonus to a spec-less character', () => {
    expect(offensiveAbilityBonus(ability('druid', 'physical'), mods(null))).toBe(0);
  });

  it('gives no bonus to an untargeted spec of a targeted class', () => {
    expect(offensiveAbilityBonus(ability('druid', 'physical'), mods('balance'))).toBe(0);
    expect(offensiveAbilityBonus(ability('shaman', 'nature'), mods('enhancement'))).toBe(0);
  });

  it('gives no bonus to a targeted spec on the wrong ability class (cross-class leakage guard)', () => {
    // The same spec id string exists on more than one class ('restoration' on
    // both shaman and druid); a lookup keyed only on the id, not the pair,
    // would leak a bonus across classes.
    expect(offensiveAbilityBonus(ability('mage', 'physical'), mods('feral'))).toBe(0);
  });
});

describe('isPhysicalBucketAbility', () => {
  it('treats a physical-school ability as the physical bucket', () => {
    expect(isPhysicalBucketAbility({ school: 'physical' })).toBe(true);
  });

  it('treats any ranged-scaling ability as the physical bucket regardless of school (Marksmanship Iron Aim shape)', () => {
    expect(isPhysicalBucketAbility({ school: 'nature', scalesWith: 'ranged' })).toBe(true);
  });

  it('treats a non-physical, non-ranged ability as the spell bucket', () => {
    expect(isPhysicalBucketAbility({ school: 'shadow' })).toBe(false);
  });
});

describe('petOffenseMultiplier', () => {
  it('gives destruction warlock demons the explicit +10% pet bonus', () => {
    expect(petOffenseMultiplier('warlock', 'destruction')).toBeCloseTo(1.1);
  });

  it('gives no bonus to every other class/spec, including a spec-less character', () => {
    expect(petOffenseMultiplier('warlock', 'demonology')).toBe(1);
    expect(petOffenseMultiplier('hunter', 'beast_mastery')).toBe(1);
    expect(petOffenseMultiplier('warlock', null)).toBe(1);
  });

  it('backs the explicit Pyre Aura 60 -> 66 refinement (combat/destruction.ts)', () => {
    expect(PYRE_AURA_DAMAGE).toBe(66);
  });
});

// combat/auto_attack.ts's wand path reads this instead of a bare 1.3 literal,
// so a retune of the discipline row can't leave the wand behind.
describe('disciplineWandOffenseMultiplier', () => {
  it('gives Doctrine discipline the canonical 1.30 wand factor', () => {
    expect(disciplineWandOffenseMultiplier()).toBeCloseTo(1.3);
  });
});

describe('primaryHealingMultiplier (shared API contract)', () => {
  it('gives Spiritmend (shaman/restoration) +10%', () => {
    expect(primaryHealingMultiplier('shaman', 'restoration')).toBeCloseTo(1.1);
  });

  it('gives Sunmender (paladin/holy) +10%', () => {
    expect(primaryHealingMultiplier('paladin', 'holy')).toBeCloseTo(1.1);
  });

  it('gives Groveheart +5% primary healing within its calibrated +20% engine package', () => {
    expect(primaryHealingMultiplier('druid', 'restoration')).toBeCloseTo(1.05);
  });

  it('gives a factor of exactly one everywhere else, including a spec-less character', () => {
    expect(primaryHealingMultiplier('shaman', 'elemental')).toBe(1);
    expect(primaryHealingMultiplier('paladin', null)).toBe(1);
    expect(primaryHealingMultiplier('priest', 'holy')).toBe(1);
    expect(primaryHealingMultiplier('druid', 'feral')).toBe(1);
  });
});
