import { describe, expect, it } from 'vitest';
import { ITEMS as REAL_ITEMS } from '../src/sim/data';
import {
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_RUNG_PRICES,
  GUILD_BANK_TREASURY_CAP,
  guildBankPipeRefusal,
} from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import {
  buildGuildBankView,
  clampGoldAmount,
  coinFieldsToCopper,
  type GuildBankItemLookup,
  guildBankGoldDepositMax,
  guildBankGoldWithdrawMax,
  guildBankSlotAction,
  guildBankSlotDormant,
} from '../src/ui/guild_bank_view';
import type { GuildBankInfo } from '../src/world_api';

// The guild bank core maps the proximity + rank gated GuildBankInfo snapshot
// (null for members, offline, away, dead, or an unloaded book) to the Guild
// tab's render model: slot rows with the DORMANT flag (the pipe-refused slots
// that must render visibly distinct, never hidden: the carried-forward Phase 3
// QA line), capacity, the raw-copper treasury with its purse-free action
// enablement, the expansion ladder price + affordability, and the slot click
// decision. Money stays raw copper here (the painter formats through the i18n
// formatMoney at the boundary); these tests pin that by asserting numbers.

// The def dimensions the client pipe predicate reads, plus quality for the tint.
const ITEMS: Record<
  string,
  { quality?: string; kind?: string; soulbound?: boolean; noMarketList?: boolean }
> = {
  sword: { quality: 'rare', kind: 'weapon' },
  potion: { quality: 'common', kind: 'potion' },
  relic: { quality: 'epic', kind: 'quest' },
  mark: { quality: 'rare', kind: 'tool', soulbound: true },
  riftplate: { quality: 'uncommon', kind: 'armor', noMarketList: true },
  bread: { kind: 'food' }, // quality-less -> 'common'
};
const lookup: GuildBankItemLookup = (id) => ITEMS[id];

// The default snapshot models an OPENED bank (rung 0 bought: purchasedSlots
// 24); the unopened-pane suite below overrides purchasedSlots to 0. The
// capacity field rides through verbatim (the core never recomputes it), so
// fixtures keep small capacities for compact empty-pad expectations.
function guildInfo(over: Partial<GuildBankInfo> = {}): GuildBankInfo {
  return {
    treasury: 25_000,
    slots: [],
    capacity: 12,
    purchasedSlots: 24,
    nextExpansionPrice: GUILD_BANK_RUNG_PRICES[1],
    ...over,
  };
}

