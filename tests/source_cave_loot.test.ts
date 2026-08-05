import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { createGroundObject } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import { lootCorpse } from '../src/sim/interaction';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  buildSourceCaveChestLoot,
  SOURCE_CAVE_EPIC_WEAPON_CHANCE,
  SOURCE_CAVE_EPIC_WEAPON_POOL,
  SOURCE_CAVE_GUARANTEED_RARE_POOL,
  SOURCE_CAVE_RARE_ITEM_CHANCE,
  SOURCE_CAVE_RARE_ITEM_ID,
} from '../src/sim/source_cave/loot';
import type { Entity, SimEvent } from '../src/sim/types';

// Reward-chest loot builder (classic shared drop). These drive
// buildSourceCaveChestLoot through the real SimContext seam (sim.ctx) and exercise
// the shared corpse-loot machinery (lootCorpse) against a hand-built chest-shaped
// entity, so the group-loot distribution (looter-takes-all solo, need/greed in a
// party) is proven on the real code path, not re-implemented here.

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

const makeSim = (seed = 42): AnySim =>
  new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;

function playerMeta(sim: AnySim, pid: number): PlayerMeta {
  const meta = sim.ctx.players.get(pid);
  if (!meta) throw new Error(`expected player ${pid}`);
  return meta;
}

function addRecipients(sim: AnySim, n: number): PlayerMeta[] {
  const metas: PlayerMeta[] = [];
  for (let i = 0; i < n; i++) metas.push(playerMeta(sim, sim.addPlayer('warrior', `R${i}`)));
  return metas;
}

const GUARANTEED_RARE_IDS = new Set<string>(SOURCE_CAVE_GUARANTEED_RARE_POOL);
const EPIC_WEAPON_IDS = new Set<string>(SOURCE_CAVE_EPIC_WEAPON_POOL);

describe('source cave chest loot: shape and pool', () => {
  it('yields exactly one shared themed rare (classic single-drop semantics)', () => {
    const sim = makeSim();
    const loot = buildSourceCaveChestLoot(sim.ctx);
    expect(loot.copper).toBe(0);
    const guaranteed = loot.items.filter((s) => GUARANTEED_RARE_IDS.has(s.itemId));
    expect(guaranteed).toHaveLength(1);
    expect(guaranteed[0].count).toBe(1);
  });

  it('marks every slot shared: no personalFor, no openToAll (the group loot method decides)', () => {
    const sim = makeSim(7);
    const loot = buildSourceCaveChestLoot(sim.ctx);
    expect(loot.items.length).toBeGreaterThan(0);
    for (const slot of loot.items) {
      expect(slot.openToAll).toBeUndefined();
      expect(slot.personalFor).toBeUndefined();
    }
  });
});

describe('source cave chest loot: both table arms', () => {
  it('drops the bonus rare AND one epic weapon alongside the guaranteed rare', () => {
    const sim = makeSim();
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    const loot = buildSourceCaveChestLoot(sim.ctx);
    vi.restoreAllMocks();
    expect(loot.items).toHaveLength(3);
    expect(loot.items.filter((s) => GUARANTEED_RARE_IDS.has(s.itemId))).toHaveLength(1);
    expect(loot.items.filter((s) => s.itemId === SOURCE_CAVE_RARE_ITEM_ID)).toHaveLength(1);
    // Exactly ONE epic weapon even on a hit (single-drop semantics).
    const epics = loot.items.filter((s) => EPIC_WEAPON_IDS.has(s.itemId));
    expect(epics).toHaveLength(1);
    expect(epics[0].count).toBe(1);
  });

  it('drops neither bonus when the chance draws miss (forced false)', () => {
    const sim = makeSim();
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    const loot = buildSourceCaveChestLoot(sim.ctx);
    vi.restoreAllMocks();
    expect(loot.items.some((s) => s.itemId === SOURCE_CAVE_RARE_ITEM_ID)).toBe(false);
    expect(loot.items.some((s) => EPIC_WEAPON_IDS.has(s.itemId))).toBe(false);
    expect(loot.items).toHaveLength(1);
    expect(GUARANTEED_RARE_IDS.has(loot.items[0].itemId)).toBe(true);
  });

  it('uses a rare chance that traces to the cited item (0.08, inside the 0.05-0.19 band)', () => {
    expect(SOURCE_CAVE_RARE_ITEM_CHANCE).toBeGreaterThanOrEqual(0.05);
    expect(SOURCE_CAVE_RARE_ITEM_CHANCE).toBeLessThanOrEqual(0.19);
    expect(SOURCE_CAVE_RARE_ITEM_CHANCE).toBe(0.08);
  });

  it('keeps the epic weapon at the rare-bonus floor (very rare, user call)', () => {
    expect(SOURCE_CAVE_EPIC_WEAPON_CHANCE).toBe(0.08);
  });
});

