// WoW-style bag system (src/sim/bags.ts): stack sizes, the pooled capacity
// budget (16-slot backpack + 4 equippable bag sockets), the capacity gates at
// the command boundaries, equip/unequip/swap rules, and save back-compat.
import { describe, expect, it } from 'vitest';
import {
  addStacked,
  BACKPACK_SLOTS,
  BAG_SOCKETS,
  bagCapacity,
  canAddItem,
  countFit,
  fitsAll,
  migrationBagsFor,
  stackSizeOf,
} from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const makeSim = (cls = 'warrior', seed = 42) =>
  new Sim({ seed, playerClass: cls as never, autoEquip: false });

const meta = (sim: Sim) =>
  (sim as never as { players: Map<number, never> }).players.get(sim.playerId)! as {
    inventory: InvSlot[];
    bags: (string | null)[];
    copper: number;
    equipment: Record<string, string | undefined>;
  };

// Fill every free slot with distinct throwaway 1-per-slot items so the next
// add has nowhere to go. Uses real gear ids (stackSize 1).
function fillBags(sim: Sim): void {
  const m = meta(sim);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1);
    i++;
  }
}

describe('stack sizes and stacking math', () => {
  it('gear, bags, and tools never stack; consumables stack to 20', () => {
    expect(stackSizeOf(ITEMS.worn_sword)).toBe(1);
    expect(stackSizeOf(ITEMS.linen_pouch)).toBe(1);
    expect(stackSizeOf(ITEMS.simple_fishing_pole)).toBe(1);
    expect(stackSizeOf(ITEMS.baked_bread)).toBe(20);
    expect(stackSizeOf(ITEMS.minor_healing_potion)).toBe(20);
  });

  it('addStacked tops up existing stacks then splits into fresh ones', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 18 }];
    addStacked(inv, 'baked_bread', 25);
    expect(inv).toEqual([
      { itemId: 'baked_bread', count: 20 },
      { itemId: 'baked_bread', count: 20 },
      { itemId: 'baked_bread', count: 3 },
    ]);
  });

  it('each copy of an unstackable item takes its own slot', () => {
    const inv: InvSlot[] = [];
    addStacked(inv, 'worn_sword', 3);
    expect(inv).toHaveLength(3);
  });

  it('countFit accounts for stack top-up room plus free slots', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 15 }];
    // capacity 2: 5 fit into the existing stack + 20 into the one free slot
    expect(countFit(inv, 2, 'baked_bread', 99)).toBe(25);
    expect(canAddItem(inv, 2, 'baked_bread', 25)).toBe(true);
    expect(canAddItem(inv, 2, 'baked_bread', 26)).toBe(false);
  });

  it('never merges into an instanced slot and offers it no top-up room (#1165)', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 5, instance: { signer: 'Ana' } }];
    // capacity 1: the instanced slot occupies the only slot and cannot absorb more
    expect(countFit(inv, 1, 'baked_bread', 1)).toBe(0);
    addStacked(inv, 'baked_bread', 3);
    expect(inv).toEqual([
      { itemId: 'baked_bread', count: 5, instance: { signer: 'Ana' } },
      { itemId: 'baked_bread', count: 3 },
    ]);
  });

  it('fitsAll simulates the batch cumulatively', () => {
    const inv: InvSlot[] = [];
    expect(
      fitsAll(inv, 2, [
        { itemId: 'worn_sword', count: 1 },
        { itemId: 'rusty_dagger', count: 1 },
      ]),
    ).toBe(true);
    expect(
      fitsAll(inv, 2, [
        { itemId: 'worn_sword', count: 1 },
        { itemId: 'rusty_dagger', count: 1 },
        { itemId: 'training_mace', count: 1 },
      ]),
    ).toBe(false);
  });
});

