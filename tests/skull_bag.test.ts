// The World PvP Skull Bag (src/sim/pvp/skull_bag.ts): a 500 honor
// sub-inventory that holds any number of trophy skulls outside the bag pools.
// Pinned here: the honor purchase, the loot routing (a carried bag takes a
// looted skull straight in, full bags or not, on the corpse take and on the
// spoils settlement), the store and take commands with their refusals, the
// readout on the World PvP self key, and the save round trip.
import { describe, expect, it, vi } from 'vitest';
import { FURY_ENTITY_ID, HONOR_QUARTERMASTER_STOCK } from '../src/sim/content/pvp_honor';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import {
  SKULL_BAG_MISSING_LINE,
  SKULL_BAG_NOTHING_LINE,
  SKULL_BAG_STORED_ALL_LINE,
  SKULL_BAG_STORED_LINE,
  WORLD_PVP_SKULL_BAG_ITEM_ID,
  WORLD_PVP_SKULL_ITEM_ID,
} from '../src/sim/pvp';
import { skullBagLoadValid } from '../src/sim/pvp/skull_bag';
import { WORLD_PVP_TOGGLE_COOLDOWN, worldPvpReadoutFor } from '../src/sim/pvp/world_pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const SEED = 7;
const CONTESTED = { x: 60, z: 700 };

function world(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: ARENA_FREE_WORLD });
}

function place(sim: Sim, pid: number, spot: { x: number; z: number }, dx = 0): void {
  const e = sim.entities.get(pid)!;
  e.pos = { x: spot.x + dx, y: groundHeight(spot.x + dx, spot.z, SEED), z: spot.z };
  e.prevPos = { ...e.pos };
}

function fighter(sim: Sim, name: string, characterId: number, dx: number): number {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true, characterId });
  sim.setPlayerLevel(20, pid);
  const e = sim.entities.get(pid)!;
  e.hp = e.maxHp;
  place(sim, pid, CONTESTED, dx);
  return pid;
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}

function flag(sim: Sim, pid: number): void {
  (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
  sim.setWorldPvpFlag(true, pid);
}

function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(
    ent(sim, killerPid),
    victim,
    victim.hp + 1_000,
    false,
    'physical',
    'Slam',
    'hit',
  );
  expect(victim.dead).toBe(true);
}

function victim(id: number, name: string, count = 1) {
  return { source: { gatherer: { kind: 'character' as const, id, name } }, count };
}

function giveBag(sim: Sim, pid: number): void {
  sim.meta(pid)!.inventory.push({ itemId: WORLD_PVP_SKULL_BAG_ITEM_ID, count: 1 });
}

function skullsCarried(sim: Sim, pid: number) {
  return sim.meta(pid)!.inventory.filter((s) => s.itemId === WORLD_PVP_SKULL_ITEM_ID);
}

function errorLines(sim: Sim, pid: number): string[] {
  return sim.events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
    )
    .map((ev) => ev.text);
}

function lootTexts(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((ev): ev is Extract<SimEvent, { type: 'loot' }> => ev.type === 'loot' && ev.pid === pid)
    .map((ev) => ev.text);
}

/** Fill every slot a skull could use (copper ore, a material that never shares
 *  a skull's stack), so the ordinary grant has no room left. */
function fillBags(sim: Sim, pid: number): void {
  const meta = sim.meta(pid)!;
  for (let i = 0; i < 500 && sim.ctx.canAddItem(WORLD_PVP_SKULL_ITEM_ID, 1, pid); i++) {
    meta.inventory.push({ itemId: 'copper_ore', count: 1 });
  }
  expect(sim.ctx.canAddItem(WORLD_PVP_SKULL_ITEM_ID, 1, pid)).toBe(false);
}

/** Aleph (killer, carrying the bag) and two flagged victims, Bet and Gimel. */
function arena() {
  const sim = world();
  const a = fighter(sim, 'Aleph', 1001, 0);
  const b = fighter(sim, 'Bet', 1002, 2);
  const c = fighter(sim, 'Gimel', 1003, -2);
  for (const pid of [a, b, c]) flag(sim, pid);
  giveBag(sim, a);
  sim.events = [];
  return { sim, a, b, c };
}

