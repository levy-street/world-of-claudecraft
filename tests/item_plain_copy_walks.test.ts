// The copy-choice walks that prefer a "plain" copy, now that every epic or
// legendary copy carries a tracked identity (src/sim/item_tracking.ts) and so
// is never payload-free. An identity-only copy (src/sim/item_plain_copy.ts
// isPlainCopy) is exactly as ordinary as a payload-free one, so each walk
// takes it before a Perfected, enchanted or signed copy, and carries its
// payload through so the guid and provenance survive a move or end in a
// consume row. The four walks (items.ts removePreferFungible and
// removeSellUnitsFromInventory, inventory_consumption.ts
// removeEnchantableItem, bags.ts consumeOneScratch) must agree slot for slot:
// a capacity model that picks a different victim than its remover re-opens
// the #2139 bag-overflow class. Every command case drives a real Sim.
import { describe, expect, it } from 'vitest';
import { consumeOneScratch } from '../src/sim/bags';
import { isItemGuid } from '../src/sim/item_provenance';
import { removePreferFungible, removeSellUnitsFromInventory } from '../src/sim/items';
import { isEnchantedInstance, resolveApplyEnchant } from '../src/sim/professions/enchanting';
import { resolveSalvage } from '../src/sim/professions/salvage';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import {
  cloneItemInstancePayload,
  type InvSlot,
  type ItemInstancePayload,
  type SimEvent,
} from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

const RING = 'warhewn_signet'; // a tradeable epic ring (tracked, one per slot)
const RING_ENCHANT = 'enchant_ring_strength';

function meta(sim: Sim, pid: number): PlayerMeta {
  const m = sim.players.get(pid);
  if (!m) throw new Error(`expected player ${pid}`);
  return m;
}

function ringSlots(sim: Sim, pid: number): InvSlot[] {
  return meta(sim, pid).inventory.filter((s) => s.itemId === RING);
}

function guidOf(payload: ItemInstancePayload | undefined): string {
  const guid = payload?.guid;
  expect(isItemGuid(guid), 'the copy is tracked').toBe(true);
  return guid as string;
}

function consumedGuids(sim: Sim): string[] {
  return (sim.drainEvents() as SimEvent[])
    .filter((ev): ev is ItemTrackedEvent => ev.type === 'itemTracked' && ev.kind === 'consume')
    .map((ev) => ev.guid);
}

function solo(seed: number): { sim: Sim; pid: number } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  return { sim, pid: sim.playerId };
}

/** One ordinary tracked ring, then one Perfected ring pushed after it: every
 *  walk below meets the Perfected copy FIRST (highest index). */
function ordinaryThenPerfected(sim: Sim, pid: number): { ordinary: string; perfected: string } {
  sim.addItem(RING, 1, pid);
  sim.addItemInstance(RING, { perfected: true }, pid, 1);
  const slots = ringSlots(sim, pid);
  expect(slots).toHaveLength(2);
  expect(slots[1].instance?.perfected).toBe(true);
  return { ordinary: guidOf(slots[0].instance), perfected: guidOf(slots[1].instance) };
}

