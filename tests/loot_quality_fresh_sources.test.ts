// Permanent loot quality on non-enemy reward sources (docs/design/loot-quality.md):
// crafts, quest and world-quest rewards, caches, chests and the Buried Hoard
// parcel roll each new equipment copy through loot/fresh_quality_grant.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { HEROIC_MARK_CURRENCY_ID } from '../src/sim/content/dungeon_difficulty';
import { STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { BUILTIN_WORLD, DELVES, ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { EMISSARY_CACHE_ITEM_ID, emissaryCachePoolForClass } from '../src/sim/emissary_cache';
import { grantFreshLoot, rollFreshLootQualities } from '../src/sim/loot/fresh_quality_grant';
import { isEligibleLootQualityItem, type LootQualityDescriptor } from '../src/sim/loot_quality';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { PERFECTING_HEADSTART_RANK } from '../src/sim/professions/perfecting';
import { type StationType, stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { grantHoardReward } from '../src/sim/rift/hoard_reward_grant';
import { type HoardRewardInput, rollHoardReward } from '../src/sim/rift/hoard_reward_roll';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Rng } from '../src/sim/rng';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type {
  ItemInstancePayload,
  QuestDef,
  SimEvent,
  WorldContent,
  WorldQuestDef,
} from '../src/sim/types';
import { emptyWeeklyRewards, WEEKLY_KEEPER_ID, weeklyLootPool } from '../src/sim/weekly_rewards';
import { terrainHeight } from '../src/sim/world';
import {
  worldQuestItemRewardForQuest,
  worldQuestItemZonesForCycle,
} from '../src/sim/world_quest_item_slots';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  worldQuestCycleForResetDay,
} from '../src/sim/world_quest_rotation';
import { awardWorldQuest } from '../src/sim/world_quests';
import { runCraft } from './helpers/enchant_family_cast';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';
import { EMPTY_TEST_WORLD } from './sim_shared';

const GEAR = 'slagbreaker_helmet';
const MATERIAL = 'copper_ore';

/** An int that answers every quality draw (0..9999) with `draw` and every weight with 1000. */
function forcedQualityRng(draw: number, seed = 7) {
  const rng = new Rng(seed);
  const real = rng.int.bind(rng);
  vi.spyOn(rng, 'int').mockImplementation((min, max) =>
    min === 0 && max === 9999 ? draw : min === 1 && max === 1000 ? 1000 : real(min, max),
  );
  return rng;
}

function fakeCtx(rng: Rng) {
  const plain: Array<{ itemId: string; count: number }> = [];
  const instanced: Array<{ itemId: string; count: number; instance: ItemInstancePayload }> = [];
  return {
    plain,
    instanced,
    ctx: {
      rng,
      addItem: (itemId: string, count: number) => plain.push({ itemId, count }),
      addItemInstance: (itemId: string, instance: ItemInstancePayload, _pid?: number, count = 1) =>
        instanced.push({ itemId, count, instance }),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('grantFreshLoot', () => {
  it('mints an enhanced copy per winning draw and keeps the rest ordinary', () => {
    const rng = new Rng(1);
    const draws = [9500, 100, 9995];
    vi.spyOn(rng, 'int').mockImplementation((min) => (min === 0 ? draws.shift()! : 1000));
    const { ctx, plain, instanced } = fakeCtx(rng);
    grantFreshLoot(ctx, GEAR, 3, 1);
    expect(instanced.map((g) => [g.count, g.instance.lootQuality?.tier])).toEqual([
      [1, 1],
      [1, 3],
    ]);
    expect(plain).toEqual([{ itemId: GEAR, count: 1 }]);
  });

  it('keeps the base payload on enhanced and ordinary copies alike', () => {
    const base: ItemInstancePayload = { signer: 'Maker', bindOnTrade: true };
    const { ctx, instanced } = fakeCtx(forcedQualityRng(9999));
    grantFreshLoot(ctx, GEAR, 1, 1, undefined, base);
    expect(instanced[0].instance).toEqual({
      signer: 'Maker',
      bindOnTrade: true,
      lootQuality: { version: 1, tier: 4, weights: [1000, 1000, 1000, 1000, 1000] },
    });
    expect(base).toEqual({ signer: 'Maker', bindOnTrade: true });

    const ordinary = fakeCtx(forcedQualityRng(0));
    grantFreshLoot(ordinary.ctx, GEAR, 2, 1, undefined, base);
    expect(ordinary.instanced).toEqual([{ itemId: GEAR, count: 2, instance: base }]);
  });

  it('takes no draw for an ineligible item or an already-rolled copy', () => {
    const rng = new Rng(3);
    const int = vi.spyOn(rng, 'int');
    const { ctx, plain, instanced } = fakeCtx(rng);
    grantFreshLoot(ctx, MATERIAL, 5, 1);
    const rolled: ItemInstancePayload = {
      lootQuality: { version: 1, tier: 2, weights: [1, 2, 3, 4, 5] },
    };
    grantFreshLoot(ctx, GEAR, 1, 1, undefined, rolled);
    expect(int).not.toHaveBeenCalled();
    expect(plain).toEqual([{ itemId: MATERIAL, count: 5 }]);
    expect(instanced).toEqual([{ itemId: GEAR, count: 1, instance: rolled }]);
    expect(rollFreshLootQualities(rng, 'no_such_item', 1)).toEqual([]);
  });
});

describe('crafted equipment', () => {
  const recipe: ProfessionRecipeRecord = {
    id: '__fresh_quality_craft',
    professionId: 'armorcrafting',
    resultItemId: GEAR,
    resultCount: 1,
    reagents: [{ itemId: MATERIAL, count: 1 }],
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
  };

  it('rolls permanent quality on the crafted copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    sim.addItem(MATERIAL, 1, pid);
    const real = sim.ctx.rng.int.bind(sim.ctx.rng);
    vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) =>
      min === 0 && max === 9999 ? 9900 : real(min, max),
    );
    const result = resolveCraftForRecipe(sim.ctx, pid, recipe);
    expect(result.ok).toBe(true);
    const crafted = meta.inventory.filter((s) => s.itemId === GEAR);
    expect(crafted).toHaveLength(1);
    expect(crafted[0].instance?.lootQuality?.tier).toBe(2);
    // The craft result (and so the craftResult event and the crafted chat
    // line) carries the whole payload the bag copy holds, signer included.
    expect(result.instance).toEqual(crafted[0].instance);
  });
});

describe('Buried Hoard parcel', () => {
  const input: HoardRewardInput = {
    rarity: 'legendary',
    cls: 'warrior',
    level: 30,
    owner: true,
    guestCapped: false,
    mountOwned: true,
  };

  /** First seed whose owner parcel carries a gear piece. */
  function gearSeed(): number {
    for (let s = 1; s < 500; s++) {
      if (
        rollHoardReward(new Rng(s), input).items.some((i) =>
          isEligibleLootQualityItem(ITEMS[i.itemId]),
        )
      )
        return s;
    }
    throw new Error('no gear parcel in range');
  }

  it('draws the gear quality last, leaving every earlier outcome unchanged', () => {
    const seed = gearSeed();
    const enhanced = rollHoardReward(forcedQualityRng(9990, seed), input);
    const ordinary = rollHoardReward(forcedQualityRng(0, seed), input);
    expect(enhanced.items.map((i) => [i.itemId, i.count])).toEqual(
      ordinary.items.map((i) => [i.itemId, i.count]),
    );
    expect(enhanced.copper).toBe(ordinary.copper);
    expect(ordinary.items.some((i) => i.lootQuality)).toBe(false);
    const gear = enhanced.items.filter((i) => i.lootQuality);
    expect(gear).toHaveLength(1);
    expect(gear[0]).toMatchObject({ count: 1, lootQuality: { tier: 3 } });

    const rng = new Rng(seed);
    const calls: string[] = [];
    const int = rng.int.bind(rng);
    const chance = rng.chance.bind(rng);
    vi.spyOn(rng, 'int').mockImplementation((min, max) => {
      calls.push(min === 0 && max === 9999 ? 'quality' : 'int');
      return int(min, max);
    });
    vi.spyOn(rng, 'chance').mockImplementation((p) => {
      calls.push('chance');
      return chance(p);
    });
    const reward = rollHoardReward(rng, input);
    const q = calls.indexOf('quality');
    expect(q).toBeGreaterThan(0);
    expect(calls.slice(q + 1).every((c) => c === 'int')).toBe(true);
    // Same seed, same parcel: the quality is part of the frozen deterministic roll.
    expect(rollHoardReward(new Rng(seed), input)).toEqual(reward);
  });

  it('grants the stored quality on the copy and never on the materials', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    const lootQuality: LootQualityDescriptor = { version: 1, tier: 3, weights: [5, 4, 3, 2, 1] };
    expect(
      grantHoardReward(
        sim.ctx,
        pid,
        'legendary',
        {
          items: [
            { itemId: MATERIAL, count: 4 },
            { itemId: GEAR, count: 1, lootQuality },
          ],
          copper: 0,
          capped: false,
        },
        true,
      ),
    ).toBe(true);
    expect(meta.inventory.find((s) => s.itemId === GEAR)?.instance?.lootQuality).toEqual(
      lootQuality,
    );
    expect(meta.inventory.find((s) => s.itemId === MATERIAL)?.instance).toBeUndefined();
  });

  it('grants a malformed stored descriptor as the ordinary copy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    const bad = { version: 1, tier: 9, weights: [1, 1, 1, 1, 1] } as never;
    grantHoardReward(
      sim.ctx,
      pid,
      'legendary',
      { items: [{ itemId: GEAR, count: 1, lootQuality: bad }], copper: 0, capped: false },
      true,
    );
    const slot = meta.inventory.find((s) => s.itemId === GEAR);
    expect(slot).toBeDefined();
    expect(slot?.instance?.lootQuality).toBeUndefined();
  });
});

