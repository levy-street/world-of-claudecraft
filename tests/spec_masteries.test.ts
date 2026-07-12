import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import { computeTalentModifiers, TALENTS, type TalentAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AbilityEffect, Entity, PlayerClass } from '../src/sim/types';

function alloc(spec: string): TalentAllocation {
  return { spec, ranks: {}, choices: {} };
}

function mastery(cls: PlayerClass, spec: string) {
  return computeTalentModifiers(cls, alloc(spec), 20);
}

function known(cls: PlayerClass, id: string, spec?: string): KnownAbility {
  const mods = spec ? mastery(cls, spec) : undefined;
  const ability = abilitiesKnownAt(cls, 20, mods).find((a) => a.def.id === id);
  if (!ability) throw new Error(`missing ${cls} ability ${id}`);
  return ability;
}

function effect<T extends AbilityEffect['type']>(
  ability: KnownAbility,
  type: T,
): Extract<AbilityEffect, { type: T }> {
  const found = ability.effects.find((e) => e.type === type);
  if (!found) throw new Error(`missing ${type} effect on ${ability.def.id}`);
  return found as Extract<AbilityEffect, { type: T }>;
}

function metaOf(sim: Sim, entity: Entity) {
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(entity.id);
  if (!meta) throw new Error(`missing player meta ${entity.id}`);
  return meta as { talentMods: ReturnType<typeof mastery> };
}

