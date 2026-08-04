// The operator projection behind GET /admin/api/guilds/:id/bank
// (server/admin_guild_bank_view.ts). Two claims carry this module, and each is
// pinned against the REAL sim rather than against itself:
//   1. AGREEMENT: a slot this view marks dormant is exactly a slot the escape
//      hatch (purgeDormantGuildBankSlot) will remove, and one it does not mark
//      is one the hatch refuses. An operator who purges what the panel showed
//      them must never get "that slot is not a stuck item" back.
//   2. THE BOUNDARY: the source snapshot deliberately keeps the real per-copy
//      instance payload (the purge's ledger row needs it as evidence), so this
//      projection is where another character's bind identity is dropped.
import { describe, expect, it } from 'vitest';
import { adminGuildBankView } from '../../server/admin_guild_bank_view';
import { ITEMS } from '../../src/sim/data';
import { Sim } from '../../src/sim/sim';
import type { InvSlot } from '../../src/sim/types';
import type { GuildBankInfo } from '../../src/world_api';

const GUILD_ID = 4242;

// One slot per refusal dimension the anonymous-pipe policy has, matching the
// hatch's own coverage in tests/guild_bank.test.ts.
const SOULBOUND = 'reins_grag_bear';
const NO_MARKET = 'riding_training';
const PLAIN = 'wolf_fang';

function questItemId(): string {
  const id = Object.keys(ITEMS).find((key) => ITEMS[key]?.kind === 'quest');
  if (!id) throw new Error('no quest item in the merged table');
  return id;
}

/** A sim holding ONE guild book, with no player, banker, or rank setup: the
 *  operator read is ungated by design, so none of that is needed here. */
function simWithBook(slots: InvSlot[], treasury = 100_000, purchasedSlots = 24): Sim {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false });
  sim.loadGuildBank(GUILD_ID, { treasury, inventory: slots, purchasedSlots });
  return sim;
}

function viewOf(sim: Sim) {
  const info = sim.guildBankInfoForGuild(GUILD_ID);
  if (!info) throw new Error('missing guild book');
  return adminGuildBankView(info);
}

describe('adminGuildBankView (the operator projection)', () => {
  it('carries the header the panel renders, with the derived used / dormant counts', () => {
    const sim = simWithBook(
      [
        { itemId: PLAIN, count: 3 },
        { itemId: SOULBOUND, count: 1 },
        { itemId: NO_MARKET, count: 2 },
      ],
      123_456,
      30,
    );
    expect(viewOf(sim)).toEqual({
      treasury: 123_456,
      capacity: 30,
      purchasedSlots: 30,
      usedSlots: 3,
      dormantSlots: 2,
      slots: [
        { index: 0, itemId: PLAIN, count: 3, dormant: false },
        { index: 1, itemId: SOULBOUND, count: 1, dormant: true },
        { index: 2, itemId: NO_MARKET, count: 2, dormant: true },
      ],
    });
  });

  it('marks every refusal dimension dormant and an ordinary copy not', () => {
    const sim = simWithBook([
      { itemId: PLAIN, count: 3 },
      { itemId: SOULBOUND, count: 1 },
      { itemId: NO_MARKET, count: 1 },
      { itemId: questItemId(), count: 1 },
      { itemId: PLAIN, count: 1, instance: { boundTo: 424_242 } },
      { itemId: PLAIN, count: 1, instance: { bindOnTrade: true } },
    ]);
    expect(viewOf(sim).slots.map((slot) => slot.dormant)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(viewOf(sim).dormantSlots).toBe(5);
  });

  it('AGREES with the escape hatch slot for slot (the whole point of the read)', () => {
    // Decisive: drive the real purge at every index of one book on a FRESH sim
    // each time (a purge splices), and require the outcome to match the flag the
    // panel showed. A view that over-marked would send an operator into a
    // "not a stuck item" refusal; one that under-marked would hide the very slot
    // that is blocking the guild's disband.
    const slots: InvSlot[] = [
      { itemId: PLAIN, count: 3 },
      { itemId: SOULBOUND, count: 1 },
      { itemId: PLAIN, count: 1, instance: { boundTo: 7 } },
      { itemId: NO_MARKET, count: 1 },
      { itemId: PLAIN, count: 1 },
    ];
    const flags = viewOf(simWithBook(slots)).slots.map((slot) => slot.dormant);
    expect(flags).toEqual([false, true, true, true, false]); // not a self-comparison
    for (const [index, dormant] of flags.entries()) {
      const sim = simWithBook(slots.map((slot) => structuredClone(slot)));
      const removed = sim.purgeDormantGuildBankSlot(GUILD_ID, index, slots[index].itemId);
      expect(removed !== null, `slot ${index}`).toBe(dormant);
    }
  });

  it('DROPS the per-copy instance payload: no bind identity reaches an operator', () => {
    // The source read is deliberately UNprojected (the ledger row keeps the real
    // payload as evidence), so this projection is the boundary. Nothing
    // account-scoped may ride the wire to the dashboard.
    const sim = simWithBook([
      { itemId: PLAIN, count: 1, instance: { boundTo: 424_242, bindOnTrade: true } },
    ]);
    // Positive control: the payload really IS on the snapshot this view reads.
    expect(sim.guildBankInfoForGuild(GUILD_ID)?.slots[0].instance).toEqual({
      boundTo: 424_242,
      bindOnTrade: true,
    });
    const view = viewOf(sim);
    expect(Object.keys(view.slots[0]).sort()).toEqual(['count', 'dormant', 'index', 'itemId']);
    expect(JSON.stringify(view)).not.toContain('424242');
    expect(JSON.stringify(view)).not.toContain('boundTo');
  });

  it('projects an empty and an unopened book without inventing slots', () => {
    const empty = adminGuildBankView({
      treasury: 0,
      slots: [],
      capacity: 0,
      purchasedSlots: 0,
      nextExpansionPrice: 90_000,
    } satisfies GuildBankInfo);
    expect(empty).toEqual({
      treasury: 0,
      capacity: 0,
      purchasedSlots: 0,
      usedSlots: 0,
      dormantSlots: 0,
      slots: [],
    });
  });

  it('keeps the index it hands out equal to the live book index (the purge argument)', () => {
    // The itemId confirmation token only helps if the index beside it is the
    // real one: a purge at index n must remove the slot the panel showed at n.
    const sim = simWithBook([
      { itemId: PLAIN, count: 1 },
      { itemId: SOULBOUND, count: 1 },
      { itemId: NO_MARKET, count: 1 },
    ]);
    const dormantRow = viewOf(sim).slots.find((slot) => slot.itemId === NO_MARKET);
    if (!dormantRow) throw new Error('expected the noMarketList row');
    expect(dormantRow.index).toBe(2);
    const removed = sim.purgeDormantGuildBankSlot(GUILD_ID, dormantRow.index, dormantRow.itemId);
    expect(removed).toEqual({ itemId: NO_MARKET, count: 1 });
    expect(viewOf(sim).slots.map((slot) => slot.itemId)).toEqual([PLAIN, SOULBOUND]);
  });
});
