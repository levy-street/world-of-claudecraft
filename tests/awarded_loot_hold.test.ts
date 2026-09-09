import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HELD_LOOT_CORPSE_SECONDS } from '../src/sim/loot/awarded_loot_hold';
import { BOP_PARTY_TRADE_MS } from '../src/sim/loot/bop_trade_window';
import { awardSharedLootItem, submitLootRoll } from '../src/sim/loot/loot_roll';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, LootSlot, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

// The awarded-loot hold (src/sim/loot/awarded_loot_hold.ts): a need/greed,
// master-loot, or round-robin winner whose bags are full no longer has the
// item force-added past their bag capacity (67/62). The award stays on the
// corpse as a slot only the winner can take, the corpse keeps at least a full
// decay window, and the item decays with the corpse if they never make room
// (deliberately no mailbox fallback: that would make the mailbox an unlimited
// bag).

const UNCOMMON = 'greyjaw_hide_boots'; // opens a need/greed roll under default strategies
const SOULBOUND = 'slagbreaker_helmet'; // soulbound: the award carries the BoP trade window
const STACKABLE_SOULBOUND = 'sigil_anvil_chest';
const COMMON = 'worn_sword'; // common: round-robin under default party strategies

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });

function partyOfThree(seed = 42) {
  const sim = makeSim(seed);
  const a = sim.addPlayer('warrior', 'Aaa');
  const b = sim.addPlayer('mage', 'Bbb');
  const c = sim.addPlayer('rogue', 'Ccc');
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  sim.partyInvite(c, a);
  sim.partyAccept(c);
  return { sim, a, b, c };
}

function playerMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.ctx.players.get(pid);
  if (!meta) throw new Error(`expected player ${pid}`);
  return meta;
}

// Fill every free slot with distinct 1-per-slot gear so the next add has
// nowhere to go (the tests/bags.test.ts idiom).
function fillBags(sim: Sim, pid: number): void {
  const m = playerMeta(sim, pid);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => (d.kind === 'weapon' || d.kind === 'armor') && d.id !== UNCOMMON)
    .filter((d) => d.id !== SOULBOUND && d.id !== COMMON)
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
  expect(m.inventory.length).toBe(cap);
}

// Drop the whole last stack so exactly one bag slot opens up.
function freeOneSlot(sim: Sim, pid: number): void {
  const meta = playerMeta(sim, pid);
  const last = meta.inventory[meta.inventory.length - 1];
  sim.removeItem(last.itemId, last.count, pid);
  expect(meta.inventory.length).toBe(bagCapacity(meta.bags) - 1);
}

// A fresh tapped corpse whose loot slots have already been consumed by the
// looter (awardSharedLootItem is what lootCorpse calls per slot).
function deadCorpse(sim: Sim, tapper: number, recipients: number[], corpseTimer = 60): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.lootable = true;
  mob.corpseTimer = corpseTimer;
  mob.tappedById = tapper;
  mob.lootRecipientIds = recipients;
  mob.loot = { copper: 0, items: [] };
  sim.entities.set(mob.id, mob);
  return mob;
}

function lootRollEvent(sim: Sim): Extract<SimEvent, { type: 'lootRoll' }> {
  const event = sim.events.find((e): e is Extract<SimEvent, { type: 'lootRoll' }> => {
    return e.type === 'lootRoll';
  });
  if (!event) throw new Error('expected loot roll event');
  return event;
}

