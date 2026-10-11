// The award-time `lootRollAwarded` event (src/sim/loot/loot_roll.ts): the one
// signal that names the player a party roll actually GRANTED an item to.
//
// The `lootRoll` prompt fans one copy out per candidate before anyone has
// rolled, so a consumer that treats it as "X received the drop" (the Discord
// rare-drop card did, keyed per roll id) names whichever candidate's copy came
// first: a party member who never won, and often one who then goes looking in
// their bags and mail for an item they were never given. This suite pins that
// the award event fires exactly once per roll, only at resolution, and carries
// the winner's pid on every grant path: a need/greed win, a direct master-loot
// assignment, and a master roll converted to need/greed.
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { assignMasterLoot, awardSharedLootItem, submitLootRoll } from '../src/sim/loot/loot_roll';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, LootSlot, SimEvent } from '../src/sim/types';

type Awarded = Extract<SimEvent, { type: 'lootRollAwarded' }>;
const ITEM = 'greyjaw_hide_boots'; // uncommon: opens a roll under default strategies

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

function deadCorpse(sim: Sim, tapper: number, recipients: number[], items: LootSlot[]): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = tapper;
  mob.lootRecipientIds = recipients;
  mob.loot = { copper: 0, items };
  sim.entities.set(mob.id, mob);
  return mob;
}

function fillBags(sim: Sim, pid: number): void {
  const m = playerMeta(sim, pid);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => (d.kind === 'weapon' || d.kind === 'armor') && d.id !== ITEM)
    .map((d) => d.id);
  for (let i = 0; m.inventory.length < cap; i++) sim.addItem(gearIds[i % gearIds.length], 1, pid);
  expect(m.inventory.length).toBe(cap);
}

function awarded(sim: Sim): Awarded[] {
  return sim.events.filter((e): e is Awarded => e.type === 'lootRollAwarded');
}

function rollIdOf(sim: Sim, type: 'lootRoll' | 'masterLoot'): number {
  const ev = sim.events.find((e) => e.type === type);
  if (!ev || (ev.type !== 'lootRoll' && ev.type !== 'masterLoot'))
    throw new Error(`expected a ${type} event`);
  return ev.rollId;
}

describe('loot_roll: lootRollAwarded names the player who actually won', () => {
  it('fires nothing when the roll opens, then exactly once for the need winner', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'lootRoll');
    // The prompt went to every candidate, the award to nobody yet.
    expect(sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(3);
    expect(awarded(sim)).toEqual([]);

    submitLootRoll(sim.ctx, rollId, 'greed', a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    expect(awarded(sim)).toEqual([]);
    submitLootRoll(sim.ctx, rollId, 'need', c);

    expect(sim.countItem(ITEM, c)).toBe(1);
    expect(awarded(sim)).toEqual([
      {
        type: 'lootRollAwarded',
        rollId,
        itemId: ITEM,
        itemName: 'Greyjaw Hide Boots',
        quality: 'uncommon',
        pid: c,
      },
    ]);
  });

  it('fires nothing when everyone passes (the item returns to the corpse)', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'lootRoll');
    for (const pid of [a, b, c]) submitLootRoll(sim.ctx, rollId, 'pass', pid);
    expect(awarded(sim)).toEqual([]);
  });

  it('fires nothing when the winner logged out before the grant (item conserved on the corpse)', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'lootRoll');
    submitLootRoll(sim.ctx, rollId, 'need', b);
    submitLootRoll(sim.ctx, rollId, 'pass', a);
    // Abrupt departure that bypasses removePlayerFromLootRolls: the resolve
    // path's own guard returns the item instead of granting to a ghost.
    sim.entities.delete(b);
    sim.ctx.players.delete(b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect(awarded(sim)).toEqual([]);
    expect(mob.loot?.items.some((s) => s.itemId === ITEM)).toBe(true);
  });

  it('fires for the winner even when full bags hold the item on the corpse for them', () => {
    const { sim, a, b, c } = partyOfThree();
    fillBags(sim, b);
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'lootRoll');
    submitLootRoll(sim.ctx, rollId, 'need', b);
    submitLootRoll(sim.ctx, rollId, 'pass', a);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect(sim.countItem(ITEM, b)).toBe(0);
    expect(mob.loot?.items.some((s) => s.itemId === ITEM && s.personalFor?.[0] === b)).toBe(true);
    expect(awarded(sim).map((e) => [e.rollId, e.pid])).toEqual([[rollId, b]]);
  });

  it('fires exactly once when the roll window EXPIRES with an undecided candidate', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'lootRoll');
    submitLootRoll(sim.ctx, rollId, 'greed', a);
    // b never answers. Age the roll to its deadline rather than ticking the
    // whole world for a minute: the tick's expiry sweep then resolves it (an
    // unanswered candidate counts as a pass) and later ticks find nothing left.
    const roll = sim.ctx.pendingLootRolls.get(rollId);
    if (!roll) throw new Error('expected the roll to be pending');
    roll.expiresAt = sim.ctx.time;
    const drained: Awarded[] = [];
    for (let i = 0; i < 5; i++)
      drained.push(...sim.tick().filter((e): e is Awarded => e.type === 'lootRollAwarded'));
    expect(sim.ctx.pendingLootRolls.has(rollId)).toBe(false);
    expect(sim.countItem(ITEM, a)).toBe(1);
    expect(drained.map((e) => [e.rollId, e.pid])).toEqual([[rollId, a]]);
  });

  it('fires once for a direct master-loot assignment, naming the assignee', () => {
    const { sim, a, b, c } = partyOfThree();
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'masterLoot');
    expect(awarded(sim)).toEqual([]);
    assignMasterLoot(sim.ctx, rollId, [b], a);
    expect(sim.countItem(ITEM, b)).toBe(1);
    expect(awarded(sim).map((e) => [e.rollId, e.pid])).toEqual([[rollId, b]]);
  });

  it('fires once, with the ORIGINAL roll id, when a master roll converts to need/greed', () => {
    const { sim, a, b, c } = partyOfThree();
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    const mob = deadCorpse(sim, a, [a, b, c], [{ itemId: ITEM, count: 1 }]);
    awardSharedLootItem(sim.ctx, ITEM, mob, playerMeta(sim, a));
    const rollId = rollIdOf(sim, 'masterLoot');
    assignMasterLoot(sim.ctx, rollId, [b, c], a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'need', c);
    expect(sim.countItem(ITEM, c)).toBe(1);
    expect(awarded(sim).map((e) => [e.rollId, e.pid])).toEqual([[rollId, c]]);
  });
});