describe('craft admission stays exact', () => {
  // resolveCraftForRecipe admits a craft against ONE output stack of
  // resultCount; grantFreshLoot may split an eligible output into one slot per
  // copy. That is only safe while no eligible output is multi-copy or stackable.
  it('has no multi-copy or stackable equipment recipe output', () => {
    const offenders = ALL_RECIPES.filter((r) => {
      const def = ITEMS[r.resultItemId];
      return def && isEligibleLootQualityItem(def) && (r.resultCount > 1 || stackSizeOf(def) > 1);
    }).map((r) => r.id);
    expect(offenders).toEqual([]);
  });
});

describe('grantFreshLoot return value and edge counts', () => {
  it('returns a detached clone of the first enhanced copy whole payload', () => {
    const rng = new Rng(1);
    const draws = [100, 9995, 9500];
    vi.spyOn(rng, 'int').mockImplementation((min) => (min === 0 ? draws.shift()! : 1000));
    const { ctx, instanced } = fakeCtx(rng);
    const base: ItemInstancePayload = { signer: 'Maker' };
    const first = grantFreshLoot(ctx, GEAR, 3, 1, undefined, base);
    // The first ENHANCED copy (the second draw, tier 3), not the first copy.
    expect(first).toEqual({
      signer: 'Maker',
      lootQuality: { version: 1, tier: 3, weights: [1000, 1000, 1000, 1000, 1000] },
    });
    expect(first).toEqual(instanced[0].instance);
    expect(first).not.toBe(instanced[0].instance);
    first!.lootQuality!.weights[0] = 1;
    first!.signer = 'Thief';
    expect(instanced[0].instance.lootQuality?.weights[0]).toBe(1000);
    expect(instanced[0].instance.signer).toBe('Maker');
  });

  it('returns undefined when every copy is Ordinary, and for an ineligible item', () => {
    const { ctx } = fakeCtx(forcedQualityRng(0));
    expect(grantFreshLoot(ctx, GEAR, 3, 1)).toBeUndefined();
    const { ctx: enhancedCtx } = fakeCtx(forcedQualityRng(9999));
    expect(grantFreshLoot(enhancedCtx, MATERIAL, 3, 1)).toBeUndefined();
  });

  it('grants nothing and draws nothing for a zero count, with or without a base payload', () => {
    const rng = new Rng(4);
    const int = vi.spyOn(rng, 'int');
    const { ctx, plain, instanced } = fakeCtx(rng);
    expect(grantFreshLoot(ctx, GEAR, 0, 1)).toBeUndefined();
    expect(grantFreshLoot(ctx, GEAR, 0, 1, undefined, { signer: 'Maker' })).toBeUndefined();
    expect(int).not.toHaveBeenCalled();
    expect(plain).toEqual([]);
    expect(instanced).toEqual([]);
  });
});

