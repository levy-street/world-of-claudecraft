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
const SCALE = 'mudfin_scale'; // poor junk, eviction filler

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
    const row = buybackOf(sim, pid).find((s) => s.itemId === HIDE);
    expect(row?.instance).toEqual(SIGNED);
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    const back = slotsOf(sim, pid, HIDE);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(SIGNED);
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
    expect(rows[0].instance).toEqual(SIGNED);
  });

  it('an instanced sale never merges into a plain row of the same item, nor the reverse', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(HIDE, 1, pid);
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 2, pid); // consumes the plain copy first, then the signed one
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === HIDE);
    expect(rows).toHaveLength(2);
    const plain = rows.find((r) => !r.instance);
    const signed = rows.find((r) => r.instance);
    expect(plain?.count).toBe(1);
    expect(signed?.count).toBe(1);
    expect(signed?.instance).toEqual(SIGNED);
  });

  it('limit eviction still holds with per-payload rows: oldest row falls off past 12', () => {
    const { sim, pid } = vendorSetup();
    // Oldest sale: the signed hide (its own row).
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    // 12 further distinct rows: differently-signed hides never merge.
    for (let i = 0; i < 12; i++) {
      sim.addItemInstance(HIDE, { signer: `Signer${i}` }, pid);
      sim.sellItem(HIDE, 1, pid);
    }
    const rows = buybackOf(sim, pid);
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => r.instance?.signer === 'Seller')).toBe(false);
    expect(rows[0].instance?.signer).toBe('Signer11');
  });

  it('plain-path rows stay byte-identical to before: merge by itemId, no instance key', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(SCALE, 3, pid);
    sim.sellItem(SCALE, 2, pid);
    sim.sellItem(SCALE, 1, pid);
    const rows = buybackOf(sim, pid).filter((s) => s.itemId === SCALE);
    expect(rows).toEqual([{ itemId: SCALE, count: 3 }]);
    sim.buyBackItem(SCALE, undefined, undefined, pid);
    const back = slotsOf(sim, pid, SCALE);
    expect(back).toEqual([{ itemId: SCALE, count: 1 }]);
  });

  it('instanced buyback capacity-models the payload: plain-stack room is not instanced room', () => {
    const { sim, pid } = vendorSetup();
    const meta = sim.ctx.resolve(pid)!.meta;
    meta.inventory.length = 0; // drop starter rations: this test pins exact slot usage
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    // Fill every slot; leave one PLAIN hide stack with room. A plain add would
    // fit (top-up), but the signed copy needs its own slot: must refuse.
    sim.addItem(HIDE, 1, pid);
    while (meta.inventory.length < 16) {
      sim.addItemInstance(SCALE, { signer: `F${meta.inventory.length}` }, pid);
    }
    sim.drainEvents();
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(buybackOf(sim, pid).find((s) => s.itemId === HIDE)?.instance).toEqual(SIGNED);
    expect(slotsOf(sim, pid, HIDE).some((s) => s.instance)).toBe(false);

    // A byte-equal signed stack with room IS instanced room: the buyback lands.
    const plainIdx = meta.inventory.findIndex((s) => s.itemId === HIDE && !s.instance);
    meta.inventory[plainIdx] = { itemId: HIDE, count: 1, instance: { ...SIGNED } };
    sim.drainEvents();
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const merged = slotsOf(sim, pid, HIDE).filter((s) => s.instance);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(2);
    expect(merged[0].instance).toEqual(SIGNED);
  });

  it('index + expected payload address the exact row when rows share an item id', () => {
    const { sim, pid } = vendorSetup();
    sim.addItem(HIDE, 1, pid);
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 2, pid); // plain row + signed row
    // Selector-less: the exact-payload fallback matches expectedInstance
    // undefined against PLAIN rows only, so the plain copy returns first.
    sim.buyBackItem(HIDE, undefined, undefined, pid);
    expect(slotsOf(sim, pid, HIDE)).toEqual([{ itemId: HIDE, count: 1 }]);
    // Then the signed copy, addressed by index + payload.
    const signedIdx = buybackOf(sim, pid).findIndex((s) => s.itemId === HIDE && s.instance);
    sim.buyBackItem(HIDE, signedIdx, { ...SIGNED }, pid);
    const signed = slotsOf(sim, pid, HIDE).find((s) => s.instance);
    expect(signed?.instance).toEqual(SIGNED);
    expect(buybackOf(sim, pid).filter((s) => s.itemId === HIDE)).toHaveLength(0);
  });

  it('a stale index whose payload no longer matches falls back to the exact-payload scan', () => {
    const { sim, pid } = vendorSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, pid);
    sim.sellItem(HIDE, 1, pid);
    // A plain sale after the client's snapshot shifts the signed row down.
    sim.addItem(HIDE, 1, pid);
    sim.sellItem(HIDE, 1, pid);
    sim.drainEvents();
    // The client still clicks index 0 expecting the signed payload: the new
    // occupant must NOT be redeemed in its place; the scan finds the real row.
    sim.buyBackItem(HIDE, 0, { ...SIGNED }, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const got = slotsOf(sim, pid, HIDE);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(SIGNED);
    expect(buybackOf(sim, pid).find((s) => s.itemId === HIDE)?.instance).toBeUndefined();
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
    sim.addItemInstance(HIDE, { signer: 'Seller', charges: { zap: 2 } }, pid);
    sim.sellItem(HIDE, 1, pid);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    state.vendorBuyback[0].count = 99; // hand-edited save
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Seller', { state });
    const rows = sim2.ctx.resolve(pid2)!.meta.vendorBuyback;
    expect(rows[0].count).toBe(1);
    // A byte-equal MERGEABLE row keeps its over-stack count: legitimate
    // multi-unit sales merge past the stack cap by design.
    const state2 = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    state2.vendorBuyback = [{ itemId: HIDE, count: 40, instance: { signer: 'Seller' } }];
    const sim3 = makeWorld();
    const pid3 = sim3.addPlayer('warrior', 'Seller', { state: state2 });
    expect(sim3.ctx.resolve(pid3)!.meta.vendorBuyback[0].count).toBe(40);
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