describe('buildGuildBankView', () => {
  it('reports hidden from a null snapshot (member / offline / away / dead / unloaded book)', () => {
    expect(buildGuildBankView(null, lookup, 0)).toEqual({ kind: 'hidden' });
  });

  it('reports an empty guild bank with a full empty pad', () => {
    const view = buildGuildBankView(guildInfo({ capacity: 12 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.empty).toBe(true);
    expect(view.slots).toEqual([]);
    expect(view.capacity).toEqual({ used: 0, total: 12, purchasedSlots: 24 });
    expect(view.emptyCells).toBe(12);
    expect(view.hasDormant).toBe(false);
  });

  it('projects the grid preserving order, wire indices, counts, and quality', () => {
    const slots: InvSlot[] = [
      { itemId: 'sword', count: 1 },
      { itemId: 'potion', count: 5 },
      { itemId: 'bread', count: 3 },
    ];
    const view = buildGuildBankView(guildInfo({ slots, capacity: 12 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.slots.map((s) => s.slotIndex)).toEqual([0, 1, 2]);
    expect(view.slots.map((s) => s.itemId)).toEqual(['sword', 'potion', 'bread']);
    expect(view.slots.map((s) => s.showCount)).toEqual([false, true, true]);
    expect(view.slots.map((s) => s.qualityKey)).toEqual(['rare', 'common', 'common']);
    expect(view.slots.every((s) => s.known)).toBe(true);
    expect(view.emptyCells).toBe(9);
    expect(view.empty).toBe(false);
  });

  it('flags each pipe dimension dormant (quest / soulbound / noMarketList / transfer lock) and never drops a slot', () => {
    const slots: InvSlot[] = [
      { itemId: 'sword', count: 1 },
      { itemId: 'relic', count: 1 },
      { itemId: 'mark', count: 1 },
      { itemId: 'riftplate', count: 1 },
      { itemId: 'sword', count: 1, instance: { bindOnTrade: true } },
      { itemId: 'sword', count: 1, instance: { boundTo: 7 } },
    ];
    const view = buildGuildBankView(guildInfo({ slots, capacity: 12 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    // Every slot stays visible at its wire index: dormant slots are flagged,
    // NEVER filtered out (the personal bank drops unknown ids; this must not).
    expect(view.slots).toHaveLength(6);
    expect(view.slots.map((s) => s.dormant)).toEqual([false, true, true, true, true, true]);
    expect(view.hasDormant).toBe(true);
  });

  it('marks an unknown id (removed def) unknown but NOT dormant: the sim allows the recovery withdraw', () => {
    const view = buildGuildBankView(
      guildInfo({ slots: [{ itemId: 'gone_item', count: 2 }], capacity: 12 }),
      lookup,
      0,
    );
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.slots[0].known).toBe(false);
    expect(view.slots[0].dormant).toBe(false);
    expect(view.slots[0].qualityKey).toBe('common');
    expect(view.hasDormant).toBe(false);
  });

  it('a dormant slot whose ONLY lock was projected away renders as an ordinary slot (the wire hides bind identity by design)', () => {
    // The sim ships a pipe-refused slot through publicInstanceView, which strips
    // boundTo/bindOnTrade; the client cannot flag that copy and its withdraw
    // round-trips to the sim's localized refusal instead. Pin the projection
    // shape so a future publicInstanceView change re-opens this decision.
    const projected: InvSlot = { itemId: 'sword', count: 1, instance: { signer: 'Ada' } };
    const view = buildGuildBankView(guildInfo({ slots: [projected], capacity: 12 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.slots[0].dormant).toBe(false);
  });

  it('clamps the empty pad to zero for an over-capacity (tampered) book', () => {
    const slots: InvSlot[] = Array.from({ length: 14 }, () => ({ itemId: 'potion', count: 1 }));
    const view = buildGuildBankView(guildInfo({ slots, capacity: 12 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.capacity.used).toBe(14);
    expect(view.emptyCells).toBe(0);
  });

  it('keeps the treasury RAW COPPER and derives purse-free gold enablement', () => {
    const view = buildGuildBankView(guildInfo({ treasury: 123_456 }), lookup, 0);
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.treasury.copper).toBe(123_456);
    expect(view.treasury.canDepositGold).toBe(true);
    expect(view.treasury.canWithdrawGold).toBe(true);
  });

  it('disables withdraw at exactly zero treasury and deposit at exactly the cap', () => {
    const empty = buildGuildBankView(guildInfo({ treasury: 0 }), lookup, 0);
    if (empty.kind !== 'guild') throw new Error('expected guild');
    expect(empty.treasury.canWithdrawGold).toBe(false);
    expect(empty.treasury.canDepositGold).toBe(true);
    const capped = buildGuildBankView(guildInfo({ treasury: GUILD_BANK_TREASURY_CAP }), lookup, 0);
    if (capped.kind !== 'guild') throw new Error('expected guild');
    expect(capped.treasury.canDepositGold).toBe(false);
    expect(capped.treasury.canWithdrawGold).toBe(true);
    // One under the cap still deposits (the decisive boundary negative).
    const nearCap = buildGuildBankView(
      guildInfo({ treasury: GUILD_BANK_TREASURY_CAP - 1 }),
      lookup,
      0,
    );
    if (nearCap.kind !== 'guild') throw new Error('expected guild');
    expect(nearCap.treasury.canDepositGold).toBe(true);
  });

  it('carries the table price + block size and derives affordability both ways', () => {
    const price = GUILD_BANK_RUNG_PRICES[1]; // rung 1: the first treasury expansion
    const afford = buildGuildBankView(guildInfo({ treasury: price }), lookup, 0);
    if (afford.kind !== 'guild') throw new Error('expected guild');
    expect(afford.buy).toEqual({
      nextPrice: price,
      blockSlots: GUILD_BANK_EXPANSION_SLOTS,
      maxed: false,
      affordable: true, // exactly the price affords (the sim accepts equality)
    });
    const poor = buildGuildBankView(guildInfo({ treasury: price - 1 }), lookup, 0);
    if (poor.kind !== 'guild') throw new Error('expected guild');
    expect(poor.buy.affordable).toBe(false);
  });

  it('reports maxed once the ladder is exhausted (null price)', () => {
    const view = buildGuildBankView(
      guildInfo({
        nextExpansionPrice: null,
        purchasedSlots: 60,
        capacity: 60,
      }),
      lookup,
      0,
    );
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.buy.maxed).toBe(true);
    expect(view.buy.nextPrice).toBeNull();
    expect(view.buy.affordable).toBe(false);
    expect(view.capacity.purchasedSlots).toBe(60);
  });

  it('passes the per-copy instance payload through to the slot model (tooltip lines)', () => {
    const instance = { signer: 'Anna', rolled: { masterwork: true, stats: { str: 2 } } };
    const view = buildGuildBankView(
      guildInfo({ slots: [{ itemId: 'sword', count: 1, instance }] }),
      lookup,
      0,
    );
    if (view.kind !== 'guild') throw new Error('expected guild');
    expect(view.slots[0].instance).toBe(instance);
  });
});

describe('guildBankSlotDormant', () => {
  it('mirrors the sim pipe per dimension, and a plain copy is never dormant', () => {
    expect(guildBankSlotDormant({ itemId: 'sword' }, ITEMS.sword)).toBe(false);
    expect(guildBankSlotDormant({ itemId: 'relic' }, ITEMS.relic)).toBe(true);
    expect(guildBankSlotDormant({ itemId: 'mark' }, ITEMS.mark)).toBe(true);
    expect(guildBankSlotDormant({ itemId: 'riftplate' }, ITEMS.riftplate)).toBe(true);
    expect(
      guildBankSlotDormant({ itemId: 'sword', instance: { bindOnTrade: true } }, ITEMS.sword),
    ).toBe(true);
    expect(guildBankSlotDormant({ itemId: 'sword', instance: { boundTo: 3 } }, ITEMS.sword)).toBe(
      true,
    );
    // An unlocked instanced copy is not dormant.
    expect(
      guildBankSlotDormant({ itemId: 'sword', instance: { signer: 'Ada' } }, ITEMS.sword),
    ).toBe(false);
    // Unknown def: not dormant (the recovery withdraw is allowed), even locked
    // payloads still flag through the per-copy dimension.
    expect(guildBankSlotDormant({ itemId: 'gone' }, undefined)).toBe(false);
    expect(guildBankSlotDormant({ itemId: 'gone', instance: { boundTo: 3 } }, undefined)).toBe(
      true,
    );
  });
});

describe('guildBankSlotAction', () => {
  const stack: InvSlot = { itemId: 'potion', count: 5 };
  const single: InvSlot = { itemId: 'sword', count: 1 };
  const instanced: InvSlot = { itemId: 'sword', count: 3, instance: { signer: 'Ada' } };

  it('withdraws whole on a plain click', () => {
    expect(guildBankSlotAction(stack, 2, false, false)).toEqual({ kind: 'withdraw', slotIndex: 2 });
  });

  it('opens the split prompt on shift over a splittable fungible stack', () => {
    expect(guildBankSlotAction(stack, 1, true, false)).toEqual({
      kind: 'withdrawPartial',
      slotIndex: 1,
      max: 5,
    });
  });

  it('never splits a single count or an instanced stack (moves whole)', () => {
    expect(guildBankSlotAction(single, 0, true, false)).toEqual({
      kind: 'withdraw',
      slotIndex: 0,
    });
    expect(guildBankSlotAction(instanced, 3, true, false)).toEqual({
      kind: 'withdraw',
      slotIndex: 3,
    });
  });

  it('a DORMANT slot always sends the plain withdraw (round-tripping to the sim refusal), never the split prompt', () => {
    expect(guildBankSlotAction(stack, 1, true, true)).toEqual({ kind: 'withdraw', slotIndex: 1 });
    expect(guildBankSlotAction(stack, 1, false, true)).toEqual({ kind: 'withdraw', slotIndex: 1 });
  });

  it('an empty cell is a no-op', () => {
    expect(guildBankSlotAction(undefined, 9, false, false)).toEqual({ kind: 'none' });
  });
});

describe('gold prompt math', () => {
  it('composes coin fields with per-field floors and non-negative clamps', () => {
    expect(coinFieldsToCopper(2, 3, 45)).toBe(20_345);
    expect(coinFieldsToCopper(0, 0, 0)).toBe(0);
    expect(coinFieldsToCopper(1.9, -5, Number.NaN)).toBe(10_000); // floor, clamp, NaN->0
  });

  it('bounds a deposit by the purse and the treasury headroom', () => {
    expect(guildBankGoldDepositMax(50_000, 0)).toBe(50_000);
    expect(guildBankGoldDepositMax(50_000, GUILD_BANK_TREASURY_CAP - 10)).toBe(10);
    expect(guildBankGoldDepositMax(0, 0)).toBe(0);
    expect(guildBankGoldDepositMax(50_000, GUILD_BANK_TREASURY_CAP)).toBe(0);
  });

  it('bounds a withdraw by the treasury and the integer-safe purse headroom', () => {
    expect(guildBankGoldWithdrawMax(0, 70_000)).toBe(70_000);
    expect(guildBankGoldWithdrawMax(Number.MAX_SAFE_INTEGER - 5, 70_000)).toBe(5);
    expect(guildBankGoldWithdrawMax(Number.MAX_SAFE_INTEGER, 70_000)).toBe(0);
    expect(guildBankGoldWithdrawMax(0, 0)).toBe(0);
  });

  it('clamps a submit into (0, max] and refuses zero/negative/NaN with null', () => {
    expect(clampGoldAmount(500, 1_000)).toBe(500);
    expect(clampGoldAmount(2_000, 1_000)).toBe(1_000);
    expect(clampGoldAmount(0, 1_000)).toBeNull();
    expect(clampGoldAmount(-5, 1_000)).toBeNull();
    expect(clampGoldAmount(Number.NaN, 1_000)).toBeNull();
    expect(clampGoldAmount(500, 0)).toBeNull(); // no headroom at all refuses
  });
});

describe('dormant predicate parity with the sim pipe', () => {
  // The client predicate (guildBankSlotDormant) and the sim's withdraw gate
  // (guildBankPipeRefusal) must agree slot for slot, or the Guild tab renders
  // a withdrawable slot as locked (or a locked one as ordinary). Sweep the
  // WHOLE merged item table so a refusal dimension added to the sim on any
  // real def (the realistic content-update vector) fails here the day it
  // lands, plus the per-copy lock arms the def sweep cannot carry.
  it('agrees with guildBankPipeRefusal for every def in the merged item table', () => {
    let dormantDefs = 0;
    for (const id of Object.keys(REAL_ITEMS)) {
      const slot: InvSlot = { itemId: id, count: 1 };
      const refused = guildBankPipeRefusal(slot) !== null;
      // The client mirror is documented as the WITHDRAW-side predicate, and the
      // sim's refusal SET is claimed direction-independent, so sweep BOTH arms
      // over the whole table: a `dir`-conditional slipping into the refusal
      // decision (not just its wording) reddens here.
      expect(guildBankPipeRefusal(slot, 'withdraw') !== null, id).toBe(refused);
      if (refused) dormantDefs++;
      expect(guildBankSlotDormant(slot, REAL_ITEMS[id]), id).toBe(refused);
    }
    // Vacuity guard: the sweep must exercise REAL positives (the table carries
    // quest/soulbound/noMarketList defs); an all-false sweep proves nothing.
    expect(dormantDefs).toBeGreaterThan(0);
  });

  it('agrees on the per-copy transfer-lock arms and the unlocked instanced copy', () => {
    const plain = Object.keys(REAL_ITEMS).find(
      (id) => guildBankPipeRefusal({ itemId: id, count: 1 }) === null,
    ) as string;
    for (const instance of [{ boundTo: 3 }, { bindOnTrade: true as const }]) {
      const slot: InvSlot = { itemId: plain, count: 1, instance };
      expect(guildBankSlotDormant(slot, REAL_ITEMS[plain])).toBe(true);
      expect(guildBankPipeRefusal(slot)).not.toBeNull();
    }
    const signed: InvSlot = { itemId: plain, count: 1, instance: { signer: 'Ada' } };
    expect(guildBankSlotDormant(signed, REAL_ITEMS[plain])).toBe(false);
    expect(guildBankPipeRefusal(signed)).toBeNull();
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim would expose a cloned snapshot directly; a ClientWorld mirrors it
  // from a server snapshot (a JSON round-trip). Drive the model from both and
  // assert identical output (the bank_view parity idiom).
  it('derives an identical model from a Sim-shaped object and its JSON mirror', () => {
    const simInfo = guildInfo({
      treasury: 777_777,
      slots: [
        { itemId: 'sword', count: 1, instance: { signer: 'Ada' } },
        { itemId: 'potion', count: 9 },
        { itemId: 'mark', count: 1 },
      ],
      capacity: 30,
      purchasedSlots: 30,
      nextExpansionPrice: GUILD_BANK_RUNG_PRICES[2],
    });
    const cliInfo = JSON.parse(JSON.stringify(simInfo)) as GuildBankInfo;
    const simView = buildGuildBankView(simInfo, lookup, 0);
    const cliView = buildGuildBankView(cliInfo, lookup, 0);
    expect(cliView).toEqual(simView);
    if (simView.kind !== 'guild') throw new Error('expected guild');
    expect(simView.hasDormant).toBe(true); // the mark slot
  });

  it('derives an identical UNOPENED model from both shapes (the purse rides outside the wire)', () => {
    const simInfo = guildInfo({
      treasury: 4_242,
      slots: [],
      capacity: 0,
      purchasedSlots: 0,
      nextExpansionPrice: GUILD_BANK_RUNG_PRICES[0],
    });
    const cliInfo = JSON.parse(JSON.stringify(simInfo)) as GuildBankInfo;
    const simView = buildGuildBankView(simInfo, lookup, 100_000);
    const cliView = buildGuildBankView(cliInfo, lookup, 100_000);
    expect(cliView).toEqual(simView);
    expect(simView.kind).toBe('unopened');
  });
});

describe('the UNOPENED pane model (rung 0: purse-paid opening)', () => {
  const unopened = (over: Partial<GuildBankInfo> = {}) =>
    guildInfo({ capacity: 0, purchasedSlots: 0, nextExpansionPrice: 90_000, ...over });

  it('reports unopened (no grid) with rung 0 as the open price', () => {
    const view = buildGuildBankView(unopened(), lookup, 0);
    if (view.kind !== 'unopened') throw new Error('expected unopened');
    expect(view.open.price).toBe(90_000); // 9g, the rung-0 literal
  });

  it('treasury gold enablement works from day one, exactly like the opened pane', () => {
    const rich = buildGuildBankView(unopened({ treasury: 5_000 }), lookup, 0);
    if (rich.kind !== 'unopened') throw new Error('expected unopened');
    expect(rich.treasury.copper).toBe(5_000);
    expect(rich.treasury.canDepositGold).toBe(true);
    expect(rich.treasury.canWithdrawGold).toBe(true);
    const empty = buildGuildBankView(unopened({ treasury: 0 }), lookup, 0);
    if (empty.kind !== 'unopened') throw new Error('expected unopened');
    expect(empty.treasury.canWithdrawGold).toBe(false);
  });

  it('affordability reads the OFFICER PURSE (never the treasury), with the exact boundary', () => {
    // A treasury-rich guild does not make the opening affordable: rung 0 is
    // purse-paid.
    const poor = buildGuildBankView(unopened({ treasury: 10_000_000 }), lookup, 89_999);
    if (poor.kind !== 'unopened') throw new Error('expected unopened');
    expect(poor.open.affordable).toBe(false);
    // Exactly the price affords (the sim accepts equality).
    const exact = buildGuildBankView(unopened({ treasury: 0 }), lookup, 90_000);
    if (exact.kind !== 'unopened') throw new Error('expected unopened');
    expect(exact.open.affordable).toBe(true);
    // A fractional (hostile) purse floors before comparing.
    const frac = buildGuildBankView(unopened(), lookup, 89_999.9);
    if (frac.kind !== 'unopened') throw new Error('expected unopened');
    expect(frac.open.affordable).toBe(false);
  });

  it('an opened bank never yields the unopened kind (the 24-slot boundary)', () => {
    const opened = buildGuildBankView(
      guildInfo({ capacity: 24, purchasedSlots: 24, nextExpansionPrice: 25_000 }),
      lookup,
      0,
    );
    expect(opened.kind).toBe('guild');
  });
});