describe('no multi-copy or stackable equipment recipe output: positive control', () => {
  it('the pinned recipe filter still sees eligible equipment outputs', () => {
    // Without this the offenders pin above passes vacuously the day the
    // eligibility filter or the recipe table stops matching anything.
    const eligible = ALL_RECIPES.filter((r) => {
      const def = ITEMS[r.resultItemId];
      return def && isEligibleLootQualityItem(def);
    });
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.some((r) => r.resultItemId === 'eastbrook_ritual_vestments')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-source wiring: each earned reward site drives its REAL entry point with
// an eligible gear item while every quality draw (rng.int(0, 9999)) is forced
// to 9999, so the granted copy must carry a tier 4 descriptor. A site that
// regressed to a plain ctx.addItem leaves the copy without an instance.
// ---------------------------------------------------------------------------

/** Answer every quality draw on `sim`'s rng with 9999 (tier 4); weights stay real. */
function forceEnhancedSim(sim: Sim) {
  const rng = sim.ctx.rng;
  const real = rng.int.bind(rng);
  const spy = vi
    .spyOn(rng, 'int')
    .mockImplementation((min, max) => (min === 0 && max === 9999 ? 9999 : real(min, max)));
  return () => spy.mock.calls.filter(([min, max]) => min === 0 && max === 9999).length;
}

function tier4Copies(sim: Sim, pid: number, itemId: string) {
  const meta = sim.players.get(pid)!;
  return meta.inventory.filter((s) => s?.itemId === itemId && s.instance?.lootQuality?.tier === 4);
}

describe('quest turn-in reward item', () => {
  const QUEST_ID = '__fresh_quality_quest';
  const quest: QuestDef = {
    id: QUEST_ID,
    name: 'Fresh quality quest',
    giverNpcId: 'foreman_odell',
    turnInNpcId: 'foreman_odell',
    text: '',
    completionText: '',
    objectives: [{ type: 'collect', itemId: 'spider_leg', count: 1, label: 'Leg' }],
    xpReward: 5,
    copperReward: 0,
    itemRewards: { warrior: GEAR },
  };
  afterEach(() => {
    delete QUESTS[QUEST_ID];
  });

  it('rolls permanent quality on the class reward through turnInQuestCore', () => {
    QUESTS[QUEST_ID] = quest;
    const sim = new Sim({ seed: 19, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    sim.addItem('spider_leg', 1, pid);
    meta.questLog.set(QUEST_ID, { questId: QUEST_ID, state: 'ready', counts: [1] });
    const draws = forceEnhancedSim(sim);
    expect(turnInQuestCore(sim.ctx, QUEST_ID, quest, meta)).toBe(true);
    expect(draws()).toBe(1);
    expect(tier4Copies(sim, pid, GEAR)).toHaveLength(1);
    expect(sim.countItem(GEAR, pid)).toBe(1);
  });
});

describe('world quest rewards', () => {
  const base = WORLD_QUESTS.find((q) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(q.id))!;

  function questSim() {
    const sim = new Sim({ seed: 4711, playerClass: 'warrior', autoEquip: false });
    sim.setPlayerLevel(20);
    const meta = sim.players.get(sim.playerId)!;
    meta.inventory = [];
    return { sim, pid: sim.playerId, meta };
  }

  it('rolls a quality per copy on a fixed extraItem (synthetic gear extra)', () => {
    const { sim, pid, meta } = questSim();
    // An always-active id carries no day's item, so only the extra grants.
    const quest: WorldQuestDef = {
      ...base,
      id: ALWAYS_ACTIVE_WORLD_QUEST_IDS[0],
      reward: { ...base.reward, extraItem: { itemId: GEAR, count: 2 } },
    };
    const draws = forceEnhancedSim(sim);
    awardWorldQuest(sim.ctx, meta, quest);
    expect(draws()).toBe(2);
    expect(tier4Copies(sim, pid, GEAR)).toHaveLength(2);
  });

  it("rolls permanent quality on the day's item", () => {
    const { sim, pid, meta } = questSim();
    let found: { cycle: string; quest: WorldQuestDef; itemId: string } | undefined;
    for (let offset = 0; offset < 60 && !found; offset++) {
      const day = new Date(Date.UTC(2026, 7, 31) + offset * 86_400_000).toISOString().slice(0, 10);
      const cycle = worldQuestCycleForResetDay(day);
      const zoneId = worldQuestItemZonesForCycle(cycle)[0];
      if (!zoneId) continue;
      const quest: WorldQuestDef = { ...base, zoneId, reward: undefined };
      const itemId = worldQuestItemRewardForQuest(cycle, quest, 'warrior', 20);
      if (itemId) found = { cycle, quest, itemId };
    }
    if (!found) throw new Error('no cycle with a day item slot');
    expect(isEligibleLootQualityItem(ITEMS[found.itemId])).toBe(true);
    meta.worldQuestCycle = found.cycle;
    const draws = forceEnhancedSim(sim);
    awardWorldQuest(sim.ctx, meta, found.quest);
    expect(draws()).toBe(1);
    expect(tier4Copies(sim, pid, found.itemId)).toHaveLength(1);
  });
});

describe('weekly vault choice claim', () => {
  it('rolls permanent quality on the claimed choice', () => {
    const WEEK = 604800000;
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      noPlayer: true,
      world: {
        ...BUILTIN_WORLD,
        camps: [],
        npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
        groundObjects: [],
      },
      lockoutNowMs: () => 1000,
      weeklyRaidResetMs: (n) => (Math.floor(n / WEEK) + 1) * WEEK,
    });
    const pid = sim.addPlayer('mage', 'Collector');
    const player = sim.entities.get(pid)!;
    player.level = 20;
    const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!;
    player.pos = { ...keeper.pos, x: keeper.pos.x - 1 };
    player.prevPos = { ...player.pos };
    sim.ctx.rebucket(player);
    const meta = sim.players.get(pid)!;
    meta.autoEquip = false;
    meta.inventory = [];
    const itemId = weeklyLootPool('world', 'mage')[0];
    expect(isEligibleLootQualityItem(ITEMS[itemId])).toBe(true);
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [
      { resetAtMs: 1000, choices: [{ pool: 'world', itemId, opened: true }] },
    ];
    const draws = forceEnhancedSim(sim);
    sim.claimWeeklyReward('1000:0', pid);
    expect(meta.weeklyRewards.vaults).toHaveLength(0);
    expect(draws()).toBe(1);
    expect(tier4Copies(sim, pid, itemId)).toHaveLength(1);
  });
});

describe("the Emissary's Cache", () => {
  it('rolls permanent quality on the raid piece and never on the marks', () => {
    const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: false });
    sim.tick();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    sim.addItem(EMISSARY_CACHE_ITEM_ID, 1, pid);
    const draws = forceEnhancedSim(sim);
    sim.useItem(EMISSARY_CACHE_ITEM_ID);
    expect(sim.countItem(EMISSARY_CACHE_ITEM_ID, pid)).toBe(0);
    const pool = new Set(emissaryCachePoolForClass('mage'));
    const pieces = meta.inventory.filter((s) => s && pool.has(s.itemId));
    expect(pieces).toHaveLength(1);
    expect(pieces[0].instance?.lootQuality?.tier).toBe(4);
    expect(draws()).toBe(1);
    expect(meta.heroicMarks).toBe(3);
    expect(meta.inventory.some((s) => s?.itemId === HEROIC_MARK_CURRENCY_ID)).toBe(false);
  });
});

describe('delve chest collect', () => {
  const DELVE_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

  /** A reliquary run at its finale with the boss dead, standing on the reward chest. */
  function chestRun() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, world: DELVE_WORLD });
    const pid = sim.playerId;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const door = DELVES.collapsed_reliquary.doorPos;
    const p = sim.player;
    p.pos = { x: door.x, y: terrainHeight(door.x, door.z, sim.cfg.seed), z: door.z };
    p.prevPos = { ...p.pos };
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(pid)!;
    run.bountiful = false;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric')!;
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    sim.tick();
    const chestId = run.rewardChestId!;
    const chest = sim.entities.get(chestId)!;
    p.pos = { ...chest.pos };
    p.prevPos = { ...chest.pos };
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    return { sim, pid, run, chestId };
  }

  it('the pendingLoot arm rolls quality on the gear and not on the material', () => {
    const { sim, pid, run, chestId } = chestRun();
    const state = run.objectState[chestId];
    expect(state.kind).toBe('locked_chest');
    state.pendingLoot = [
      { itemId: MATERIAL, count: 2 },
      { itemId: GEAR, count: 1 },
    ];
    state.lootOwnerId = pid;
    const draws = forceEnhancedSim(sim);
    sim.collectDelveChestLoot(chestId);
    expect(state.pendingLoot).toEqual([]);
    expect(draws()).toBe(1);
    expect(tier4Copies(sim, pid, GEAR)).toHaveLength(1);
    expect(sim.players.get(pid)!.inventory.find((s) => s?.itemId === MATERIAL)?.instance).toBe(
      undefined,
    );
  });

  it('the drowned reliquary partyLoot arm rolls quality on the collector slice', () => {
    const { sim, pid, run, chestId } = chestRun();
    const state = run.objectState[chestId];
    state.kind = 'drowned_reliquary';
    state.pendingLoot = undefined;
    state.partyLoot = { [pid]: [{ itemId: GEAR, count: 1 }] };
    const draws = forceEnhancedSim(sim);
    sim.collectDelveChestLoot(chestId);
    expect(state.partyLoot[pid]).toEqual([]);
    expect(draws()).toBe(1);
    expect(tier4Copies(sim, pid, GEAR)).toHaveLength(1);
  });
});

