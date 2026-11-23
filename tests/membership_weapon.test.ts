import { describe, expect, it, vi } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { wieldsDagger } from '../src/sim/combat/equipment_requirement';
import { MEMBERSHIP_WEAPON_ID } from '../src/sim/content/membership';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { canEquipItemInSlot } from '../src/sim/equipment_rules';
import { checkStaminaModel } from '../src/sim/item_budget';
import { membershipWeaponForm, membershipWeaponItem } from '../src/sim/membership_weapon';
import { Sim } from '../src/sim/sim';
import type { PlayerClass, WeaponHand } from '../src/sim/types';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';
import { EMPTY_TEST_WORLD } from './sim_shared';

const EXPECTED_FORMS: readonly [
  PlayerClass,
  readonly string[],
  string,
  WeaponHand,
  number,
  boolean,
][] = [
  ['warrior', ['arms', 'fury'], 'eastbrook_greatsword', 'twohand', 3.4, false],
  ['warrior', ['prot'], 'worn_sword', 'onehand', 2, false],
  ['paladin', ['holy'], 'training_mace', 'onehand', 2, false],
  ['paladin', ['protection'], 'worn_sword', 'onehand', 2, false],
  ['paladin', ['retribution'], 'eastbrook_greatsword', 'twohand', 3.4, false],
  [
    'hunter',
    ['beast_mastery', 'marksmanship', 'survival'],
    'eastbrook_greatsword',
    'twohand',
    3.4,
    false,
  ],
  ['rogue', ['assassination', 'subtlety'], 'rusty_dagger', 'onehand', 1.8, true],
  ['rogue', ['combat'], 'worn_sword', 'onehand', 2, false],
  ['priest', ['discipline', 'holy', 'shadow'], 'gnarled_staff', 'onehand', 2.9, false],
  ['shaman', ['elemental', 'restoration'], 'gnarled_staff', 'onehand', 2.9, false],
  ['shaman', ['enhancement'], 'training_mace', 'onehand', 2, false],
  ['mage', ['arcane', 'fire', 'frost'], 'gnarled_staff', 'onehand', 2.9, false],
  ['warlock', ['affliction', 'demonology', 'destruction'], 'gnarled_staff', 'onehand', 2.9, false],
  ['druid', ['balance', 'restoration'], 'gnarled_staff', 'onehand', 2.9, false],
  ['druid', ['feral'], 'gnarled_staff', 'twohand', 2.9, false],
];

function weaponUser(cls: PlayerClass, spec: string) {
  const sim = new Sim({ seed: 42, playerClass: cls, autoEquip: false, world: EMPTY_TEST_WORLD });
  const player = sim.player;
  const meta = sim.players.get(player.id);
  if (!meta) throw new Error('missing weapon wearer');
  meta.equipment = {};
  meta.equipmentInstance = {};
  meta.inventory = [];
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.setMembership(player.id, 1000);
  sim.equipItem(MEMBERSHIP_WEAPON_ID, player.id, 'mainhand');
  const target = createMob(9500, MOBS.forest_wolf, 1, { ...player.pos, z: player.pos.z + 2 });
  target.maxHp = target.hp = 100_000;
  target.hostile = true;
  sim.entities.set(target.id, target);
  return { sim, player, meta, target };
}

