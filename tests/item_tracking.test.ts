// Tracked-item grants through the inventory hub (src/sim/item_tracking.ts):
// every epic or legendary one-per-slot copy is minted with a guid and a
// provenance record on its way into the bags, keeps both across every
// container boundary, and records each change of hands. Driven through the
// real Sim commands (addItem, trade, mail, bank, equip, save/reload), never a
// hand-built payload, so the pins hold the shipped code paths.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import { isItemGuid, LEGACY_ITEM_SOURCE, WORLD_ITEM_SOURCE } from '../src/sim/item_provenance';
import { isTrackedItem } from '../src/sim/item_tracking';
import { MAIL_DELIVERY_SECONDS } from '../src/sim/mail/post_office';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const EPIC_WEAPON = 'duskforged_warblade';
const EPIC_ARMOR = 'duskforged_bulwark';
const LEGENDARY_WEAPON = 'kingsbane_last_oath';
const EPIC_MOUNT = 'reins_avian_strider'; // stackable: never tracked
const COMMON_WEAPON = 'worn_sword';
const HOST_GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

function makeSim(seed = 42, mintItemGuid?: () => string): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    world: VENDOR_TEST_WORLD,
    lockoutNowMs: () => 1_700_000_000_000,
    ...(mintItemGuid ? { mintItemGuid } : {}),
  });
}

