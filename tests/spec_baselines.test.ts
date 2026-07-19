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
  'warrior/arms': {
    stats: { armorPct: 0.12, apPct: 0.12 },
    abilities: { overpower: { dmgPct: 0.5 } },
  },
  'warrior/fury': {
    stats: { ap: 10, crit: 0.03, apPct: 0.12, armorPct: 0.12 },
  },
  'warrior/prot': {
    stats: { apPct: 0.12, armorPct: 0.27 },
    abilities: { thunder_clap: { dmgPct: 0.3, costPct: -0.5 } },
  },
  'paladin/holy': {
    stats: { str: 6 },
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
    stats: { sta: 9, ap: 32, armorPct: 0.12, maxHpPct: 0.08 },
    abilities: { aspect_of_the_hawk: { buffPct: 0.4 } },
  },
  'hunter/marksmanship': {
    stats: { crit: 0.03 },
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
    stats: { spi: 9 },
    abilities: {
      shadow_word_pain: { dmgPct: 0.24, costPct: -0.1 },
      mind_blast: { dmgPct: 0.18, costPct: -0.1 },
    },
  },
  'shaman/elemental': {
    stats: { int: 4 },
    abilities: {
      lightning_bolt: { dmgPct: 0.18, costPct: -0.35, castPct: -0.2 },
      earth_shock: { dmgPct: 0.18, costPct: -0.15 },
      flame_shock: { costPct: -0.2 },
    },
  },
  'shaman/enhancement': {
    stats: { int: 6, ap: 24 },
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
  'mage/fire': {
    global: { spellDmgPct: 0.06 },
    abilities: {
      fireball: { dmgPct: 0.15, costPct: -0.12, castPct: -0.12 },
      frostbolt: { costPct: -0.12 },
      fire_blast: { dmgPct: 0.24 },
      scorch: { dmgPct: 0.54 },
    },
  },
  'mage/frost': {
    stats: { int: 2, crit: 0.04, dodge: 0.02, armorPct: 0.1 },
    abilities: {
      frostbolt: { dmgPct: 0.15, costPct: -0.12, castPct: -0.12 },
      fireball: { costPct: -0.12 },
    },
  },
  'warlock/affliction': {
    global: { spellDmgPct: 0.02 },
    abilities: {
      corruption: { dmgPct: 0.16, costPct: -0.15, castPct: -0.7 },
      curse_of_agony: { dmgPct: 0.09, costPct: -0.15 },
    },
  },
  'warlock/demonology': {
    stats: { sta: 15, staPct: 0.08, armorPct: 0.06 },
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
    stats: { spi: 3 },
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
    stats: { spi: 3 },
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
  it('contains exactly 26 passive-only spec baselines and excludes Chronomancy', () => {
    const entries = Object.entries(SPEC_BASELINES).flatMap(([cls, specs]) =>
      Object.entries(specs ?? {}).map(([spec, effect]) => ({ cls, spec, effect })),
    );

    expect(entries).toHaveLength(26);
    expect(entries.some(({ cls, spec }) => cls === 'mage' && spec === 'arcane')).toBe(false);
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

  it('restores the complete repository-backed baseline for all 26 applicable specs', () => {
    expect(Object.keys(EXPECTED_BASELINES)).toHaveLength(26);
    for (const [key, expected] of Object.entries(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 20), key).toEqual(expected);
    }
  });

  it('applies the full baseline as soon as a spec unlocks, without changing Chronomancy', () => {
    for (const key of Object.keys(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 5), key).toEqual(EXPECTED_BASELINES[key]);
    }
    expect(baselineSnapshot('mage', 'arcane', 20)).toEqual({});
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

  it('keeps choice-row effects additive to the automatic baseline', () => {
    const baseline = computeTalentModifiers('warrior', allocation('fury'), 20);
    const withChoice = computeTalentModifiers(
      'warrior',
      { spec: 'fury', rows: { 5: 'war_row_double_charge' } },
      20,
    );

    expect(withChoice.stats).toEqual(baseline.stats);
    expect(withChoice.abilities.overpower).toEqual(baseline.abilities.overpower);
    expect(withChoice.abilities.charge?.bonusCharges).toBe(1);
  });
});
