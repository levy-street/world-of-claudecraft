// A World Market browse row for a listed tracked (epic or legendary) copy
// carries its history as the public projection, so a buyer can weigh where
// the copy has been (docs/design/item-tracking.md). The record rides BESIDE
// the payload as MarketListingView.history, never inside `instance`: the
// display trim (publicInstanceView) is unchanged, so every payload equality,
// the escrow match, the collapse and the buy deliver exactly what they did.
// The guid, character ids and the parent guid never reach the row.

import { describe, expect, it } from 'vitest';
import { itemInstancePayloadsEqual } from '../src/sim/item_instance_merge';
import { publicInstanceView } from '../src/sim/item_instance_transfer';
import { publicProvenanceView } from '../src/sim/item_provenance';
import { defaultMarketQuery } from '../src/sim/market_query';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { marketListingItemHistory } from '../src/ui/market_view';

const EPIC = 'duskforged_warblade'; // epic, one per slot: tracked
const PLAIN = 'oiled_boots'; // never tracked

function makeWorld(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    lockoutNowMs: () => 1_700_000_000_000,
  });
}

function standAtMerchant(sim: Sim, pid: number): void {
  let m: Entity | undefined;
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') m = e;
  const e = sim.entities.get(pid);
  if (!m || !e) throw new Error('missing merchant or player');
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function bagCopy(sim: Sim, pid: number, itemId: string): ItemInstancePayload | undefined {
  return sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === itemId)?.instance;
}

function setup() {
  const sim = makeWorld();
  const seller = sim.addPlayer('warrior', 'Lister');
  const buyer = sim.addPlayer('mage', 'Buyer');
  for (const pid of [seller, buyer]) {
    standAtMerchant(sim, pid);
    sim.players.get(pid)!.copper = 1_000_000;
  }
  sim.addItem(EPIC, 1, seller);
  const full = bagCopy(sim, seller, EPIC);
  if (!full?.guid || !full.provenance) throw new Error('the epic copy was not tracked');
  // Give the record a parent so the projection's drop of derivedFrom is decisive.
  full.provenance.derivedFrom = '9b2e7c1a-5d34-4f6e-8a1b-2c3d4e5f6071';
  const listed = structuredClone(full);
  sim.marketListInstance(EPIC, 5000, listed, seller);
  sim.addItem(PLAIN, 1, seller);
  sim.marketList(PLAIN, 1, 300, seller);
  sim.drainEvents();
  return { sim, seller, buyer, full: structuredClone(full) };
}

describe('market browse rows: the tracked copy history', () => {
  it('a buyer reads the public projection beside an unchanged display trim', () => {
    const { sim, buyer, full } = setup();
    const rows = sim.marketInfoFor(buyer)?.listings ?? [];
    const epic = rows.find((l) => l.itemId === EPIC);
    const plain = rows.find((l) => l.itemId === PLAIN);
    expect(epic).toBeDefined();
    expect(epic?.history).toEqual(publicProvenanceView(full.provenance!));
    expect(epic?.history?.byId).toBeUndefined();
    expect(epic?.history?.derivedFrom).toBeUndefined();
    // The display trim is exactly what it was before: no identity fields ride it.
    expect(epic?.instance).toEqual(publicInstanceView(full));
    expect(epic?.instance && 'provenance' in epic.instance).toBe(false);
    expect(epic?.instance && 'guid' in epic.instance).toBe(false);
    // A plain row stays byte-identical: no history key at all.
    expect(plain).toBeDefined();
    expect(plain && 'history' in plain).toBe(false);
    const wire = JSON.stringify(rows);
    expect(wire).not.toContain(full.guid);
    expect(wire).not.toContain('"byId"');
    expect(wire).not.toContain('derivedFrom');
    // The window's door reads the same record (validated and re-projected).
    expect(marketListingItemHistory(epic!)).toEqual(epic?.history);
    expect(marketListingItemHistory(plain!)).toBeNull();
  });

  it('the seller sees the same public record on their own row', () => {
    const { sim, seller, full } = setup();
    const own = sim.marketInfoFor(seller)?.listings.find((l) => l.itemId === EPIC);
    expect(own?.mine).toBe(true);
    expect(own?.history).toEqual(publicProvenanceView(full.provenance!));
  });

  it('a collapsed browse keeps the tracked row and its history', () => {
    const { sim, buyer, full } = setup();
    sim.marketSearch({ ...defaultMarketQuery(), collapseLowest: true }, buyer);
    const epic = sim.marketInfoFor(buyer)?.listings.find((l) => l.itemId === EPIC);
    expect(epic?.history).toEqual(publicProvenanceView(full.provenance!));
  });
});

describe('escrow, buy and cancel are untouched by the history field', () => {
  it('the escrowed copy is the full payload, and the buy hands it over with one more hand', () => {
    const { sim, seller, buyer, full } = setup();
    const listing = sim.marketListings.find((l) => l.itemId === EPIC);
    // Escrow holds the whole copy (guid and full record), byte-equal to what was listed.
    expect(listing?.instance).toEqual(full);
    expect(itemInstancePayloadsEqual(listing!.instance!, full)).toBe(true);
    expect(bagCopy(sim, seller, EPIC)).toBeUndefined();
    sim.marketBuy(listing!.id, undefined, buyer);
    const errors = sim.drainEvents().filter((e) => e.type === 'error');
    expect(errors).toEqual([]);
    const got = bagCopy(sim, buyer, EPIC);
    expect(got?.guid).toBe(full.guid);
    expect(got?.provenance?.byId).toBe(full.provenance?.byId);
    expect(got?.provenance?.owners?.map((o) => o.by)).toEqual(['Buyer']);
    expect(got?.provenance?.transfers).toBe(1);
    expect(sim.marketListings.some((l) => l.itemId === EPIC)).toBe(false);
  });

  it('a cancel returns the byte-equal copy to the seller', () => {
    const { sim, seller, full } = setup();
    const listing = sim.marketListings.find((l) => l.itemId === EPIC);
    sim.marketCancel(listing!.id, seller);
    expect(bagCopy(sim, seller, EPIC)).toEqual(full);
  });
});

describe('marketListingItemHistory: the row door', () => {
  it('drops a malformed record and re-projects a private one', () => {
    expect(marketListingItemHistory({})).toBeNull();
    expect(
      marketListingItemHistory({ history: { at: 'x', by: 'A', source: 'world' } as never }),
    ).toBeNull();
    expect(
      marketListingItemHistory({
        history: {
          at: 5,
          by: 'A',
          byId: 9,
          source: 'world',
          owners: [{ at: 6, by: 'B', byId: 3 }],
        },
      }),
    ).toEqual({ at: 5, by: 'A', source: 'world', owners: [{ at: 6, by: 'B' }] });
  });
});
