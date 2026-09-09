// The unsettled gate, unit: what one holder's log contributes, how holders
// sum, which withdraws / gold withdraws / rung purchases that refuses (and
// which inadmissible shapes it leaves to the sim), and the dependency a
// refusal names for the flush. The server-level pins (the 2026-09-01
// two-material swap, the flush, the counter, the notice) live in
// tests/guild_bank_persistence.test.ts; the holder index and the coalesced
// flush in tests/guild_book_holders.test.ts.
import { describe, expect, it } from 'vitest';
import {
  contributesTo,
  deficitDependency,
  GUILD_BANK_GATED_OPS,
  type GuildBankOpRequest,
  guildBankUnsettledRefusal,
  holderContribution,
  isGuildBankGatedOp,
  sumContributions,
  unsettledGuildBook,
} from '../server/guild_bank_settle_gate';
import { type GuildBankOpDelta, guildBankDeltaIdentityKey } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import type { GuildBankInfo } from '../src/world_api';

const delta = (partial: Partial<GuildBankOpDelta> & { op: GuildBankOpDelta['op'] }) => ({
  itemId: null,
  count: null,
  instance: null,
  craftedRecipeId: null,
  copperDelta: 0,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 0,
  ...partial,
});
const deposit = (itemId: string, count: number, extra: Partial<GuildBankOpDelta> = {}) =>
  delta({ op: 'deposit', itemId, count, ...extra });
const withdraw = (itemId: string, count: number, extra: Partial<GuildBankOpDelta> = {}) =>
  delta({ op: 'withdraw', itemId, count, ...extra });
const gold = (copperDelta: number) =>
  delta({ op: copperDelta > 0 ? 'deposit_gold' : 'withdraw_gold', copperDelta });
const keyOf = (itemId: string, extra: Partial<GuildBankOpDelta> = {}) =>
  guildBankDeltaIdentityKey({
    itemId,
    instance: extra.instance ?? null,
    craftedRecipeId: extra.craftedRecipeId ?? null,
  });

function book(
  slots: InvSlot[],
  treasury = 0,
  purchasedSlots = 24,
  overrides: Partial<GuildBankInfo> = {},
): GuildBankInfo {
  return {
    treasury,
    slots,
    capacity: purchasedSlots,
    purchasedSlots,
    nextExpansionPrice: purchasedSlots === 0 ? 10_000 : 50_000,
    canEdit: true,
    ...overrides,
  };
}

const refusal = (
  op: (typeof GUILD_BANK_GATED_OPS)[number],
  request: GuildBankOpRequest,
  live: GuildBankInfo,
  logs: readonly (readonly GuildBankOpDelta[])[],
) => guildBankUnsettledRefusal(op, request, live, unsettledGuildBook(logs));

describe('holderContribution and the sum over holders', () => {
  it('nets item deltas per identity key within a log and keeps the positive nets', () => {
    const c = holderContribution([
      deposit('spider_leg', 20),
      withdraw('spider_leg', 5),
      deposit('venom_gland', 7),
      withdraw('wolf_fang', 3),
      delta({ op: 'admin_purge', itemId: 'venom_gland', count: 1 }),
    ]);
    expect([...c.items.entries()]).toEqual([
      [keyOf('spider_leg'), 15],
      [keyOf('venom_gland'), 6],
    ]);
    expect(c.copper).toBe(0);
    expect(c.ladder).toBe(false);
  });

  it("never lets one holder's removal hide another holder's deposit (positives per holder)", () => {
    // Holder B deposited 10, holder C withdrew 10 (of the durable copies): a
    // single net would read 0 and wave the acting officer through onto B's
    // unsettled copies. C's commit lowers durable, B's may never land.
    const u = unsettledGuildBook([[deposit('spider_leg', 10)], [withdraw('spider_leg', 10)]]);
    expect(u.items.get(keyOf('spider_leg'))).toBe(10);
    const g = unsettledGuildBook([[gold(10_000)], [gold(-10_000)]]);
    expect(g.copper).toBe(10_000);
    // A holder that is net-negative on its own contributes nothing.
    const n = holderContribution([deposit('spider_leg', 4), withdraw('spider_leg', 9), gold(-5)]);
    expect(n.items.size).toBe(0);
    expect(n.copper).toBe(0);
  });

  it('keeps the three identity dimensions apart (instance payload and craft provenance)', () => {
    const u = unsettledGuildBook([
      [deposit('iron_ore', 5, { instance: { signer: 'BigDamage' } })],
      [deposit('iron_ore', 5)],
      [deposit('iron_ore', 5, { craftedRecipeId: 'smelt_iron' })],
    ]);
    expect(u.items.size).toBe(3);
    for (const net of u.items.values()) expect(net).toBe(5);
  });

  it('nets treasury copper the replay would move within a log: gold both ways and buy_slots, never open_bank', () => {
    const c = holderContribution([
      gold(40_000),
      gold(-15_000),
      delta({
        op: 'buy_slots',
        copperDelta: -5_000,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 30,
      }),
    ]);
    expect(c.copper).toBe(20_000);
    expect(c.ladder).toBe(true);
    const opened = holderContribution([
      delta({ op: 'open_bank', copperDelta: -10_000, purchasedSlotsAfter: 24 }),
    ]);
    expect(opened.copper).toBe(0);
    expect(opened.ladder).toBe(true);
    expect(sumContributions([c, opened])).toEqual({
      items: new Map(),
      sourceUnits: new Map(),
      copper: 20_000,
      ladder: true,
    });
  });

  it('ignores a malformed item delta rather than keying on it', () => {
    const c = holderContribution([deposit('', 5), withdraw('wolf_fang', Number.NaN)]);
    expect(c.items.size).toBe(0);
  });
});

