import { describe, expect, it } from 'vitest';
import { addStacked } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { isMaterialItemId } from '../src/sim/material_ids';
import { Sim } from '../src/sim/sim';
import { isStackProvenanceItemId } from '../src/sim/stack_provenance_ids';
import type { InvSlot } from '../src/sim/types';

const POTION = 'minor_healing_potion';
const mixed = (): InvSlot => ({
  itemId: POTION,
  count: 5,
  materialSources: [
    { source: { signer: 'Ana' }, count: 2 },
    { source: { signer: 'Bru' }, count: 3 },
  ],
});

function player(sim: Sim, pid: number) {
  const resolved = sim.ctx.resolve(pid);
  if (!resolved) throw new Error('missing test player');
  return resolved;
}

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const seller = sim.addPlayer('warrior', 'Seller');
  const buyer = sim.addPlayer('warrior', 'Buyer');
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  if (!merchant) throw new Error('missing merchant');
  for (const pid of [seller, buyer]) {
    const { meta, e } = player(sim, pid);
    meta.inventory = [];
    meta.copper = 100_000;
    e.pos = { ...merchant.pos };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  }
  return { sim, seller, buyer };
}

function seedEscrow(sim: Sim, seller: number) {
  sim.loadMarket({
    listings: [
      {
        ...mixed(),
        id: 900,
        sellerKey: String(seller),
        sellerName: 'Seller',
        price: 500,
        secondsLeft: 1000,
      },
    ],
    collections: [],
    nextListingId: 901,
  });
  const listing = sim.marketListings.find((row) => !row.house);
  if (!listing) throw new Error('mixed escrow did not load');
  expect(listing.materialSources).toEqual(mixed().materialSources);
  return listing;
}

describe('crafted consumables through real inventory lifecycle commands', () => {
  it.each([
    ['baked_bread', 'food'],
    ['spring_water', 'drink'],
    [POTION, 'potion'],
    ['elixir_of_the_bear', 'elixir'],
    ['ironhusk_flask', 'flask'],
    ['silverleaf_scroll', 'scroll'],
  ] as const)('stacks different makers for the shipped %s kind %s', (itemId, kind) => {
    expect(ITEMS[itemId].kind).toBe(kind);
    expect(isMaterialItemId(itemId)).toBe(false);
    expect(isStackProvenanceItemId(itemId)).toBe(true);
    const inventory: InvSlot[] = [];
    addStacked(inventory, itemId, 2, { signer: 'Ana' });
    addStacked(inventory, itemId, 3, { signer: 'Bru' });
    expect(inventory).toEqual([{ ...mixed(), itemId }]);
  });

  it('confirms both players and merges traded makers into a full recipient bag', () => {
    const { sim, seller, buyer } = setup();
    const giver = player(sim, seller).meta;
    const receiver = player(sim, buyer).meta;
    giver.inventory = [mixed()];
    receiver.bags = [null, null, null, null];
    receiver.inventory = [
      { itemId: POTION, count: 17, materialSources: [{ source: { signer: 'Cyd' }, count: 17 }] },
      ...Array.from({ length: 15 }, () => ({ itemId: 'worn_sword', count: 1 })),
    ];
    sim.tradeRequest(buyer, seller);
    sim.tradeAccept(buyer);
    sim.tradeSetOffer([{ itemId: POTION, count: 3 }], 0, seller);
    sim.tradeConfirm(seller);
    sim.tradeConfirm(buyer);
    expect(giver.inventory).toEqual([
      { itemId: POTION, count: 2, materialSources: [{ source: { signer: 'Bru' }, count: 2 }] },
    ]);
    expect(receiver.inventory).toHaveLength(16);
    expect(receiver.inventory[0]).toEqual({
      itemId: POTION,
      count: 20,
      materialSources: [
        { source: { signer: 'Ana' }, count: 2 },
        { source: { signer: 'Bru' }, count: 1 },
        { source: { signer: 'Cyd' }, count: 17 },
      ],
    });
    expect(sim.ctx.trades.size).toBe(0);
  });

  it('partially buys mixed escrow and returns exactly the unsold makers on cancellation', () => {
    const { sim, seller, buyer } = setup();
    const listing = seedEscrow(sim, seller);
    sim.marketBuy(listing.id, 3, buyer);
    expect(player(sim, buyer).meta.inventory).toEqual([
      {
        itemId: POTION,
        count: 3,
        materialSources: [
          { source: { signer: 'Ana' }, count: 2 },
          { source: { signer: 'Bru' }, count: 1 },
        ],
      },
    ]);
    expect(listing.count).toBe(2);
    expect(listing.materialSources).toEqual([{ source: { signer: 'Bru' }, count: 2 }]);
    const saved = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const restored = setup();
    expect(restored.seller).toBe(seller);
    restored.sim.loadMarket(saved);
    const reloaded = restored.sim.marketListings.find((row) => !row.house);
    if (!reloaded) throw new Error('partial listing disappeared on reload');
    restored.sim.marketCancel(reloaded.id, restored.seller);
    expect(player(restored.sim, restored.seller).meta.inventory).toEqual([
      { itemId: POTION, count: 2, materialSources: [{ source: { signer: 'Bru' }, count: 2 }] },
    ]);
    expect(restored.sim.marketListings.filter((row) => !row.house)).toEqual([]);
  });

  it('expires mixed escrow, reloads the collection and collects every maker intact', () => {
    const { sim, seller } = setup();
    const listing = seedEscrow(sim, seller);
    listing.expiresAt = sim.time - 1;
    for (let tick = 0; tick < 20; tick++) sim.tick();
    expect(sim.marketListings.filter((row) => !row.house)).toEqual([]);
    expect(sim.marketInfoFor(seller)?.collectionItems).toEqual([mixed()]);
    const restored = setup();
    expect(restored.seller).toBe(seller);
    restored.sim.loadMarket(JSON.parse(JSON.stringify(sim.serializeMarket())));
    expect(restored.sim.marketInfoFor(restored.seller)?.collectionItems).toEqual([mixed()]);
    restored.sim.marketCollect(restored.seller);
    expect(player(restored.sim, restored.seller).meta.inventory).toEqual([mixed()]);
    expect(restored.sim.marketInfoFor(restored.seller)?.collectionItems).toEqual([]);
  });
});