describe('source cave chest loot: rollable ids are pinned, not self-compared', () => {
  it('the bonus rare id and guaranteed themed pool are pinned to their literal values', () => {
    // Every other assertion in this file compares against these SAME exported constants,
    // which would not catch a rename/typo desync between loot.ts and the items registry.
    // Pin the literals directly so that kind of drift fails here.
    expect(SOURCE_CAVE_RARE_ITEM_ID).toBe('source_cave_mantle');
    expect([...SOURCE_CAVE_GUARANTEED_RARE_POOL]).toEqual([
      'conflictbreaker_breastplate',
      'cherry_pickers_gauntlets',
      'maintainers_crown',
    ]);
    expect([...SOURCE_CAVE_EPIC_WEAPON_POOL]).toEqual([
      'commit_blade',
      'bug_squasher',
      'mech_keyboard',
    ]);
  });

  it('every rollable id resolves to a real ItemDef (no dangling id, no missing stats/icon)', () => {
    expect(ITEMS[SOURCE_CAVE_RARE_ITEM_ID]).toBeDefined();
    for (const id of SOURCE_CAVE_GUARANTEED_RARE_POOL) {
      expect(ITEMS[id], `expected ${id} to be a registered item`).toBeDefined();
    }
    for (const id of SOURCE_CAVE_EPIC_WEAPON_POOL) {
      expect(ITEMS[id], `expected ${id} to be a registered item`).toBeDefined();
    }
  });

  it('the guaranteed pool covers strength, agility, and caster class groups', () => {
    expect(ITEMS.conflictbreaker_breastplate).toMatchObject({
      name: 'Conflictbreaker Breastplate',
      kind: 'armor',
      armorType: 'mail',
      slot: 'chest',
      quality: 'rare',
      stats: { armor: 230, str: 9, sta: 6 },
    });
    expect(ITEMS.cherry_pickers_gauntlets).toMatchObject({
      name: "Cherry-Picker's Gauntlets",
      kind: 'armor',
      armorType: 'leather',
      slot: 'gloves',
      quality: 'rare',
      stats: { armor: 110, agi: 7, sta: 3 },
    });
    expect(ITEMS.maintainers_crown).toMatchObject({
      name: "Maintainer's Crown",
      kind: 'armor',
      armorType: 'cloth',
      slot: 'helmet',
      quality: 'rare',
      stats: { armor: 76, int: 8, spi: 4 },
    });
    expect(ITEMS.conflictbreaker_breastplate.requiredClass).toBeUndefined();
    expect(ITEMS.cherry_pickers_gauntlets.requiredClass).toBeUndefined();
    expect(ITEMS.maintainers_crown.requiredClass).toBeUndefined();
  });

  it('every class can equip its intended stat-profile rare through existing armor rules', () => {
    const intended = new Map([
      ['conflictbreaker_breastplate', ['warrior', 'paladin', 'shaman']],
      ['cherry_pickers_gauntlets', ['rogue', 'hunter']],
      ['maintainers_crown', ['mage', 'priest', 'warlock', 'druid']],
    ] as const);
    for (const [itemId, classes] of intended) {
      for (const cls of classes) {
        expect(canEquipItem(cls, ITEMS[itemId]), `${cls} can equip ${itemId}`).toBe(true);
      }
    }
  });

  it('every epic weapon is an epic level-20 mainhand (the dungeon-worthy reward contract)', () => {
    for (const id of SOURCE_CAVE_EPIC_WEAPON_POOL) {
      const item = ITEMS[id];
      expect(item.quality, id).toBe('epic');
      expect(item.kind, id).toBe('weapon');
      expect(item.slot, id).toBe('mainhand');
      expect(item.requiredLevel, id).toBe(20);
      expect(item.requiredClass, id).toBeUndefined();
    }
  });

  it('The Keystroke is the agility epic and no longer carries caster stats', () => {
    expect(ITEMS.mech_keyboard.stats).toEqual({ agi: 12, sta: 8 });
  });
});

