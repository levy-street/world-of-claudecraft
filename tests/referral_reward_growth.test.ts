import { describe, expect, it } from 'vitest';
import { BACKPACK_SLOTS, BAG_SOCKETS, stackSizeOf } from '../src/sim/bags';
import {
  BANK_BAG_SOCKETS,
  BANK_BASE_SLOTS,
  BANK_MAX_BONUS_SLOTS,
  BANK_PURCHASED_SLOTS_MAX,
} from '../src/sim/bank';
import type { CharacterState } from '../src/sim/character_state';
import { REFERRAL_BAG, REFERRAL_RAPTOR_REINS } from '../src/sim/content/referral_rewards';
import { ITEMS } from '../src/sim/data';
import { isMaterialItemId } from '../src/sim/material_ids';
import { referralRewardState } from '../src/sim/referral_reward_state';
import {
  grantReferralInviterReward,
  grantReferralReward,
  moveReferralRewards,
} from '../src/sim/referral_rewards';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Production referral link ids are account INT primary keys. Ten decimal digits
// are the widest live ids; the loader also preserves older wider safe integers.
const MAX_LINK_ID = 2_147_483_647;
const CARRIED = BACKPACK_SLOTS + BAG_SOCKETS * 16;
const BANK =
  BANK_BASE_SLOTS + BANK_PURCHASED_SLOTS_MAX + BANK_MAX_BONUS_SLOTS + BANK_BAG_SOCKETS * 16;
const SOCKETS = BAG_SOCKETS + BANK_BAG_SOCKETS;
const MAX_BAG_RECEIPTS = CARRIED + BANK + SOCKETS;

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

function fullCustody(withInviter = false): CharacterState {
  let state = withInviter ? grantReferralInviterReward(blank(), 5) : blank();
  state.bags = Array.from({ length: BAG_SOCKETS }, () => null);
  state.bank = {
    inventory: [],
    purchasedSlots: BANK_PURCHASED_SLOTS_MAX,
    bonusSlots: BANK_MAX_BONUS_SLOTS,
    unlockedSockets: BANK_BAG_SOCKETS,
    socketBags: Array.from({ length: BANK_BAG_SOCKETS }, () => null),
  };
  const receipts = MAX_BAG_RECEIPTS - (withInviter ? 1 : 0);
  for (let index = 0; index < receipts; index++) {
    state = grantReferralReward(state, MAX_LINK_ID - index, 'tutorial');
    // Place the granted copy in an ordinary legal socket/bank destination before
    // claiming the next one. No item or receipt is invented by this fixture.
    if (index < BAG_SOCKETS) {
      state.bags![index] = state.inventory.pop()!.itemId;
    } else if (index < SOCKETS) {
      state.bank!.socketBags![index - BAG_SOCKETS] = state.inventory.pop()!.itemId;
    } else if (index < SOCKETS + BANK) {
      state.bank!.inventory.push(state.inventory.pop()!);
    }
  }
  return state;
}

function roundTrip(state: CharacterState): CharacterState {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Custody', { state });
  return sim.serializeCharacter(pid)!;
}