describe('trade: an ordinary tracked copy ships before an enchanted one, guid intact', () => {
  it('two rings, one enchanted (the re-grant moves it last): the ORDINARY ring is staged and lands with its guid', () => {
    const sim = new Sim({ seed: 41, playerClass: 'warrior', noPlayer: true });
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('warrior', 'Bob');
    for (const pid of [alice, bob]) {
      const e = sim.entities.get(pid);
      if (!e) throw new Error('missing player entity');
      e.pos = { x: 0, y: 0, z: 0 };
      e.prevPos = { x: 0, y: 0, z: 0 };
      sim.rebucket(e);
    }
    meta(sim, alice).craftSkills.enchanting = 125;
    sim.addItem('arcane_dust', 10, alice);
    sim.addItem(RING, 2, alice);
    expect(ringSlots(sim, alice)).toHaveLength(2);
    const applied = resolveApplyEnchant(sim.ctx, alice, RING, RING_ENCHANT);
    expect(applied.ok, `apply: ${applied.reason}`).toBe(true);
    const held = ringSlots(sim, alice);
    expect(held.map((s) => s.instance?.enchant)).toEqual([undefined, RING_ENCHANT]);
    const ordinaryGuid = guidOf(held[0].instance);
    const enchantedGuid = guidOf(held[1].instance);

    sim.tradeRequest(bob, alice);
    sim.tradeAccept(bob);
    sim.tradeSetOffer([{ itemId: RING, count: 1 }], 0, alice);
    const session = sim.ctx.trades.get(alice);
    const staged = (session?.a === alice ? session.offerA : session?.offerB)?.items ?? [];
    expect(staged.map((s) => s.instance?.guid)).toEqual([ordinaryGuid]);
    expect(staged[0].instance?.enchant).toBeUndefined();

    sim.tradeConfirm(alice);
    sim.tradeConfirm(bob);
    const received = ringSlots(sim, bob);
    expect(received.map((s) => s.instance?.guid)).toEqual([ordinaryGuid]);
    expect(received[0].instance?.provenance).toBeDefined();
    const kept = ringSlots(sim, alice);
    expect(kept.map((s) => s.instance?.guid)).toEqual([enchantedGuid]);
    expect(kept[0].instance?.enchant).toBe(RING_ENCHANT);
  });
});

describe('the id-only destroy and modify arms take the ordinary tracked copy first', () => {
  it('apply-enchant id-only enchants the ordinary ring, not the newer Perfected one', () => {
    const { sim, pid } = solo(42);
    meta(sim, pid).craftSkills.enchanting = 125;
    sim.addItem('arcane_dust', 10, pid);
    const { ordinary, perfected } = ordinaryThenPerfected(sim, pid);
    const applied = resolveApplyEnchant(sim.ctx, pid, RING, RING_ENCHANT);
    expect(applied.ok, `apply: ${applied.reason}`).toBe(true);
    const byGuid = new Map(ringSlots(sim, pid).map((s) => [s.instance?.guid, s.instance]));
    expect(byGuid.get(ordinary)?.enchant).toBe(RING_ENCHANT);
    expect(byGuid.get(perfected)?.enchant).toBeUndefined();
    expect(byGuid.get(perfected)?.perfected).toBe(true);
  });

  it('salvage id-only destroys the ordinary ring and writes its consume row', () => {
    const { sim, pid } = solo(43);
    const { ordinary, perfected } = ordinaryThenPerfected(sim, pid);
    sim.drainEvents();
    const result = resolveSalvage(sim.ctx, pid, RING);
    expect(result.ok, `salvage: ${result.reason}`).toBe(true);
    expect(ringSlots(sim, pid).map((s) => s.instance?.guid)).toEqual([perfected]);
    expect(consumedGuids(sim)).toEqual([ordinary]);
  });

  it('a bulk discard destroys the ordinary rings and spares the Perfected one between them', () => {
    const { sim, pid } = solo(44);
    const { ordinary, perfected } = ordinaryThenPerfected(sim, pid);
    sim.addItem(RING, 1, pid);
    const third = guidOf(ringSlots(sim, pid)[2].instance);
    sim.drainEvents();
    sim.discardItem(RING, 2, pid);
    expect(ringSlots(sim, pid).map((s) => s.instance?.guid)).toEqual([perfected]);
    expect(consumedGuids(sim).sort()).toEqual([ordinary, third].sort());
  });
});

