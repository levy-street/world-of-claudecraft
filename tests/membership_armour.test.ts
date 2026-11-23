import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DURATION_SECONDS,
  MEMBERSHIP_TOKEN_ID,
  MEMBERSHIP_WEAPON_ID,
} from '../src/sim/content/membership';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { SPEC_PRIMARY_STAT } from '../src/sim/content/spec_primary_stat';
import { ITEMS } from '../src/sim/data';
import { maxArmorTypeForClass } from '../src/sim/equipment_rules';
import { checkStaminaModel, primaryStatBudget } from '../src/sim/item_budget';
import { membershipArmourItem, membershipItemLevel } from '../src/sim/membership_armour';
import { isDisenchantable } from '../src/sim/professions/enchanting';
import { isSalvageable } from '../src/sim/professions/salvage';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

function member(cls: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: 42, playerClass: cls });
  const pid = sim.player.id;
  const meta = sim.players.get(pid)!;
  sim.setMembership(pid, MEMBERSHIP_DURATION_SECONDS);
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.equipItem(`membership_${slot}`, pid);
  return { sim, pid, meta };
}

describe('membership gear primary stats', () => {
  it('raises attack power through the live stat derivation for every physical specialisation', () => {
    // The per-spec primary itself is pinned in tests/spec_primary_stat.test.ts.
    for (const [cls, specs] of Object.entries(SPEC_PRIMARY_STAT) as [
      PlayerClass,
      Record<string, string>,
    ][]) {
      for (const [spec, primary] of Object.entries(specs)) {
        if (primary === 'int') continue;
        const { sim, pid } = member(cls);
        sim.setPlayerLevel(20, pid);
        expect(sim.setSpec(spec, pid)).toBe(true);
        const power = () => (cls === 'hunter' ? sim.player.rangedPower : sim.player.attackPower);
        const worn = power();
        for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.unequipItem(slot, pid);
        expect(worn - power(), `${cls}/${spec}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('membership armour', () => {
  it('uses the normal stat budget for every class/spec and stays rare and five item levels above every character level', () => {
    for (const level of [1, 7, 19, 20, 25, 40]) {
      expect(membershipItemLevel(level)).toBe(level + 5);
      for (const set of SEASON2_SETS) {
        for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
          const item = membershipArmourItem(
            ITEMS[`membership_${slot}`],
            set.cls as PlayerClass,
            set.spec,
            level,
            true,
          );
          expect(item.kind === 'armor' && item.armorType).toBe(
            maxArmorTypeForClass(set.cls as PlayerClass),
          );
          expect(item.quality).toBe('rare');
          const check = checkStaminaModel(
            item.stats,
            primaryStatBudget(membershipItemLevel(level), 'rare', slot),
          );
          expect(check.meetsFloor).toBe(true);
          expect(check.onLine).toBe(true);
        }
      }
    }
  });

  it('adapts live equipped stats on level and specialisation changes', () => {
    const { sim, pid, meta } = member('paladin');
    sim.setPlayerLevel(19, pid);
    sim.setSpec('retribution', pid);
    const strength = sim.player.stats.str;
    sim.setSpec('holy', pid);
    expect(sim.player.stats.str).toBeLessThan(strength);
    expect(sim.player.healPower).toBeGreaterThan(sim.player.spellPower);
    const intellect = sim.player.stats.int;
    sim.setPlayerLevel(20, pid);
    expect(sim.player.stats.int).toBeGreaterThan(intellect);
    expect(meta.equipmentInstance.chest?.perfected).toBe(true);
    expect(
      MEMBERSHIP_ARMOUR_SLOTS.every((slot) => meta.equipment[slot] === `membership_${slot}`),
    ).toBe(true);
  });

  it('grants +20% total quest and rested kill XP only for the full worn active set', () => {
    const { sim, pid, meta } = member();
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(120);
    meta.restedXp = 100;
    sim.grantXp(100, meta, { fromKill: true });
    expect(meta.lifetimeXp).toBe(360);
    expect(meta.restedXp).toBe(0);
    sim.unequipItem('helmet', pid);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(460);
    sim.equipItem('membership_helmet', pid);
    sim.setMembership(pid, 0);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(560);
  });

  it('removes all armour and enchant power at the expiry tick while retaining the items', () => {
    const { sim, pid, meta } = member();
    sim.setPlayerLevel(20, pid);
    meta.equipmentInstance.chest = { rolled: { stats: { str: 100 } } };
    sim.setPlayerLevel(20, pid);
    sim.setMembership(pid, 0.1);
    const activeStr = sim.player.stats.str;
    sim.tick();
    expect(sim.membershipActiveFor(pid)).toBe(true);
    sim.tick();
    expect(sim.membershipActiveFor(pid)).toBe(false);
    expect(sim.player.stats.str).toBeLessThan(activeStr);
    expect(meta.equipment.chest).toBe('membership_chest');
    const dormant = { ...sim.player.stats };
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.unequipItem(slot, pid);
    expect(sim.player.stats).toEqual(dormant);
    sim.setMembership(pid, 30);
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.equipItem(`membership_${slot}`, pid);
    expect(sim.player.stats.str).toBe(activeStr);
  });

  it('overflows full bags and grants only pieces missing from every owned container', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.player.id;
    const meta = sim.players.get(pid)!;
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const rev = meta.wireRev;
    sim.setMembership(pid, 30);
    expect(meta.inventory).toHaveLength(24);
    expect(meta.wireRev).toBeGreaterThan(rev);
    const take = (id: string) =>
      meta.inventory.splice(
        meta.inventory.findIndex((s) => s.itemId === id),
        1,
      )[0];
    meta.bank.inventory.push(take('membership_helmet'));
    meta.courier = {
      phase: 'waiting',
      x: 0,
      z: 0,
      bankerId: null,
      travelDistance: 0,
      cargo: [take('membership_feet')],
      withdrawals: [],
      revision: 0,
      retryRemaining: 0,
    };
    sim.equipItem('membership_chest', pid);
    for (let i = 0; i < 3; i++) sim.claimMembershipArmour(pid);
    const owned = [
      ...meta.inventory.map((s) => s.itemId),
      ...meta.bank.inventory.map((s) => s.itemId),
      ...Object.values(meta.equipment),
      ...meta.courier.cargo.map((s) => s.itemId),
    ];
    for (const id of [
      ...MEMBERSHIP_ARMOUR_SLOTS.map((slot) => `membership_${slot}`),
      MEMBERSHIP_WEAPON_ID,
    ])
      expect(owned.filter((ownedId) => ownedId === id)).toHaveLength(1);
    take('membership_gloves');
    sim.claimMembershipArmour(pid);
    expect(meta.inventory.filter((s) => s.itemId === 'membership_gloves')).toHaveLength(1);
    expect(meta.inventory.filter((s) => s.itemId === MEMBERSHIP_WEAPON_ID)).toHaveLength(1);
  });

  it('does not restore or accept membership authority from a character blob', () => {
    const { sim, pid } = member();
    const saved = sim.serializeCharacter(pid)!;
    expect(saved).not.toHaveProperty('membershipExpiresAt');
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const next = restored.addPlayer('warrior', 'Member', {
      state: { ...saved, ...{ membershipExpiresAt: 999999, membershipActive: true } },
    });
    expect(restored.membershipActiveFor(next)).toBe(false);
    expect(restored.entities.get(next)?.membershipActive).not.toBe(true);
  });

  it('refreshes an unchanged entitlement and expires it without traversing a grown bank', () => {
    const { sim, pid, meta } = member();
    sim.setPlayerLevel(20, pid);
    // One tick first: a character's first tick runs the seasonal event-bound sweep
    // (seasonal_bound_items.ts), which walks the bank ONCE per character per event
    // change and never again on a quiet tick. Membership is what this pins.
    sim.tick();
    meta.bank.inventory = new Proxy(
      Array.from({ length: 10000 }, () => ({ itemId: 'worn_sword', count: 1 })),
      {
        get(target, property, receiver) {
          if (
            property === Symbol.iterator ||
            property === 'map' ||
            /^\d+$/.test(String(property))
          ) {
            throw new Error('Membership refresh or expiry traversed the bank');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const stats = sim.player.stats;
    const revision = meta.wireRev;
    for (let renewal = 1; renewal <= 20; renewal++) sim.setMembership(pid, renewal * 30);
    expect(meta.membershipExpiresAt).toBe(sim.time + 600);
    expect(meta.wireRev).toBe(revision);
    expect(sim.player.stats).toBe(stats);
    sim.setMembership(pid, 0.1);
    sim.tick();
    sim.tick();
    expect(sim.membershipActiveFor(pid)).toBe(false);
    const expiredRevision = meta.wireRev;
    sim.setMembership(pid, 0);
    expect(meta.wireRev).toBe(expiredRevision);
  });

  it('cannot mint materials by reclaiming soulbound rewards or redeem a token offline', () => {
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
      const item = ITEMS[`membership_${slot}`];
      expect(item.soulbound).toBe(true);
      expect(isSalvageable(item)).toBe(false);
      expect(isDisenchantable(item)).toBe(false);
    }
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    sim.addItem(MEMBERSHIP_TOKEN_ID, 1);
    sim.useItem(MEMBERSHIP_TOKEN_ID);
    expect(sim.countItem(MEMBERSHIP_TOKEN_ID)).toBe(1);
    expect(sim.membershipActiveFor(sim.player.id)).toBe(false);
  });
});
