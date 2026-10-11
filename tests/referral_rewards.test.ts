import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import { onTrinketDamage } from '../src/sim/combat/trinkets';
import { BUDDIES } from '../src/sim/content/buddies';
import { MOUNTS } from '../src/sim/content/mounts';
import {
  REFERRAL_BAG,
  REFERRAL_FOG_TRINKET,
  REFERRAL_HOLLOW_TRINKET,
  REFERRAL_RAPTOR_REINS,
  REFERRAL_STAMP_ITEMS,
  REFERRAL_TANK_REINS,
  REFERRAL_TITLE,
} from '../src/sim/content/referral_rewards';
import { TRINKET_AURA, trinketCooldownKey } from '../src/sim/content/trinkets';
import { ITEMS } from '../src/sim/data';
import { expectedStatBudget, itemSourceLevel } from '../src/sim/item_level';
import {
  applyReferralRewardState,
  grantReferralInviterReward,
  grantReferralReward,
  moveReferralRewards,
  ownsReferralTitle,
  removeReferralRewards,
} from '../src/sim/referral_rewards';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function blank(): CharacterState {
  return {
    level: 1,
    xp: 0,
    copper: 0,
    hp: 100,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    questsDone: [],
  };
}
function hollow(linkId = 1): CharacterState {
  return grantReferralReward(grantReferralReward(blank(), linkId, 'tutorial'), linkId, 'hollow');
}
function simWith(state: CharacterState) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Friend', { state });
  return { sim, pid, meta: sim.players.get(pid)!, player: sim.entities.get(pid)! };
}

