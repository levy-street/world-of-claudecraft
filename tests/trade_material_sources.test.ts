// Material provenance across a REAL two-player trade, driven through the live
// Sim (no fake ctx): stage, confirm, remove, grant. These are the cases the
// program contract makes about trading material, asserted on the players' own
// bags rather than on any helper's return value.
//
// The invariant every case shares: units are conserved and so are their
// descriptors. A refused trade leaves both sides exactly as they were, and a
// completed one moves the exact buckets that were on the table.

import { describe, expect, it } from 'vitest';
// generalOnlyPools lives in bag_pools.ts and is NOT re-exported by bags.ts, so
// importing it from there resolved to undefined and the non-vacuity check threw
// instead of proving the receiver was full.
import { generalOnlyPools } from '../src/sim/bag_pools';
import { bagCapacity, countFit } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { MaterialSource, MaterialSourceCount } from '../src/sim/material_sources';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const MATERIAL = 'copper_ore';
const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 12, name: 'Bru' } };
const SIGNED: MaterialSource = { signer: 'Cyd' };
const NOBODY: MaterialSource = {};

const held = (source: MaterialSource, count: number): MaterialSourceCount => ({ source, count });

/** Distinct one-per-slot gear, for filling bags with something that is provably
 *  not a material (so a full-bag fixture never accidentally leaves material
 *  headroom through the second pool). */
const GEAR_IDS = Object.values(ITEMS)
  .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
  .map((d) => d.id);

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const a = sim.addPlayer('warrior', 'Ana');
  const b = sim.addPlayer('warrior', 'Bru');
  // Both sides start from a KNOWN bag, so every count below is exact rather
  // than "the starting kit plus whatever we added".
  sim.players.get(a)!.inventory.splice(0);
  sim.players.get(b)!.inventory.splice(0);
  // A trade needs both parties inside TRADE_RANGE; put them on one spot.
  sim.entities.get(b)!.pos = { ...sim.entities.get(a)!.pos };
  sim.entities.get(b)!.prevPos = { ...sim.entities.get(a)!.pos };
  return { sim, a, b };
}

const bagOf = (sim: Sim, pid: number): InvSlot[] => sim.players.get(pid)!.inventory;
const unitsOf = (sim: Sim, pid: number, itemId = MATERIAL): number =>
  bagOf(sim, pid)
    .filter((s) => s.itemId === itemId)
    .reduce((n, s) => n + s.count, 0);

function openTrade(sim: Sim, a: number, b: number): void {
  sim.tradeRequest(b, a);
  sim.tradeAccept(b);
}

/** Both sides confirm; the second confirm runs the swap. */
function confirmBoth(sim: Sim, a: number, b: number): void {
  sim.tradeConfirm(a);
  sim.tradeConfirm(b);
}

const errorsIn = (events: { type: string; text?: string }[]): string[] =>
  events.filter((e) => e.type === 'error').map((e) => e.text ?? '');

