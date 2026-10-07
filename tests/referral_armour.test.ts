import { describe, expect, it } from 'vitest';
import { MEMBERSHIP_ARMOUR_SLOTS } from '../src/sim/content/membership';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import { membershipArmourItem, referralArmourItem } from '../src/sim/membership_armour';
import { referralArmourXpActive, setReferralArmour } from '../src/sim/referral_armour';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

function friend(cls: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: 42, playerClass: cls });
  const pid = sim.player.id,
    meta = sim.players.get(pid)!;
  meta.accountId = 11;
  setReferralArmour(sim.ctx, pid, { inviterAccountId: 22, inviterName: 'Inviter' });
  for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.equipItem(`referral_${slot}`, pid);
  return { sim, pid, meta };
}
function addPartyMember(sim: Sim, pid: number, accountId: number, active: boolean) {
  const member = sim.addPlayer('priest', `Friend${accountId}`);
  sim.players.get(member)!.accountId = accountId;
  if (active) sim.setMembership(member, 1000);
  sim.partyInvite(member, pid);
  sim.partyAccept(member);
  return member;
}

describe('referral armour', () => {
  it('shares every class/spec/level budget with membership armour and is soulbound without salvage', () => {
    for (const set of SEASON2_SETS)
      for (const level of [1, 7, 19, 20])
        for (const slot of MEMBERSHIP_ARMOUR_SLOTS) {
          const referral = referralArmourItem(
            ITEMS[`referral_${slot}`],
            set.cls as PlayerClass,
            set.spec,
            level,
            true,
          );
          const membership = membershipArmourItem(
            ITEMS[`membership_${slot}`],
            set.cls as PlayerClass,
            set.spec,
            level,
            true,
          );
          expect({ ...referral, id: membership.id, name: membership.name }).toEqual(membership);
          expect(referral.soulbound).toBe(true);
          expect(referral.noSalvage).toBe(true);
        }
  });

  it('keeps stats permanently, adapts spec, and perfects all storage at level20', () => {
    const { sim, pid, meta } = friend('paladin');
    sim.setPlayerLevel(19, pid);
    sim.setSpec('retribution', pid);
    const strength = sim.player.stats.str;
    sim.setSpec('holy', pid);
    expect(sim.player.stats.str).toBeLessThan(strength);
    expect(sim.player.healPower).toBeGreaterThan(0);
    sim.unequipItem('helmet', pid);
    const helmet = meta.inventory.findIndex((x) => x.itemId === 'referral_helmet');
    meta.bank.inventory.push(meta.inventory.splice(helmet, 1)[0]);
    sim.unequipItem('feet', pid);
    const feet = meta.inventory.findIndex((x) => x.itemId === 'referral_feet');
    meta.courier = {
      phase: 'waiting',
      x: 0,
      z: 0,
      bankerId: null,
      travelDistance: 0,
      cargo: meta.inventory.splice(feet, 1),
      withdrawals: [],
      revision: 0,
      retryRemaining: 0,
    };
    sim.setPlayerLevel(20, pid);
    expect(meta.equipmentInstance.chest?.perfected).toBe(true);
    expect(meta.bank.inventory[0].instance?.perfected).toBe(true);
    expect(meta.courier.cargo[0].instance?.perfected).toBe(true);
    const stats = { ...sim.player.stats };
    sim.setMembership(pid, 0);
    expect(sim.player.stats).toEqual(stats);
    expect(sim.player.referralInviterName).toBe('Inviter');
  });

  it('grants rested and quest XP only beside the specific active inviter account, including an alt', () => {
    const { sim, pid, meta } = friend();
    const wrong = addPartyMember(sim, pid, 33, true);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(100);
    const inviter = addPartyMember(sim, pid, 22, false);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(200);
    sim.setMembership(inviter, 0.1);
    meta.restedXp = 100;
    sim.grantXp(100, meta, { fromKill: true });
    expect(meta.lifetimeXp).toBe(440);
    expect(meta.restedXp).toBe(0);
    sim.players.get(inviter)!.membershipExpiresAt = sim.time;
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(540);
    // A different character on the same inviting account qualifies immediately.
    sim.players.get(wrong)!.accountId = 22;
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(660);
    sim.partyLeave(wrong);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(760);
  });

  it('requires an exact full set and never stacks membership and referral XP', () => {
    const { sim, pid, meta } = friend();
    addPartyMember(sim, pid, 22, true);
    sim.setMembership(pid, 1000);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(120);
    sim.equipItem('membership_helmet', pid);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(220);
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS) sim.equipItem(`membership_${slot}`, pid);
    sim.grantXp(100, meta);
    expect(meta.lifetimeXp).toBe(340);
  });

  it('retries partial claims without membership or duplicate inventory, bank, equipment or courier pieces', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const pid = sim.player.id,
      meta = sim.players.get(pid)!;
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    setReferralArmour(sim.ctx, pid, { inviterAccountId: 22, inviterName: 'Inviter' });
    expect(meta.inventory.filter((x) => x.itemId.startsWith('referral_'))).toHaveLength(0);
    meta.inventory.splice(0, 3);
    sim.claimMembershipArmour(pid);
    expect(meta.inventory.filter((x) => x.itemId.startsWith('referral_'))).toHaveLength(3);
    meta.inventory = meta.inventory.filter((x) => x.itemId.startsWith('referral_'));
    meta.bank.inventory.push(meta.inventory.shift()!);
    meta.courier = {
      phase: 'waiting',
      x: 0,
      z: 0,
      bankerId: null,
      travelDistance: 0,
      cargo: [meta.inventory.shift()!],
      withdrawals: [],
      revision: 0,
      retryRemaining: 0,
    };
    sim.equipItem(meta.inventory[0].itemId, pid);
    sim.claimMembershipArmour(pid);
    sim.claimMembershipArmour(pid);
    const ids = [
      ...Object.values(meta.equipment),
      ...meta.inventory.map((x) => x.itemId),
      ...meta.bank.inventory.map((x) => x.itemId),
      ...meta.courier.cargo.map((x) => x.itemId),
    ];
    for (const slot of MEMBERSHIP_ARMOUR_SLOTS)
      expect(ids.filter((id) => id === `referral_${slot}`)).toHaveLength(1);
  });

  it('does not restore forged entitlement, account identity or inviter display from a character save', () => {
    const { sim, pid } = friend();
    const saved = sim.serializeCharacter(pid)!;
    expect(saved).not.toHaveProperty('referralArmour');
    expect(saved).not.toHaveProperty('accountId');
    expect(saved).not.toHaveProperty('referralInviterName');
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const next = restored.addPlayer('warrior', 'Forged', {
      state: {
        ...saved,
        ...{
          accountId: 11,
          referralArmour: { inviterAccountId: 22, inviterName: 'Forged' },
          referralInviterName: 'Forged',
        },
      },
    });
    const meta = restored.players.get(next)!,
      entity = restored.entities.get(next)!;
    expect(meta.accountId).toBeUndefined();
    expect(meta.referralArmour).toBeUndefined();
    expect(entity.referralInviterName).toBeUndefined();
    const inert = { ...entity.stats };
    const ordinary = Object.fromEntries(
      Object.entries(meta.equipment).filter(([, id]) => !id?.startsWith('referral_')),
    );
    recalcPlayerStats(
      entity,
      meta.cls,
      ordinary,
      restored.playerMods(meta),
      meta.equipmentInstance,
    );
    expect(entity.stats).toEqual(inert);
    expect(referralArmourXpActive(restored.ctx, meta)).toBe(false);
  });

  it('reads only the bounded party roster and keeps repeated host refreshes off grown containers', () => {
    const { sim, pid, meta } = friend();
    addPartyMember(sim, pid, 22, true);
    meta.bank.inventory = new Proxy(meta.bank.inventory, {
      get(target, key, receiver) {
        if (key === Symbol.iterator || key === 'map') throw new Error('unexpected bank traversal');
        return Reflect.get(target, key, receiver);
      },
    });
    const rev = meta.wireRev;
    setReferralArmour(sim.ctx, pid, { inviterAccountId: 22, inviterName: 'Inviter' });
    expect(meta.wireRev).toBe(rev);
    sim.players.values = () => {
      throw new Error('realm roster scan');
    };
    expect(referralArmourXpActive(sim.ctx, meta)).toBe(true);
    sim.partyOf(pid)!.members = Array.from({ length: 11 }, () => pid);
    expect(referralArmourXpActive(sim.ctx, meta)).toBe(false);
  });
});
