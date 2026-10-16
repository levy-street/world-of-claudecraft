import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DURATION_SECONDS,
  MEMBERSHIP_TOKEN_ID,
} from '../src/sim/content/membership';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
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

describe('membership armour', () => {
  it('uses the normal stat budget for every class/spec and scales into item level 25 at 20', () => {
    for (const level of [1, 7, 19, 20]) {
      expect(membershipItemLevel(level)).toBe(level === 20 ? 25 : level);
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
          const check = checkStaminaModel(
            item.stats,
            primaryStatBudget(membershipItemLevel(level), 'epic', slot),
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

  it('claims within capacity and reclaims without duplicating banked, worn, or carried pieces', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const pid = sim.player.id;
    const meta = sim.players.get(pid)!;
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    sim.setMembership(pid, 30);
    expect(meta.inventory).toHaveLength(16);
    expect(meta.inventory.some((slot) => slot.itemId.startsWith('membership_'))).toBe(false);
    meta.inventory = [];
    sim.claimMembershipArmour(pid);
    const banked = meta.inventory.shift()!;
    meta.bank.inventory.push(banked);
    sim.equipItem('membership_chest', pid);
    sim.setMembership(pid, 60);
    sim.claimMembershipArmour(pid);
    const owned = [
      ...meta.inventory.map((s) => s.itemId),
      ...meta.bank.inventory.map((s) => s.itemId),
      ...Object.values(meta.equipment),
    ];
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS)
      expect(owned.filter((id) => id === `membership_${slot}`)).toHaveLength(1);
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