describe('the Skull Bag item', () => {
  it('is a soulbound, unique, epic 500 honor row both quartermasters sell', () => {
    const def = ITEMS[WORLD_PVP_SKULL_BAG_ITEM_ID];
    expect(def).toMatchObject({
      name: 'Skull Bag',
      quality: 'epic',
      priceHonor: 500,
      sellValue: 0,
      soulbound: true,
      unique: true,
      stackSize: 1,
    });
    // Never a socket bag: a bag click opens its pane instead of equipping it.
    expect(def.kind).not.toBe('bag');
    expect(def.bagSlots).toBeUndefined();
    expect(HONOR_QUARTERMASTER_STOCK).toContain(WORLD_PVP_SKULL_BAG_ITEM_ID);
  });

  it('is bought from FURY for 500 honor, once', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Buyer', { autoEquip: true, characterId: 5001 });
    const fury = ent(sim, FURY_ENTITY_ID);
    const me = ent(sim, pid);
    me.pos = { ...fury.pos, x: fury.pos.x + 1 };
    me.prevPos = { ...me.pos };
    sim.meta(pid)!.honor = 1_200;
    sim.buyItem(FURY_ENTITY_ID, WORLD_PVP_SKULL_BAG_ITEM_ID, undefined, pid);
    expect(sim.meta(pid)!.honor).toBe(700);
    expect(
      sim.meta(pid)!.inventory.filter((s) => s.itemId === WORLD_PVP_SKULL_BAG_ITEM_ID),
    ).toHaveLength(1);
    // Unique: a second copy is refused and charges nothing.
    sim.buyItem(FURY_ENTITY_ID, WORLD_PVP_SKULL_BAG_ITEM_ID, undefined, pid);
    expect(sim.meta(pid)!.honor).toBe(700);
  });
});

describe('looted skulls go straight into a carried bag', () => {
  it('the corpse take stores the skull with its victim and leaves the bags alone', () => {
    const { sim, a, b } = arena();
    slay(sim, a, b);
    sim.events = [];
    expect(sim.lootCorpse(b, a)).toBe(true);
    expect(skullsCarried(sim, a)).toEqual([]);
    expect(sim.meta(a)!.skullBag).toEqual([victim(1002, 'Bet')]);
    expect(lootTexts(sim, a)).toContain(SKULL_BAG_STORED_LINE);
    // The body is spent exactly as an ordinary take spends it.
    expect(ent(sim, b).loot).toBeNull();
  });

  it('full bags never strand a skull on the body when the bag is carried', () => {
    const { sim, a, b } = arena();
    fillBags(sim, a);
    slay(sim, a, b);
    sim.events = [];
    expect(sim.lootCorpse(b, a)).toBe(true);
    expect(errorLines(sim, a)).not.toContain('Your bags are full.');
    expect(sim.meta(a)!.skullBag).toEqual([victim(1002, 'Bet')]);
  });

  it('the spoils settlement (the victim releases first) stores it too', () => {
    const { sim, a, b } = arena();
    fillBags(sim, a);
    slay(sim, a, b);
    sim.releaseSpirit(b);
    expect(sim.meta(a)!.skullBag).toEqual([victim(1002, 'Bet')]);
    expect(skullsCarried(sim, a)).toEqual([]);
  });

  it('keeps counting per victim, with no cap', () => {
    const { sim, a, b, c } = arena();
    for (const target of [b, c, b]) {
      slay(sim, a, target);
      sim.lootCorpse(target, a);
      // Stand the victim back up for the next round.
      const t = ent(sim, target);
      t.dead = false;
      t.ghost = false;
      t.hp = t.maxHp;
    }
    expect(sim.meta(a)!.skullBag).toEqual([victim(1002, 'Bet', 2), victim(1003, 'Gimel')]);
    // No cap: a stored total well past any stack or bag size still merges.
    sim.meta(a)!.skullBag = [victim(1002, 'Bet', 5_000)];
    sim.ctx.addItem(WORLD_PVP_SKULL_ITEM_ID, 1, a, { materialSources: [victim(1002, 'Bet')] });
    sim.skullBagAction({ op: 'store' }, a);
    expect(sim.meta(a)!.skullBag).toEqual([victim(1002, 'Bet', 5_001)]);
  });

  it('without the bag the skull lands in the bags exactly as before', () => {
    const { sim, a, b } = arena();
    sim.meta(a)!.inventory = sim
      .meta(a)!
      .inventory.filter((s) => s.itemId !== WORLD_PVP_SKULL_BAG_ITEM_ID);
    slay(sim, a, b);
    sim.lootCorpse(b, a);
    expect(sim.meta(a)!.skullBag).toBeUndefined();
    expect(skullsCarried(sim, a).map((s) => s.materialSources)).toEqual([[victim(1002, 'Bet')]]);
  });
});