describe('referral reward transactions', () => {
  it('prices both charms at the ordinary accessory budget of their milestone bosses', () => {
    expect(itemSourceLevel(REFERRAL_HOLLOW_TRINKET)).toBe(10);
    expect(itemSourceLevel(REFERRAL_FOG_TRINKET)).toBe(13);
    expect(expectedStatBudget(ITEMS[REFERRAL_HOLLOW_TRINKET])).toBe(3);
    expect(expectedStatBudget(ITEMS[REFERRAL_FOG_TRINKET])).toBe(5);
  });
  it('grants the title and maximum bag once per card, with permanent custody protection', () => {
    const start = blank();
    const granted = grantReferralReward(start, 1, 'tutorial');
    expect(start.inventory).toEqual([]);
    expect(granted.inventory).toEqual([{ itemId: REFERRAL_BAG, count: 1 }]);
    expect(ownsReferralTitle(granted.referralRewards)).toBe(true);
    expect(grantReferralReward(granted, 1, 'tutorial')).toBe(granted);
    expect(ITEMS[REFERRAL_BAG].bagSlots).toBe(
      Math.max(
        ...Object.values(ITEMS)
          .filter((i) => i.kind === 'bag' && !i.materialsOnly && i.id !== REFERRAL_BAG)
          .map((i) => i.bagSlots ?? 0),
      ),
    );
    for (const item of Object.values(REFERRAL_STAMP_ITEMS)) {
      expect(item).toMatchObject({
        soulbound: true,
        noVendorSell: true,
        noDiscard: true,
        noSalvage: true,
      });
    }
  });

  it('moves one card out of several while preserving the exact banked enchanted trinket', () => {
    let from = grantReferralReward(hollow(1), 2, 'tutorial');
    from = grantReferralReward(from, 2, 'hollow');
    from.activeTitle = REFERRAL_TITLE;
    const movedCharm = from.inventory.find((i) => i.instance?.referralLinkId === 1)!;
    movedCharm.instance!.enchant = 'test_enchant';
    from.bank = { inventory: [movedCharm], purchasedSlots: 0, bonusSlots: 0 };
    from.inventory = from.inventory.filter((i) => i !== movedCharm);
    const result = moveReferralRewards(from, blank(), 1);
    expect(result.from.referralRewards).toEqual({ '2': { redeemed: 3 } });
    expect(result.from.activeTitle).toBe(REFERRAL_TITLE);
    expect(result.from.inventory.find((i) => i.instance?.referralLinkId === 2)).toBeDefined();
    expect(result.to.inventory.find((i) => i.itemId === REFERRAL_HOLLOW_TRINKET)?.instance).toEqual(
      { referralLinkId: 1, enchant: 'test_enchant' },
    );
    expect(from.bank.inventory).toHaveLength(1);
    expect(result.from.bank?.inventory).toEqual([]);
  });

  it('removes a socketed bag and worn trinket and clears the final card title', () => {
    const from = hollow();
    from.bags = [REFERRAL_BAG, null, null, null];
    from.equipment.trinket = REFERRAL_HOLLOW_TRINKET;
    from.equipmentInstance = { trinket: { referralLinkId: 1 } };
    from.inventory = [];
    from.activeTitle = REFERRAL_TITLE;
    const result = moveReferralRewards(from, blank(), 1);
    expect(result.from.bags?.[0]).toBeNull();
    expect(result.from.equipment.trinket).toBeUndefined();
    expect(result.from.equipmentInstance?.trinket).toBeUndefined();
    expect(result.from.activeTitle).toBeUndefined();
    expect(result.to.inventory).toHaveLength(2);
  });

  it('refuses bag shrink or a full recipient without mutating either snapshot', () => {
    const from = grantReferralReward(blank(), 1, 'tutorial');
    from.inventory = Array.from({ length: 17 }, () => ({ itemId: 'forest_pelt', count: 1 }));
    from.bags = [REFERRAL_BAG];
    const prior = JSON.stringify(from);
    expect(() => moveReferralRewards(from, blank(), 1)).toThrow('capacity');
    expect(JSON.stringify(from)).toBe(prior);
    const full = blank();
    full.inventory = Array.from({ length: 16 }, () => ({ itemId: 'forest_pelt', count: 1 }));
    expect(() => moveReferralRewards(hollow(), full, 1)).toThrow('capacity');
    expect(full.inventory).toHaveLength(16);
  });

  it('checks bank socket capacity and refuses a missing linked trinket instead of taking another card copy', () => {
    const from = hollow();
    from.inventory = from.inventory.filter((item) => item.itemId !== REFERRAL_BAG);
    from.bank = {
      inventory: Array.from({ length: 25 }, () => ({ itemId: 'forest_pelt', count: 1 })),
      purchasedSlots: 0,
      bonusSlots: 0,
      unlockedSockets: 1,
      socketBags: [REFERRAL_BAG],
    };
    expect(() => moveReferralRewards(from, blank(), 1)).toThrow('capacity');
    from.bank.inventory = [];
    const moved = moveReferralRewards(from, blank(), 1);
    expect(moved.from.bank?.socketBags?.[0]).toBeNull();
    const corrupt = hollow();
    corrupt.inventory.find((item) => item.itemId === REFERRAL_HOLLOW_TRINKET)!.instance = {
      referralLinkId: 2,
    };
    expect(() => moveReferralRewards(corrupt, blank(), 1)).toThrow('missingReward');
    expect(corrupt.inventory).toHaveLength(2);
  });

  it('evolves only this card trinket in place, locks removal, trains riding, and grants its exclusive mount', () => {
    let state = hollow();
    state.equipment.trinket = REFERRAL_HOLLOW_TRINKET;
    state.equipmentInstance = { trinket: { referralLinkId: 1, enchant: 'test_enchant' } };
    state.inventory = state.inventory.filter((i) => i.itemId !== REFERRAL_HOLLOW_TRINKET);
    state = grantReferralReward(state, 1, 'fogbinder');
    expect(state.equipment.trinket).toBe(REFERRAL_FOG_TRINKET);
    expect(state.equipmentInstance?.trinket?.enchant).toBe('test_enchant');
    expect(() => removeReferralRewards(state, 1)).toThrow('locked');
    state = grantReferralReward(state, 1, 'gravewyrm');
    expect(state).toMatchObject({ ridingTrained: true, mountTrainingFeePaid: true, copper: 0 });
    state = grantReferralReward(state, 1, 'raid');
    expect(state.inventory.some((i) => i.itemId === REFERRAL_TANK_REINS)).toBe(true);
    expect(MOUNTS.referral_tank.moveSpeedPct).toBe(MOUNTS.terrorspark_groundshaker.moveSpeedPct);
  });

  it('grants inviter tiers once, with a distinct raptor and restored Sapling ownership', () => {
    const first = grantReferralInviterReward(blank(), 1);
    expect(first.inventory.map((i) => i.itemId)).toEqual([REFERRAL_RAPTOR_REINS]);
    expect(grantReferralInviterReward(first, 4)).toBe(first);
    const fifth = grantReferralInviterReward(first, 5);
    expect(fifth.buddies?.owned).toEqual(['sapling']);
    expect(BUDDIES.sapling).toBeDefined();
    expect(grantReferralInviterReward(fifth, 10)).toBe(fifth);
  });
});