function tickFor(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

// Need/greed roll on `itemId` that `winner` wins with need while the others pass.
function winRoll(sim: Sim, mob: Entity, itemId: string, winner: number, others: number[]): void {
  awardSharedLootItem(sim.ctx, itemId, mob, playerMeta(sim, winner));
  const rollId = lootRollEvent(sim).rollId;
  submitLootRoll(sim.ctx, rollId, 'need', winner);
  for (const pid of others) submitLootRoll(sim.ctx, rollId, 'pass', pid);
}

function heldSlot(mob: Entity, itemId: string): LootSlot | undefined {
  return mob.loot?.items.find((s) => s.itemId === itemId && s.personalFor);
}

describe('awarded loot hold: a roll winner with full bags', () => {
  it('keeps the award on the corpse as a winner-only slot instead of overfilling the bags', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const cap = bagCapacity(playerMeta(sim, a).bags);
    const mob = deadCorpse(sim, a, [a, b, c]);
    sim.events.length = 0;
    winRoll(sim, mob, UNCOMMON, a, [b, c]);

    expect(sim.countItem(UNCOMMON, a)).toBe(0);
    expect(playerMeta(sim, a).inventory.length).toBe(cap);
    const held = expectDefined(heldSlot(mob, UNCOMMON));
    expect(held.count).toBe(1);
    expect(held.personalFor).toEqual([a]);
    expect(held.openToAll).toBeUndefined();
    expect(mob.lootable).toBe(true);
    expect(mob.corpseTimer).toBeGreaterThanOrEqual(HELD_LOOT_CORPSE_SECONDS);
    // The winner is told where the item went; the roll's win line still fired.
    const lines = sim.events
      .filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot' && e.pid === a)
      .map((e) => e.text);
    expect(lines.some((l) => l.startsWith(`Aaa wins [[i:${UNCOMMON}]]`))).toBe(true);
    expect(lines).toContain(
      `Your bags are full; [[i:${UNCOMMON}]] is waiting on the corpse for you.`,
    );
  });

  it('extends a nearly decayed corpse to the full held window on the hold', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const mob = deadCorpse(sim, a, [a, b, c]);
    awardSharedLootItem(sim.ctx, UNCOMMON, mob, playerMeta(sim, a));
    const rollId = lootRollEvent(sim).rollId;
    // Opening the roll pins the corpse for the roll window; the winner answers
    // late, with the corpse nearly decayed by then.
    mob.corpseTimer = 2;
    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect(mob.corpseTimer).toBe(HELD_LOOT_CORPSE_SECONDS);
  });

  it('nobody else can take the held item, and the winner can once a slot is free', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const mob = deadCorpse(sim, a, [a, b, c]);
    winRoll(sim, mob, UNCOMMON, a, [b, c]);
    for (const pid of [a, b, c]) {
      const p = expectDefined(sim.entities.get(pid));
      p.pos = { ...mob.pos };
    }
    // A party mate looting the corpse gets nothing: the slot is not theirs.
    sim.lootCorpse(mob.id, b);
    expect(sim.countItem(UNCOMMON, b)).toBe(0);
    expect(heldSlot(mob, UNCOMMON)?.count).toBe(1);
    // The winner with full bags still cannot take it (bags-full toast, item stays).
    sim.lootCorpse(mob.id, a);
    expect(sim.countItem(UNCOMMON, a)).toBe(0);
    expect(heldSlot(mob, UNCOMMON)?.count).toBe(1);
    // Free one slot and loot again: the held award lands.
    freeOneSlot(sim, a);
    sim.lootCorpse(mob.id, a);
    expect(sim.countItem(UNCOMMON, a)).toBe(1);
    expect(heldSlot(mob, UNCOMMON)).toBeUndefined();
  });

  it('a held soulbound award still carries the bind-on-pickup party trade window when taken', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const mob = deadCorpse(sim, a, [a, b, c]);
    winRoll(sim, mob, SOULBOUND, a, [b, c]);
    const awardedAtMs = Math.floor(sim.time * 1000);
    freeOneSlot(sim, a);
    const p = expectDefined(sim.entities.get(a));
    p.pos = { ...mob.pos };
    sim.lootCorpse(mob.id, a);
    const slot = expectDefined(playerMeta(sim, a).inventory.find((s) => s.itemId === SOULBOUND));
    expect(slot.instance?.partyTrade?.eligible).toEqual(['Aaa', 'Bbb', 'Ccc']);
    expect(slot.instance?.partyTrade?.untilMs).toBe(awardedAtMs + BOP_PARTY_TRADE_MS);
  });

  it('holds a stackable soulbound award when only a plain stack has room', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const meta = playerMeta(sim, a);
    const last = meta.inventory[meta.inventory.length - 1];
    sim.removeItem(last.itemId, last.count, a);
    sim.addItem(STACKABLE_SOULBOUND, 19, a);
    expect(meta.inventory.length).toBe(bagCapacity(meta.bags));
    expect(sim.ctx.canAddItem(STACKABLE_SOULBOUND, 1, a)).toBe(true);
    const mob = deadCorpse(sim, a, [a, b, c]);

    winRoll(sim, mob, STACKABLE_SOULBOUND, a, [b, c]);

    expect(sim.countItem(STACKABLE_SOULBOUND, a)).toBe(19);
    expect(expectDefined(heldSlot(mob, STACKABLE_SOULBOUND)).personalFor).toEqual([a]);
    const p = expectDefined(sim.entities.get(a));
    p.pos = { ...mob.pos };
    sim.lootCorpse(mob.id, a);
    expect(sim.countItem(STACKABLE_SOULBOUND, a)).toBe(19);
    expect(heldSlot(mob, STACKABLE_SOULBOUND)).toBeDefined();
  });

  it('decays with the corpse if the winner never makes room (no mailbox fallback)', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const cap = bagCapacity(playerMeta(sim, a).bags);
    const mob = deadCorpse(sim, a, [a, b, c]);
    winRoll(sim, mob, UNCOMMON, a, [b, c]);
    mob.corpseTimer = 0.05;
    tickFor(sim, 1);
    expect(mob.lootable).toBe(false);
    expect(sim.countItem(UNCOMMON, a)).toBe(0);
    expect(playerMeta(sim, a).inventory.length).toBe(cap);
    const p = expectDefined(sim.entities.get(a));
    p.pos = { ...mob.pos };
    freeOneSlot(sim, a);
    expect(sim.lootCorpse(mob.id, a)).toBe(false);
    expect(sim.countItem(UNCOMMON, a)).toBe(0);
  });

  it('grants as before when the corpse is already gone at resolution (never destroys)', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, a);
    const mob = deadCorpse(sim, a, [a, b, c]);
    awardSharedLootItem(sim.ctx, UNCOMMON, mob, playerMeta(sim, a));
    const rollId = lootRollEvent(sim).rollId;
    sim.ctx.dropEntity(mob.id);
    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect(sim.countItem(UNCOMMON, a)).toBe(1);
  });

  it('a winner with room still receives the award directly (the hold never engages)', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c]);
    winRoll(sim, mob, UNCOMMON, a, [b, c]);
    expect(sim.countItem(UNCOMMON, a)).toBe(1);
    expect(heldSlot(mob, UNCOMMON)).toBeUndefined();
  });

  it('is deterministic per seed', () => {
    const run = () => {
      const { sim, a, b, c } = partyOfThree(7);
      fillBags(sim, a);
      const mob = deadCorpse(sim, a, [a, b, c]);
      winRoll(sim, mob, UNCOMMON, a, [b, c]);
      tickFor(sim, 1);
      return JSON.stringify([mob.loot, mob.corpseTimer, playerMeta(sim, a).inventory]);
    };
    expect(run()).toEqual(run());
  });
});

describe('awarded loot hold: master loot and round-robin awards', () => {
  it('holds a master-loot assignment for a full-bags target on the corpse', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, b);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    const mob = deadCorpse(sim, a, [a, b, c]);
    awardSharedLootItem(sim.ctx, UNCOMMON, mob, playerMeta(sim, a));
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');
    sim.assignMasterLoot(rollId, [b], a);
    expect(sim.countItem(UNCOMMON, b)).toBe(0);
    expect(expectDefined(heldSlot(mob, UNCOMMON)).personalFor).toEqual([b]);
  });

  it('holds a round-robin common award for a full-bags recipient on the corpse', () => {
    const { sim, a, b, c } = partyOfThree();
    for (const pid of [a, b, c]) fillBags(sim, pid);
    const mob = deadCorpse(sim, a, [a, b, c]);
    const consumed = awardSharedLootItem(sim.ctx, COMMON, mob, playerMeta(sim, a));
    expect(consumed).toBe(true);
    expect([a, b, c].map((pid) => sim.countItem(COMMON, pid))).toEqual([0, 0, 0]);
    expect(expectDefined(heldSlot(mob, COMMON)).personalFor).toHaveLength(1);
  });
});