describe('store and take', () => {
  it('store moves every plain carried skull stack in, legacy and instanced copies handled', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.inventory.push(
      { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 2, materialSources: [victim(1002, 'Bet', 2)] },
      // A legacy stack with no records is stored as unrecorded skulls.
      { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1 },
      // A locked copy keeps its own identity in the bags.
      { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1, instance: { locked: true } },
    );
    sim.skullBagAction({ op: 'store' }, a);
    expect(meta.skullBag).toEqual([{ source: {}, count: 1 }, victim(1002, 'Bet', 2)]);
    expect(skullsCarried(sim, a)).toEqual([
      { itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1, instance: { locked: true } },
    ]);
    // Nothing left to store: refused with a line.
    sim.events = [];
    sim.skullBagAction({ op: 'store' }, a);
    expect(errorLines(sim, a)).toEqual([SKULL_BAG_NOTHING_LINE]);
  });

  it('take moves exactly the selected skulls back, keeping their victim', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.skullBag = [victim(1002, 'Bet', 3), victim(1003, 'Gimel')];
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet', 2)] }, a);
    expect(meta.skullBag).toEqual([victim(1002, 'Bet'), victim(1003, 'Gimel')]);
    expect(skullsCarried(sim, a).map((s) => [s.count, s.materialSources])).toEqual([
      [2, [victim(1002, 'Bet', 2)]],
    ]);
    // Emptying the bag clears the field, so an empty bag saves nothing.
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet'), victim(1003, 'Gimel')] }, a);
    expect(meta.skullBag).toBeUndefined();
  });

  it('refuses a take the bag cannot cover, a malformed one, and one the bags cannot fit', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.skullBag = [victim(1002, 'Bet')];
    for (const bad of [
      [victim(1002, 'Bet', 2)], // more than held
      [victim(1003, 'Gimel')], // a victim the bag does not hold
      [{ source: { gatherer: { kind: 'character', id: 1002, name: 'Bet' } }, count: 0 }],
      [{ source: { nope: 1 }, count: 1 }],
      'all',
      [],
    ]) {
      sim.skullBagAction({ op: 'take', sources: bad } as never, a);
      expect(meta.skullBag, JSON.stringify(bad)).toEqual([victim(1002, 'Bet')]);
    }
    expect(skullsCarried(sim, a)).toEqual([]);
    fillBags(sim, a);
    sim.events = [];
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet')] }, a);
    expect(errorLines(sim, a)).toEqual(['Your bags are full.']);
    expect(meta.skullBag).toEqual([victim(1002, 'Bet')]);
  });

  it('both commands need the bag carried; the contents wait for it', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.skullBag = [victim(1002, 'Bet')];
    meta.inventory = meta.inventory.filter((s) => s.itemId !== WORLD_PVP_SKULL_BAG_ITEM_ID);
    sim.events = [];
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet')] }, a);
    sim.skullBagAction({ op: 'store' }, a);
    expect(errorLines(sim, a)).toEqual([SKULL_BAG_MISSING_LINE, SKULL_BAG_MISSING_LINE]);
    expect(meta.skullBag).toEqual([victim(1002, 'Bet')]);
    // An unknown op is a malformed frame: ignored without a line.
    sim.events = [];
    sim.skullBagAction({ op: 'dump' } as never, a);
    expect(errorLines(sim, a)).toEqual([]);
  });
});