describe('the capacity scratch agrees with every live remover, slot for slot', () => {
  const identity = (n: number): ItemInstancePayload => ({
    guid: `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(n).padStart(2, '0')}`,
    provenance: { at: 1, by: 'A', source: 'world' },
  });
  // Interleaved so the highest-index-first walks meet special copies above
  // ordinary ones; one legacy payload-free copy pins plain-before-identity.
  const mixed = (): InvSlot[] => [
    { itemId: RING, count: 1, instance: { ...identity(1), enchant: RING_ENCHANT } },
    { itemId: RING, count: 1, instance: identity(2) },
    { itemId: RING, count: 1 },
    { itemId: RING, count: 1, instance: { ...identity(3), perfected: true } },
    { itemId: RING, count: 1, instance: identity(4) },
    { itemId: RING, count: 1, instance: { ...identity(5), signer: 'Crafter' } },
  ];
  const clone = (inv: InvSlot[]): InvSlot[] =>
    inv.map((s) => ({
      ...s,
      ...(s.instance ? { instance: cloneItemInstancePayload(s.instance) } : {}),
    }));
  const label = (instance: ItemInstancePayload | undefined): string =>
    instance?.guid ?? 'payload-free';
  // The expected order: payload-free, then the identity-only copies (newest
  // first), then the special ones (newest first, the enchanted one last for
  // the enchant-excluding walks and in plain index order otherwise).
  const ORDER = ['payload-free', identity(4).guid, identity(2).guid] as const;

  function scratchOrder(exclude?: (i: ItemInstancePayload) => boolean): string[] {
    const scratch = clone(mixed());
    const out: string[] = [];
    while (scratch.length > 0) out.push(label(consumeOneScratch(scratch, RING, exclude)));
    return out;
  }

  it('consumeOneScratch takes plain, then identity-only, then the special copies', () => {
    expect(scratchOrder().slice(0, 3)).toEqual([...ORDER]);
    expect(scratchOrder()).toEqual([
      ...ORDER,
      identity(5).guid,
      identity(3).guid,
      identity(1).guid,
    ]);
  });

  it('removePreferFungible (salvage, discard) consumes the scratch order and returns each payload', () => {
    const { sim, pid } = solo(45);
    meta(sim, pid).inventory = clone(mixed());
    const live: string[] = [];
    for (let n = 0; n < mixed().length; n++) {
      const before = meta(sim, pid).inventory.length;
      const [payload] = removePreferFungible(sim.ctx, RING, 1, pid);
      expect(meta(sim, pid).inventory.length).toBe(before - 1);
      live.push(label(payload));
    }
    expect(live).toEqual(scratchOrder());
    // The identity-only arm hands back the slot's own payload, guid included.
    meta(sim, pid).inventory = clone(mixed());
    const batch = removePreferFungible(sim.ctx, RING, 3, pid);
    expect(batch.map((p) => p.guid)).toEqual([identity(4).guid, identity(2).guid]);
    expect(batch[0].provenance).toEqual(identity(4).provenance);
  });

  it('removeSellUnitsFromInventory (trade, vendor) walks the same order', () => {
    const inventory = clone(mixed());
    const units = removeSellUnitsFromInventory(inventory, RING, mixed().length);
    expect(units.map((u) => label(u.instance))).toEqual(scratchOrder());
    // `() => true` still means payload-free stock only (mail and market escrow).
    const escrow = removeSellUnitsFromInventory(clone(mixed()), RING, 3, () => true);
    expect(escrow.map((u) => label(u.instance))).toEqual(['payload-free']);
  });

  it('removeEnchantableItem (apply-enchant) matches the enchant-excluding scratch', () => {
    const { sim, pid } = solo(46);
    meta(sim, pid).inventory = clone(mixed());
    const expected = scratchOrder(isEnchantedInstance);
    // The live remover never spends an enchanted copy; the scratch reaches it
    // only as the disenchant fallback, after every other copy is gone.
    expect(expected[expected.length - 1]).toBe(identity(1).guid);
    const live: string[] = [];
    while (sim.ctx.countEnchantableItem(RING, pid) > 0) {
      const [unit] = sim.ctx.removeEnchantableItem(RING, 1, pid);
      live.push(label(unit.instance));
    }
    expect(live).toEqual(expected.slice(0, -1));
  });
});
