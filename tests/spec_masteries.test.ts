import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import { computeTalentModifiers, TALENTS, type TalentAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AbilityEffect, Entity, PlayerClass } from '../src/sim/types';

function alloc(spec: string): TalentAllocation {
  return { spec, rows: {} };
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
      global: { critDmgHealPct: 0.5 },
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
    // Mage rework (owner leveling pass 2026-07-14): Fire's mastery is Ignition, a
    // crit-triggered burn (ignitionPct) plus a static +2% crit chance, not the old
    // Afterflame crit-damage bonus.
    expect(TALENTS.mage?.specs.find((s) => s.id === 'fire')?.mastery.effect).toEqual({
      global: { ignitionPct: 0.4 },
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
    // Balance pass: the penalty is gone; the Sword Specialization extra-attack
    // chance joined the haste.
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'combat')?.mastery.effect).toEqual({
      global: { meleeHastePct: 0.1, extraAttackPct: 0.05 },
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
    // Balance pass: Quickblood is the evasive-skirmisher mastery.
    expect(TALENTS.hunter?.specs.find((s) => s.id === 'survival')?.mastery.effect).toEqual({
      stats: { agiPct: 0.15, dodge: 0.04 },
    });
    // Mage rework: the 'arcane' internal id is now the Chronomancy healer (Chronoweave
    // mastery), so its effect boosts healing/mana, not spell damage.
    expect(TALENTS.mage?.specs.find((s) => s.id === 'arcane')?.mastery.effect).toEqual({
      global: { healPct: 0.15, manaPct: 0.05, manaRegenPct: 0.2 },
    });
    // Balance pass: Redhanded is the scoped Craven Thrust crit (Improved
    // Backstab shape) plus the Potent Poisons identity.
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'assassination')?.mastery.effect).toEqual({
      ability: [
        { ability: 'backstab', critPct: 0.3 },
        { ability: 'instant_poison', buffPct: 0.1 },
        { ability: 'deadly_poison', buffPct: 0.1 },
        { ability: 'crippling_poison', dmgPct: 0.1 },
      ],
    });
    // Balance pass: tuned down plus the Duskveil stealth-speed identity.
    expect(TALENTS.rogue?.specs.find((s) => s.id === 'subtlety')?.mastery.effect).toEqual({
      global: { critDmgPhysPct: 0.25 },
      ability: [
        { ability: 'stealth', buffPct: 0.5 },
        { ability: 'vanish', buffPct: 0.5 },
      ],
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
      // The v0.27 Dire Bruin retune rides the mastery now that the old
      // feral_choice_bear node is retired.
      stats: { armorPct: 0.15 },
    });
    // Balance pass (maintainer sheet): the scoped Ruinbolt/Gloom Bolt amp.
    expect(TALENTS.warlock?.specs.find((s) => s.id === 'destruction')?.mastery.effect).toEqual({
      ability: [
        { ability: 'chaos_bolt', dmgPct: 0.2 },
        { ability: 'shadow_bolt', dmgPct: 0.2 },
      ],
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
    // Balance pass: Scrapper's Edge lost the -10% cut, so the combat-specced
    // bonus matches the base value.
    expect(effect(known('rogue', 'sinister_strike', 'combat'), 'weaponStrike').bonus).toBe(18);
  });

  it('applies petDmgPct at BOTH the melee and ranged pet damage sites, not only the helper', () => {
    // Drive the actual damage sites (a regression that drops `dmg *= petDamageMult` at
    // either would still pass a helper-only assertion). Same seed + fixed rolls + an
    // identical dummy (armor cancels in the ratio) isolate the multiplier: BM's Packbond (petDmgPct 0.35)
    // must deal exactly 1.35x what a no-pet-mastery spec's identical pet deals.
    const setup = (spec: string) => {
      const sim = new Sim({ seed: 11, playerClass: 'hunter', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec(spec);
      const pet = createMob(9101, MOBS.forest_wolf, 20, sim.player.pos);
      pet.ownerId = sim.player.id;
      pet.weapon = { ...pet.weapon, min: 100, max: 100 };
      pet.swingTimer = 0;
      (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);
      const dummy = createMob(9102, MOBS.forest_wolf, 20, {
        x: sim.player.pos.x,
        y: sim.player.pos.y,
        z: sim.player.pos.z + 2,
      });
      dummy.maxHp = dummy.hp = 100000;
      (sim as unknown as { addEntity(e: Entity): void }).addEntity(dummy);
      return { sim, pet, dummy };
    };
    const dealtMelee = (spec: string): number => {
      const { sim, pet, dummy } = setup(spec);
      const before = dummy.hp;
      (sim as unknown as { mobSwing(a: Entity, b: Entity): void }).mobSwing(pet, dummy);
      return before - dummy.hp;
    };
    const dealtRanged = (spec: string): number => {
      const { sim, pet, dummy } = setup(spec);
      const spell = {
        name: 'Test Bolt',
        school: 'nature' as const,
        min: 100,
        max: 100,
        range: 100,
        every: 2,
      };
      const before = dummy.hp;
      (
        sim as unknown as { updateRangedPetAttack(p: Entity, t: Entity, s: typeof spell): void }
      ).updateRangedPetAttack(pet, dummy, spell);
      return before - dummy.hp;
    };
    const meleeBm = dealtMelee('beast_mastery');
    const meleeNone = dealtMelee('marksmanship');
    expect(meleeNone).toBeGreaterThan(0);
    expect(meleeBm / meleeNone).toBeCloseTo(1.35, 2);

    const rangedBm = dealtRanged('beast_mastery');
    const rangedNone = dealtRanged('marksmanship');
    expect(rangedNone).toBeGreaterThan(0);
    expect(rangedBm / rangedNone).toBeCloseTo(1.35, 2);
  });

  it('Veinleech (siphon_life) leeches: the affliction dot tick heals the caster', () => {
    const sim = new Sim({ seed: 12, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('affliction'); // grants the Veinleech signature (siphon_life)
    const caster = sim.player;
    caster.hp = Math.round(caster.maxHp * 0.5); // leave room for the leech to heal
    const target = createMob(9201, MOBS.forest_wolf, 20, {
      x: caster.pos.x,
      y: caster.pos.y,
      z: caster.pos.z + 3,
    });
    target.hostile = true;
    target.maxHp = target.hp = 100000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(target);
    sim.targetEntity(target.id);
    caster.facing = Math.atan2(target.pos.x - caster.pos.x, target.pos.z - caster.pos.z);
    sim.castAbility('siphon_life');

    // Tick until a dot tick lands; the leech emits a heal2 whose target is the caster.
    let selfHeal = false;
    for (let i = 0; i < 20 * 6 && !selfHeal; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'heal2' && ev.targetId === caster.id && ev.amount > 0) selfHeal = true;
      }
    }
    expect(selfHeal).toBe(true);
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
    paladin.player.critDmgHealBonus = 0;
    paladin.player.hp = 0;
    (
      paladin as unknown as { applyHeal(s: Entity, t: Entity, a: number, n: string): void }
    ).applyHeal(paladin.player, paladin.player, 100, 'test');
    expect(paladin.player.hp).toBe(150);
    paladin.player.hp = 0;
    paladin.player.critDmgHealBonus = metaOf(
      paladin,
      paladin.player,
    ).talentMods.global.critDmgHealPct;
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

  it('setPlayerLevel re-bakes level-scaled mastery (dev/GM cap-level path)', () => {
    // Spec is chosen FIRST (baked at 20), then the level is jumped down: the mastery
    // must re-bake to the new level, not keep its old-level strength. Before the fix,
    // setPlayerLevel recalced stats but left talentMods baked at the prior level.
    const sim = new Sim({ seed: 12, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('restoration');
    expect(metaOf(sim, sim.player).talentMods.global.hotHealPct).toBeCloseTo(0.25, 10);
    // Jump down to level 10: mastery must halve (min(1, 10/20) = 0.5).
    sim.setPlayerLevel(10);
    expect(metaOf(sim, sim.player).talentMods.global.hotHealPct).toBeCloseTo(0.25 * 0.5, 10);
    // And back up to 20: full strength again.
    sim.setPlayerLevel(20);
    expect(metaOf(sim, sim.player).talentMods.global.hotHealPct).toBeCloseTo(0.25, 10);
  });

  it('re-bakes mastery-scaled passive stats when setPlayerLevel jumps without a respec', () => {
    // The mage-rework Fire mastery also grants +2% crit chance (stats.crit 0.02) on top of
    // its crit-damage bonus, and that passive stat must re-bake to the new level.
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
      | { abilities: string[]; dmgPct?: number; costPct?: number; critPct?: number };
    const AXES: Record<string, Record<string, Axis>> = {
      warrior: {
        arms: { global: 'masteryTwoHandDmgPct', value: 0.1 },
        fury: { stat: 'crit', value: 0.05 },
        prot: { global: 'threatPct', value: 0.3 },
      },
      paladin: {
        holy: { global: 'critDmgHealPct', value: 0.5 },
        protection: { global: 'threatPct', value: 0.5 },
        retribution: { global: 'meleeDmgPct', value: 0.2 },
      },
      hunter: {
        beast_mastery: { global: 'petDmgPct', value: 0.35 },
        marksmanship: { global: 'meleeDmgPct', value: 0.2 },
        survival: { stat: 'agiPct', value: 0.15 },
      },
      mage: {
        // Mage rework: arcane is the Chronomancy healer (healing axis), fire is Ignition.
        arcane: { global: 'healPct', value: 0.15 },
        fire: { global: 'ignitionPct', value: 0.4 },
        frost: { abilities: ['frostbolt', 'frost_nova'], dmgPct: 0.25 },
      },
      rogue: {
        assassination: { abilities: ['backstab'], critPct: 0.3 },
        combat: { global: 'meleeHastePct', value: 0.1 },
        subtlety: { global: 'critDmgPhysPct', value: 0.25 },
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
        destruction: { abilities: ['chaos_bolt', 'shadow_bolt'], dmgPct: 0.2 },
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
            if (axis.critPct !== undefined) expect(mod?.critPct).toBeCloseTo(axis.critPct, 10);
          }
        }
      }
    }
  });
});