describe('capacity budget and the equip/unequip commands', () => {
  it('a fresh character has the 16-slot backpack and 4 empty sockets', () => {
    const sim = makeSim();
    expect(sim.bags).toEqual([null, null, null, null]);
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS);
    expect(BAG_SOCKETS).toBe(4);
  });

  it('equipping a bag from the inventory raises capacity and frees its slot', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
    sim.equipBag('linen_pouch');
    expect(sim.bags[0]).toBe('linen_pouch');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 6);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(false);
  });

  it('using a bag item equips it (useItem path)', () => {
    const sim = makeSim();
    sim.addItem('travelers_knapsack', 1);
    sim.useItem('travelers_knapsack');
    expect(sim.bags[0]).toBe('travelers_knapsack');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 8);
  });

  it('equipping onto an occupied socket swaps and returns the old bag', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 0);
    sim.addItem('wolfhide_satchel', 1);
    sim.equipBag('wolfhide_satchel', 0);
    expect(sim.bags[0]).toBe('wolfhide_satchel');
    expect(sim.bagCapacity).toBe(BACKPACK_SLOTS + 10);
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
  });

  it('a fifth bag with all sockets full is refused with an error', () => {
    const sim = makeSim();
    for (const _ of [0, 1, 2, 3]) sim.addItem('linen_pouch', 1);
    for (const i of [0, 1, 2, 3]) sim.equipBag('linen_pouch', i);
    sim.addItem('wolfhide_satchel', 1);
    sim.drainEvents();
    sim.equipBag('wolfhide_satchel');
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'All your bag slots are full.')).toBe(
      true,
    );
    expect(sim.bags.every((b) => b === 'linen_pouch')).toBe(true);
  });

  it('unequipping a bag is refused while the items would not fit the shrunk budget', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 0);
    fillBags(sim);
    sim.drainEvents();
    sim.unequipBag(0);
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'You have too many items to remove that bag.',
      ),
    ).toBe(true);
    expect(sim.bags[0]).toBe('linen_pouch');
    // free enough room (7 slots: 6 lost capacity + 1 for the bag itself)
    for (let i = 0; i < 7; i++) sim.discardItem(sim.inventory[sim.inventory.length - 1].itemId, 1);
    sim.unequipBag(0);
    expect(sim.bags[0]).toBeNull();
    expect(sim.inventory.some((s) => s.itemId === 'linen_pouch')).toBe(true);
  });

  it('unequipping gear is refused when the bags are full', () => {
    const sim = makeSim();
    fillBags(sim);
    sim.drainEvents();
    const ok = sim.unequipItem('chest');
    const ev = sim.drainEvents();
    expect(ok).toBe(false);
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
  });
});

describe('capacity gates at the grant boundaries', () => {
  it('vendor buy is refused (and not charged) when the bags are full', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 100000;
    fillBags(sim);
    // find the vendor npc and stand next to it
    const wilkes = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.vendorItems.includes('linen_pouch'),
    )!;
    sim.player.pos.x = wilkes.pos.x;
    sim.player.pos.z = wilkes.pos.z;
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.buyItem(wilkes.id, 'linen_pouch');
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(m.copper).toBe(copperBefore);
    expect(sim.countItem('linen_pouch')).toBe(0);
  });

  it('walk-by autoloot stays silent when the bags are full (no toast loop)', () => {
    const sim = makeSim();
    fillBags(sim);
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    wolf.hp = 0;
    wolf.dead = true;
    wolf.lootable = true;
    wolf.tappedById = sim.playerId;
    wolf.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] };
    wolf.pos = { ...sim.player.pos };
    sim.drainEvents();
    sim.autoLoot(wolf.id);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error')).toBe(false); // passive pass: no toast
    expect(wolf.loot!.items[0].count).toBe(1); // item left on the corpse
    // the deliberate click still gets exactly one toast
    sim.lootCorpse(wolf.id);
    const ev2 = sim.drainEvents();
    expect(ev2.filter((e) => e.type === 'error' && e.text === 'Your bags are full.')).toHaveLength(
      1,
    );
  });

  it('addItem never destroys an async grant even above capacity (force path)', () => {
    const sim = makeSim();
    fillBags(sim);
    const used = sim.inventory.length;
    sim.addItem('wolf_fang', 1); // e.g. a need-greed win landing later
    expect(sim.inventory.length).toBe(used + 1);
    expect(sim.countItem('wolf_fang')).toBe(1);
  });

  it('corpse loot that does not fit stays on the corpse', () => {
    const sim = makeSim();
    fillBags(sim);
    // hand-build a lootable corpse next to the player
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    wolf.hp = 0;
    wolf.dead = true;
    wolf.lootable = true;
    wolf.tappedById = sim.playerId;
    wolf.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 2 }] };
    wolf.pos = { ...sim.player.pos };
    sim.drainEvents();
    sim.lootCorpse(wolf.id);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(wolf.loot!.items[0].count).toBe(2); // untouched, still on the corpse
    expect(sim.countItem('wolf_fang')).toBe(0);
    // free one slot: exactly one fang fits... a 20-stack slot takes both
    sim.discardItem(sim.inventory[sim.inventory.length - 1].itemId, 1);
    sim.lootCorpse(wolf.id);
    expect(sim.countItem('wolf_fang')).toBe(2);
  });
});