function metaFor(sim: Sim, pid: number): PlayerMeta {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no meta for pid ${pid}`);
  return r.meta;
}

function slotsOf(sim: Sim, pid: number, itemId: string): InvSlot[] {
  return metaFor(sim, pid).inventory.filter((s) => s.itemId === itemId);
}

function trackedEvents(sim: Sim): ItemTrackedEvent[] {
  return sim.drainEvents().filter((e): e is ItemTrackedEvent => e.type === 'itemTracked');
}

function colocate(sim: Sim, a: number, b: number): void {
  const ea = sim.ctx.entities.get(a);
  const eb = sim.ctx.entities.get(b);
  if (!ea || !eb) throw new Error('missing players');
  eb.pos = { ...ea.pos };
  eb.prevPos = { ...eb.pos };
  sim.rebucket(eb as Entity);
}

function runTrade(sim: Sim, from: number, to: number, itemId: string): void {
  sim.tradeRequest(to, from);
  sim.tradeAccept(to);
  sim.tradeSetOffer([{ itemId, count: 1 }], 0, from);
  sim.tradeConfirm(from);
  sim.tradeConfirm(to);
}

describe('isTrackedItem', () => {
  it('tracks one-per-slot epic and legendary defs and nothing else', () => {
    expect(isTrackedItem(ITEMS[EPIC_WEAPON])).toBe(true);
    expect(isTrackedItem(ITEMS[EPIC_ARMOR])).toBe(true);
    expect(isTrackedItem(ITEMS[LEGENDARY_WEAPON])).toBe(true);
    expect(isTrackedItem(ITEMS[COMMON_WEAPON])).toBe(false);
    expect(isTrackedItem(ITEMS[EPIC_MOUNT])).toBe(false);
    expect(isTrackedItem(undefined)).toBe(false);
  });

  it("reads the copy's rolled quality over the def (a promoted legendary)", () => {
    expect(isTrackedItem(ITEMS['eastbrook_chain_vest'], { rolled: { quality: 'legendary' } })).toBe(
      true,
    );
  });
});

describe('the mint at the inventory hub', () => {
  it('stamps a plain epic grant with a guid and an origin record', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.drainEvents();
    sim.addItem(EPIC_WEAPON, 1, pid, { source: 'mob:forest_wolf' });
    const [slot] = slotsOf(sim, pid, EPIC_WEAPON);
    expect(slot.count).toBe(1);
    expect(isItemGuid(slot.instance?.guid)).toBe(true);
    expect(slot.instance?.provenance).toMatchObject({
      at: 1_700_000_000_000,
      by: metaFor(sim, pid).name,
      source: 'mob:forest_wolf',
    });
    expect(typeof slot.instance?.provenance?.zone).toBe('string');
    const events = trackedEvents(sim);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'mint',
      guid: slot.instance?.guid,
      itemId: EPIC_WEAPON,
      quality: 'epic',
      source: 'mob:forest_wolf',
      pid,
    });
  });

  it('leaves common and stackable epic grants plain', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.addItem(EPIC_MOUNT, 2, pid);
    expect(slotsOf(sim, pid, COMMON_WEAPON)[0].instance).toBeUndefined();
    const mounts = slotsOf(sim, pid, EPIC_MOUNT);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].count).toBe(2);
    expect(mounts[0].instance).toBeUndefined();
    expect(trackedEvents(sim)).toHaveLength(0);
  });

  it('mints every copy of a multi-count grant on its own guid', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(EPIC_ARMOR, 3, pid);
    const slots = slotsOf(sim, pid, EPIC_ARMOR);
    expect(slots).toHaveLength(3);
    const guids = new Set(slots.map((s) => s.instance?.guid));
    expect(guids.size).toBe(3);
    expect(trackedEvents(sim).filter((e) => e.kind === 'mint')).toHaveLength(3);
  });

  it('uses the host mint when the host supplies one', () => {
    let calls = 0;
    const sim = makeSim(42, () => {
      calls += 1;
      return HOST_GUID;
    });
    sim.addItem(EPIC_WEAPON, 1, sim.playerId);
    expect(calls).toBe(1);
    expect(slotsOf(sim, sim.playerId, EPIC_WEAPON)[0].instance?.guid).toBe(HOST_GUID);
  });

  it('falls back to the deterministic mint on a malformed host guid', () => {
    const sim = makeSim(42, () => 'not-a-guid');
    sim.addItem(EPIC_WEAPON, 1, sim.playerId);
    const guid = slotsOf(sim, sim.playerId, EPIC_WEAPON)[0].instance?.guid;
    expect(isItemGuid(guid)).toBe(true);
    expect(guid?.[14]).toBe('8');
  });

  it('is replay-stable without a host mint: two same-seed worlds agree', () => {
    const a = makeSim(7);
    const b = makeSim(7);
    a.addItem(EPIC_WEAPON, 1, a.playerId);
    b.addItem(EPIC_WEAPON, 1, b.playerId);
    expect(slotsOf(a, a.playerId, EPIC_WEAPON)[0].instance?.guid).toBe(
      slotsOf(b, b.playerId, EPIC_WEAPON)[0].instance?.guid,
    );
  });

  it('records the generic world source when no caller labelled the grant', () => {
    const sim = makeSim();
    sim.addItem(EPIC_WEAPON, 1, sim.playerId);
    expect(slotsOf(sim, sim.playerId, EPIC_WEAPON)[0].instance?.provenance?.source).toBe(
      WORLD_ITEM_SOURCE,
    );
  });

  it('derives the craft source from craftedRecipeId', () => {
    const sim = makeSim();
    sim.addItem(EPIC_WEAPON, 1, sim.playerId, { craftedRecipeId: 'recipe_x' });
    expect(slotsOf(sim, sim.playerId, EPIC_WEAPON)[0].instance?.provenance?.source).toBe(
      'craft:recipe_x',
    );
  });

  it('draws no rng: the shared stream is untouched by a mint', () => {
    const sim = makeSim();
    const before = sim.rng.next();
    const twin = makeSim();
    twin.rng.next();
    twin.addItem(EPIC_WEAPON, 1, twin.playerId);
    expect(twin.rng.next()).toBe(sim.rng.next());
    expect(before).not.toBeNaN();
  });
});

describe('changes of hands', () => {
  it('a trade appends the recipient to the owner chain and emits a transfer', () => {
    const sim = makeSim();
    const alice = sim.addPlayer('warrior', 'Alice', { characterId: 101 });
    const bob = sim.addPlayer('mage', 'Bob', { characterId: 202 });
    colocate(sim, alice, bob);
    sim.addItem(EPIC_WEAPON, 1, alice);
    const minted = slotsOf(sim, alice, EPIC_WEAPON)[0].instance?.guid;
    sim.drainEvents();

    runTrade(sim, alice, bob, EPIC_WEAPON);

    expect(slotsOf(sim, alice, EPIC_WEAPON)).toHaveLength(0);
    const [slot] = slotsOf(sim, bob, EPIC_WEAPON);
    expect(slot.instance?.guid).toBe(minted);
    expect(slot.instance?.provenance).toMatchObject({
      by: 'Alice',
      byId: 101,
      owners: [{ by: 'Bob', byId: 202 }],
      transfers: 1,
    });
    const events = trackedEvents(sim);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'transfer',
      guid: minted,
      by: 'Bob',
      byId: 202,
      pid: bob,
    });
  });

  it('a movement grant back to the same holder records nothing (a re-mint or rollback)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(EPIC_WEAPON, 1, pid);
    const [slot] = slotsOf(sim, pid, EPIC_WEAPON);
    const payload = slot.instance as ItemInstancePayload;
    sim.removeItem(EPIC_WEAPON, 1, pid);
    sim.drainEvents();
    sim.addItemInstance(EPIC_WEAPON, payload, pid, 1, { movement: true });
    const [back] = slotsOf(sim, pid, EPIC_WEAPON);
    expect(back.instance?.guid).toBe(payload.guid);
    expect(back.instance?.provenance?.owners).toBeUndefined();
    expect(back.instance?.provenance?.transfers).toBeUndefined();
    expect(trackedEvents(sim)).toHaveLength(0);
  });

  it('a plain pre-tracking copy first seen changing hands is minted as legacy', () => {
    const sim = makeSim();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    colocate(sim, alice, bob);
    // A legacy save: an epic sitting in the bags with no payload at all.
    metaFor(sim, alice).inventory.push({ itemId: EPIC_WEAPON, count: 1 });
    runTrade(sim, alice, bob, EPIC_WEAPON);
    const [slot] = slotsOf(sim, bob, EPIC_WEAPON);
    expect(isItemGuid(slot.instance?.guid)).toBe(true);
    expect(slot.instance?.provenance).toMatchObject({ by: 'Bob', source: LEGACY_ITEM_SOURCE });
  });

  it('a mailed copy arrives with the recipient on its chain', () => {
    const sim = makeSim();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Rex');
    const box = sim.ctx.entities.get(sim.postOffice.mailboxIds[0]);
    for (const pid of [sender, recipient]) {
      const p = sim.ctx.entities.get(pid);
      if (!box || !p) throw new Error('missing mailbox or player');
      p.pos = { ...box.pos };
      p.prevPos = { ...p.pos };
      sim.rebucket(p as Entity);
    }
    metaFor(sim, sender).copper = 10_000;
    sim.addItem(EPIC_WEAPON, 1, sender);
    const [staged] = slotsOf(sim, sender, EPIC_WEAPON);
    const minted = staged.instance?.guid;
    sim.drainEvents();

    sim.mailSend('Rex', 'a gift', '', 0, [{ ...staged }], sender);
    for (let i = 0; i < (MAIL_DELIVERY_SECONDS + 2) * 20; i++) sim.tick();
    const letter = sim.postOffice.mail.find(
      (m) => m.recipientName === 'Rex' && m.senderName === 'Sender',
    );
    expect(letter).toBeDefined();
    sim.drainEvents();
    sim.mailTake(letter?.id ?? -1, recipient);

    const [slot] = slotsOf(sim, recipient, EPIC_WEAPON);
    expect(slot.instance?.guid).toBe(minted);
    expect(slot.instance?.provenance).toMatchObject({
      by: 'Sender',
      owners: [{ by: 'Rex' }],
      transfers: 1,
    });
    expect(trackedEvents(sim).map((e) => e.kind)).toEqual(['transfer']);
  });
});

describe('identity across container boundaries', () => {
  it('survives equip, unequip, the bank, and a save/reload untouched', () => {
    const sim = makeSim(4106);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    sim.addItem(EPIC_ARMOR, 1, pid);
    const original = slotsOf(sim, pid, EPIC_ARMOR)[0].instance;
    const guid = original?.guid;
    const provenance = JSON.stringify(original?.provenance);

    // An epic shield carries a level requirement well above a fresh character.
    sim.setPlayerLevel(60, pid);
    sim.equipItem(EPIC_ARMOR, pid);
    expect(slotsOf(sim, pid, EPIC_ARMOR)).toHaveLength(0);
    const wornSlot = Object.entries(meta.equipment).find(([, id]) => id === EPIC_ARMOR)?.[0];
    expect(wornSlot).toBeDefined();
    expect(meta.equipmentInstance[wornSlot as keyof typeof meta.equipmentInstance]?.guid).toBe(
      guid,
    );
    sim.unequipItem(wornSlot as Parameters<Sim['unequipItem']>[0], pid);
    expect(slotsOf(sim, pid, EPIC_ARMOR)[0].instance?.guid).toBe(guid);

    const banker = sim.bankerIds
      .map((id) => sim.ctx.entities.get(id))
      .find((e): e is Entity => !!e && e.kind === 'npc');
    const p = sim.ctx.entities.get(pid);
    if (!banker || !p) throw new Error('missing banker or player');
    p.pos = { x: banker.pos.x + 1, y: banker.pos.y, z: banker.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p as Entity);
    const bagIndex = meta.inventory.findIndex((s) => s.itemId === EPIC_ARMOR);
    sim.drainEvents();
    sim.bankDeposit(bagIndex, undefined, pid);
    expect(slotsOf(sim, pid, EPIC_ARMOR)).toHaveLength(0);
    const banked = meta.bank.inventory.find((s) => s.itemId === EPIC_ARMOR);
    expect(banked?.instance?.guid).toBe(guid);
    sim.bankWithdraw(meta.bank.inventory.indexOf(banked as InvSlot), 1, pid);
    const withdrawn = slotsOf(sim, pid, EPIC_ARMOR)[0].instance;
    expect(withdrawn?.guid).toBe(guid);
    expect(JSON.stringify(withdrawn?.provenance)).toBe(provenance);
    // The bank is the owner's own custody: no change of hands is recorded.
    expect(trackedEvents(sim)).toHaveLength(0);

    const state = sim.serializeCharacter(pid);
    const reloaded = makeSim(1);
    const pid2 = reloaded.addPlayer('warrior', meta.name, { state: state ?? undefined });
    const after = slotsOf(reloaded, pid2, EPIC_ARMOR)[0].instance;
    expect(after?.guid).toBe(guid);
    expect(JSON.stringify(after?.provenance)).toBe(provenance);
  });

  it('the load bound drops a malformed guid or record but keeps the legal one', () => {
    const legal = {
      guid: HOST_GUID,
      provenance: { at: 1, by: 'Aaa', source: 'world' },
    };
    const clean = sanitizeItemInstancePayloadOnLoad({ ...legal });
    expect(clean.dropped).toEqual([]);
    expect(clean.payload).toEqual(legal);

    const bad = sanitizeItemInstancePayloadOnLoad({
      guid: 'NOPE',
      provenance: { at: 1, by: 'Aaa', source: 'world', owners: 'junk' },
      signer: 'Aaa',
    });
    expect(bad.dropped.sort()).toEqual(['guid', 'provenance']);
    expect(bad.payload).toEqual({ signer: 'Aaa' });
  });
});
