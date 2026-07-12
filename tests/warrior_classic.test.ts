// Kit-fidelity pins for the classic warrior: the pre-overhaul kit resurrected
// as its own class (src/sim/content/classes_warrior_classic.ts) so PTR testers
// can compare the two warrior designs side by side. These tests pin what makes
// it CLASSIC: the old ability list under cw_ ids, the old rage coefficients,
// and the defensive-stance-only stance model. Weapon access is deliberately
// EQUAL footing (operator decision 2026-07-11): the classic warrior always
// dual-wields one-handers (classic-era rules, no spec gate), equips shields,
// and swings two-handers, so the head-to-head isolates ABILITY design; only
// Titan's Grip (a 2H in each hand) stays Bloodrush-warrior exclusive.

import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import {
  canDualWield,
  canDualWieldTwoHand,
  canEquipItem,
  canEquipItemInSlot,
  maxArmorTypeForClass,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import {
  PARRY_CLASSES,
  rageConversion,
  rageFromDealing,
  rageFromDealingClassic,
  rageFromTaking,
  rageFromTakingClassic,
} from '../src/sim/types';

const OLD_KIT = [
  'cw_heroic_strike',
  'cw_battle_shout',
  'cw_commanding_shout',
  'cw_charge',
  'cw_rend',
  'cw_thunder_clap',
  'cw_hamstring',
  'cw_bloodrage',
  'cw_overpower',
  'cw_execute',
  'cw_slam',
  'cw_cleave',
  'cw_defensive_stance',
  'cw_demoralizing_shout',
  'cw_sunder_armor',
  'cw_taunt',
];

describe('warrior_classic: the pre-overhaul kit as a second class', () => {
  it('ships exactly the old 16-ability base kit under cw_ ids', () => {
    expect(CLASSES.warrior_classic.abilities).toEqual(OLD_KIT);
    expect(CLASSES.warrior_classic.resourceType).toBe('rage');
    expect(CLASSES.warrior_classic.startOffhand).toBeUndefined();
  });

  it('has the three old specs with the OLD masteries (Sharpened Blades kept)', () => {
    const specs = TALENTS.warrior_classic?.specs ?? [];
    expect(specs.map((s) => s.id)).toEqual(['arms', 'fury', 'prot']);
    expect(specs[0].mastery.name).toBe('Sharpened Blades');
  });

  it("always dual-wields one-handers (classic-era rules: no spec gate, no Titan's Grip)", () => {
    // Operator decision 2026-07-11: equal weapon footing for the head-to-head.
    // Classic dual wield is unconditional (like the classic-era trainer skill),
    // while the overhauled warrior gates it behind Bloodrush.
    expect(canDualWield('warrior_classic', null)).toBe(true);
    expect(canDualWield('warrior_classic', 'arms')).toBe(true);
    expect(canDualWield('warrior_classic', 'prot')).toBe(true);
    // Titan's Grip stays Bloodrush-warrior exclusive: a classic offhand must
    // be one-handed.
    expect(canDualWieldTwoHand('warrior_classic', 'fury')).toBe(false);
    expect(canEquipItemInSlot('warrior_classic', ITEMS.kingsbane_last_oath, 'offhand', null)).toBe(
      true,
    );
    expect(
      canEquipItemInSlot('warrior_classic', ITEMS.bonewrought_greatsword, 'offhand', 'fury'),
    ).toBe(false);
  });

  it('right-click equipping actually dual-wields: the second one-hander auto-routes to the offhand', () => {
    // 2026-07-11 PBE bug: desiredEquipSlot gated offhand routing on its OWN
    // copy of the dual-wield rule (rogue || fury warrior) instead of
    // canDualWield, so a classic warrior's second one-hander kept replacing
    // the mainhand and 1H+1H was unreachable by right-click.
    const sim = new Sim({ seed: 9, playerClass: 'warrior_classic', playerName: 'Dwclassic' });
    const pid = sim.playerId;
    sim.setPlayerLevel(20, pid);
    // The boosted spawn state: a two-hander in the mainhand, the pair in bags.
    sim.addItem('bonewrought_greatsword', 1, pid);
    sim.addItem('kingsbane_last_oath', 1, pid);
    sim.addItem('drownedmoon_maul', 1, pid);
    sim.equipItem('bonewrought_greatsword', pid);
    // First 1H cannot sit beside the 2H (no Titan's Grip), so it swaps the
    // mainhand; the second then auto-routes to the empty offhand.
    sim.equipItem('kingsbane_last_oath', pid);
    sim.equipItem('drownedmoon_maul', pid);
    const equipment = sim.meta(pid)?.equipment;
    expect(equipment?.mainhand).toBe('kingsbane_last_oath');
    expect(equipment?.offhand).toBe('drownedmoon_maul');
  });

  it('equips shields through the warrior gear alias; caster held offhands stay out', () => {
    expect(canEquipItem('warrior_classic', ITEMS.highwatch_wallshield)).toBe(true);
    expect(canEquipItem('warrior_classic', ITEMS.bonewrought_bulwark)).toBe(true);
    expect(canEquipItemInSlot('warrior_classic', ITEMS.bonewrought_bulwark, 'offhand', null)).toBe(
      true,
    );
    // The caster stat stick is a held_offhand with a caster-group class list
    // that includes neither warrior_classic nor its warrior alias.
    expect(canEquipItem('warrior_classic', ITEMS.wraithfire_orb)).toBe(false);
  });

  it('shares warrior gear proficiency (mail rank, warrior-locked epics)', () => {
    expect(maxArmorTypeForClass('warrior_classic')).toBe('mail');
    expect(canEquipItem('warrior_classic', ITEMS.crownforged_dreadhelm)).toBe(true);
    expect(canEquipItem('warrior_classic', ITEMS.kingsbane_last_oath)).toBe(true);
    // Weapons resolve via the gearCls alias: the raid 2H greatsword's warrior
    // proficiency group covers the classic warrior too.
    expect(canEquipItem('warrior_classic', ITEMS.bonewrought_greatsword)).toBe(true);
  });

  it('parries like every melee class in the new engine', () => {
    expect(PARRY_CLASSES.has('warrior_classic')).toBe(true);
  });

  it('keeps the old rage coefficients (dealing 7.5x, taking /(level*1.5))', () => {
    expect(rageFromDealingClassic(100, 20)).toBeLessThan(rageFromDealing(100, 20));
    expect(rageFromDealingClassic(100, 20)).toBeCloseTo((7.5 * 100) / rageConversion(20), 5);
    expect(rageFromTakingClassic(100, 20)).toBeCloseTo(100 / 30, 5);
    expect(rageFromTakingClassic(100, 20)).toBeLessThan(rageFromTaking(100, 20));
  });

  it('reconciles into the classic Defensive Stance and nothing else', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior_classic', playerName: 'Oldschool' });
    const pid = sim.playerId;
    sim.setPlayerLevel(20, pid);
    for (let i = 0; i < 5; i++) sim.tick();
    const e = (
      sim as unknown as { entities: Map<number, { auras: { id: string }[] }> }
    ).entities.get(pid);
    const stances = e?.auras.filter((a) =>
      ['cw_defensive_stance', 'battle_stance', 'berserker_stance', 'defensive_stance'].includes(
        a.id,
      ),
    );
    expect(stances?.map((a) => a.id)).toEqual(['cw_defensive_stance']);
  });

  it('serializes and reloads like any class (the server login shape)', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior_classic', playerName: 'Oldschool' });
    sim.setPlayerLevel(20, sim.playerId);
    const state = sim.serializeCharacter(sim.playerId);
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'x', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior_classic', 'Oldschool', {
      state: JSON.parse(JSON.stringify(state)),
    });
    expect(sim2.serializeCharacter(pid2)?.level).toBe(20);
  });
});
