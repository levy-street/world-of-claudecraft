import { afterEach, describe, expect, it, vi } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import { MOBS, QUESTS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { rollEnemyLootQuality } from '../src/sim/loot/enemy_quality';
import {
  activeLootRolls,
  activeMasterLootRolls,
  lootRollGroupStatus,
  rollLoot,
} from '../src/sim/loot/loot_roll';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { rollWorldBossLoot } from '../src/sim/world_boss';

const ITEM = 'slagbreaker_helmet';
const quality: ItemInstancePayload = {
  lootQuality: { version: 1, tier: 4, weights: [1000, 2, 3, 4, 5] },
};

function setup(grouped = true, count = 1) {
  const sim = new Sim({ seed: 42, noPlayer: true, playerClass: 'warrior' });
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('mage', 'Bravo');
  if (grouped) {
    sim.partyInvite(b, a);
    sim.partyAccept(b);
  }
  const meta = sim.ctx.players.get(a)!;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { ...sim.entities.get(a)!.pos });
  Object.assign(mob, {
    dead: true,
    lootable: true,
    corpseTimer: 60,
    tappedById: a,
    lootRecipientIds: grouped ? [a, b] : [a],
  });
  mob.loot = { copper: 0, items: [{ itemId: ITEM, count, instance: structuredClone(quality) }] };
  sim.entities.set(mob.id, mob);
  return { sim, a, b, meta, mob };
}

function copy(sim: Sim, pid: number) {
  return sim.ctx.players.get(pid)!.inventory.find((s) => s.itemId === ITEM)?.instance;
}

function win(sim: Sim, a: number, b: number) {
  const id = activeLootRolls(sim.ctx, a)[0].rollId;
  sim.submitLootRoll(id, 'need', a);
  sim.submitLootRoll(id, 'pass', b);
}

afterEach(() => vi.restoreAllMocks());

