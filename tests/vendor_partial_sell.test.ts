// The vendor PARTIAL sell summary (src/sim/items.ts sellItem): the one info
// line a mixed stack gets when the clamp sold fewer copies than were asked
// for.
//
// The clamp spares TWO classes of copy: a bound one (the Maker's Bond, never
// vendor-sellable) and a player-LOCKED one (issue 3042, sellable again the
// moment the owner unlocks it). Both are subtracted by the same expression,
// and the summary called every spared copy "bound", so a farmer who locked a
// stack was told their copies were bound to them: a different rule, with a
// different remedy (a bound copy needs the unbind fee ladder; a locked one
// needs one click).
//
// Driven through the real Sim at a real vendor, one arm per spared class plus
// the mixed case, so a future exclusion added to the clamp that forgets its
// own line reds here.

import { describe, expect, it } from 'vitest';
import * as items from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, InvSlot, SimEvent } from '../src/sim/types';

/** A plain, stackable, vendor-sellable id with no bind or quest rule of its own. */
const ITEM = 'wolf_fang';

function makeSim(seed = 11): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

/** Stand a player at Trader Wilkes so the vendor proximity gate passes
 *  (the items.test.ts / item_lock.test.ts vendorPlayer helper). */
function vendorPlayer(sim: Sim) {
  const pid = sim.addPlayer('warrior', 'Sellwright');
  const anySim = sim as unknown as { entities: Map<number, Entity>; rebucket(e: Entity): void };
  const wilkes = [...anySim.entities.values()].find(
    (e) => (e as unknown as { templateId?: string }).templateId === 'trader_wilkes',
  ) as Entity;
  const p = anySim.entities.get(pid) as Entity;
  p.pos.x = wilkes.pos.x + 2;
  p.pos.z = wilkes.pos.z;
  anySim.rebucket(p);
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('no seller meta');
  meta.inventory.length = 0;
  return { pid, meta };
}

/** Only the summary lines, in emit order. */
function keptLines(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot')
    .map((e) => e.text)
    .filter((text) => text.startsWith('Kept '));
}

function soldLines(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot')
    .map((e) => e.text)
    .filter((text) => text.startsWith('Sold '));
}

function held(meta: { inventory: InvSlot[] }): InvSlot[] {
  return meta.inventory.filter((s) => s.itemId === ITEM);
}

describe('the vendor partial-sell summary names the rule that spared each copy', () => {
  it('a LOCKED copy the clamp spared is reported as locked, never as bound', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: ITEM, count: 2 });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), ITEM, 3, pid);
    const events = sim.drainEvents();

    // Non-vacuity: the sale really happened and really was partial.
    expect(soldLines(events)).toHaveLength(1);
    expect(held(meta)).toHaveLength(1);
    expect(held(meta)[0].count).toBe(1);
    expect(keptLines(events)).toEqual(['Kept 1 locked copy.']);
  });

  it('pluralizes the locked line the same way the bound line does', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 2, instance: { locked: true } });
    meta.inventory.push({ itemId: ITEM, count: 1 });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), ITEM, 3, pid);

    expect(keptLines(sim.drainEvents())).toEqual(['Kept 2 locked copies.']);
  });

  it('a BOUND copy the clamp spared still reads bound', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { boundTo: pid } });
    meta.inventory.push({ itemId: ITEM, count: 2 });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), ITEM, 3, pid);
    const events = sim.drainEvents();

    expect(soldLines(events)).toHaveLength(1);
    expect(keptLines(events)).toEqual(['Kept 1 bound copy.']);
  });

  it('a stack holding both spared classes names each of them, once', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { boundTo: pid } });
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: ITEM, count: 2 });
    sim.drainEvents();

    // Ask for all four: the clamp spares the bound one and the locked one, so
    // the split is exact and both lines are owed.
    items.sellItem(ctxOf(sim), ITEM, 4, pid);
    const events = sim.drainEvents();

    expect(soldLines(events)).toHaveLength(1);
    expect(keptLines(events)).toEqual(['Kept 1 bound copy.', 'Kept 1 locked copy.']);
  });

  it('an ambiguous partial shortfall names the BOUND copy first', () => {
    // The tie-break the summary's own comment states ("the bound ones are named
    // first: they are the copies no click can free"), and the only case that can
    // see it. Every arm above asks for the whole stack, where the shortfall IS
    // boundHeld + lockedHeld and both counts are exact, so bound-first and
    // locked-first agree and neither attribution rule is under test.
    //
    // Here the ask stops one copy short of the spared pair, so the shortfall is
    // 1 while BOTH tallies are 1: a request is a count, not a slot pick, and the
    // two rules disagree. Without this arm the attribution could be inverted
    // (Math.min(lockedHeld, keptCount) instead of Math.min(boundHeld, ...)) with
    // the whole suite still green, which sends a player holding a bound copy to
    // the unlock click that cannot free it.
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { boundTo: pid } });
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: ITEM, count: 2 });
    sim.drainEvents();

    // Four held, two of them spared, three asked for: two sell and one is short.
    items.sellItem(ctxOf(sim), ITEM, 3, pid);
    const events = sim.drainEvents();

    expect(soldLines(events)).toHaveLength(1);
    expect(keptLines(events)).toEqual(['Kept 1 bound copy.']);
  });

  it('a clean sell of unlocked, unbound copies says nothing at all', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 3 });
    sim.drainEvents();

    items.sellItem(ctxOf(sim), ITEM, 3, pid);
    const events = sim.drainEvents();

    expect(soldLines(events)).toHaveLength(1);
    expect(keptLines(events)).toEqual([]);
  });

  it('a partial ask that clears the sellable pool exactly keeps nothing', () => {
    const sim = makeSim();
    const { pid, meta } = vendorPlayer(sim);
    meta.inventory.push({ itemId: ITEM, count: 1, instance: { locked: true } });
    meta.inventory.push({ itemId: ITEM, count: 2 });
    sim.drainEvents();

    // Two unlocked copies asked for, two sold: the locked copy was never in
    // the request, so nothing was "kept" from it.
    items.sellItem(ctxOf(sim), ITEM, 2, pid);
    const events = sim.drainEvents();

    expect(soldLines(events)).toHaveLength(1);
    expect(keptLines(events)).toEqual([]);
  });
});