describe('trading material sources', () => {
  it('runs on a REAL material, so every case here exercises the source path', () => {
    expect(isMaterialItemId(MATERIAL)).toBe(true);
    expect(GEAR_IDS.filter((id) => isMaterialItemId(id))).toEqual([]);
  });

  it('moves a whole mixed stack with every bucket intact', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 2), held(ANA, 3)],
    });

    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 5 }], 0, a);
    confirmBoth(sim, a, b);

    // The giver is empty and the receiver holds the SAME buckets: five units
    // crossed, and so did the record of who gathered which of them.
    expect(bagOf(sim, a)).toEqual([]);
    expect(bagOf(sim, b)).toEqual([
      { itemId: MATERIAL, count: 5, materialSources: [held(NOBODY, 2), held(ANA, 3)] },
    ]);
  });

  it('spends unrecorded and gathered units before premium, leaving the signed unit home', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 2), held(ANA, 2), held(SIGNED, 1)],
    });

    openTrade(sim, a, b);
    // A COUNT-only offer: the automatic order decides which units, and the
    // premium unit is the last thing it spends.
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 3 }], 0, a);
    confirmBoth(sim, a, b);

    expect(bagOf(sim, b)).toEqual([
      { itemId: MATERIAL, count: 3, materialSources: [held(NOBODY, 2), held(ANA, 1)] },
    ]);
    // What stayed behind is exact too: the premium unit is untouched, and so is
    // the gathered unit the offer did not reach.
    // Bucket order is the ALGEBRA's canonical key order, not the order the
    // units were gathered or spent: a signer-only descriptor sorts ahead of a
    // gatherer-bearing one. The units and their counts are the claim.
    expect(bagOf(sim, a)).toEqual([
      { itemId: MATERIAL, count: 2, materialSources: [held(SIGNED, 1), held(ANA, 1)] },
    ]);
  });

  it('refuses an explicit empty staged composition without selecting replacement stock', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({ itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] });
    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 2 }], 0, a);
    const session = sim.ctx.trades.get(a)!;
    const offer = session.a === a ? session.offerA : session.offerB;
    expect(offer.items).toHaveLength(1);
    offer.items[0]!.materialSources = [];
    const beforeA = structuredClone(bagOf(sim, a));
    const beforeB = structuredClone(bagOf(sim, b));
    sim.drainEvents();
    confirmBoth(sim, a, b);
    expect(bagOf(sim, a)).toEqual(beforeA);
    expect(bagOf(sim, b)).toEqual(beforeB);
    expect(errorsIn(sim.drainEvents()).some((line) => line.startsWith('Trade failed:'))).toBe(true);
  });

  it('leaves BOTH sides untouched when the receiver cannot fit what they accepted', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 2), held(ANA, 3)],
    });
    // Fill the receiver's bags with distinct non-material gear: no free slot,
    // and no material stack to top up either. The capacity is READ, never
    // assumed, so a backpack resize cannot leave this fixture half full.
    const capacity = bagCapacity(sim.players.get(b)!.bags);
    for (let i = 0; bagOf(sim, b).length < capacity && i < GEAR_IDS.length; i++) {
      bagOf(sim, b).push({ itemId: GEAR_IDS[i], count: 1 });
    }
    // Non-vacuity: the receiver really has no room for even one unit, so the
    // refusal below can only be the capacity gate.
    expect(bagOf(sim, b)).toHaveLength(capacity);
    expect(countFit(bagOf(sim, b), generalOnlyPools(capacity), MATERIAL, 1)).toBe(0);
    const beforeA = structuredClone(bagOf(sim, a));
    const beforeB = structuredClone(bagOf(sim, b));

    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 5 }], 0, a);
    sim.drainEvents();
    confirmBoth(sim, a, b);

    expect(errorsIn(sim.drainEvents())).toContain('Trade failed: not enough bag space.');
    // The refusal is total on BOTH sides: no partial shipment, and the giver's
    // buckets are byte-identical to what they were before the attempt.
    expect(bagOf(sim, a)).toEqual(beforeA);
    expect(bagOf(sim, b)).toEqual(beforeB);
  });

  it('refuses when the staged sources changed under the offer, never retargeting', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 2), held(ANA, 3)],
    });

    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 5 }], 0, a);

    // The COUNT is unchanged, so the per-id coverage check still passes; only
    // the descriptors moved. Ana's three gathered units are gone.
    bagOf(sim, a).splice(0, bagOf(sim, a).length, {
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 5)],
    });
    const beforeA = structuredClone(bagOf(sim, a));
    sim.drainEvents();
    confirmBoth(sim, a, b);

    // Refused, not quietly re-aimed at five unrecorded units: the counterparty
    // agreed to Ana's gathered material, and substituting anonymous stock for
    // it is exactly the laundering provenance exists to prevent.
    expect(errorsIn(sim.drainEvents())).toContain(
      'Trade failed: items or money no longer available.',
    );
    expect(bagOf(sim, a)).toEqual(beforeA);
    expect(bagOf(sim, b)).toEqual([]);
  });

  it('cannot double-spend when one offer names the same material twice', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({
      itemId: MATERIAL,
      count: 5,
      materialSources: [held(NOBODY, 3), held(ANA, 2)],
    });
    const totalBefore = unitsOf(sim, a) + unitsOf(sim, b);

    openTrade(sim, a, b);
    // Two lines of the same item: they merge into ONE request for five, which
    // is exactly what is held. A path that staged each line separately would
    // try to spend the same buckets twice.
    sim.tradeSetOffer(
      [
        { itemId: MATERIAL, count: 3 },
        { itemId: MATERIAL, count: 2 },
      ],
      0,
      a,
    );
    confirmBoth(sim, a, b);

    // Conserved: five units existed before and five exist after, all on the
    // receiving side, with both buckets intact and neither duplicated.
    expect(unitsOf(sim, a) + unitsOf(sim, b)).toBe(totalBefore);
    expect(bagOf(sim, a)).toEqual([]);
    expect(bagOf(sim, b)).toEqual([
      { itemId: MATERIAL, count: 5, materialSources: [held(NOBODY, 3), held(ANA, 2)] },
    ]);
  });

  it('conserves both sides across a two-way material swap', () => {
    const { sim, a, b } = setup();
    bagOf(sim, a).push({ itemId: MATERIAL, count: 4, materialSources: [held(ANA, 4)] });
    bagOf(sim, b).push({ itemId: MATERIAL, count: 3, materialSources: [held(BRU, 3)] });

    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 4 }], 0, a);
    sim.tradeSetOffer([{ itemId: MATERIAL, count: 3 }], 0, b);
    confirmBoth(sim, a, b);

    // Each side ends holding exactly the other's units, still attributed to the
    // player who gathered them. Both removals run before either grant, so a
    // shared item id cannot bounce a stack back to its own owner.
    expect(bagOf(sim, a)).toEqual([
      { itemId: MATERIAL, count: 3, materialSources: [held(BRU, 3)] },
    ]);
    expect(bagOf(sim, b)).toEqual([
      { itemId: MATERIAL, count: 4, materialSources: [held(ANA, 4)] },
    ]);
  });
});