describe('Rift treasure chest', () => {
  it('rolls permanent quality on the opened cache gear', () => {
    let seed = -1;
    for (let s = 1; s < 800 && seed < 0; s++) {
      const f = generateRiftFloor(s, 20, 0);
      if (!f.isBoss && f.objects.some((o) => o.kind === 'treasure')) seed = s;
    }
    expect(seed).toBeGreaterThan(0);
    const sim = new Sim({
      seed,
      playerClass: 'warrior',
      autoEquip: false,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.playerId;
    sim.enterRift(seed, 20, pid);
    sim.player.gm = true;
    const chest = [...sim.entities.values()].find((e) => e.templateId === 'rift_treasure')!;
    expect(chest).toBeDefined();
    sim.player.pos = { ...chest.pos };
    sim.player.prevPos = { ...chest.pos };
    const meta = sim.players.get(pid)!;
    meta.inventory = [];
    const draws = forceEnhancedSim(sim);
    sim.riftOpenTreasure(chest.id, pid);
    expect(chest.templateId).toBe('rift_treasure_open');
    const gear = meta.inventory.filter((s) => s && isEligibleLootQualityItem(ITEMS[s.itemId]));
    expect(gear.length).toBeGreaterThan(0);
    expect(gear.every((s) => s.instance?.lootQuality?.tier === 4)).toBe(true);
    expect(draws()).toBe(gear.length);
  });
});

describe('vendor purchases never roll', () => {
  it.each([
    ['fury', 'final_argument_greatblade'],
    ['wardsmith_orun', 'wardplate_cuirass'],
  ])('buying %s stock %s mints a plain copy and takes no quality draw', (npcId, itemId) => {
    expect(isEligibleLootQualityItem(ITEMS[itemId])).toBe(true);
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Shopper');
    const meta = sim.players.get(pid)!;
    meta.autoEquip = false;
    meta.inventory = [];
    meta.copper = 1_000_000;
    meta.honor = 100_000;
    const vendor = [...sim.entities.values()].find((e) => e.templateId === npcId)!;
    expect(vendor, `${npcId} spawns`).toBeDefined();
    const player = sim.entities.get(pid)!;
    player.pos = { ...vendor.pos };
    player.prevPos = { ...player.pos };
    sim.ctx.rebucket(player);
    const rng = sim.ctx.rng;
    const real = rng.int.bind(rng);
    const int = vi
      .spyOn(rng, 'int')
      .mockImplementation((min, max) => (min === 0 && max === 9999 ? 9999 : real(min, max)));
    sim.buyItem(vendor.id, itemId, undefined, pid);
    // Positive premise: the purchase really landed.
    expect(sim.countItem(itemId, pid)).toBe(1);
    expect(meta.inventory.find((s) => s?.itemId === itemId)?.instance?.lootQuality).toBe(undefined);
    expect(int.mock.calls.some(([min, max]) => min === 0 && max === 9999)).toBe(false);
  });
});

describe('the sanctioned fresh-loot grant sites', () => {
  // A copy rolls its permanent quality exactly once, where it first enters the
  // world. So grantFreshLoot is called only from the earned reward sources; a
  // vendor purchase, a transfer (mail, trade, bank, buyback, market) or a dev
  // grant that started calling it would mint a second roll. The importers pin
  // closes the aliased-import hole (`import { grantFreshLoot as g }`).
  const SIM_ROOT = fileURLToPath(new URL('../src/sim', import.meta.url));
  const CALL = /\bgrantFreshLoot\s*\(/;
  const IMPORT = /from\s+'[./]*(?:loot\/)?fresh_quality_grant'/;
  const scan = (pattern: RegExp) =>
    tsFilesUnder(SIM_ROOT)
      .filter((source) => pattern.test(stripComments(readFileSync(source.full, 'utf8'))))
      .map((source) => source.file)
      .sort();

  it('calls grantFreshLoot only from the sanctioned reward sources', () => {
    expect(scan(CALL)).toEqual(
      [
        'clue_casket.ts',
        'delves/runs.ts',
        'emissary_cache.ts',
        'loot/fresh_quality_grant.ts',
        'professions/crafting.ts',
        'quests/quest_commands.ts',
        'rift/runs.ts',
        'weekly_rewards.ts',
        'world_quest_reward_mail.ts',
      ].sort(),
    );
  });

  it('imports the helper module only from those sources and the Hoard parcel roll', () => {
    expect(scan(IMPORT)).toEqual(
      [
        'clue_casket.ts',
        'delves/runs.ts',
        'emissary_cache.ts',
        'professions/crafting.ts',
        'quests/quest_commands.ts',
        'rift/hoard_reward_roll.ts',
        'rift/runs.ts',
        'weekly_rewards.ts',
        'world_quest_reward_mail.ts',
      ].sort(),
    );
  });

  it('positive controls: the patterns match a real call and import, and comments never count', () => {
    expect(CALL.test('  grantFreshLoot(ctx, id, 1, pid);')).toBe(true);
    expect(CALL.test('  rollFreshLootQualities(rng, id, 1);')).toBe(false);
    expect(CALL.test(stripComments('// grantFreshLoot(ctx, id, 1)\n/* grantFreshLoot( */'))).toBe(
      false,
    );
    expect(IMPORT.test("import { grantFreshLoot } from './loot/fresh_quality_grant';")).toBe(true);
    expect(IMPORT.test("import { grantFreshLoot } from '../loot/fresh_quality_grant';")).toBe(true);
    // The walk is recursive (nested sim modules are in the sanctioned set) and
    // covers the whole sim tree, so an empty or flat scan cannot pass.
    expect(tsFilesUnder(SIM_ROOT).length).toBeGreaterThan(900);
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});

describe('crafted copies through the real Sim craft command', () => {
  /** Answer call N of rng.next with values[N] (the last repeating): the
   *  perfecting.test.ts forceRollSequence idiom. 0 hits the proc; 0.9999 maps
   *  the quality draw to 9999 (tier 4) and every weight to 1000. */
  function forceRollSequence(sim: Sim, values: number[]): () => number {
    let draws = 0;
    (sim.rng as { next: () => number }).next = () => {
      const v = values[Math.min(draws, values.length - 1)];
      draws += 1;
      return v;
    };
    return () => draws;
  }
  const TIER4 = { version: 1, tier: 4, weights: [1000, 1000, 1000, 1000, 1000] };
  type CraftResultEvent = Extract<SimEvent, { type: 'craftResult' }>;
  const craftResultsOf = (sim: Sim) =>
    sim.drainEvents().filter((ev): ev is CraftResultEvent => ev.type === 'craftResult');

  /** A vestments crafter (the masterwork bonusStats arm) with the bill in hand. */
  function vestmentsCrafter(seed: number) {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
    sim.addItem('spider_leg', 1, pid);
    sim.addItem('homespun_cloth', 3, pid);
    sim.addItem('spool_of_thread', 5, pid);
    sim.drainEvents();
    return { sim, pid, meta };
  }

  it('the craftResult event carries the crafted copy whole payload as `instance`', () => {
    const { sim, pid, meta } = vestmentsCrafter(53);
    // A proc miss, then an enhanced quality: the plain (unsigned) grant arm.
    forceRollSequence(sim, [0.999, 0.9999]);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    const slot = meta.inventory.find((s) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slot?.instance?.lootQuality).toEqual(TIER4);
    const [ev] = craftResultsOf(sim).filter((e) => e.ok);
    expect(ev).toBeDefined();
    expect(ev.instance).toEqual(slot?.instance);
    expect(ev.instance).toEqual({ lootQuality: TIER4 });
    expect('lootQuality' in ev).toBe(false);
  });

  it('an Ordinary crafted copy emits no instance key on craftResult', () => {
    const { sim, pid, meta } = vestmentsCrafter(53);
    forceRollSequence(sim, [0.999, 0]);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    const slot = meta.inventory.find((s) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slot).toBeDefined();
    expect(slot?.instance?.lootQuality).toBeUndefined();
    const [ev] = craftResultsOf(sim).filter((e) => e.ok);
    expect(ev).toBeDefined();
    expect('instance' in ev).toBe(false);
  });

  it('a masterwork proc and an enhanced quality compose on one copy', () => {
    const { sim, pid, meta } = vestmentsCrafter(53);
    forceRollSequence(sim, [0, 0.9999]);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    expect(meta.lastCraftResult?.masterwork).toBe(true);
    const slot = meta.inventory.find((s) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slot?.instance?.rolled?.masterwork).toBe(true);
    expect(slot?.instance?.rolled?.stats).toBeDefined();
    expect(slot?.instance?.signer).toBeTruthy();
    expect(slot?.instance?.lootQuality).toEqual(TIER4);
    // The event links the whole composed payload, not just the quality.
    const [ev] = craftResultsOf(sim).filter((e) => e.ok);
    expect(ev.instance).toEqual(slot?.instance);
    expect(ev.masterwork).toBe(true);
  });

  it('a Perfecting head start and an enhanced quality compose on one copy', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.archetype.activeArchetype = 'jewelcrafting';
    const recipe = recipeById('recipe_wyrmfall_pendant');
    if (!recipe) throw new Error('the apex neck recipe exists');
    if (recipe.stationType) {
      const station = stationsOfType(STATIONS, recipe.stationType as StationType)[0];
      const e = sim.entities.get(pid)!;
      e.pos.x = station.pos.x;
      e.pos.z = station.pos.z;
      e.prevPos = { ...e.pos };
    }
    meta.knownRecipes?.add(recipe.id);
    for (const g of recipe.reagents) sim.addItem(g.itemId, g.count, pid);
    sim.drainEvents();
    forceRollSequence(sim, [0, 0.9999]);
    runCraft(sim, recipe.id, false, pid);
    expect(meta.lastCraftResult?.masterwork).toBe(true);
    const slot = meta.inventory.find((s) => s.itemId === 'wyrmfall_pendant');
    expect(slot?.instance?.perfecting).toBe(PERFECTING_HEADSTART_RANK);
    expect(slot?.instance?.signer).toBeTruthy();
    expect(slot?.instance?.lootQuality).toEqual(TIER4);
    const [ev] = craftResultsOf(sim).filter((e) => e.ok);
    expect(ev.instance).toEqual(slot?.instance);
  });
});