describe('live referral reward behavior', () => {
  it('persists receipts and exact trinket provenance and permits the earned title after loading', () => {
    const { sim, pid, meta, player } = simWith(hollow());
    sim.setActiveTitle(REFERRAL_TITLE, pid);
    expect(player.title).toBe(REFERRAL_TITLE);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.referralRewards).toEqual(meta.referralRewards);
    expect(
      saved.inventory.find((i) => i.itemId === REFERRAL_HOLLOW_TRINKET)?.instance?.referralLinkId,
    ).toBe(1);
    expect(simWith(saved).player.title).toBe(REFERRAL_TITLE);
    const unearned = simWith(blank());
    unearned.sim.setActiveTitle(REFERRAL_TITLE, unearned.pid);
    expect(unearned.player.title).toBeNull();
  });

  it('raises the stated low-health shield at two health scales and respects its cooldown', () => {
    for (const level of [10, 20]) {
      const state = hollow();
      state.level = level;
      state.equipment.trinket = REFERRAL_HOLLOW_TRINKET;
      const { sim, player } = simWith(state);
      const maxHp = player.maxHp;
      player.hp = Math.floor(maxHp * 0.3);
      onTrinketDamage(sim.ctx, null, player, 1, 'physical', true, null);
      const shield = player.auras.find((a) => a.id === TRINKET_AURA.lastStand)!;
      expect(shield).toMatchObject({ value: Math.round(maxHp * 0.1), duration: 10, value2: 0.35 });
      expect(player.auras.find((a) => a.id === TRINKET_AURA.lastStandIcd)?.duration).toBe(120);
      player.auras = player.auras.filter((a) => a !== shield);
      onTrinketDamage(sim.ctx, null, player, 1, 'physical', true, null);
      expect(player.auras.some((a) => a.id === TRINKET_AURA.lastStand)).toBe(false);
    }
  });

  it('uses the evolved charm for five flat primary stats for 15 seconds on a 120-second cooldown', () => {
    const state = grantReferralReward(hollow(), 1, 'fogbinder');
    state.level = 13;
    state.equipment.trinket = REFERRAL_FOG_TRINKET;
    const { sim, pid, player } = simWith(state);
    sim.useItem(REFERRAL_FOG_TRINKET, pid);
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi']) {
      expect(player.auras.find((a) => a.id === `referral_friendship_${stat}`)).toMatchObject({
        kind: `buff_${stat}`,
        value: 5,
        duration: 15,
      });
    }
    expect(player.cooldowns.get(trinketCooldownKey(REFERRAL_FOG_TRINKET))).toBe(120);
    expect(sim.serializeCharacter(pid)!.cooldowns).toBeDefined();
  });

  it('applies and expires live primary stats without consuming a different seeded RNG tail', () => {
    const state = grantReferralReward(hollow(), 1, 'fogbinder');
    state.level = 13;
    state.equipment.trinket = REFERRAL_FOG_TRINKET;
    const used = simWith(structuredClone(state));
    const control = simWith(structuredClone(state));
    used.sim.useItem(REFERRAL_FOG_TRINKET, used.pid);
    used.sim.tick();
    control.sim.tick();
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
      expect(used.player.stats[stat]).toBe(control.player.stats[stat] + 5);
    }
    for (let tick = 0; tick < 300; tick++) {
      used.sim.tick();
      control.sim.tick();
    }
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
      expect(used.player.stats[stat]).toBe(control.player.stats[stat]);
    }
    expect(used.player.cooldowns.get(trinketCooldownKey(REFERRAL_FOG_TRINKET))).toBeCloseTo(
      104.95,
      5,
    );
    expect(used.sim.ctx.rng.next()).toBe(control.sim.ctx.rng.next());
  });

  it('projects only reward domains and refuses a stale inventory instead of overwriting passive loot', () => {
    const { sim, pid, meta, player } = simWith(blank());
    const before = sim.serializeCharacter(pid)!;
    const after = grantReferralReward(before, 1, 'tutorial');
    const hp = player.hp;
    expect(applyReferralRewardState(sim.ctx, pid, before, after)).toBe(true);
    expect(player.hp).toBe(hp);
    const next = grantReferralReward(after, 1, 'hollow');
    meta.inventory.push({ itemId: 'forest_pelt', count: 1 });
    expect(applyReferralRewardState(sim.ctx, pid, after, next)).toBe(false);
    expect(meta.inventory.some((i) => i.itemId === 'forest_pelt')).toBe(true);
  });
});
