// Vendor buyback vs instance payloads (#1165 completion): selling a special
// copy (enchanted, masterwork, signed, bind-on-trade-armed) and buying it back
// must return the IDENTICAL payload, byte-equal. Before this fix
// recordVendorBuyback stored bare { itemId, count } rows and buyBackItem
// re-granted a plain copy, silently destroying the enchant/signature: the
// live-reported data-loss bug this suite reproduces first.
//
// Probes the REAL Sim delegates (the professions_bind_on_trade_surfaces.test.ts
// harness), never internals.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BOOTS = 'oiled_boots'; // armor, sellValue 80, stack 1
const HIDE = 'pristine_hide'; // junk rare material, sellValue 25, stack 20
const SCALE = 'mudfin_scale'; // junk reagent (common since phase 11l), eviction filler

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function standAt(sim: Sim, pid: number, target: Entity): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos = { ...target.pos };
  p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function vendorEntity(sim: Sim): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.vendorItems.length > 0) return e;
  }
  throw new Error('no vendor npc');
}

function vendorSetup() {
  const sim = makeWorld();
  const pid = sim.addPlayer('warrior', 'Seller');
  standAt(sim, pid, vendorEntity(sim));
  sim.players.get(pid)!.copper = 100000;
  sim.drainEvents();
  return { sim, pid };
}

function inv(sim: Sim, pid: number) {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error('no player meta');
  return r.meta.inventory;
}

function buybackOf(sim: Sim, pid: number) {
  return sim.ctx.resolve(pid)!.meta.vendorBuyback;
}

