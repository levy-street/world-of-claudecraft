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
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

type NumericRecord = Record<string, number>;
interface BaselineSnapshot {
  stats?: NumericRecord;
  global?: NumericRecord;
  abilities?: Record<string, NumericRecord>;
}

const EXPECTED_BASELINES: Record<string, BaselineSnapshot> = {
  'hunter/beast_mastery': {
    stats: { ap: 24, armorPct: 0.08 },
    abilities: { aspect_of_the_hawk: { buffPct: 0.4 } },
  },
  'hunter/marksmanship': {
    stats: { crit: 0.03, agi: 6 },
    abilities: {
      arcane_shot: { dmgPct: 0.24, costPct: -0.16, cooldownPct: -0.1 },
      serpent_sting: { costPct: -0.16 },
      aimed_shot: { dmgPct: 0.5, castPct: -0.2 },
      concussive_shot: { cooldownPct: -0.1 },
    },
  },
  // The percent arm is apPct on purpose (review, PR 3201): it feeds melee AP
  // and hunter ranged AP only (entity.ts), where agiPct would also lift the
  // Agility-derived armor, dodge, and crit. This deep-equal is the guard that
  // no defensive key sneaks back into the damage baseline.
  'hunter/survival': {
    stats: { agi: 3, crit: 0.03, dodge: 0.12, apPct: 0.15 },
    global: { meleeDmgPct: 0.3 },
  },
  // v0.34 rogue base re-band (spec_baselines.ts): the BiS-epic floor lift that
  // ships with the Thronebane hand fix. apPct/crit carry the auto-attack heavy
  // kit; meleeDmgPct tops up the builder and finisher share.
  'rogue/assassination': {
    stats: { crit: 0.12, apPct: 0.36 },
    global: { meleeDmgPct: 0.22 },
    abilities: {
      sinister_strike: { costPct: -0.16 },
      eviscerate: { dmgPct: 0.32 },
    },
  },
  'rogue/combat': {
    stats: { ap: 24, crit: 0.14, apPct: 0.55 },
    global: { meleeDmgPct: 0.36 },
    abilities: { sinister_strike: { dmgPct: 0.2, costPct: -0.16 } },
  },
  'rogue/subtlety': {
    stats: { agi: 7, crit: 0.1, dodge: 0.05, apPct: 0.12 },
    global: { meleeDmgPct: 0.08 },
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
      heal: { dmgPct: 0.18, costPct: -0.3, castPct: -0.2 },
      flash_heal: { costPct: -0.16 },
      prayer_of_healing: { costPct: -0.15 },
      smite: { castPct: -0.1 },
    },
  },
  'priest/shadow': {
    stats: { int: 6 },
    global: { spellDmgPct: 0.15 },
    abilities: {
      shadow_word_pain: { dmgPct: 0.2, costPct: -0.1 },
      mind_blast: { dmgPct: 0.2, costPct: -0.1 },
      mind_flay: { dmgPct: 0.15 },
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
    stats: { int: 2, ap: 24, apPct: 0.22 },
    abilities: {
      lightning_bolt: { costPct: -0.2 },
      earth_shock: { costPct: -0.2 },
      flame_shock: { costPct: -0.2 },
      rockbiter_weapon: { dmgPct: 0.4 },
      stormstrike: { dmgPct: 0.8 },
    },
  },
  'shaman/restoration': {
    stats: { int: 6 },
    abilities: { healing_wave: { dmgPct: 0.1, costPct: -0.46, castPct: -0.1 } },
  },
  'warlock/affliction': {
    stats: { int: 6 },
    abilities: {
      needle_of_fate: { dmgPct: 0.08, costPct: -0.08 },
      drain_life: { costPct: -0.08 },
    },
  },
  'warlock/demonology': {
    stats: { sta: 8, armorPct: 0.06, int: 6 },
    abilities: {
      soul_harvest: { costPct: -0.08, dmgPct: 0.08 },
      bone_armor: { costPct: -0.08 },
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
    stats: { armorPct: 0.23, staPct: 0.25 },
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
  it('contains exactly 18 passive-only spec baselines and excludes Paladin, Warrior, and Mage', () => {
    const entries = Object.entries(SPEC_BASELINES).flatMap(([cls, specs]) =>
      Object.entries(specs ?? {}).map(([spec, effect]) => ({ cls, spec, effect })),
    );

    expect(entries).toHaveLength(18);
    // Paladin owns a replacement kit and mastery layer. Warrior and Mage remain
    // excluded so restoring their pre-v0.27 passives cannot widen the gap.
    expect(SPEC_BASELINES.paladin).toBeUndefined();
    expect(SPEC_BASELINES.warrior).toBeUndefined();
    expect(SPEC_BASELINES.mage).toBeUndefined();
    expect(
      entries.some(({ cls }) => cls === 'paladin' || cls === 'warrior' || cls === 'mage'),
    ).toBe(false);
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

  it('applies the Survival physical baseline to custom Fieldcraft effects', () => {
    const known = abilitiesKnownAt(
      'hunter',
      20,
      computeTalentModifiers('hunter', allocation('survival'), 20),
    );
    const bloodhook = known
      .find(({ def }) => def.id === 'bloodhook')
      ?.effects.find((effect) => effect.type === 'hunterBloodhook');
    const shrapnel = known
      .find(({ def }) => def.id === 'shrapnel_charge')
      ?.effects.find((effect) => effect.type === 'hunterShrapnel');

    expect(bloodhook).toMatchObject({ damageMult: 1.3 });
    expect(shrapnel).toMatchObject({ damageMult: 1.3 });
  });

  // 18, not the old 21: #2428 retired the three legacy paladin spec baselines
  // along with the specs themselves.
  it('restores the complete repository-backed baseline for all 18 applicable specs', () => {
    expect(Object.keys(EXPECTED_BASELINES)).toHaveLength(18);
    for (const [key, expected] of Object.entries(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 20), key).toEqual(expected);
    }
  });

  it('applies the full baseline at unlock and leaves Paladin, Warrior, and Mage floor-free', () => {
    for (const key of Object.keys(EXPECTED_BASELINES)) {
      const [cls, spec] = key.split('/') as [PlayerClass, string];
      expect(baselineSnapshot(cls, spec, 5), key).toEqual(EXPECTED_BASELINES[key]);
    }
    // Excluded specs gain nothing beyond their level-scaled mastery, at any level.
    for (const spec of ['holy', 'protection', 'retribution']) {
      expect(baselineSnapshot('paladin', spec, 20), `paladin/${spec}`).toEqual({});
    }
    for (const spec of ['arms', 'fury', 'prot']) {
      expect(baselineSnapshot('warrior', spec, 20), `warrior/${spec}`).toEqual({});
    }
    for (const spec of ['fire', 'frost', 'arcane']) {
      expect(baselineSnapshot('mage', spec, 20), `mage/${spec}`).toEqual({});
    }
  });

  it('re-bands every rogue spec onto a large Attack Power floor (v0.34)', () => {
    // The base re-band leans on apPct/crit to lift the auto-attack heavy kit.
    // Assert it lands end to end: a specced rogue's resolved Attack Power must be
    // well above a spec-less rogue on identical (empty) gear, which only the
    // baseline apPct + flat AP can produce. Deterministic (no rng draw).
    const apFor = (spec: string | null): number => {
      const sim = new Sim({ seed: 1, playerClass: 'rogue', autoEquip: false });
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec)).toBe(true);
      sim.tick();
      return sim.player.attackPower;
    };
    const bare = apFor(null);
    for (const spec of ['assassination', 'combat']) {
      // apPct is 0.36 to 0.55 across these specs, plus crit/flat AP; both clear
      // a 1.3x AP floor over the spec-less rogue. A dropped apPct wiring fails here.
      expect(apFor(spec), spec).toBeGreaterThan(bare * 1.3);
    }
    // 2026-08-09 120s band round: subtlety's apPct stepped 0.35 to 0.12 to
    // land the 150-200 BiS band, leaving too little margin for a ratio floor
    // (measured 1.186 over bare). Pin the exact resolved AP instead, derived
    // from the wiring under guard: bare 118, plus the baseline agi 7, times
    // 1.12 apPct = 140. A dropped agi row reads 132, a dropped apPct reads
    // 125, so either wiring break fails decisively. Re-pin with the values on
    // the next re-band.
    expect(bare).toBe(118);
    expect(apFor('subtlety'), 'subtlety').toBe(140);
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
    // The level-5 row's frozen first option grants Intervene (was Double Charge); the
    // point of the assertion is that the row layer lands WITHOUT disturbing the spec
    // layer's stats above, not which effect kind the row happens to use.
    expect(withChoice.grants.some((g) => g.ability === 'intervene')).toBe(true);
    expect(specOnly.grants.some((g) => g.ability === 'intervene')).toBe(false);
  });

  it('keeps a restored baseline intact when a choice row is added', () => {
    // A baselined class (rogue) must keep its folded-in baseline modifier when a
    // choice row stacks on top; the two accumulate, neither clobbers the other.
    const baseline = computeTalentModifiers('rogue', allocation('assassination'), 20);
    const withChoice = computeTalentModifiers(
      'rogue',
      { spec: 'assassination', rows: { 5: 'rog_r5_killers_pace' } },
      20,
    );

    expect(baseline.abilities.eviscerate?.dmgPct).toBeCloseTo(0.32);
    expect(withChoice.abilities.eviscerate).toEqual(baseline.abilities.eviscerate);
  });
});