describe('source cave chest loot: determinism', () => {
  it('same seed reproduces the exact loot', () => {
    const build = () => buildSourceCaveChestLoot(makeSim(9001).ctx);
    expect(build()).toEqual(build());
  });

  it('draws the fixed sequence: guaranteed pick, two chances, epic pick only on a hit', () => {
    // Both chance draws miss: one int (the guaranteed rare pick), two chance calls.
    const miss = makeSim(123);
    const missChance = vi.spyOn(miss.ctx.rng, 'chance').mockReturnValue(false);
    const missInt = vi.spyOn(miss.ctx.rng, 'int');
    buildSourceCaveChestLoot(miss.ctx);
    expect(missChance).toHaveBeenCalledTimes(2);
    expect(missInt).toHaveBeenCalledTimes(1);
    expect(missInt).toHaveBeenNthCalledWith(1, 0, 2);
    vi.restoreAllMocks();

    // Both hit: the epic which-weapon pick adds the second int draw.
    const hit = makeSim(123);
    const hitChance = vi.spyOn(hit.ctx.rng, 'chance').mockReturnValue(true);
    const hitInt = vi.spyOn(hit.ctx.rng, 'int');
    buildSourceCaveChestLoot(hit.ctx);
    expect(hitChance).toHaveBeenCalledTimes(2);
    expect(hitInt).toHaveBeenCalledTimes(2);
    expect(hitInt).toHaveBeenNthCalledWith(1, 0, 2);
    expect(hitInt).toHaveBeenNthCalledWith(2, 0, 2);
    vi.restoreAllMocks();
  });
});

