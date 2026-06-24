// Delve Marks vendor (Brother Halven's shop): gate unlock logic + the
// server-authoritative buy path (gate + balance re-validated in the Sim).
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

// autoEquip:false so a bought wearable stays in the bags where we can count it
// (mirrors the chest-loot test in delves.test.ts).
const makeSim = (cls: PlayerClass = 'warrior', seed = 7) =>
  new Sim({ seed, playerClass: cls, autoEquip: false });
const metaOf = (sim: Sim) => (sim as any).players.get(sim.playerId);
const countOf = (sim: Sim, id: string) =>
  sim.inventory.filter((s) => s.itemId === id).reduce((n, s) => n + s.count, 0);

const shop = DELVE_SHOPS.collapsed_reliquary;
const availableEntry = shop.find((e) => e.gate === 'available')!;
const clearsEntry = shop.find((e) => e.gate === 'clears:3')!;
const heroicEntry = shop.find((e) => e.gate === 'heroicClear')!;

describe('delve shop, gate logic', () => {
  it('available is always open', () => {
    const sim = makeSim();
    expect(sim.delveShopGateMet(metaOf(sim), 'collapsed_reliquary', 'available')).toBe(true);
  });

  it('clears:N counts this delve at any difficulty (normal + heroic), not other delves', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(false);
    meta.delveClears['collapsed_reliquary:normal'] = 2;
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(true);
    // A different delve's clears must not bleed into this gate.
    meta.delveClears['collapsed_reliquary:normal'] = 0;
    meta.delveClears['collapsed_reliquary:heroic'] = 0;
    meta.delveClears['some_other_delve:normal'] = 9;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'clears:3')).toBe(false);
  });

  it('heroicClear needs at least one heroic completion', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveClears['collapsed_reliquary:normal'] = 5; // normal clears do not unlock it
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'heroicClear')).toBe(false);
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    expect(sim.delveShopGateMet(meta, 'collapsed_reliquary', 'heroicClear')).toBe(true);
  });
});

describe('delve shop, buying', () => {
  it('grants the item and debits Marks on a valid purchase', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = 100;
    const before = countOf(sim, availableEntry.itemId);
    sim.delveBuyShopItem('collapsed_reliquary', availableEntry.itemId);
    expect(countOf(sim, availableEntry.itemId) - before).toBe(1);
    expect(sim.delveMarks).toBe(100 - availableEntry.marks);
  });

  it('rejects when Marks are insufficient, no item, no debit', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = availableEntry.marks - 1;
    const before = countOf(sim, availableEntry.itemId);
    sim.delveBuyShopItem('collapsed_reliquary', availableEntry.itemId);
    expect(countOf(sim, availableEntry.itemId)).toBe(before);
    expect(sim.delveMarks).toBe(availableEntry.marks - 1);
  });

  it('rejects a locked clears:3 item until the clears requirement is met', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', clearsEntry.itemId);
    expect(countOf(sim, clearsEntry.itemId)).toBe(0);
    expect(sim.delveMarks).toBe(100); // gate blocks BEFORE any debit

    meta.delveClears['collapsed_reliquary:normal'] = 3;
    sim.delveBuyShopItem('collapsed_reliquary', clearsEntry.itemId);
    expect(countOf(sim, clearsEntry.itemId)).toBe(1);
    expect(sim.delveMarks).toBe(100 - clearsEntry.marks);
  });

  it('rejects a Heroic-gated rare until a heroic clear is recorded', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', heroicEntry.itemId);
    expect(countOf(sim, heroicEntry.itemId)).toBe(0);
    expect(sim.delveMarks).toBe(100);

    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    sim.delveBuyShopItem('collapsed_reliquary', heroicEntry.itemId);
    expect(countOf(sim, heroicEntry.itemId)).toBe(1);
    expect(sim.delveMarks).toBe(100 - heroicEntry.marks);
  });

  it('rejects an item that is not in the shop / wrong delve, no debit', () => {
    const sim = makeSim();
    metaOf(sim).delveMarks = 100;
    sim.delveBuyShopItem('collapsed_reliquary', 'worn_sword');
    sim.delveBuyShopItem('no_such_delve', availableEntry.itemId);
    expect(sim.delveMarks).toBe(100);
    expect(countOf(sim, 'worn_sword')).toBe(0);
  });
});

// The shop tab (hud.ts) renders from this IWorld view; the same resolver backs the
// online ClientWorld off its mirrored delveClears, so the lock badge it shows
// matches the gate the server-authoritative buy enforces.
describe('delve shop, delveShopOffers view', () => {
  it('mirrors the stock and resolves lock state + gate breakdown from clears', () => {
    const sim = makeSim();
    const offers = sim.delveShopOffers('collapsed_reliquary');
    expect(offers).toHaveLength(shop.length);

    const clearsOffer = offers.find((o) => o.itemId === clearsEntry.itemId)!;
    expect(clearsOffer.requiresClears).toBe(3);
    expect(clearsOffer.requiresHeroicClear).toBe(false);
    const heroicOffer = offers.find((o) => o.itemId === heroicEntry.itemId)!;
    expect(heroicOffer.requiresHeroicClear).toBe(true);
    expect(heroicOffer.requiresClears).toBe(0);

    // Fresh character: available open, gated entries locked.
    expect(offers.find((o) => o.itemId === availableEntry.itemId)?.unlocked).toBe(true);
    expect(clearsOffer.unlocked).toBe(false);
    expect(heroicOffer.unlocked).toBe(false);
  });

  it('unlocks gated offers once the clears requirement is met', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.delveClears['collapsed_reliquary:normal'] = 3;
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    const offers = sim.delveShopOffers('collapsed_reliquary');
    expect(offers.find((o) => o.itemId === clearsEntry.itemId)?.unlocked).toBe(true);
    expect(offers.find((o) => o.itemId === heroicEntry.itemId)?.unlocked).toBe(true);
  });

  it('returns an empty list for an unknown delve', () => {
    expect(makeSim().delveShopOffers('no_such_delve')).toEqual([]);
  });
});
