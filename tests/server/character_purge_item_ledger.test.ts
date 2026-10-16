// The tracked-item end of a deleted character's WORLD STATE
// (server/character_purge_item_ledger.ts): the post-delete purge destroys the
// character's World Market listings and collection and its homeless
// Ravenpost letters, none of which the stored character row (and so the
// delete's own consume rows) ever held. Pins: the real Sim purges report
// exactly the copies they destroyed (a returned letter's copy flies home and
// is NOT among them), the one multi-row INSERT those copies become, and the
// writer's audit-twin posture (nothing issued for no tracked copy, a refusal
// logs and resolves 0).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; the writer module imports it, so set a dummy URL. The pool never
// connects: every write here goes to a fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase12_units';

import { describe, expect, it, vi } from 'vitest';
import { CHARACTER_DELETE_ITEM_SOURCE } from '../../server/character_delete_item_ledger';
import {
  emptyPurgedCharacterHoldings,
  purgedHoldingsLedgerInsert,
  recordPurgedCharacterCopies,
} from '../../server/character_purge_item_ledger';
import { HOARD_REWARD_LETTER } from '../../src/sim/content/letters';
import { isItemGuid } from '../../src/sim/item_provenance';
import { Sim } from '../../src/sim/sim';
import type { InvSlot, ItemInstancePayload } from '../../src/sim/types';

const EPIC_WEAPON = 'duskforged_warblade'; // epic, market-listable: tracked
const EPIC_ARMOR = 'crownforged_dreadhelm'; // epic: tracked
const PLAIN = 'wolf_fang'; // never tracked
const DOOMED_ID = 77;
const DOOMED = { key: String(DOOMED_ID), name: 'Doomed' };

function makeWorld(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    lockoutNowMs: () => 1_700_000_000_000,
  });
}

/** A freshly minted tracked copy of `itemId`, lifted out of a holder's bags. */
function trackedCopy(sim: Sim, pid: number, itemId: string): ItemInstancePayload {
  sim.addItem(itemId, 1, pid);
  const meta = sim.players.get(pid);
  const index = meta?.inventory.findIndex((s) => s.itemId === itemId) ?? -1;
  const slot = meta?.inventory[index];
  if (!meta || !slot?.instance || !isItemGuid(slot.instance.guid)) {
    throw new Error(`${itemId} was not tracked`);
  }
  meta.inventory.splice(index, 1);
  return slot.instance;
}

describe('the real purges report what they destroyed', () => {
  it('purgeMarketSeller hands over the listing escrow and the collection', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const listed = trackedCopy(sim, seller, EPIC_WEAPON);
    const collected = trackedCopy(sim, seller, EPIC_ARMOR);
    // Seeded straight into the books (the market.test.ts purge idiom): a
    // tracked instanced listing and a collection holding a returned copy.
    sim.marketListings.push({
      id: 990001,
      sellerKey: DOOMED.key,
      sellerName: DOOMED.name,
      itemId: EPIC_WEAPON,
      count: 1,
      price: 5000,
      expiresAt: Infinity,
      house: false,
      instance: listed,
    });
    (
      sim.market as unknown as {
        marketCollections: Map<string, { copper: number; items: InvSlot[] }>;
      }
    ).marketCollections.set(DOOMED.key, {
      copper: 10,
      items: [
        { itemId: EPIC_ARMOR, count: 1, instance: collected },
        { itemId: PLAIN, count: 2 },
      ],
    });
    const holdings = emptyPurgedCharacterHoldings();
    expect(sim.purgeMarketSeller(DOOMED_ID, DOOMED.name, holdings.market)).toBe(true);
    expect(holdings.market.map((s) => s.instance?.guid)).toEqual([
      listed.guid,
      collected.guid,
      undefined,
    ]);
    const insert = purgedHoldingsLedgerInsert('Claudemoon', 9, DOOMED.name, holdings);
    expect(insert?.count).toBe(2);
    expect(insert?.values).toEqual([
      'Claudemoon',
      9,
      DOOMED.name,
      CHARACTER_DELETE_ITEM_SOURCE,
      [listed.guid, collected.guid],
      [EPIC_WEAPON, EPIC_ARMOR],
      ['epic', 'epic'],
      ['market', 'market'],
    ]);
  });

  it('purgeMailOwner hands over a homeless parcel, never a letter that flies home', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice', { characterId: 88 });
    const homeless = trackedCopy(sim, alice, EPIC_WEAPON);
    const fliesHome = trackedCopy(sim, alice, EPIC_ARMOR);
    // A system parcel: minted by the world, no live sender, deleted with the
    // mailbox. A player parcel from a live sender: returned, so its copy lives.
    expect(
      sim.mailSystemParcel(DOOMED, HOARD_REWARD_LETTER, [
        { itemId: EPIC_WEAPON, count: 1, instance: homeless },
      ]),
    ).toBe(true);
    const meta = sim.players.get(alice);
    if (!meta) throw new Error('no meta');
    meta.copper = 100_000;
    sim.addItem(PLAIN, 1, alice);
    const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
    const sender = sim.entities.get(alice);
    if (!box || !sender) throw new Error('missing mailbox or sender');
    sender.pos = { ...box.pos };
    sender.prevPos = { ...sender.pos };
    sim.rebucket(sender);
    sim.mailSendResolved(DOOMED, 'Parcel', 'Hold this.', 500, [{ itemId: PLAIN, count: 1 }], alice);
    const parcel = sim.postOffice.mail.find((m) => m.subject === 'Parcel');
    if (!parcel) throw new Error('parcel missing');
    parcel.items = [{ itemId: EPIC_ARMOR, count: 1, instance: fliesHome }];

    const holdings = emptyPurgedCharacterHoldings();
    expect(sim.purgeMailOwner(DOOMED_ID, DOOMED.name, holdings.mail)).toBe(true);
    expect(parcel.returned).toBe(true);
    expect(holdings.mail.map((s) => s.instance?.guid)).toEqual([homeless.guid]);
    const insert = purgedHoldingsLedgerInsert('Claudemoon', 9, DOOMED.name, holdings);
    expect(insert?.values.slice(4)).toEqual([[homeless.guid], [EPIC_WEAPON], ['epic'], ['mail']]);
  });

  it('the sinks are optional: a purge without one still purges', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const listed = trackedCopy(sim, seller, EPIC_WEAPON);
    sim.marketListings.push({
      id: 990002,
      sellerKey: DOOMED.key,
      sellerName: DOOMED.name,
      itemId: EPIC_WEAPON,
      count: 1,
      price: 5000,
      expiresAt: Infinity,
      house: false,
      instance: listed,
    });
    expect(sim.purgeMarketSeller(DOOMED_ID, DOOMED.name)).toBe(true);
    expect(sim.marketListings.some((l) => l.id === 990002)).toBe(false);
  });
});