describe('Staff of Changing', () => {
  it('pins the intended form for every class and specialization independently of the resolver', () => {
    const covered: string[] = [];
    for (const [cls, specs, model, hand, speed, dagger] of EXPECTED_FORMS) {
      for (const spec of specs) {
        covered.push(`${cls}:${spec}`);
        expect(membershipWeaponForm(cls, spec)).toEqual({ model, hand, speed, dagger });
        const item = membershipWeaponItem(ITEMS[MEMBERSHIP_WEAPON_ID], cls, spec, 20, true);
        if (item.kind !== 'weapon') throw new Error('missing adaptive weapon');
        expect(item.hand).toBe(hand);
        expect(item.weapon).toMatchObject({ speed, dagger });
        for (const field of [
          'weaponProcs',
          'hitRating',
          'critRating',
          'hasteRating',
          'spellPower',
          'healingPower',
          'pvpOffenseRating',
          'pvpDefenseRating',
        ])
          expect(item).not.toHaveProperty(field);
      }
    }
    expect(covered.sort()).toEqual(SEASON2_SETS.map(({ cls, spec }) => `${cls}:${spec}`).sort());
  });

  it.each([
    [1, 3, 10, 20, 4, 22, 44],
    [19, 13, 17, 33, 17, 36, 72],
    [20, 14, 17, 34, 18, 37, 74],
    [21, 15, 17, 35, 20, 38, 76],
    [30, 20, 21, 41, 26, 45, 90],
  ])(
    'uses the exact rare level-plus-five budget at character level %s',
    (level, oneBudget, oneMin, oneMax, twoBudget, twoMin, twoMax) => {
      const one = membershipWeaponItem(
        ITEMS[MEMBERSHIP_WEAPON_ID],
        'rogue',
        'assassination',
        level,
        true,
      );
      const two = membershipWeaponItem(ITEMS[MEMBERSHIP_WEAPON_ID], 'warrior', 'arms', level, true);
      expect(checkStaminaModel(one.stats, oneBudget)).toMatchObject({
        onLine: true,
        meetsFloor: true,
      });
      expect(checkStaminaModel(two.stats, twoBudget)).toMatchObject({
        onLine: true,
        meetsFloor: true,
      });
      expect(one.weapon).toMatchObject({ min: oneMin, max: oneMax, speed: 1.8 });
      expect(two.weapon).toMatchObject({ min: twoMin, max: twoMax, speed: 3.4 });
    },
  );

  it('applies Arms two-hand mastery to real damage and removes it for a one-hander or dormant staff', () => {
    const { sim, player, meta, target } = weaponUser('warrior', 'arms');
    const hit = (school: string) => {
      const before = target.hp;
      sim.dealDamage(player, target, 100, false, school, 'Test Ability', 'hit', true);
      return before - target.hp;
    };
    expect(meta.equipment.mainhand).toBe(MEMBERSHIP_WEAPON_ID);
    expect(hit('physical')).toBe(110);
    expect(hit('fire')).toBe(110);
    sim.addItem('worn_sword', 1);
    sim.equipItem('worn_sword');
    expect(hit('physical')).toBe(100);
    sim.equipItem(MEMBERSHIP_WEAPON_ID);
    sim.setMembership(player.id, 0);
    expect(hit('physical')).toBe(100);
    expect(hit('fire')).toBe(100);
  });

  it('keeps the dagger requirement in sync with the actual live weapon across specialization and expiry', () => {
    const { sim, player, meta } = weaponUser('rogue', 'assassination');
    const eligible = () =>
      wieldsDagger(
        meta.equipment,
        player.level,
        meta.cls,
        meta.talents.spec,
        player.membershipActive,
      );
    expect(eligible()).toBe(true);
    expect(player.weapon.dagger).toBe(true);
    sim.setSpec('combat');
    expect(eligible()).toBe(false);
    expect(player.weapon.dagger).toBe(false);
    sim.setSpec('subtlety');
    expect(eligible()).toBe(true);
    sim.setMembership(player.id, 0);
    expect(eligible()).toBe(false);
    expect(player.weapon.dagger).not.toBe(true);
    expect(wieldsDagger(meta.equipment, player.level)).toBe(false);
  });

  it('uses adaptive swing speed for enchant procs and makes expired membership enchants inert', () => {
    const { sim, player, meta, target } = weaponUser('warrior', 'arms');
    const enchant = 'enchant_weapon_lastflame_zeal';
    meta.equipmentInstance.mainhand = { enchant };
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    try {
      runWeaponProcs(sim.ctx, player, target, 'weaponHit', player.mainhandItemId, 'mainhand');
      expect(chance).toHaveBeenCalledExactlyOnceWith(3.4 / 60);
      chance.mockClear();
      sim.setSpec('prot');
      runWeaponProcs(sim.ctx, player, target, 'weaponHit', player.mainhandItemId, 'mainhand');
      expect(chance).toHaveBeenCalledExactlyOnceWith(2 / 60);
      sim.setMembership(player.id, 0);
      chance.mockClear().mockReturnValue(true);
      runWeaponProcs(sim.ctx, player, target, 'weaponHit', player.mainhandItemId, 'mainhand');
      expect(chance).not.toHaveBeenCalled();
      expect(player.auras.some((aura) => aura.id === enchant)).toBe(false);
    } finally {
      chance.mockRestore();
    }
  });

  it('never inherits a cosmetic donor weapon proc', () => {
    const { sim, player, target } = weaponUser('warrior', 'arms');
    const donor = ITEMS.eastbrook_greatsword;
    if (donor.kind !== 'weapon') throw new Error('missing donor weapon');
    const previous = donor.weaponProcs;
    donor.weaponProcs = [
      {
        id: 'test_donor_proc',
        name: 'Test Donor Proc',
        trigger: 'weaponHit',
        chance: 1,
        effects: [],
      },
    ];
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    try {
      runWeaponProcs(sim.ctx, player, target, 'weaponHit', player.mainhandItemId, 'mainhand');
      expect(chance).not.toHaveBeenCalled();
    } finally {
      chance.mockRestore();
      if (previous === undefined) delete donor.weaponProcs;
      else donor.weaponProcs = previous;
    }
  });

  it('chooses a legal weapon and a shipped non-proc appearance for every specialization', () => {
    for (const set of SEASON2_SETS) {
      const cls = set.cls as PlayerClass;
      for (const level of [1, 19, 20, 35]) {
        const item = membershipWeaponItem(ITEMS[MEMBERSHIP_WEAPON_ID], cls, set.spec, level, true);
        const form = membershipWeaponForm(cls, set.spec);
        expect(item.id).toBe(MEMBERSHIP_WEAPON_ID);
        expect(item.quality).toBe('rare');
        expect(item.soulbound).toBe(true);
        expect(item.noSalvage).toBe(true);
        expect(canEquipItemInSlot(cls, item, 'mainhand', set.spec)).toBe(true);
        expect(ITEM_WEAPON_VARIANTS[form.model]).toBeTruthy();
        expect(ITEMS[form.model]?.kind).toBe('weapon');
        expect(ITEMS[form.model]).not.toHaveProperty('weaponProcs');
        expect(item.weapon!.min).toBeGreaterThan(1);
      }
    }
  });

  it('changes worn stats, damage, hands and displayed model with specialization, without losing a shield', () => {
    const sim = new Sim({ seed: 42, playerClass: 'paladin', autoEquip: false });
    const pid = sim.player.id;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    meta.equipment = {};
    meta.equipmentInstance = {};
    sim.setPlayerLevel(20, pid);
    sim.setSpec('protection', pid);
    sim.setMembership(pid, 1000);
    sim.equipItem(MEMBERSHIP_WEAPON_ID, pid, 'mainhand');
    sim.addItem('eastbrook_buckler', 1, pid);
    sim.equipItem('eastbrook_buckler', pid);
    expect(meta.equipment.offhand).toBe('eastbrook_buckler');
    expect(sim.player.mainhandItemId).toBe('worn_sword');
    const damage = sim.player.weapon.max;
    sim.setSpec('retribution', pid);
    expect(meta.equipment.mainhand).toBe(MEMBERSHIP_WEAPON_ID);
    expect(sim.player.mainhandItemId).toBe('eastbrook_greatsword');
    expect(sim.player.weapon.max).toBeGreaterThan(damage);
    expect(meta.equipment.offhand).toBeUndefined();
    expect(sim.countItem('eastbrook_buckler', pid)).toBe(1);
    const strength = sim.player.stats.str;
    sim.setSpec('holy', pid);
    expect(sim.player.mainhandItemId).toBe('training_mace');
    expect(sim.player.stats.str).toBeLessThan(strength);
    expect(sim.player.stats.int).toBeGreaterThan(0);
    sim.equipItem('eastbrook_buckler', pid);
    expect(meta.equipment.offhand).toBe('eastbrook_buckler');
  });

  it('uses rogue dagger rules, scales beyond level twenty and makes enchants inert at expiry', () => {
    const sim = new Sim({ seed: 42, playerClass: 'rogue', autoEquip: false });
    const pid = sim.player.id;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    meta.equipment = {};
    meta.equipmentInstance = {};
    sim.setPlayerLevel(20, pid);
    sim.setMembership(pid, 100);
    sim.setSpec('assassination', pid);
    sim.equipItem(MEMBERSHIP_WEAPON_ID, pid, 'mainhand');
    expect(sim.player.weapon.dagger).toBe(true);
    expect(sim.player.mainhandItemId).toBe('rusty_dagger');
    const atTwenty = membershipWeaponItem(
      ITEMS[MEMBERSHIP_WEAPON_ID],
      'rogue',
      'assassination',
      20,
      true,
    );
    const atThirty = membershipWeaponItem(
      ITEMS[MEMBERSHIP_WEAPON_ID],
      'rogue',
      'assassination',
      30,
      true,
    );
    expect(atThirty.weapon!.max).toBeGreaterThan(atTwenty.weapon!.max);
    sim.setSpec('combat', pid);
    expect(sim.player.weapon.dagger).toBe(false);
    expect(sim.player.mainhandItemId).toBe('worn_sword');
    meta.equipmentInstance.mainhand = { rolled: { stats: { agi: 999 } } };
    sim.setMembership(pid, 0);
    expect(sim.player.weapon).toEqual({ min: 1, max: 2, speed: 2 });
    const dormant = { ...sim.player.stats };
    recalcPlayerStats(sim.player, 'rogue', {}, sim.playerMods(meta), {});
    expect(sim.player.stats).toEqual(dormant);
    expect(meta.equipment.mainhand).toBe(MEMBERSHIP_WEAPON_ID);
  });
});