describe('enemy quality copies through authoritative loot distribution', () => {
  it('opens a group roll for the enhanced copy and preserves its tier and BoP eligibility', () => {
    const { sim, a, b, mob } = setup();
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(copy(sim, a)).toBeUndefined();
    expect(activeLootRolls(sim.ctx, a)[0].instance).toEqual(quality);
    expect(lootRollGroupStatus(sim.ctx, b)[0].instance).toEqual(quality);
    win(sim, a, b);
    expect(copy(sim, a)?.lootQuality).toEqual(quality.lootQuality);
    expect(copy(sim, a)?.partyTrade?.eligible).toEqual(['Alpha', 'Bravo']);
  });

  it('projects only the public descriptor to the other candidates, never custody fields', () => {
    // Roll prompts, status rows and the party-wide loot events go through
    // publicInstanceView (the exchange allowlist): a corpse copy carrying
    // private custody data reaches the winner verbatim and everyone else
    // trimmed, so a future custody field never widens by default.
    const { sim, a, b, mob } = setup();
    mob.loot!.items[0].instance = {
      ...structuredClone(quality),
      boundTo: 99,
      bindOnTrade: true,
      charges: { private: 2 },
    };
    sim.drainEvents();
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    for (const pid of [a, b]) {
      expect(activeLootRolls(sim.ctx, pid)[0].instance).toEqual(quality);
      expect(lootRollGroupStatus(sim.ctx, pid)[0].instance).toEqual(quality);
    }
    const carried = (events: ReturnType<typeof sim.drainEvents>) =>
      events
        .filter((ev) => 'instance' in ev && ev.instance !== undefined)
        .map((ev) => (ev as { pid?: number; instance?: unknown }).instance);
    const opened = carried(sim.drainEvents());
    expect(opened.length).toBeGreaterThan(0);
    for (const instance of opened) expect(instance).toEqual(quality);
    win(sim, a, b);
    // The loser only ever sees the public projection; the winner's receipt is
    // their own custody copy and may carry more.
    const resolved = sim.drainEvents();
    const toLoser = carried(resolved.filter((ev) => 'pid' in ev && ev.pid === b));
    expect(toLoser.length).toBeGreaterThan(0);
    for (const instance of toLoser) expect(instance).toEqual(quality);
    // The winner's grant is the custody copy, not the projection: the private
    // fields the corpse copy carried arrive with it (the decisive negative for
    // a grant path accidentally switched to publicInstanceView).
    const won = copy(sim, a);
    expect(won?.lootQuality).toEqual(quality.lootQuality);
    expect(won?.bindOnTrade).toBe(true);
    expect(won?.charges).toEqual({ private: 2 });
  });

  it('directly loots every solo copy without rerolling quality', () => {
    const { sim, a, mob, meta } = setup(false, 2);
    const int = vi.spyOn(sim.ctx.rng, 'int');
    sim.lootCorpse(mob.id, a);
    expect(meta.inventory.filter((s) => s.itemId === ITEM).reduce((n, s) => n + s.count, 0)).toBe(
      2,
    );
    expect(
      meta.inventory
        .filter((s) => s.itemId === ITEM)
        .every((s) => s.instance?.lootQuality?.tier === 4),
    ).toBe(true);
    expect(int).not.toHaveBeenCalled();
  });

  it('holds a full-bag winner copy and grants it unchanged after room is freed', () => {
    const { sim, a, b, mob, meta } = setup();
    while (meta.inventory.length < bagCapacity(meta.bags)) sim.addItem('worn_sword', 1, a);
    sim.lootCorpse(mob.id, a);
    win(sim, a, b);
    const held = mob.loot!.items[0];
    expect(held.personalFor).toEqual([a]);
    expect(held.instance?.lootQuality).toEqual(quality.lootQuality);
    const stamp = structuredClone(held.instance);
    sim.lootCorpse(mob.id, b);
    expect(copy(sim, b)).toBeUndefined();
    sim.removeItem('worn_sword', 1, a);
    sim.lootCorpse(mob.id, a);
    expect(copy(sim, a)).toEqual(stamp);
  });

  it('returns distinct passed copies without merging their quality allocations', () => {
    const { sim, a, b, mob } = setup();
    const other = structuredClone(quality);
    other.lootQuality!.weights[0] = 8;
    mob.loot!.items.push({ itemId: ITEM, count: 1, instance: other });
    sim.lootCorpse(mob.id, a);
    for (const prompt of activeLootRolls(sim.ctx, a)) {
      sim.submitLootRoll(prompt.rollId, 'pass', a);
      sim.submitLootRoll(prompt.rollId, 'pass', b);
    }
    expect(mob.loot!.items).toHaveLength(2);
    expect(mob.loot!.items.every((s) => s.openToAll && s.count === 1)).toBe(true);
    sim.lootCorpse(mob.id, a);
    const copies = sim.ctx.players.get(a)!.inventory.filter((s) => s.itemId === ITEM);
    expect(copies.map((s) => s.instance?.lootQuality?.weights[0])).toEqual([1000, 8]);
    expect(copies.every((s) => s.instance?.partyTrade?.eligible.length === 2)).toBe(true);
  });

  it('carries the exact copy through master assignment', () => {
    const { sim, a, b, mob } = setup();
    sim.setPartyLootMaster(true, a, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const prompt = activeMasterLootRolls(sim.ctx, a)[0];
    expect(prompt.instance).toEqual(quality);
    sim.assignMasterLoot(prompt.rollId, [b], a);
    expect(copy(sim, b)?.lootQuality).toEqual(quality.lootQuality);
  });

  it('keeps the exact copy when master curation opens a restricted roll', () => {
    const { sim, a, b, mob } = setup();
    sim.setPartyLootMaster(true, a, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const prompt = activeMasterLootRolls(sim.ctx, a)[0];
    sim.assignMasterLoot(prompt.rollId, [a, b], a);
    expect(activeMasterLootRolls(sim.ctx, a)).toHaveLength(0);
    expect(activeLootRolls(sim.ctx, a)[0]).toMatchObject({
      rollId: prompt.rollId,
      instance: quality,
    });
    win(sim, a, b);
    expect(copy(sim, a)?.lootQuality).toEqual(quality.lootQuality);
    expect(sim.events.find((e) => e.type === 'loot' && e.text.includes(' wins '))).toMatchObject({
      rollId: prompt.rollId,
      itemId: ITEM,
      instance: quality,
    });
  });

  it('respects declared personal copy counts without losing copies or exceeding capacity', () => {
    const { sim, a, mob, meta } = setup(false, 2);
    mob.loot!.items[0].personalFor = [a];
    while (meta.inventory.length < bagCapacity(meta.bags) - 1) sim.addItem('worn_sword', 1, a);
    expect(sim.lootCorpse(mob.id, a)).toBe(false);
    expect(mob.loot!.items[0].count).toBe(2);
    sim.removeItem('worn_sword', 1, a);
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(sim.countItem(ITEM, a)).toBe(2);
    expect(
      meta.inventory
        .filter((s) => s.itemId === ITEM)
        .every((s) => s.instance?.lootQuality?.tier === 4),
    ).toBe(true);
  });

  it('honours round robin for enhanced copies', () => {
    const { sim, a, mob } = setup();
    sim.ctx.partyOf(a)!.lootStrategies.premiumItems = 'round-robin';
    sim.lootCorpse(mob.id, a);
    expect(copy(sim, a)?.lootQuality).toEqual(quality.lootQuality);
    expect(activeLootRolls(sim.ctx, a)).toHaveLength(0);
  });

  it('returns the same copy when every candidate disconnects', () => {
    const { sim, a, b, mob } = setup();
    sim.lootCorpse(mob.id, a);
    sim.removePlayer(a);
    sim.removePlayer(b);
    expect(mob.loot!.items[0].instance).toEqual(quality);
    expect(mob.loot!.items[0].openToAll).toBe(true);
  });
});

describe('enemy-only quality generation', () => {
  it.each([
    [9000, 1],
    [9900, 2],
    [9990, 3],
    [9999, 4],
  ])('takes tier draw %i through generation, roll and award', (draw, tier) => {
    const { sim, a, b, mob, meta } = setup();
    vi.spyOn(MOBS.forest_wolf, 'loot', 'get').mockReturnValue([{ itemId: ITEM, chance: 1 }]);
    vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) => (max === 9999 ? draw : min));
    rollLoot(sim.ctx, mob, meta, [meta, sim.ctx.players.get(b)!]);
    const generated = structuredClone(mob.loot!.items[0].instance);
    expect(generated?.lootQuality?.tier).toBe(tier);
    sim.lootCorpse(mob.id, a);
    expect(activeLootRolls(sim.ctx, a)[0].instance).toEqual(generated);
    win(sim, a, b);
    expect(copy(sim, a)?.lootQuality).toEqual(generated?.lootQuality);
  });

  it('adds quality to the resolved Heroic copy without changing the item selection', () => {
    const { sim, a, mob, meta } = setup(false);
    const base = 'deathlord_warplate';
    vi.spyOn(MOBS.forest_wolf, 'loot', 'get').mockReturnValue([{ itemId: base, chance: 1 }]);
    sim.ctx.instances.push({
      partyKey: a,
      difficulty: 'heroic',
      mobIds: [mob.id],
    } as unknown as (typeof sim.ctx.instances)[number]);
    vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) => (max === 9999 ? 9999 : min));
    rollLoot(sim.ctx, mob, meta);
    expect(mob.loot!.items).toMatchObject([
      { itemId: heroicVariantId(base), count: 1, instance: { lootQuality: { tier: 4 } } },
    ]);
    sim.lootCorpse(mob.id, a);
    expect(
      meta.inventory.find((s) => s.itemId === heroicVariantId(base))?.instance?.lootQuality?.tier,
    ).toBe(4);
  });

  it('rolls quality after the complete normal loot table and excludes quest and common drops', () => {
    const { sim, meta, mob } = setup(false);
    const quest = QUESTS[Object.keys(QUESTS)[0]];
    vi.spyOn(quest, 'objectives', 'get').mockReturnValue([
      { type: 'collect', itemId: ITEM, count: 1, label: 'Test collect' },
    ]);
    meta.questLog.set(quest.id, { questId: quest.id, counts: [0], state: 'active' });
    vi.spyOn(MOBS.forest_wolf, 'loot', 'get').mockReturnValue([
      { itemId: ITEM, chance: 1 },
      { copper: 10, chance: 1 },
      { itemId: 'worn_sword', chance: 1 },
      { itemId: ITEM, questId: quest.id, chance: 1 },
    ]);
    vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0);
    const int = vi
      .spyOn(sim.ctx.rng, 'int')
      .mockImplementation((min, max) => (max === 9999 ? 9999 : min));
    rollLoot(sim.ctx, mob, meta);
    const slots = mob.loot!.items;
    expect(slots).toHaveLength(3);
    expect(slots[0].instance?.lootQuality?.tier).toBe(4);
    expect(slots.slice(1).every((s) => !s.instance)).toBe(true);
    expect(int.mock.calls[0]).toEqual([6, 14]);
    expect(int.mock.calls.filter(([min, max]) => min === 0 && max === 9999)).toHaveLength(1);
  });

  it.each(['dev', 'owned', 'affix', 'dummy'] as const)('excludes %s source equipment', (source) => {
    const { sim, meta, mob } = setup(false);
    if (source === 'dummy') mob.templateId = Object.values(MOBS).find((m) => m.dummy)!.id;
    vi.spyOn(MOBS[mob.templateId], 'loot', 'get').mockReturnValue([{ itemId: ITEM, chance: 1 }]);
    if (source === 'dev') mob.devSpawnOwnerId = meta.entityId;
    if (source === 'owned') mob.ownerId = meta.entityId;
    if (source === 'affix') mob.affixSpawned = true;
    const int = vi.spyOn(sim.ctx.rng, 'int');
    rollLoot(sim.ctx, mob, meta);
    expect(mob.loot!.items[0].instance).toBeUndefined();
    expect(int).not.toHaveBeenCalled();
  });

  it('rolls each world boss personal copy after all contributor table draws', () => {
    const { sim, a, b, mob, meta } = setup();
    mob.templateId = 'thunzharr_waking_peak';
    const existing = { itemId: ITEM, count: 1 };
    mob.loot!.items = [existing];
    vi.spyOn(MOBS[mob.templateId], 'loot', 'get').mockReturnValue([{ itemId: ITEM, chance: 1 }]);
    const calls: string[] = [];
    vi.spyOn(sim.ctx.rng, 'chance').mockImplementation(() => {
      calls.push('table');
      return true;
    });
    vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) => {
      calls.push(max === 9999 ? 'tier' : 'allocation');
      return max;
    });
    rollWorldBossLoot(sim.ctx, mob, [meta, sim.ctx.players.get(b)!]);
    expect(calls.slice(0, 3)).toEqual(['table', 'table', 'tier']);
    expect(mob.loot!.items[0]).toBe(existing);
    expect(mob.loot!.items.slice(1).map((s) => s.personalFor)).toEqual([[a], [b]]);
    expect(mob.loot!.items.slice(1).every((s) => s.instance?.lootQuality?.tier === 4)).toBe(true);
  });

  it('rolls each selected equipment unit independently and leaves plain grants alone', () => {
    const { sim, a, mob } = setup(false);
    let tierRolls = 0;
    vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) =>
      max === 9999 ? [0, 9000, 9999][tierRolls++] : min,
    );
    const slots = rollEnemyLootQuality(sim.ctx.rng, mob, [{ itemId: ITEM, count: 3 }]);
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.count === 1)).toBe(true);
    expect(slots.map((s) => s.instance?.lootQuality?.tier)).toEqual([undefined, 1, 4]);
    expect(tierRolls).toBe(3);
    expect(slots[1].instance).not.toBe(slots[2].instance);
    sim.addItem(ITEM, 1, a);
    expect(copy(sim, a)).toBeUndefined();
  });
});