describe('spec masteries', () => {
  it('authors the ten PR B mastery effects exactly', () => {
    expect(TALENTS.paladin?.specs.find((s) => s.id === 'holy')?.mastery.effect).toEqual({
      global: { critDmgPct: 0.5 },
    });
    expect(TALENTS.priest?.specs.find((s) => s.id === 'discipline')?.mastery.effect).toEqual({
      global: { absorbPct: 0.3 },
      stats: { maxHpPct: 0.08 },
    });
    expect(TALENTS.druid?.specs.find((s) => s.id === 'restoration')?.mastery.effect).toEqual({
      global: { hotHealPct: 0.25 },
    });
    expect(TALENTS.shaman?.specs.find((s) => s.id === 'restoration')?.mastery.effect).toEqual({
      ability: [
        { ability: 'chain_heal', costPct: -0.2 },
        { ability: 'healing_wave', costPct: -0.2 },
      ],
    });
    expect(TALENTS.warlock?.specs.find((s) => s.id === 'affliction')?.mastery.effect).toEqual({
      global: { dotDmgPct: 0.2 },
    });
    expect(TALENTS.mage?.specs.find((s) => s.id === 'fire')?.mastery.effect).toEqual({
      global: { critDmgPct: 0.5 },
      stats: { crit: 0.02 },
    });
    expect(TALENTS.mage?.specs.find((s) => s.id === 'frost')?.mastery.effect).toEqual({
      // Frost-kit scoped so the mage's fire/arcane baseline spells stay untouched;
      // this per-ability damage is the spec's future mastery-rating scaling axis.
      ability: [
        { ability: 'frostbolt', dmgPct: 0.25 },
        { ability: 'frost_nova', dmgPct: 0.25 },
      ],
      stats: { armorPct: 0.1 },
    });
    expect(TALENTS.hunter?.specs.find((s) => s.id === 'beast_mastery')?.mastery.effect).toEqual({
      global: { petDmgPct: 0.35 },
      stats: { maxHpPct: 0.08 },
    });
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'combat')?.mastery.effect).toEqual({
      global: { meleeHastePct: 0.1, meleeDmgPct: -0.1 },
    });
    expect(TALENTS.warlock?.specs.find((s) => s.id === 'demonology')?.mastery.effect).toEqual({
      global: { petDmgSharePct: 0.2 },
      stats: { staPct: 0.1 },
    });
  });

  it('authors the all-27 extension mastery effects exactly', () => {
    expect(TALENTS.paladin?.specs.find((s) => s.id === 'protection')?.mastery.effect).toEqual({
      global: { threatPct: 0.5 },
      stats: { armorPct: 0.2 },
    });
    expect(TALENTS.paladin?.specs.find((s) => s.id === 'retribution')?.mastery.effect).toEqual({
      global: { meleeDmgPct: 0.2, spellDmgPct: 0.2 },
    });
    expect(TALENTS.hunter?.specs.find((s) => s.id === 'marksmanship')?.mastery.effect).toEqual({
      global: { meleeDmgPct: 0.2 },
      stats: { crit: 0.03 },
    });
    expect(TALENTS.hunter?.specs.find((s) => s.id === 'survival')?.mastery.effect).toEqual({
      global: { meleeDmgPct: 0.15 },
      stats: { agiPct: 0.15 },
    });
    expect(TALENTS.mage?.specs.find((s) => s.id === 'arcane')?.mastery.effect).toEqual({
      global: { spellDmgPct: 0.15, spellHastePct: 0.1 },
    });
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'assassination')?.mastery.effect).toEqual({
      global: { dotDmgPct: 0.2 },
      stats: { crit: 0.03 },
    });
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'subtlety')?.mastery.effect).toEqual({
      global: { critDmgPct: 0.4 },
      stats: { agiPct: 0.1 },
    });
    expect(TALENTS.priest?.specs.find((s) => s.id === 'holy')?.mastery.effect).toEqual({
      global: { healPct: 0.2 },
    });
    expect(TALENTS.priest?.specs.find((s) => s.id === 'shadow')?.mastery.effect).toEqual({
      global: { dotDmgPct: 0.15, spellDmgPct: 0.1 },
    });
    expect(TALENTS.shaman?.specs.find((s) => s.id === 'enhancement')?.mastery.effect).toEqual({
      global: { meleeHastePct: 0.1, meleeDmgPct: 0.1 },
    });
    expect(TALENTS.druid?.specs.find((s) => s.id === 'balance')?.mastery.effect).toEqual({
      global: { spellDmgPct: 0.15, spellHastePct: 0.1 },
    });
    expect(TALENTS.druid?.specs.find((s) => s.id === 'feral')?.mastery.effect).toEqual({
      global: { meleeDmgPct: 0.15, dotDmgPct: 0.15, threatPct: 0.2 },
    });
    expect(TALENTS.warlock?.specs.find((s) => s.id === 'destruction')?.mastery.effect).toEqual({
      global: { critDmgPct: 0.5 },
      stats: { crit: 0.02 },
    });
  });

  it('bakes DoT, HoT, absorb, cost, and melee damage mastery fields into abilities', () => {
    expect(effect(known('warlock', 'corruption'), 'dot').total).toBe(85);
    expect(effect(known('warlock', 'corruption', 'affliction'), 'dot').total).toBe(102);

    expect(effect(known('druid', 'rejuvenation'), 'hot').total).toBe(116);
    expect(effect(known('druid', 'rejuvenation', 'restoration'), 'hot').total).toBe(145);

    expect(effect(known('priest', 'power_word_shield'), 'absorb').amount).toBe(145);
    expect(effect(known('priest', 'power_word_shield', 'discipline'), 'absorb').amount).toBe(189);

    expect(known('shaman', 'healing_wave').cost).toBe(90);
    expect(known('shaman', 'healing_wave', 'restoration').cost).toBe(72);

    expect(effect(known('rogue', 'sinister_strike'), 'weaponStrike').bonus).toBe(18);
    expect(effect(known('rogue', 'sinister_strike', 'combat'), 'weaponStrike').bonus).toBe(16);
  });

  it('applies passive stat, pet damage, damage-share, and heal-crit masteries at runtime', () => {
    const rogue = new Sim({ seed: 4, playerClass: 'rogue', autoEquip: true });
    rogue.setPlayerLevel(20);
    rogue.setSpec('combat');
    expect(rogue.player.meleeHaste).toBeCloseTo(0.1);

    const hunter = new Sim({ seed: 5, playerClass: 'hunter', autoEquip: true });
    hunter.setPlayerLevel(20);
    hunter.setSpec('beast_mastery');
    const hunterPet = createMob(9001, MOBS.forest_wolf, 20, hunter.player.pos);
    hunterPet.ownerId = hunter.player.id;
    expect(
      (hunter as unknown as { petDamageMult(e: Entity): number }).petDamageMult(hunterPet),
    ).toBeCloseTo(1.35);

    const paladin = new Sim({ seed: 6, playerClass: 'paladin', autoEquip: true });
    paladin.setPlayerLevel(20);
    paladin.setSpec('holy');
    paladin.player.stats.int = 2000;
    paladin.player.critDmgBonus = 0;
    paladin.player.hp = 0;
    (
      paladin as unknown as { applyHeal(s: Entity, t: Entity, a: number, n: string): void }
    ).applyHeal(paladin.player, paladin.player, 100, 'test');
    expect(paladin.player.hp).toBe(150);
    paladin.player.hp = 0;
    paladin.player.critDmgBonus = metaOf(paladin, paladin.player).talentMods.global.critDmgPct;
    (
      paladin as unknown as { applyHeal(s: Entity, t: Entity, a: number, n: string): void }
    ).applyHeal(paladin.player, paladin.player, 100, 'test');
    expect(paladin.player.hp).toBe(200);

    const warlock = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    warlock.setPlayerLevel(20);
    warlock.setSpec('demonology');
    const demon = createMob(9002, MOBS.forest_wolf, 20, warlock.player.pos);
    demon.ownerId = warlock.player.id;
    demon.maxHp = demon.hp = 1000;
    (warlock as unknown as { addEntity(e: Entity): void }).addEntity(demon);
    warlock.player.hp = warlock.player.maxHp = 1000;
    (
      warlock as unknown as {
        dealDamage(
          s: Entity | null,
          t: Entity,
          a: number,
          c: boolean,
          sc: string,
          ab: string | null,
          k: 'hit',
        ): void;
      }
    ).dealDamage(null, warlock.player, 100, false, 'physical', null, 'hit');
    expect(warlock.player.hp).toBe(920);
    expect(demon.hp).toBe(980);
  });

  it('mastery strength ramps on the live level-up path (min(1, level/20) re-bake)', () => {
    const sim = new Sim({ seed: 11, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(10);
    sim.setSpec('restoration');
    const at10 = metaOf(sim, sim.player).talentMods.global.hotHealPct;
    expect(at10).toBeCloseTo(0.25 * (10 / 20), 10);

    // Ding through grantXp (the live level-up path), NOT setPlayerLevel/setSpec:
    // the ding itself must re-bake talentMods at the new level.
    const grant = (sim as unknown as { grantXp(amount: number): void }).grantXp.bind(sim);
    for (let i = 0; i < 200 && sim.player.level < 20; i++) grant(5000);
    expect(sim.player.level).toBe(20);
    const at20 = metaOf(sim, sim.player).talentMods.global.hotHealPct;
    expect(at20).toBeCloseTo(0.25, 10);
    expect(at20).toBeGreaterThan(at10);
  });

  it('re-bakes mastery-scaled passive stats when setPlayerLevel jumps without a respec', () => {
    const sim = new Sim({ seed: 12, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(10);
    sim.setSpec('fire');

    const noSpec10 = new Sim({ seed: 12, playerClass: 'mage', autoEquip: true });
    noSpec10.setPlayerLevel(10);
    const at10MasteryCrit = sim.player.critChance - noSpec10.player.critChance;
    expect(at10MasteryCrit).toBeCloseTo(0.02 * (10 / 20), 10);

    sim.setPlayerLevel(20);
    const noSpec20 = new Sim({ seed: 12, playerClass: 'mage', autoEquip: true });
    noSpec20.setPlayerLevel(20);
    const at20MasteryCrit = sim.player.critChance - noSpec20.player.critChance;
    expect(at20MasteryCrit).toBeCloseTo(0.02, 10);
    expect(at20MasteryCrit).toBeGreaterThan(at10MasteryCrit);
  });

  it('every spec ships its designated mastery-rating axis (PRD: Mastery rating readiness)', () => {
    // The future mastery stat (item rating, unimplemented) scales exactly one axis per
    // spec. This pins that the shipped mastery DATA carries that axis, so the rating PR
    // can be a pure multiplier over existing fields. Table mirrors docs/prd/talents-2.0.md.
    type Axis =
      | { global: string; value: number }
      | { stat: string; value: number }
      | { abilities: string[]; dmgPct?: number; costPct?: number };
    const AXES: Record<string, Record<string, Axis>> = {
      warrior: {
        // Warrior overhaul masteries: Arms scales two-handed damage (Master Armorer),
        // Fury crit (Bloodletter), Protection threat (Recompense).
        arms: { global: 'masteryTwoHandDmgPct', value: 0.1 },
        fury: { stat: 'crit', value: 0.05 },
        prot: { global: 'threatPct', value: 0.3 },
      },
      paladin: {
        holy: { global: 'critDmgPct', value: 0.5 },
        protection: { global: 'threatPct', value: 0.5 },
        retribution: { global: 'meleeDmgPct', value: 0.2 },
      },
      hunter: {
        beast_mastery: { global: 'petDmgPct', value: 0.35 },
        marksmanship: { global: 'meleeDmgPct', value: 0.2 },
        survival: { global: 'meleeDmgPct', value: 0.15 },
      },
      mage: {
        arcane: { global: 'spellDmgPct', value: 0.15 },
        fire: { global: 'critDmgPct', value: 0.5 },
        frost: { abilities: ['frostbolt', 'frost_nova'], dmgPct: 0.25 },
      },
      rogue: {
        assassination: { global: 'dotDmgPct', value: 0.2 },
        combat: { global: 'meleeHastePct', value: 0.1 },
        subtlety: { global: 'critDmgPct', value: 0.4 },
      },
      priest: {
        discipline: { global: 'absorbPct', value: 0.3 },
        holy: { global: 'healPct', value: 0.2 },
        shadow: { global: 'dotDmgPct', value: 0.15 },
      },
      shaman: {
        elemental: { global: 'spellDmgPct', value: 0.15 },
        enhancement: { global: 'meleeHastePct', value: 0.1 },
        restoration: { abilities: ['chain_heal', 'healing_wave'], costPct: -0.2 },
      },
      warlock: {
        affliction: { global: 'dotDmgPct', value: 0.2 },
        demonology: { global: 'petDmgSharePct', value: 0.2 },
        destruction: { global: 'critDmgPct', value: 0.5 },
      },
      druid: {
        balance: { global: 'spellDmgPct', value: 0.15 },
        feral: { global: 'meleeDmgPct', value: 0.15 },
        restoration: { global: 'hotHealPct', value: 0.25 },
      },
    };
    for (const [cls, specs] of Object.entries(AXES)) {
      for (const [specId, axis] of Object.entries(specs)) {
        const spec = TALENTS[cls as PlayerClass]?.specs.find((s) => s.id === specId);
        expect(spec, `${cls}/${specId} spec def`).toBeTruthy();
        const eff = spec?.mastery.effect ?? {};
        if ('global' in axis) {
          expect(
            (eff.global as Record<string, number> | undefined)?.[axis.global],
            `${cls}/${specId} axis ${axis.global}`,
          ).toBeCloseTo(axis.value, 10);
        } else if ('stat' in axis) {
          expect(
            (eff.stats as Record<string, number> | undefined)?.[axis.stat],
            `${cls}/${specId} axis stat ${axis.stat}`,
          ).toBeCloseTo(axis.value, 10);
        } else {
          for (const ab of axis.abilities) {
            const mod = eff.ability?.find((a) => a.ability === ab);
            expect(mod, `${cls}/${specId} ability axis ${ab}`).toBeTruthy();
            if (axis.dmgPct !== undefined) expect(mod?.dmgPct).toBeCloseTo(axis.dmgPct, 10);
            if (axis.costPct !== undefined) expect(mod?.costPct).toBeCloseTo(axis.costPct, 10);
          }
        }
      }
    }
  });
});