describe('source cave chest loot: classic group-loot distribution', () => {
  // A chest armed the way clear.ts arms it: shared loot, tapped for the group,
  // candidates pinned to the kill-time recipient set.
  function makeArmedChest(sim: AnySim, metas: PlayerMeta[], forceRare: boolean): Entity {
    const chest = createGroundObject(sim.nextId++, '', 'Source Cache', { x: 0, y: 0, z: 0 });
    chest.templateId = 'source_cave_chest';
    chest.objectItemId = null;
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(forceRare);
    chest.loot = buildSourceCaveChestLoot(sim.ctx);
    vi.restoreAllMocks();
    chest.lootable = true;
    chest.respawnTimer = Infinity;
    chest.tappedById = metas[0].entityId;
    chest.lootRecipientIds = metas.map((m) => m.entityId);
    sim.entities.set(chest.id, chest);
    return chest;
  }

  function teleportTo(sim: AnySim, pid: number, x: number, z: number): void {
    const e = sim.ctx.entities.get(pid) as Entity;
    e.pos = { x, y: e.pos.y, z };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  }

  it('a solo clearer takes the drop directly (looter-takes-all), exactly once', () => {
    const sim = makeSim(555);
    const [a] = addRecipients(sim, 1);
    const chest = makeArmedChest(sim, [a], true);
    const itemIds = (chest.loot as { items: { itemId: string }[] }).items.map((s) => s.itemId);

    teleportTo(sim, a.entityId, 0, 0);
    lootCorpse(sim.ctx, chest.id, a.entityId);
    for (const id of itemIds) expect(sim.ctx.countItem(id, a.entityId)).toBe(1);
    expect(chest.loot).toBeNull();
    expect(chest.lootable).toBe(false);

    // A second loot grants nothing: the chest was pruned empty.
    lootCorpse(sim.ctx, chest.id, a.entityId);
    for (const id of itemIds) expect(sim.ctx.countItem(id, a.entityId)).toBe(1);
  });

  it('a party gets the classic need/greed roll instead of a direct grant', () => {
    const sim = makeSim(556);
    const [a, b] = addRecipients(sim, 2);
    sim.partyInvite(b.entityId, a.entityId);
    sim.partyAccept(b.entityId);
    expect(sim.partyOf(a.entityId)?.members).toEqual([a.entityId, b.entityId]);

    const chest = makeArmedChest(sim, [a, b], false);
    const itemId = (chest.loot as { items: { itemId: string }[] }).items[0].itemId;

    teleportTo(sim, a.entityId, 0, 0);
    teleportTo(sim, b.entityId, 0, 0);
    sim.drainEvents();
    lootCorpse(sim.ctx, chest.id, a.entityId);

    // The guaranteed rare opens a need/greed roll for both members (the party
    // default premiumItems strategy); nobody is granted the item directly.
    const events = sim.drainEvents() as SimEvent[];
    const rollPrompts = events.filter(
      (e: SimEvent & { itemId?: string }) => e.type === 'lootRoll' && e.itemId === itemId,
    );
    expect(rollPrompts).toHaveLength(2);
    expect(sim.ctx.countItem(itemId, a.entityId)).toBe(0);
    expect(sim.ctx.countItem(itemId, b.entityId)).toBe(0);

    // Both roll need: the machinery resolves and exactly one of them wins the item.
    const rollId = (rollPrompts[0] as SimEvent & { rollId: number }).rollId;
    sim.submitLootRoll(rollId, 'need', a.entityId);
    sim.submitLootRoll(rollId, 'need', b.entityId);
    const total = sim.ctx.countItem(itemId, a.entityId) + sim.ctx.countItem(itemId, b.entityId);
    expect(total).toBe(1);
  });

  it('an everyone-passes roll returns the item to the chest instead of destroying it', () => {
    const sim = makeSim(557);
    const [a, b] = addRecipients(sim, 2);
    sim.partyInvite(b.entityId, a.entityId);
    sim.partyAccept(b.entityId);

    const chest = makeArmedChest(sim, [a, b], false);
    const itemId = (chest.loot as { items: { itemId: string }[] }).items[0].itemId;

    teleportTo(sim, a.entityId, 0, 0);
    teleportTo(sim, b.entityId, 0, 0);
    sim.drainEvents();
    lootCorpse(sim.ctx, chest.id, a.entityId);
    const events = sim.drainEvents() as SimEvent[];
    const rollId = (
      events.find((e: SimEvent) => e.type === 'lootRoll') as SimEvent & { rollId: number }
    ).rollId;

    sim.submitLootRoll(rollId, 'pass', a.entityId);
    sim.submitLootRoll(rollId, 'pass', b.entityId);

    // The chest is an object (not a dead mob): the passed item still returns to
    // it as an open-to-all slot rather than vanishing.
    const loot = chest.loot as { items: { itemId: string; openToAll?: boolean }[] } | null;
    expect(loot).not.toBeNull();
    expect(loot?.items.some((s) => s.itemId === itemId && s.openToAll === true)).toBe(true);
    expect(chest.lootable).toBe(true);
  });

  it('an everyone-passes roll never returns an item to a LIVE mob (the object arm stays narrow)', () => {
    // Per-dimension negative for the widened returnLootRollItemToCorpse guard
    // (!mob.dead && mob.kind !== 'object'): a live kind:'mob' roll target must
    // keep the pre-change behavior (no returned slot), or a regression that
    // dropped the dead-check would resurrect loot onto living mobs.
    const sim = makeSim(558);
    const [a, b] = addRecipients(sim, 2);
    sim.partyInvite(b.entityId, a.entityId);
    sim.partyAccept(b.entityId);

    const target = makeArmedChest(sim, [a, b], false);
    target.kind = 'mob'; // a LIVE mob-shaped roll target (dead stays false)
    const itemId = (target.loot as { items: { itemId: string }[] }).items[0].itemId;

    teleportTo(sim, a.entityId, 0, 0);
    teleportTo(sim, b.entityId, 0, 0);
    sim.drainEvents();
    lootCorpse(sim.ctx, target.id, a.entityId);
    const events = sim.drainEvents() as SimEvent[];
    const rollId = (
      events.find((e: SimEvent) => e.type === 'lootRoll') as SimEvent & { rollId: number }
    ).rollId;

    sim.submitLootRoll(rollId, 'pass', a.entityId);
    sim.submitLootRoll(rollId, 'pass', b.entityId);

    // Live mob: the guard early-returns, so no open-to-all slot reappears and
    // nobody received the item.
    const loot = target.loot as { items: { itemId: string; openToAll?: boolean }[] } | null;
    expect(loot?.items.some((s) => s.itemId === itemId && s.openToAll === true) ?? false).toBe(
      false,
    );
    expect(sim.ctx.countItem(itemId, a.entityId)).toBe(0);
    expect(sim.ctx.countItem(itemId, b.entityId)).toBe(0);
  });
});
