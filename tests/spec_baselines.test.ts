import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { SPEC_BASELINES } from '../src/sim/content/spec_baselines';
import {
  accumulateTalentEffect,
  computeTalentModifiers,
  emptyModifiers,
  TALENTS,
  type TalentAllocation,
  type TalentModifiers,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';

type NumericRecord = Record<string, number>;
interface BaselineSnapshot {
  stats?: NumericRecord;
  global?: NumericRecord;
  abilities?: Record<string, NumericRecord>;
}

const EXPECTED_BASELINES: Record<string, BaselineSnapshot> = {
  'paladin/holy': {
    stats: { int: 6 },
    global: { healPct: 0.06 },
    abilities: {
      seal_of_righteousness: { costPct: -0.16 },
      judgement: { costPct: -0.16 },
      holy_light: { dmgPct: 0.24 },
      flash_of_light: { costPct: -0.16, castPct: -0.2 },
    },
  },
  'paladin/protection': {
    stats: { str: 6, dodge: 0.02, armorPct: 0.29 },
    global: { threatPct: 0.2 },
    abilities: {
      devotion_aura: { buffPct: 0.4 },
      righteous_fury: { costPct: -0.5 },
    },
  },
  'paladin/retribution': {
    stats: { str: 6 },
    abilities: {
      seal_of_righteousness: { dmgPct: 0.2, costPct: -0.4 },
      judgement: { dmgPct: 0.2, costPct: -0.4, cooldownPct: -0.3 },
    },
  },
  'hunter/beast_mastery': {
    stats: { ap: 24, armorPct: 0.08 },
    abilities: { aspect_of_the_hawk: { buffPct: 0.4 } },
  },
  'hunter/marksmanship': {
    stats: { crit: 0.03, agi: 6 },
    abilities: {
      arcane_shot: { dmgPct: 0.24, costPct: -0.16, cooldownPct: -0.1 },
      serpent_sting: { costPct: -0.16 },
      aimed_shot: { dmgPct: 0.16, castPct: -0.2 },
      concussive_shot: { cooldownPct: -0.1 },
    },
  },
  'hunter/survival': {
    stats: { agi: 3, crit: 0.03, dodge: 0.12 },
    global: { meleeDmgPct: 0.06 },
  },
  'rogue/assassination': {
    stats: { crit: 0.03 },
    global: { meleeDmgPct: 0.08 },
    abilities: {
      sinister_strike: { costPct: -0.16 },
      eviscerate: { dmgPct: 0.32 },
    },
  },
  'rogue/combat': {
    stats: { ap: 24, crit: 0.03 },
    global: { meleeDmgPct: 0.08 },
    abilities: { sinister_strike: { dmgPct: 0.2, costPct: -0.16 } },
  },
  'rogue/subtlety': {
    stats: { agi: 7, crit: 0.03, dodge: 0.05 },
    abilities: {
      stealth: { cooldownPct: -0.7 },
      backstab: { dmgPct: 0.16 },
      ambush: { dmgPct: 0.16 },
    },
  },
  'priest/discipline': {
    stats: { sta: 6, int: 3, spi: 6 },
    abilities: {
      lesser_heal: { costPct: -0.16 },
      heal: { costPct: -0.16 },
      flash_heal: { costPct: -0.16 },
      power_word_shield: { dmgPct: 0.18, costPct: -0.16, cooldownPct: -0.3 },
    },
  },
  'priest/holy': {
    stats: { int: 3, spi: 3 },
    global: { healPct: 0.08 },
    abilities: {
      lesser_heal: { dmgPct: 0.18, costPct: -0.16 },
      heal: { dmgPct: 0.18, costPct: -0.16, castPct: -0.2 },
      flash_heal: { costPct: -0.16 },
      smite: { castPct: -0.1 },
    },
  },
  'priest/shadow': {
    stats: { int: 6 },
    abilities: {
      shadow_word_pain: { dmgPct: 0.24, costPct: -0.1 },
      mind_blast: { dmgPct: 0.18, costPct: -0.1 },
    },
  },
  'shaman/elemental': {
    stats: { int: 8 },
    abilities: {
      lightning_bolt: { dmgPct: 0.18, costPct: -0.35, castPct: -0.2 },
      earth_shock: { dmgPct: 0.18, costPct: -0.15 },
      flame_shock: { costPct: -0.2 },
    },
  },
  'shaman/enhancement': {
    stats: { int: 2, ap: 24 },
    abilities: {
      lightning_bolt: { costPct: -0.1 },
      earth_shock: { costPct: -0.1 },
      rockbiter_weapon: { dmgPct: 0.4 },
      stormstrike: { dmgPct: 0.25 },
    },
  },
  'shaman/restoration': {
    stats: { int: 6 },
    abilities: { healing_wave: { dmgPct: 0.1, costPct: -0.46, castPct: -0.1 } },
  },
  'warlock/affliction': {
    stats: { int: 6 },
    global: { spellDmgPct: 0.06 },
    abilities: {
      corruption: { dmgPct: 0.16, costPct: -0.15, castPct: -0.7 },
      curse_of_agony: { dmgPct: 0.09, costPct: -0.15 },
    },
  },
  'warlock/demonology': {
    stats: { sta: 8, armorPct: 0.06, int: 6 },
    abilities: {
      shadow_bolt: { costPct: -0.08 },
      immolate: { costPct: -0.08 },
      demon_skin: { dmgPct: 0.3 },
    },
  },
  'warlock/destruction': {
    stats: { sta: 6 },
    abilities: {
      shadow_bolt: { costPct: -0.23, castPct: -0.03 },
      immolate: { costPct: -0.23, castPct: -0.03 },
    },
  },
  'druid/balance': {
    stats: { int: 3 },
    global: { spellDmgPct: 0.08 },
    abilities: {
      entangling_roots: { costPct: -0.18, castPct: -0.24 },
      healing_touch: { castPct: -0.16 },
      wrath: { dmgPct: 0.15, castPct: -0.2 },
      starfire: { castPct: -0.16 },
    },
  },
  'druid/feral': {
    stats: { armorPct: 0.23 },
    global: { threatPct: 0.2 },
    abilities: {
      maul: { dmgPct: 0.35 },
      claw: { dmgPct: 0.15 },
      swipe: { dmgPct: 0.2 },
    },
  },
  'druid/restoration': {
    stats: { int: 3, spi: 3 },
    global: { healPct: 0.08 },
    abilities: {
      entangling_roots: { costPct: -0.18 },
      healing_touch: { costPct: -0.2, castPct: -0.16 },
      wrath: { castPct: -0.08 },
      rejuvenation: { dmgPct: 0.24, costPct: -0.2 },
    },
  },
};

function allocation(spec: string | null): TalentAllocation {
  return { spec, rows: {} };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function numericDelta(actual: NumericRecord, base: NumericRecord): NumericRecord | undefined {
  const delta: NumericRecord = {};
  for (const key of Object.keys(actual).sort()) {
    // Only diff numeric fields. Resolved ability mods also carry booleans and
    // arrays (castWhileMoving, addEffects); subtracting those would coerce to
    // NaN and silently pass. A future baseline that sets one must be asserted
    // explicitly, not smuggled through this delta.
    if (typeof actual[key] !== 'number') continue;
    const value = rounded(actual[key] - (base[key] ?? 0));
    if (value !== 0) delta[key] = value;
  }
  return Object.keys(delta).length > 0 ? delta : undefined;
}

function baselineSnapshot(cls: PlayerClass, specId: string, level: number): BaselineSnapshot {
  const actual = computeTalentModifiers(cls, allocation(specId), level);
  const mastery = emptyModifiers();
  const spec = TALENTS[cls].specs.find((candidate) => candidate.id === specId);
  if (!spec) throw new Error(`missing ${cls}/${specId}`);
  accumulateTalentEffect(mastery, spec.mastery.effect, Math.min(1, Math.max(0, level) / 20));

  const abilities: Record<string, NumericRecord> = {};
  for (const abilityId of Object.keys(actual.abilities).sort()) {
    const actualAbility = actual.abilities[abilityId] as unknown as NumericRecord;
    const masteryAbility = (mastery.abilities[abilityId] ?? {}) as unknown as NumericRecord;
    const delta = numericDelta(actualAbility, masteryAbility);
    if (delta) abilities[abilityId] = delta;
  }

  const snapshot: BaselineSnapshot = {};
  const stats = numericDelta(actual.stats as unknown as NumericRecord, mastery.stats);
  const global = numericDelta(actual.global as unknown as NumericRecord, mastery.global);
  if (stats) snapshot.stats = stats;
  if (global) snapshot.global = global;
  if (Object.keys(abilities).length > 0) snapshot.abilities = abilities;
  return snapshot;
}

describe('v0.28 passive restoration hotfix', () => {
  it('contains exactly 21 passive-only spec baselines and excludes Warrior, Mage, and Chronomancy', () => {
    const entries = Object.entries(SPEC_BASELINES).flatMap(([cls, specs]) =>
      Object.entries(specs ?? {}).map(([spec, effect]) => ({ cls, spec, effect })),
    );

    expect(entries).toHaveLength(21);
    // Warrior and Mage are the strongest classes and are deliberately given no
    // floor, so restoring their pre-v0.27 passives cannot widen the gap.
    expect(SPEC_BASELINES.warrior).toBeUndefined();
    expect(SPEC_BASELINES.mage).toBeUndefined();
    expect(entries.some(({ cls }) => cls === 'warrior' || cls === 'mage')).toBe(false);
    for (const { effect } of entries) {
      expect(effect.grant).toBeUndefined();
      expect(effect.proc).toBeUndefined();
    }
  });

  it('targets abilities that exist in each current specialization kit', () => {
    const missing: string[] = [];
    for (const [cls, specs] of Object.entries(SPEC_BASELINES)) {
      for (const [spec, baseline] of Object.entries(specs ?? {})) {
        const playerClass = cls as PlayerClass;
        const knownIds = new Set(
          abilitiesKnownAt(
            playerClass,
            20,
            computeTalentModifiers(playerClass, allocation(spec), 20),
          ).map(({ def }) => def.id),
        );
        for (const ability of baseline.ability ?? []) {
          if (!knownIds.has(ability.ability)) missing.push(`${cls}/${spec}/${ability.ability}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only modifies ability dimensions that are live on the resolved kit', () => {
    // A restoration must not silently no-op: a costPct row needs a nonzero cost,
    // a castPct row a nonzero cast time, a cooldownPct row a nonzero cooldown, and
    // a dmgPct/buffPct row an effect to scale. This catches a future kit change
    // (e.g. an ability made instant or free) that would quietly kill a baseline.
    const dead: string[] = [];
    for (const [cls, specs] of Object.entries(SPEC_BASELINES)) {
      for (const [spec, baseline] of Object.entries(specs ?? {})) {
        const playerClass = cls as PlayerClass;
        const known = abilitiesKnownAt(
          playerClass,
          20,
          computeTalentModifiers(playerClass, allocation(spec), 20),
        );
        for (const mod of baseline.ability ?? []) {
          const entry = known.find(({ def }) => def.id === mod.ability);
          if (!entry) continue; // existence is covered by the previous test
          const tag = `${cls}/${spec}/${mod.ability}`;
          if (mod.costPct && entry.cost <= 0) dead.push(`${tag}: costPct on zero cost`);
          if (mod.castPct && entry.castTime <= 0) dead.push(`${tag}: castPct on instant cast`);
          if (mod.cooldownPct && entry.cooldown <= 0)
            dead.push(`${tag}: cooldownPct on no cooldown`);
          if ((mod.dmgPct || mod.buffPct) && entry.effects.length === 0) {
            dead.push(`${tag}: dmgPct/buffPct with no effect to scale`);
          }
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('restores the complete repository-backed baseline for all 21 applicable specs', () => {
    expect(Object.keys(EXPECTED_BASELINES)).toHaveLength(21);
    for (const [key, expected] of Object.entries(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 20), key).toEqual(expected);
    }
  });

  it('applies the full baseline at unlock and leaves Warrior, Mage, and Chronomancy floor-free', () => {
    for (const key of Object.keys(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 5), key).toEqual(EXPECTED_BASELINES[key]);
    }
    // Excluded specs gain nothing beyond their (level-scaled) mastery, at any level.
    for (const spec of ['arms', 'fury', 'prot']) {
      expect(baselineSnapshot('warrior', spec, 20), `warrior/${spec}`).toEqual({});
    }
    for (const spec of ['fire', 'frost', 'arcane']) {
      expect(baselineSnapshot('mage', spec, 20), `mage/${spec}`).toEqual({});
    }
  });

  it('adds no baseline when no specialization is selected', () => {
    for (const cls of Object.keys(TALENTS) as PlayerClass[]) {
      const mods: TalentModifiers = computeTalentModifiers(cls, allocation(null), 20);
      expect(mods.spec).toBeNull();
      expect(mods.grants).toEqual([]);
      expect(
        numericDelta(mods.stats as unknown as NumericRecord, emptyModifiers().stats),
      ).toBeUndefined();
      expect(
        numericDelta(mods.global as unknown as NumericRecord, emptyModifiers().global),
      ).toBeUndefined();
      expect(mods.abilities).toEqual({});
    }
  });

  it('keeps choice-row effects additive to the auto-applied spec layer', () => {
    // Warrior has no restored baseline, so this isolates the choice row stacking
    // purely on top of the auto-applied mastery/signature without disturbing it.
    const specOnly = computeTalentModifiers('warrior', allocation('fury'), 20);
    const withChoice = computeTalentModifiers(
      'warrior',
      { spec: 'fury', rows: { 5: 'war_row_double_charge' } },
      20,
    );

    expect(withChoice.stats).toEqual(specOnly.stats);
    expect(withChoice.abilities.charge?.bonusCharges).toBe(1);
  });

  it('keeps a restored baseline intact when a choice row is added', () => {
    // A baselined class (rogue) must keep its folded-in baseline modifier when a
    // choice row stacks on top; the two accumulate, neither clobbers the other.
    const baseline = computeTalentModifiers('rogue', allocation('assassination'), 20);
    const withChoice = computeTalentModifiers(
      'rogue',
      { spec: 'assassination', rows: { 5: 'rog_r5_relentless_strikes' } },
      20,
    );

    expect(baseline.abilities.eviscerate?.dmgPct).toBeCloseTo(0.32);
    expect(withChoice.abilities.eviscerate).toEqual(baseline.abilities.eviscerate);
  });
});