describe('referral receipt growth follows permanent bag custody', () => {
  it('pins the physical bound and the restrictions that prevent a bag leaving custody', () => {
    expect([CARRIED, BANK, SOCKETS, MAX_BAG_RECEIPTS]).toEqual([80, 196, 8, 284]);
    expect(ITEMS[REFERRAL_BAG]).toMatchObject({
      kind: 'bag',
      bagSlots: 16,
      soulbound: true,
      noVendorSell: true,
      noDiscard: true,
      noMarketList: true,
      noSalvage: true,
    });
    expect(stackSizeOf(ITEMS[REFERRAL_BAG])).toBe(1);
    expect(isMaterialItemId(REFERRAL_BAG)).toBe(false);
  });

  it('retains all 284 earned receipts through load/save, rejects new claims and allows retry/move', () => {
    const state = fullCustody();
    expect(Object.keys(state.referralRewards!)).toHaveLength(284);
    expect(state.inventory).toHaveLength(80);
    expect(state.bank!.inventory).toHaveLength(196);
    const saved = roundTrip(state);
    expect(saved.referralRewards).toEqual(state.referralRewards);
    expect(roundTrip(saved)).toEqual(saved);
    expect(Buffer.byteLength(JSON.stringify(saved))).toBe(21685);
    expect(Buffer.byteLength(JSON.stringify(referralRewardState(saved)))).toBe(7973);
    expect(() => grantReferralReward(saved, MAX_LINK_ID - 284, 'tutorial')).toThrow('capacity');
    expect(grantReferralReward(saved, MAX_LINK_ID, 'tutorial')).toBe(saved);
    const before = JSON.stringify(saved);
    const moved = moveReferralRewards(saved, blank(), MAX_LINK_ID);
    expect(JSON.stringify(saved)).toBe(before);
    expect(Object.keys(moved.from.referralRewards!)).toHaveLength(283);
    expect(moved.from.inventory).toHaveLength(79);
    expect(moved.to.referralRewards).toEqual({ [MAX_LINK_ID]: { redeemed: 1 } });
    expect(moved.to.inventory).toEqual([{ itemId: REFERRAL_BAG, count: 1 }]);
    expect(roundTrip(moved.from).referralRewards).toEqual(moved.from.referralRewards);
    expect(roundTrip(moved.to).referralRewards).toEqual(moved.to.referralRewards);
    expect(
      Object.keys(grantReferralReward(moved.from, MAX_LINK_ID - 284, 'tutorial').referralRewards!),
    ).toHaveLength(284);
    process.stdout.write(
      `[referral-custody-growth] ${JSON.stringify({ receipts: 284, bytes: Buffer.byteLength(JSON.stringify(saved)), ledgerBytes: Buffer.byteLength(JSON.stringify(referralRewardState(saved))) })}\n`,
    );
  });

  it('retains the inviter mask and rewards beside 283 bags without exceeding custody', () => {
    const state = fullCustody(true);
    expect(Object.keys(state.referralRewards!)).toHaveLength(283);
    expect(state.inventory).toHaveLength(80);
    expect(state.inventory.filter((row) => row.itemId === REFERRAL_RAPTOR_REINS)).toEqual([
      { itemId: REFERRAL_RAPTOR_REINS, count: 1 },
    ]);
    expect(state.referralInviterRewards).toBe(3);
    const saved = roundTrip(state);
    expect(saved.referralRewards).toEqual(state.referralRewards);
    expect(saved.referralInviterRewards).toBe(3);
    expect(saved.buddies?.owned).toEqual(['sapling']);
    expect(grantReferralInviterReward(saved, 5)).toBe(saved);
    expect(roundTrip(saved)).toEqual(saved);
    expect(Buffer.byteLength(JSON.stringify(saved))).toBe(21780);
    expect(Buffer.byteLength(JSON.stringify(referralRewardState(saved)))).toBe(7972);
    process.stdout.write(
      `[referral-inviter-custody-growth] ${JSON.stringify({ receipts: 283, bytes: Buffer.byteLength(JSON.stringify(saved)), ledgerBytes: Buffer.byteLength(JSON.stringify(referralRewardState(saved))) })}\n`,
    );
  });

  it('measures the conservative widest receipt fields without clipping a recovered oversized save', () => {
    const state = {
      referralRewards: Object.fromEntries(
        Array.from({ length: MAX_BAG_RECEIPTS }, (_, index) => [
          MAX_LINK_ID - index,
          { redeemed: 31 },
        ]),
      ),
      referralInviterRewards: 31,
    };
    const receiptBytes = Buffer.byteLength(JSON.stringify(referralRewardState(state)));
    expect(receiptBytes).toBe(8285);
    // This is a field envelope, not a jointly reachable 284 fully completed cards:
    // their protected trinkets/reins would occupy additional physical slots.
    expect(referralRewardState(state)).toEqual(state);
    process.stdout.write(
      `[referral-receipt-envelope] ${JSON.stringify({ receiptBytes, rows: 284 })}\n`,
    );
    state.referralRewards[String(MAX_LINK_ID - 284)] = { redeemed: 31 };
    expect(Object.keys(referralRewardState(state).referralRewards!)).toHaveLength(285);
  });
});