describe('guildBankUnsettledRefusal: withdraws', () => {
  const live = book([{ itemId: 'spider_leg', count: 20 }]);
  const legs = { kind: 'items', key: keyOf('spider_leg') } as const;

  it("refuses a withdraw of another session's unsettled stack, naming the identity", () => {
    expect(refusal('withdraw', { slot: 0 }, live, [[deposit('spider_leg', 20)]])).toEqual(legs);
  });

  it('passes the same withdraw once nothing is unsettled (the stack is durable)', () => {
    expect(refusal('withdraw', { slot: 0 }, live, [])).toBeNull();
    expect(refusal('withdraw', { slot: 0 }, live, [[deposit('venom_gland', 20)]])).toBeNull();
  });

  it('lets a PARTIAL withdraw through while it fits inside the settled copies', () => {
    // 30 live copies across two stacks, 20 of them unsettled: 10 are settled.
    const two = book([
      { itemId: 'spider_leg', count: 20 },
      { itemId: 'spider_leg', count: 10 },
    ]);
    const logs = [[deposit('spider_leg', 20)]];
    expect(refusal('withdraw', { slot: 0, count: 10 }, two, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: 11 }, two, logs)).toEqual(legs);
    // No count asked means the whole stack.
    expect(refusal('withdraw', { slot: 1 }, two, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0 }, two, logs)).toEqual(legs);
    // Release materials require an exact safe-integer take. A fractional
    // material request is refused by the sim without forcing a holder flush.
    expect(refusal('withdraw', { slot: 0, count: 10.9 }, two, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: 11.1 }, two, logs)).toBeNull();
  });

  it("is blind to another session's unsettled REMOVAL (the live count already reflects it)", () => {
    expect(refusal('withdraw', { slot: 0 }, live, [[withdraw('spider_leg', 20)]])).toBeNull();
  });

  it('matches on the full identity: a differently signed or crafted copy is a different key', () => {
    const signed = book([{ itemId: 'iron_ore', count: 5, instance: { signer: 'BigDamage' } }]);
    expect(refusal('withdraw', { slot: 0 }, signed, [[deposit('iron_ore', 5)]])).toBeNull();
    expect(
      refusal('withdraw', { slot: 0 }, signed, [
        [deposit('iron_ore', 5, { instance: { signer: 'BigDamage' } })],
      ]),
    ).toEqual({ kind: 'items', key: keyOf('iron_ore', { instance: { signer: 'BigDamage' } }) });
    const crafted = book([{ itemId: 'iron_ore', count: 5, craftedRecipeId: 'smelt_iron' }]);
    expect(refusal('withdraw', { slot: 0 }, crafted, [[deposit('iron_ore', 5)]])).toBeNull();
  });

  it('treats an instanced stack as moving whole, whatever count was asked', () => {
    const signed = book([{ itemId: 'iron_ore', count: 5, instance: { signer: 'BigDamage' } }]);
    const logs = [[deposit('iron_ore', 5, { instance: { signer: 'BigDamage' } })]];
    expect(refusal('withdraw', { slot: 0, count: 1 }, signed, logs)).toMatchObject({
      kind: 'items',
    });
  });

  it('passes every shape the sim refuses itself unjudged (missing slot, bad or over-stack count)', () => {
    const logs = [[deposit('spider_leg', 20)]];
    expect(refusal('withdraw', { slot: 7 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: -1 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0.5 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: 0 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: -3 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: Number.NaN }, live, logs)).toBeNull();
    // Over the stack: moveBetweenContainers refuses it as 'invalid'.
    expect(refusal('withdraw', { slot: 0, count: 21 }, live, logs)).toBeNull();
    expect(refusal('withdraw', { slot: 0, count: Number.MAX_SAFE_INTEGER }, live, logs)).toBeNull();
    expect(refusal('withdraw', {}, live, logs)).toBeNull();
  });
});