function slotsOf(sim: Sim, pid: number, itemId: string) {
  return inv(sim, pid).filter((s) => s.itemId === itemId);
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

const ENCHANTED: ItemInstancePayload = {
  enchant: 'ench_stat_str',
  rolled: { stats: { str: 2 } },
};
const MASTERWORK: ItemInstancePayload = {
  signer: 'Seller',
  rolled: { stats: { agi: 3 }, masterwork: true },
};
const SIGNED: ItemInstancePayload = { signer: 'Seller' };
const ARMED: ItemInstancePayload = { bindOnTrade: true };

describe('buyback preserves instance payloads', () => {
  it('sell an enchanted piece, buy it back: the identical payload returns byte-equal', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.sellItem(BOOTS, 1, pid);
    expect(slotsOf(sim, pid, BOOTS)).toHaveLength(0);
    const row = buybackOf(sim, pid).find((s) => s.itemId === BOOTS);
    expect(row?.instance).toEqual(ENCHANTED);

    sim.buyBackItem(BOOTS, undefined, undefined, pid);
    const back = slotsOf(sim, pid, BOOTS);
    expect(back).toHaveLength(1);
    expect(back[0].count).toBe(1);
    expect(back[0].instance).toEqual(ENCHANTED);
    expect(buybackOf(sim, pid).find((s) => s.itemId === BOOTS)).toBeUndefined();
  });

  it('a masterwork proc copy keeps stats, masterwork flag, and signer through the round trip', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(BOOTS, { ...MASTERWORK, rolled: { ...MASTERWORK.rolled } }, pid);
    sim.sellItem(BOOTS, 1, pid);
    sim.buyBackItem(BOOTS, undefined, undefined, pid);
    const back = slotsOf(sim, pid, BOOTS);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(MASTERWORK);
  });

  it('a signed Pristine material round-trips with its signature', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    // A material's legacy `signer` moves into the source-count composition on
    // normalize: the row carries no top-level `instance` anymore, only the
    // one-unit descriptor in `materialSources` (source-aware materials, #3907).
    const row = buybackOf(sim, pid).find((s) => s.itemId === HIDE);
    expect(row?.instance).toBeUndefined();
    expect(row?.materialSources).toEqual([{ source: SIGNED, count: 1 }]);
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    const back = slotsOf(sim, pid, HIDE);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toBeUndefined();
    expect(back[0].materialSources).toEqual([{ source: SIGNED, count: 1 }]);
  });

  it('an armed (bindOnTrade) copy is not laundered plain by sell + buyback', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { ...ARMED }, pid);
    sim.sellItem(HIDE, 1, pid);
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    const back = slotsOf(sim, pid, HIDE);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(ARMED);
  });

  it('two differently-instanced sales occupy separate buyback rows and return in order', () => {
    const { sim, pid } = vendorSetup();
    const enchantA: ItemInstancePayload = { enchant: 'ench_a', rolled: { stats: { str: 2 } } };
    const enchantB: ItemInstancePayload = { enchant: 'ench_b', rolled: { stats: { agi: 2 } } };
    sim.addItemInstance(BOOTS, { ...enchantA, rolled: { stats: { str: 2 } } }, pid);
    sim.addItemInstance(BOOTS, { ...enchantB, rolled: { stats: { agi: 2 } } }, pid);
    sim.sellItem(BOOTS, 1, pid); // consumes the most-recently-added copy (B) first
    sim.sellItem(BOOTS, 1, pid);
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === BOOTS);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
    // Most recent sale sits first (unshift order): A was sold second.
    expect(rows[0].instance).toEqual(enchantA);
    expect(rows[1].instance).toEqual(enchantB);

    // A selector-less redemption falls back across same-payload tiers; both
    // rows here are instanced, so the most recent row returns first.
    sim.buyBackItem(BOOTS, undefined, undefined, pid);
    expect(slotsOf(sim, pid, BOOTS)[0].instance).toEqual(enchantA);
    sim.buyBackItem(BOOTS, undefined, undefined, pid);
    const both = slotsOf(sim, pid, BOOTS).map((s) => s.instance);
    expect(both).toContainEqual(enchantA);
    expect(both).toContainEqual(enchantB);
    expect(buybackOf(sim, pid).filter((s) => s.itemId === BOOTS)).toHaveLength(0);
  });

  it('byte-equal instanced sales merge into one buyback row (identical-payload stacking)', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    sim.sellItem(HIDE, 1, pid);
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === HIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].instance).toBeUndefined();
    expect(rows[0].materialSources).toEqual([{ source: SIGNED, count: 2 }]);
  });

  // Materials no longer separate buyback rows by payload identity: the merge
  // key at the row level is `instance` (recordVendorBuyback), and a material's
  // legacy signer never survives normalization as an `instance` field, so a
  // plain sale and a signed sale of the SAME material always land in one row.
  // The provenance is not lost, it moves into that row's `materialSources`
  // buckets (source-aware materials, #3907): distinct sources, one shared row.
  it('a plain sale and a signed sale of the same material coalesce into one bucketed row', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(HIDE, 1, pid);
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 2, pid); // consumes the plain copy first, then the signed one
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === HIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].instance).toBeUndefined();
    expect(rows[0].materialSources).toEqual([
      { source: {}, count: 1 },
      { source: SIGNED, count: 1 },
    ]);
  });

  // Per-payload row separation (and its eviction past the cap) is still real
  // for a NON-material instanced item: distinct enchants never fold into one
  // materialSources bucket, so they stay the genuinely distinct residual
  // payloads this rule needs (materials bucket-merge instead; see above).
  it('limit eviction still holds with per-payload rows: oldest row falls off past 12', () => {
    const { sim, pid } = vendorSetup();
    // Oldest sale: an enchanted pair of boots (its own row).
    sim.addItemInstance(BOOTS, { enchant: 'ench_oldest', rolled: { stats: { str: 1 } } }, pid);
    sim.sellItem(BOOTS, 1, pid);
    // 12 further distinct rows: differently-enchanted boots never merge.
    for (let i = 0; i < 12; i++) {
      sim.addItemInstance(BOOTS, { enchant: `ench_${i}`, rolled: { stats: { str: i } } }, pid);
      sim.sellItem(BOOTS, 1, pid);
    }
    const rows = buybackOf(sim, pid);
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => r.instance?.enchant === 'ench_oldest')).toBe(false);
    expect(rows[0].instance?.enchant).toBe('ench_11');
  });

  it('plain-path rows stay byte-identical to before: merge by itemId, no instance key', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(SCALE, 3, pid);
    sim.sellItem(SCALE, 2, pid);
    sim.sellItem(SCALE, 1, pid);
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === SCALE);
    // A plain material sale still carries no `instance` key, but it now always
    // carries its exact (unrecorded) source composition too.
    expect(rows).toEqual([
      { itemId: SCALE, count: 3, materialSources: [{ source: {}, count: 3 }] },
    ]);
    sim.buyBackItem(SCALE, undefined, undefined, pid);
    const back = slotsOf(sim, pid, SCALE);
    expect(back).toEqual([
      { itemId: SCALE, count: 1, materialSources: [{ source: {}, count: 1 }] },
    ]);
  });

  // The OLD rule ("a plain stack never offers room to a signed unit") is
  // retired for materials: compatibleMaterialStacks gates a shared stack on
  // `instance` only, and provenance rides inside it via materialSources, so
  // any compatible (non-charge, non-locked) hide stack with room now IS room
  // for a signed sale. What still holds, and what this test pins instead: a
  // truly full bag (every stack at cap or one-per-slot) still refuses, and
  // freeing one unit of room in ANY hide stack lets the buyback land there,
  // bucketing its source into that stack rather than minting a new slot.
  it('instanced buyback capacity-models the payload: any compatible material stack offers room, but a full bag still refuses', () => {
    const { sim, pid } = vendorSetup();
    const meta = sim.ctx.resolve(pid)!.meta;
    meta.inventory.length = 0; // drop starter rations: this test pins exact slot usage
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    // A hide stack already at its 20-unit cap offers no room, and the rest of
    // the bag is one-per-slot charge-bearing hides (charges never merge):
    // nothing anywhere can take the buyback in, so the bag reads full even
    // though every slot holds the same item.
    sim.addItem(HIDE, 20, pid);
    while (meta.inventory.length < 16) {
      sim.addItemInstance(HIDE, { charges: { zap: meta.inventory.length } }, pid);
    }
    sim.drainEvents();
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(buybackOf(sim, pid).find((s) => s.itemId === HIDE)?.materialSources).toEqual([
      { source: SIGNED, count: 1 },
    ]);

    // Selling one unit off the full stack opens exactly one unit of room, and
    // the buyback lands there, bucketing the signed source alongside the
    // unrecorded one already in that stack.
    const fullIdx = meta.inventory.findIndex((s) => s.itemId === HIDE && s.count === 20);
    meta.inventory[fullIdx] = {
      itemId: HIDE,
      count: 19,
      materialSources: [{ source: {}, count: 19 }],
    };
    sim.drainEvents();
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const merged = meta.inventory[fullIdx];
    expect(merged.count).toBe(20);
    expect(merged.materialSources).toEqual([
      { source: {}, count: 19 },
      { source: SIGNED, count: 1 },
    ]);
  });

  // Row addressing by index + expected payload needs genuinely distinct
  // residual payloads to prove anything: a non-material instanced item, where
  // `instance` (never a materialSources bucket) is still the merge key.
  it('index + expected payload address the exact row when rows share an item id', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(BOOTS, 1, pid);
    sim.addItemInstance(BOOTS, { ...SIGNED }, pid);
    sim.sellItem(BOOTS, 2, pid); // plain row + signed row
    // Selector-less: the exact-payload fallback matches expectedInstance
    // undefined against PLAIN rows only, so the plain copy returns first.
    sim.buyBackItem(BOOTS, undefined, undefined, pid);
    expect(slotsOf(sim, pid, BOOTS)).toEqual([{ itemId: BOOTS, count: 1 }]);
    // Then the signed copy, addressed by index + payload.
    const signedIdx = buybackOf(sim, pid).findIndex((s) => s.itemId === BOOTS && s.instance);
    sim.buyBackItem(BOOTS, signedIdx, { ...SIGNED }, pid);
    const signed = slotsOf(sim, pid, BOOTS).find((s) => s.instance);
    expect(signed?.instance).toEqual(SIGNED);
    expect(buybackOf(sim, pid).filter((s) => s.itemId === BOOTS)).toHaveLength(0);
  });

  it('a stale index whose payload no longer matches falls back to the exact-payload scan', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(BOOTS, { ...SIGNED }, pid);
    sim.sellItem(BOOTS, 1, pid);
    // A plain sale after the client's snapshot shifts the signed row down.
    sim.addItem(BOOTS, 1, pid);
    sim.sellItem(BOOTS, 1, pid);
    sim.drainEvents();
    // The client still clicks index 0 expecting the signed payload: the new
    // occupant must NOT be redeemed in its place; the scan finds the real row.
    sim.buyBackItem(BOOTS, 0, { ...SIGNED }, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const got = slotsOf(sim, pid, BOOTS);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(SIGNED);
    expect(buybackOf(sim, pid).find((s) => s.itemId === BOOTS)?.instance).toBeUndefined();
  });

  it('an expected payload the player never sold is refused', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    sim.drainEvents();
    sim.buyBackItem(HIDE, 0, { signer: 'Forged' }, pid);
    expect(errorTexts(sim.drainEvents())).toContain('That item is not available for buyback.');
    expect(buybackOf(sim, pid)).toHaveLength(1);
  });

  it('a tampered charge-bearing buyback count clamps to 1 on load (merge cap rule)', () => {
    const { sim, pid } = vendorSetup();
    // A LEGACY row (no `materialSources`): the shape a save from before #3907
    // still carries, so it is the charges-clamp path under test here, not the
    // explicit-v2 composition validator below.
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    state.vendorBuyback = [
      { itemId: HIDE, count: 99, instance: { signer: 'Seller', charges: { zap: 2 } } },
    ];
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Seller', { state });
    const rows = sim2.ctx.resolve(pid2)!.meta.vendorBuyback;
    expect(rows[0].count).toBe(1);

    // A byte-equal MERGEABLE legacy row keeps its over-stack count: legitimate
    // multi-unit sales merge past the stack cap by design.
    const state2 = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    state2.vendorBuyback = [{ itemId: HIDE, count: 40, instance: { signer: 'Seller' } }];
    const sim3 = makeWorld();
    const pid3 = sim3.addPlayer('warrior', 'Seller', { state: state2 });
    expect(sim3.ctx.resolve(pid3)!.meta.vendorBuyback[0].count).toBe(40);
  });

  // The EXPLICIT v2 shape (#3907) is validated, never coerced: a real sale
  // moves ONLY the legacy `signer` into `materialSources` (a MaterialSource
  // carries `gatherer`/`signer` alone, never `charges`); `charges` stays on
  // the slot's own top-level `instance`, residual beside the composition.
  // `validateMaterialSlotSourcesOnLoad` refuses a charge-bearing `instance`
  // whose slot `count` is not exactly 1, which fires even when the
  // composition sum is internally VALID (row.count and the source count
  // tampered together): the charge-count-1 rule is a separate limit from
  // the sum-mismatch check, not a special case of it.
  // `validateCharacterMaterialSourcesOnLoad` runs before any entity or meta
  // exists (sim.ts addPlayer), so the refusal is atomic: the whole join
  // throws and no partial player is ever registered.
  it('a malformed v2 charge-bearing count is refused even with a self-consistent composition, never clamped', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { signer: 'Seller', charges: { zap: 2 } }, pid);
    sim.sellItem(HIDE, 1, pid);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    const row = state.vendorBuyback.find((s: { itemId: string }) => s.itemId === HIDE);
    expect(row.instance).toEqual({ charges: { zap: 2 } });
    expect(row.materialSources).toEqual([{ source: { signer: 'Seller' }, count: 1 }]);
    // Bump both row.count and the source count to 40 together: the
    // composition still sums correctly (40 === 40), so only the dedicated
    // charge-count-1 rule can catch this, not the sum-mismatch arm.
    row.count = 40;
    row.materialSources[0].count = 40;

    const sim2 = makeWorld();
    expect(() => sim2.addPlayer('warrior', 'Seller', { state })).toThrow(
      /material source state is invalid/,
    );
    expect(sim2.players.size).toBe(0);
  });

  it('buyback rows with payloads round-trip the character save byte-equal', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, pid);
    sim.sellItem(BOOTS, 1, pid);
    const state = sim.serializeCharacter(pid);
    const reloaded = JSON.parse(JSON.stringify(state));
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Seller', { state: reloaded });
    const rows = sim2.ctx.resolve(pid2)!.meta.vendorBuyback;
    expect(rows.find((s) => s.itemId === BOOTS)?.instance).toEqual(ENCHANTED);
    standAt(sim2, pid2, vendorEntity(sim2));
    sim2.players.get(pid2)!.copper = 100000;
    sim2.buyBackItem(BOOTS, undefined, undefined, pid2);
    expect(
      sim2.ctx.resolve(pid2)!.meta.inventory.find((s) => s.itemId === BOOTS)?.instance,
    ).toEqual(ENCHANTED);
  });
});