describe('purgedHoldingsLedgerInsert', () => {
  it('answers null when the purge destroyed no tracked copy', () => {
    const holdings = emptyPurgedCharacterHoldings();
    holdings.market.push({ itemId: PLAIN, count: 3 });
    holdings.mail.push({ itemId: EPIC_WEAPON, count: 1, instance: { guid: 'not-a-uuid' } });
    expect(purgedHoldingsLedgerInsert('Claudemoon', 9, 'Doomed', holdings)).toBeNull();
  });

  it('is the delete-time consume INSERT: NULL character, the account kept', () => {
    const holdings = emptyPurgedCharacterHoldings();
    holdings.mail.push({
      itemId: EPIC_WEAPON,
      count: 1,
      instance: { guid: '11111111-1111-4111-8111-111111111111' },
    });
    const insert = purgedHoldingsLedgerInsert('Claudemoon', 9, 'Doomed', holdings);
    expect(insert?.text).toContain("'consume', NULL, $2");
    expect(insert?.values[1]).toBe(9);
    expect(insert?.values[3]).toBe('characterDelete');
  });
});

describe('recordPurgedCharacterCopies', () => {
  const G1 = '11111111-1111-4111-8111-111111111111';
  const G2 = '22222222-2222-4222-8222-222222222222';

  it('writes one INSERT for every tracked copy and resolves the row count', async () => {
    const db = { query: vi.fn(async () => ({ rowCount: 2 })) };
    const holdings = {
      market: [{ itemId: EPIC_WEAPON, count: 1, instance: { guid: G1 } }],
      mail: [
        { itemId: EPIC_ARMOR, count: 1, instance: { guid: G2 } },
        { itemId: PLAIN, count: 1 },
      ],
    };
    await expect(recordPurgedCharacterCopies(9, 'Doomed', holdings, db)).resolves.toBe(2);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [, values] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(values.slice(1)).toEqual([
      9,
      'Doomed',
      'characterDelete',
      [G1, G2],
      [EPIC_WEAPON, EPIC_ARMOR],
      ['epic', 'epic'],
      ['market', 'mail'],
    ]);
  });

  it('issues nothing when no tracked copy was destroyed', async () => {
    const db = { query: vi.fn(async () => ({})) };
    await expect(
      recordPurgedCharacterCopies(9, 'Doomed', emptyPurgedCharacterHoldings(), db),
    ).resolves.toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('a refused insert logs and resolves 0, never rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('violates check'), { code: '23514' });
      }),
    };
    const holdings = {
      market: [{ itemId: EPIC_WEAPON, count: 1, instance: { guid: G1 } }],
      mail: [],
    };
    await expect(recordPurgedCharacterCopies(9, 'Doomed', holdings, db)).resolves.toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