describe('guildBankUnsettledRefusal: gold and ladder rungs', () => {
  it('refuses a gold withdraw that exceeds the settled treasury', () => {
    const live = book([], 140_000);
    const logs = [[gold(40_000)]];
    expect(refusal('withdraw_gold', { amount: 100_000 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: 100_001 }, live, logs)).toEqual({ kind: 'copper' });
  });

  it("is blind to another session's unsettled gold WITHDRAW", () => {
    const live = book([], 60_000);
    expect(refusal('withdraw_gold', { amount: 60_000 }, live, [[gold(-40_000)]])).toBeNull();
  });

  it('passes every amount the sim refuses itself unjudged (non-positive, fractional, unsafe, over the treasury)', () => {
    const live = book([], 40_000);
    const logs = [[gold(40_000)]];
    expect(refusal('withdraw_gold', { amount: 0 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: -5 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: 100.5 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: Number.NaN }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: 2 ** 53 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', { amount: 40_001 }, live, logs)).toBeNull();
    expect(refusal('withdraw_gold', {}, live, logs)).toBeNull();
  });

  it('refuses a rung purchase while any rung is unsettled (the ladder is strictly ordered)', () => {
    const live = book([], 500_000, 24);
    const opened = [[delta({ op: 'open_bank', copperDelta: -10_000, purchasedSlotsAfter: 24 })]];
    expect(refusal('buy_slots', {}, live, opened)).toEqual({ kind: 'ladder' });
    expect(refusal('buy_slots', {}, live, [])).toBeNull();
  });

  it('refuses a treasury-paid rung the settled treasury cannot cover, but never a purse-paid opening', () => {
    // Rung 1+ costs nextExpansionPrice (50_000 here) from the treasury.
    const live = book([], 60_000, 24);
    expect(refusal('buy_slots', {}, live, [[gold(10_000)]])).toBeNull();
    expect(refusal('buy_slots', {}, live, [[gold(10_001)]])).toEqual({ kind: 'copper' });
    // Rung 0 opens the bank from the acting officer's own purse: no copper rule.
    const unopened = book([], 0, 0);
    expect(refusal('buy_slots', {}, unopened, [[gold(10_000)]])).toBeNull();
  });

  it('passes a rung the sim refuses itself unjudged (ladder finished, treasury short of the price)', () => {
    const done = book([], 500_000, 24, { nextExpansionPrice: null });
    expect(refusal('buy_slots', {}, done, [[gold(10_000)]])).toBeNull();
    const poor = book([], 40_000, 24);
    expect(refusal('buy_slots', {}, poor, [[gold(10_000)]])).toBeNull();
  });
});

describe('the dependency a refusal names, and who feeds it', () => {
  it('contributesTo matches the exact identity, any identity of an item, copper, or the ladder', () => {
    const c = holderContribution([
      deposit('iron_ore', 5, { instance: { signer: 'BigDamage' } }),
      gold(1),
      delta({ op: 'open_bank', copperDelta: -10_000, purchasedSlotsAfter: 24 }),
    ]);
    const signedKey = keyOf('iron_ore', { instance: { signer: 'BigDamage' } });
    expect(contributesTo(c, { kind: 'items', key: signedKey })).toBe(true);
    expect(contributesTo(c, { kind: 'items', key: keyOf('iron_ore') })).toBe(false);
    expect(contributesTo(c, { kind: 'items_of', itemId: 'iron_ore' })).toBe(true);
    expect(contributesTo(c, { kind: 'items_of', itemId: 'iron' })).toBe(false);
    expect(contributesTo(c, { kind: 'copper' })).toBe(true);
    expect(contributesTo(c, { kind: 'ladder' })).toBe(true);
    const plain = holderContribution([withdraw('wolf_fang', 2)]);
    expect(contributesTo(plain, { kind: 'copper' })).toBe(false);
    expect(contributesTo(plain, { kind: 'ladder' })).toBe(false);
    expect(contributesTo(plain, { kind: 'items_of', itemId: 'wolf_fang' })).toBe(false);
  });

  it('maps the escrow refusal deficit onto the same dependency vocabulary', () => {
    const base = { op: 'withdraw' as const, shortfall: 1, copperDelta: 0 };
    expect(deficitDependency({ ...base, kind: 'missing_items', itemId: 'spider_leg' })).toEqual({
      kind: 'items_of',
      itemId: 'spider_leg',
    });
    expect(deficitDependency({ ...base, kind: 'missing_items', itemId: null })).toBeNull();
    expect(deficitDependency({ ...base, kind: 'treasury_underflow', itemId: null })).toEqual({
      kind: 'copper',
    });
    expect(deficitDependency({ ...base, kind: 'treasury_overflow', itemId: null })).toEqual({
      kind: 'copper',
    });
    expect(deficitDependency({ ...base, kind: 'ladder_behind', itemId: null })).toEqual({
      kind: 'ladder',
    });
    expect(
      deficitDependency({ ...base, kind: 'source_unreadable', itemId: 'iron_ore' }),
    ).toBeNull();
    expect(deficitDependency(null)).toBeNull();
  });
});

describe('the gated op set', () => {
  it('gates withdraws, gold withdraws, and rung purchases; never deposits or the operator purge', () => {
    expect([...GUILD_BANK_GATED_OPS]).toEqual(['withdraw', 'withdraw_gold', 'buy_slots']);
    for (const op of ['deposit', 'deposit_gold', 'open_bank', 'admin_purge']) {
      expect(isGuildBankGatedOp(op)).toBe(false);
    }
  });
});