describe('persistence and back-compat', () => {
  it('serializeCharacter round-trips the equipped bags', () => {
    const sim = makeSim();
    sim.addItem('linen_pouch', 1);
    sim.equipBag('linen_pouch', 2);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.bags).toEqual([null, null, 'linen_pouch', null]);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    expect(sim2.bags).toEqual([null, null, 'linen_pouch', null]);
    expect(sim2.bagCapacity).toBe(BACKPACK_SLOTS + 6);
    expect(pid).toBeGreaterThan(0);
  });

  it('a pre-bag save (no bags field) loads with 4 empty sockets', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    sim2.addPlayer('warrior', 'Legacy', { state });
    expect(sim2.bags).toEqual([null, null, null, null]);
    expect(sim2.bagCapacity).toBe(BACKPACK_SLOTS);
  });

  it('a tampered save with a non-bag id in a socket loads it as empty', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = ['worn_sword', 'not_an_item', 'linen_pouch', null];
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    sim2.addPlayer('warrior', 'Tampered', { state });
    expect(sim2.bags).toEqual([null, null, 'linen_pouch', null]);
  });

  it('an over-capacity legacy inventory is preserved and blocks new pickups only', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = [null, null, null, null];
    state.inventory = Array.from({ length: 20 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Hoarder', { state });
    const m2 = (sim2 as never as { players: Map<number, { inventory: InvSlot[] }> }).players.get(
      pid,
    )!;
    expect(m2.inventory).toHaveLength(20); // nothing destroyed
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(false);
  });
});

describe('pre-bag save migration (equivalent bags for earned space)', () => {
  it('grants nothing at or under the backpack budget', () => {
    expect(migrationBagsFor(0)).toEqual([]);
    expect(migrationBagsFor(BACKPACK_SLOTS)).toEqual([]);
  });

  it('covers small overflows with the lowest quality tier that suffices', () => {
    expect(migrationBagsFor(20)).toEqual(['linen_pouch']); // needs 4
    expect(migrationBagsFor(24)).toEqual(['travelers_knapsack']); // needs 8
    // needs 14: two commons, never a free epic duffel
    expect(migrationBagsFor(30)).toEqual(['travelers_knapsack', 'linen_pouch']);
    expect(migrationBagsFor(30).length).toBeLessThanOrEqual(BAG_SOCKETS);
  });

  it('escalates tiers only when a lower tier cannot cover the need', () => {
    // needs 44: commons max out at 32 and uncommons at 40, so rare tier
    expect(migrationBagsFor(60)).toEqual([
      'gravewoven_bag',
      'gravewoven_bag',
      'gravewoven_bag',
      'travelers_knapsack',
    ]);
    // needs 56: exactly four epics (the 72-slot ceiling)
    expect(migrationBagsFor(72)).toEqual([
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
    ]);
    // exact tier boundary: used 48 is needed 32 = 4x8, the strict < must KEEP
    // the common tier (a <= would silently escalate to uncommon)
    expect(migrationBagsFor(48)).toEqual([
      'travelers_knapsack',
      'travelers_knapsack',
      'travelers_knapsack',
      'travelers_knapsack',
    ]);
    // first slot past the 72 ceiling: four epics, 1 slot of tolerated overflow
    expect(migrationBagsFor(73)).toEqual([
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
      'mistcallers_duffel',
    ]);
    // past the ceiling: still four epics, the rest stays tolerated overflow
    expect(migrationBagsFor(90)).toHaveLength(4);
  });

  it('equips migration bags on loading a pre-bag save and covers the used space', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    state.inventory = Array.from({ length: 30 }, (_, i) => ({
      itemId: i % 2 ? 'worn_sword' : 'rusty_dagger',
      count: 1,
    }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Veteran', { state });
    const m2 = (sim2 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid,
    )!;
    expect(m2.bags).toEqual(['travelers_knapsack', 'linen_pouch', null, null]);
    // exact coverage: everything owned fits (30/30), nothing was lost
    expect(bagCapacity(m2.bags)).toBeGreaterThanOrEqual(30);
    sim2.discardItem('worn_sword', 1, pid);
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(true); // freeing one slot re-opens pickups
    const ev = sim2.tick();
    expect(
      ev.some(
        (e) => e.type === 'log' && e.text === 'Your belongings have been packed into new bags.',
      ),
    ).toBe(true);
  });

  it('is idempotent: the migrated save round-trips without a second grant', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    delete (state as { bags?: unknown }).bags;
    state.inventory = Array.from({ length: 20 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Veteran', { state });
    const migrated = sim2.serializeCharacter(pid)!;
    expect(migrated.bags).toEqual(['linen_pouch', null, null, null]);
    // discard down to an empty backpack-sized load, then unequip the granted bag
    const sim3 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid3 = sim3.addPlayer('warrior', 'Veteran', { state: migrated });
    const m3 = (sim3 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid3,
    )!;
    expect(m3.bags).toEqual(['linen_pouch', null, null, null]); // loaded, not re-granted
    const ev = sim3.tick();
    expect(ev.some((e) => e.type === 'log' && /packed into new bags/.test(e.text))).toBe(false);
  });

  it('does not grant on a post-bag save even if it is over capacity (tampered)', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    state.bags = [null, null, null, null];
    state.inventory = Array.from({ length: 30 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Tamper', { state });
    const m2 = (sim2 as never as { players: Map<number, { bags: (string | null)[] }> }).players.get(
      pid,
    )!;
    expect(m2.bags).toEqual([null, null, null, null]);
    expect(sim2.canAddItem('wolf_fang', 1, pid)).toBe(false); // overflow just blocks pickups
  });
});
