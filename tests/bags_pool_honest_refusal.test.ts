// The pool-honest "bags are full" refusal (issue #3795): with a materials-only
// satchel equipped, the general pool can be full while the summed counter and
// the grid still show free squares. Refusing a non-material with "Your bags
// are full." then contradicts what the player sees, so the shared rejection
// (src/sim/bags.ts bagsFullError) names the materials-only headroom instead.
import { describe, expect, it } from 'vitest';
import { bagCapacity, bagsFullError } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const ONLY_MATERIALS = 'Only materials fit in the space left in your bags.';
const FULL = 'Your bags are full.';
const SATCHEL = 'burlap_reagent_pouch'; // 8-slot materialsOnly satchel

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior' as never, autoEquip: false });
const meta = (sim: Sim) =>
  (sim as never as { players: Map<number, never> }).players.get(sim.playerId)! as {
    inventory: InvSlot[];
    bags: (string | null)[];
  };
const errors = (sim: Sim): string[] =>
  sim
    .drainEvents()
    .filter((e) => e.type === 'error')
    .map((e) => (e as { text: string }).text);

/** Fill the GENERAL pool with never-stacking gear, leaving the satchel's
 *  materials headroom untouched. */
function fillGeneral(sim: Sim): void {
  const m = meta(sim);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  const general = bagCapacity(m.bags) - 8;
  let i = 0;
  while (m.inventory.length < general) sim.addItem(gearIds[i++ % gearIds.length], 1);
}

describe('bagsFullError names the materials-only headroom (issue #3795)', () => {
  it('the fixture really is a materials-only satchel', () => {
    expect(ITEMS[SATCHEL]?.materialsOnly).toBe(true);
    expect(ITEMS[SATCHEL]?.bagSlots).toBe(8);
    expect(MATERIAL_ITEM_IDS.has('linen_scrap')).toBe(true);
    expect(MATERIAL_ITEM_IDS.has('worn_sword')).toBe(false);
  });

  it('unequipping gear with the general pool full but satchel room left says so', () => {
    const sim = makeSim();
    sim.addItem(SATCHEL, 1);
    sim.equipBag(SATCHEL);
    fillGeneral(sim);
    sim.drainEvents();
    expect(sim.unequipItem('chest')).toBe(false);
    const errs = errors(sim);
    expect(errs).toContain(ONLY_MATERIALS);
    expect(errs).not.toContain(FULL);
  });

  it('keeps the plain refusal once the satchel is full too', () => {
    const sim = makeSim();
    sim.addItem(SATCHEL, 1);
    sim.equipBag(SATCHEL);
    fillGeneral(sim);
    for (let i = 0; i < 8; i++) sim.addItem('linen_scrap', 20);
    sim.drainEvents();
    expect(meta(sim).inventory.length).toBe(bagCapacity(meta(sim).bags));
    expect(sim.unequipItem('chest')).toBe(false);
    const errs = errors(sim);
    expect(errs).toContain(FULL);
    expect(errs).not.toContain(ONLY_MATERIALS);
  });

  it('keeps the plain refusal without any satchel', () => {
    const sim = makeSim();
    fillGeneral(sim);
    // No satchel: the whole budget is general, so fillGeneral under-fills by
    // the 8 it reserved; top it up.
    while (meta(sim).inventory.length < bagCapacity(meta(sim).bags)) sim.addItem('worn_sword', 1);
    sim.drainEvents();
    expect(sim.unequipItem('chest')).toBe(false);
    expect(errors(sim)).toContain(FULL);
  });

  it('a refused MATERIAL never gets the materials-headroom line', () => {
    // The direct-call arm: a caller that names the refused item. A material
    // refused while materials headroom stands (an over-large batch) must not be
    // told "only materials fit": that would be no help at all.
    const sim = makeSim();
    sim.addItem(SATCHEL, 1);
    sim.equipBag(SATCHEL);
    fillGeneral(sim);
    sim.drainEvents();
    const ctx = (sim as never as { ctx: never }).ctx as Parameters<typeof bagsFullError>[0];
    bagsFullError(ctx, sim.playerId, 'linen_scrap');
    expect(errors(sim)).toEqual([FULL]);
    bagsFullError(ctx, sim.playerId, 'worn_sword');
    expect(errors(sim)).toEqual([ONLY_MATERIALS]);
    bagsFullError(ctx, sim.playerId);
    expect(errors(sim)).toEqual([ONLY_MATERIALS]);
  });
});