describe('the grant hub, the dead and the bags repaint', () => {
  it('a skull looted into the bag is still discovered for the Book of Deeds', () => {
    const { sim, a, b } = arena();
    expect(sim.meta(a)!.deedStats.itemsDiscovered.has(WORLD_PVP_SKULL_ITEM_ID)).toBe(false);
    slay(sim, a, b);
    sim.lootCorpse(b, a);
    expect(skullsCarried(sim, a)).toEqual([]);
    expect(sim.meta(a)!.deedStats.itemsDiscovered.has(WORLD_PVP_SKULL_ITEM_ID)).toBe(true);
  });

  it('store says so on a loot line (both hosts repaint the bags on one)', () => {
    const { sim, a } = arena();
    sim.meta(a)!.inventory.push({ itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1 });
    sim.events = [];
    sim.skullBagAction({ op: 'store' }, a);
    expect(lootTexts(sim, a)).toEqual([SKULL_BAG_STORED_ALL_LINE]);
  });

  it('take grants through the hub (a receipt the bags repaint on), as a movement', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.skullBag = [victim(1002, 'Bet')];
    const addItem = vi.spyOn(sim.ctx, 'addItem');
    sim.events = [];
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet')] }, a);
    expect(skullsCarried(sim, a)).toHaveLength(1);
    expect(lootTexts(sim, a)).toContain('You receive: Trophy Skull.');
    // A relocation of copies the player already held, never a fresh obtain.
    expect(addItem).toHaveBeenCalledWith(WORLD_PVP_SKULL_ITEM_ID, 1, a, {
      materialSources: [victim(1002, 'Bet')],
      movement: true,
    });
  });

  it('the dead move nothing between the bag and the bags', () => {
    const { sim, a } = arena();
    const meta = sim.meta(a)!;
    meta.skullBag = [victim(1002, 'Bet')];
    meta.inventory.push({ itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1 });
    ent(sim, a).dead = true;
    sim.events = [];
    sim.skullBagAction({ op: 'store' }, a);
    sim.skullBagAction({ op: 'take', sources: [victim(1002, 'Bet')] }, a);
    expect(errorLines(sim, a)).toEqual([
      "You can't do that while dead.",
      "You can't do that while dead.",
    ]);
    expect(meta.skullBag).toEqual([victim(1002, 'Bet')]);
    expect(skullsCarried(sim, a)).toEqual([{ itemId: WORLD_PVP_SKULL_ITEM_ID, count: 1 }]);
  });
});

describe('the readout and the save', () => {
  it('rides the IWorld readout only for a player with a bag or stored skulls', () => {
    const { sim, a, b } = arena();
    expect(worldPvpReadoutFor(sim.ctx, b)!.skullBag).toBeUndefined();
    expect(worldPvpReadoutFor(sim.ctx, a)!.skullBag).toEqual({
      owned: true,
      total: 0,
      sources: [],
    });
    sim.meta(a)!.skullBag = [victim(1002, 'Bet', 2)];
    sim.meta(a)!.inventory = sim
      .meta(a)!
      .inventory.filter((s) => s.itemId !== WORLD_PVP_SKULL_BAG_ITEM_ID);
    expect(worldPvpReadoutFor(sim.ctx, a)!.skullBag).toEqual({
      owned: false,
      total: 2,
      sources: [victim(1002, 'Bet', 2)],
    });
    // The server's 2 Hz flag readout never carries the bag: it has its own
    // change-gated key (server/world_pvp_wire.ts).
    expect(sim.worldPvpInfoFor(a)!.skullBag).toBeUndefined();
  });

  it('round-trips through the character save, and an empty bag saves nothing', () => {
    const { sim, a, b } = arena();
    expect(sim.serializeCharacter(a)!.skullBag).toBeUndefined();
    sim.meta(a)!.skullBag = [victim(1002, 'Bet', 2), { source: {}, count: 1 }];
    const saved = sim.serializeCharacter(a)!;
    expect(saved.skullBag).toEqual([victim(1002, 'Bet', 2), { source: {}, count: 1 }]);
    const fresh = world();
    const loaded = fresh.addPlayer('warrior', 'Aleph', {
      state: JSON.parse(JSON.stringify(saved)),
      characterId: 1001,
    });
    expect(fresh.meta(loaded)!.skullBag).toEqual([
      { source: {}, count: 1 },
      victim(1002, 'Bet', 2),
    ]);
    // A corrupt record refuses the load, like every other skull container:
    // provenance is never silently erased (the next save would make it final).
    for (const skullBag of [
      [{ source: {}, count: -3 }],
      [{ source: { gatherer: { kind: 'character', id: 1, name: '' } }, count: 1 }],
      'lots',
    ]) {
      expect(
        () =>
          world().addPlayer('warrior', 'Bet', {
            state: { ...sim.serializeCharacter(b)!, skullBag } as never,
            characterId: 1002,
          }),
        JSON.stringify(skullBag),
      ).toThrow(/refusing character load/);
    }
    expect(skullBagLoadValid([])).toBe(true);
    expect(skullBagLoadValid(undefined)).toBe(true);
  });
});
