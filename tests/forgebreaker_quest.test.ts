import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { DEEDS } from '../src/sim/content/deeds';
import { recipeById } from '../src/sim/content/recipes';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { evaluateDeedsFor } from '../src/sim/deeds';
import { countsTowardCompletion } from '../src/sim/deeds_completion';
import { createMob, createNpc } from '../src/sim/entity';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { itemLevel } from '../src/sim/item_level';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { maxCraftCountForRecipe, requiredReagentCountFor } from '../src/sim/professions/crafting';
import { ownedItemCount } from '../src/sim/quests/quest_owned_count';
import {
  catalogCharacterCompletion,
  catalogRankOwned,
  isCataloguedRelicItem,
} from '../src/sim/reliquary';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { completeCraftCast, runCraft } from './helpers/enchant_family_cast';

const RECOVERY = 'q_forgefathers_requiem';
const FORGING = 'q_requiem_at_the_forge';
const RECIPE = 'recipe_varkhul_forgebreaker';
const EMBER = 'forgefathers_ember';
const HAMMER = 'varkhul_forgebreaker';
const MAELIN = 'archivist_maelin_ember_projection';

function smith(cls: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: 83, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const meta = expectDefined(sim.players.get(pid), 'smith');
  meta.craftSkills.weaponcrafting = 125;
  meta.copper = 100000;
  meta.questsDone.add('q_ignivar_the_forgefather');
  // Real quest verbs still verify proximity against a live NPC.
  const projection = createNpc(90001, NPCS[MAELIN], { ...sim.player.pos });
  sim.addEntity(projection);
  return { sim, pid, meta, projection };
}

function learnHammer() {
  const state = smith();
  expect(QUESTS[RECOVERY], 'recovery quest must be registered').toBeDefined();
  state.sim.acceptQuest(RECOVERY);
  state.sim.addItem(EMBER, 1);
  state.sim.turnInQuest(RECOVERY);
  expect(state.meta.knownRecipes.has(RECIPE)).toBe(true);
  return state;
}

function atForge(sim: Sim) {
  const forge = expectDefined(
    sim.ctx.stationPlacements.find((station) => station.type === 'forge'),
    'forge',
  );
  sim.player.pos = { x: forge.pos.x, y: sim.player.pos.y, z: forge.pos.z };
  sim.player.prevPos = { ...sim.player.pos };
}

function materials(sim: Sim) {
  sim.addItem('lastflame_core', 15);
  sim.addItem('fine_thorium_ore', 10);
  sim.addItem('fine_elderwood_log', 6);
}

function fillBags(meta: PlayerMeta) {
  while (meta.inventory.length < bagCapacity(meta.bags)) {
    meta.inventory.push({ itemId: 'worn_sword', count: 1 });
  }
}

describe('Forgebreaker one-time quest route', () => {
  it('registers a skill-125 quest-only recipe without retuning the existing legendary', () => {
    const recipe = expectDefined(recipeById(RECIPE), 'Forgebreaker recipe');
    expect(recipe).toMatchObject({
      professionId: 'weaponcrafting',
      resultItemId: HAMMER,
      resultCount: 1,
      skillReq: 125,
      level: 42,
      stationType: 'forge',
      acquisition: ['quest'],
      consumeOnCraft: true,
    });
    expect(recipe.reagents).toEqual([
      { itemId: EMBER, count: 1, noDiscount: true },
      { itemId: 'lastflame_core', count: 15, noDiscount: true },
      { itemId: 'fine_thorium_ore', count: 10 },
      { itemId: 'fine_elderwood_log', count: 6 },
    ]);
    expect(ITEMS[HAMMER]).toMatchObject({
      soulbound: true,
      quality: 'legendary',
      weapon: { min: 77, max: 115, speed: 3.6 },
      stats: { str: 44, sta: 32, agi: 19 },
      requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
    });
    expect(ITEMS[HAMMER].masterwrought).toBeUndefined();
    expect(itemLevel(ITEMS[HAMMER])).toBe(55);
    expect(QUESTS[FORGING].text).toContain('Fine Osmium Ore');
    expect(QUESTS[FORGING].text).toContain('Fine Highpine Logs');
    expect(
      requiredReagentCountFor(
        true,
        recipe.reagents[1],
        { weaponcrafting: 125 },
        'weaponcrafting',
        true,
      ).count,
    ).toBe(15);
  });

  it('keeps the recovered relic, teaches once, and never grants a free replacement', () => {
    const { sim, meta } = learnHammer();
    expect(sim.countItem(EMBER)).toBe(1);
    expect(ITEMS[EMBER]).toMatchObject({
      kind: 'quest',
      soulbound: true,
      noDiscard: true,
      questId: RECOVERY,
    });
    expect(QUESTS[RECOVERY].requiresQuest).toBe('q_ignivar_the_forgefather');
    expect(QUESTS[RECOVERY].requiredItems).toBeUndefined();
    expect(QUESTS[FORGING].requiredItems).toBeUndefined();
    expect(QUESTS[FORGING]).toMatchObject({
      requiresQuest: RECOVERY,
      keepsCollectedItems: true,
      objectives: [{ type: 'collect', itemId: HAMMER, count: 1 }],
    });
    sim.turnInQuest(RECOVERY);
    expect(sim.countItem(EMBER)).toBe(1);
    expect(meta.questsDone.has(RECOVERY)).toBe(true);
    sim.acceptQuest(FORGING);
    sim.abandonQuest(FORGING);
    sim.acceptQuest(FORGING);
    expect(sim.countItem(EMBER)).toBe(1);
  });

  it('refuses an early turn-in without consuming its relic or awarding its recipe', () => {
    const { sim, meta } = smith();
    expect(QUESTS[RECOVERY]).toBeDefined();
    sim.acceptQuest(RECOVERY);
    sim.addItem(EMBER, 1);
    meta.craftSkills.weaponcrafting = 124;
    sim.turnInQuest(RECOVERY);
    expect(meta.questLog.get(RECOVERY)?.state).toBe('ready');
    expect(meta.questsDone.has(RECOVERY)).toBe(false);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(sim.countItem(EMBER)).toBe(1);
    meta.craftSkills.weaponcrafting = 125;
    sim.turnInQuest(RECOVERY);
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
  });

  it.each<PlayerClass>(['warrior', 'paladin', 'shaman', 'druid'])(
    'offers the chain to an eligible %s',
    (cls) => {
      const { sim } = smith(cls);
      expect(sim.questState(RECOVERY)).toBe('available');
    },
  );

  it.each<PlayerClass>(['rogue', 'hunter', 'mage', 'warlock', 'priest'])(
    'does not offer the chain to a %s',
    (cls) => {
      const { sim } = smith(cls);
      expect(QUESTS[RECOVERY]).toBeDefined();
      expect(sim.questState(RECOVERY)).toBe('unavailable');
    },
  );

  it.each(['normal', 'heroic'] as const)(
    'adds the personal quest relic on %s difficulty',
    (difficulty) => {
      const { sim, meta } = smith();
      expect(QUESTS[RECOVERY]).toBeDefined();
      const drop = MOBS[VARKHUL_BOSS_ID].loot.find((entry) => entry.itemId === EMBER);
      expect(drop).toEqual({ itemId: EMBER, chance: 1, questId: RECOVERY });
      const boss = createMob(90002, MOBS[VARKHUL_BOSS_ID], 20, { ...sim.player.pos });
      sim.addEntity(boss);
      if (difficulty === 'heroic') {
        const slot = sim.ctx.instances[0];
        expect(slot).toBeDefined();
        // The loot roller's authority is the live claimed slot, not a player
        // preference. Clone a complete slot and explicitly claim this boss.
        sim.ctx.instances.push({
          ...slot,
          dungeonId: 'ignivar_inner_crucible',
          difficulty: 'heroic',
          partyKey: `solo:${sim.playerId}`,
          mobIds: [boss.id],
        });
      }
      rollLoot(sim.ctx, boss, meta);
      expect(boss.loot?.items.some((entry) => entry.itemId === EMBER)).toBe(false);
      sim.acceptQuest(RECOVERY);
      rollLoot(sim.ctx, boss, meta);
      expect(boss.loot?.items.find((entry) => entry.itemId === EMBER)?.personalFor).toEqual([
        sim.playerId,
      ]);
      sim.addItem(EMBER, 1);
      rollLoot(sim.ctx, boss, meta);
      expect(boss.loot?.items.some((entry) => entry.itemId === EMBER)).toBe(false);
    },
  );

  it('consumes the proof and recipe once even when a batch requests multiple hammers', () => {
    const { sim, meta } = learnHammer();
    atForge(sim);
    materials(sim);
    // Extra stale corpse loot cannot bypass the one-use recipe after the first craft.
    sim.addItem(EMBER, 1);
    materials(sim);
    const recipe = expectDefined(recipeById(RECIPE), 'Forgebreaker recipe');
    expect(maxCraftCountForRecipe(sim.ctx, recipe, sim.playerId)).toBe(1);
    runCraft(sim, RECIPE, false, sim.playerId, 2);
    completeCraftCast(sim);
    expect(sim.countItem(HAMMER)).toBe(1);
    expect(sim.countItem('lastflame_core')).toBe(15);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(maxCraftCountForRecipe(sim.ctx, recipe, sim.playerId)).toBe(0);
    expect(meta.inventory.find((slot) => slot.itemId === HAMMER)?.instance?.signer).toBe(meta.name);
    runCraft(sim, RECIPE);
    expect(meta.lastCraftResult?.reason).toBe('recipe_not_learned');
    expect(sim.countItem(HAMMER)).toBe(1);
  });

  it('keeps an unlooted relic on the corpse while bags are full and never replaces it on acceptance', () => {
    const { sim, meta, pid } = smith();
    sim.acceptQuest(RECOVERY);
    fillBags(meta);
    const boss = createMob(90002, MOBS[VARKHUL_BOSS_ID], 20, { ...sim.player.pos });
    sim.addEntity(boss);
    rollLoot(sim.ctx, boss, meta);
    const relic = expectDefined(
      boss.loot?.items.find((entry) => entry.itemId === EMBER),
      'personal quest ember',
    );
    expect(relic.personalFor).toEqual([pid]);
    // Keep only the real rolled quest slot so ordinary boss loot cannot fill
    // the one space this regression intentionally makes on the retry.
    boss.loot = { copper: 0, items: [relic] };
    boss.dead = true;
    boss.aiState = 'dead';
    boss.lootable = true;
    boss.corpseTimer = 100;
    boss.tappedById = pid;
    expect(sim.lootCorpse(boss.id)).toBe(false);
    expect(relic.personalFor).toEqual([pid]);
    expect(sim.countItem(EMBER)).toBe(0);
    meta.inventory.pop();
    sim.abandonQuest(RECOVERY);
    sim.acceptQuest(RECOVERY);
    expect(sim.countItem(EMBER)).toBe(0);
    expect(sim.lootCorpse(boss.id)).toBe(true);
    expect(sim.countItem(EMBER)).toBe(1);
    expect(sim.questState(RECOVERY)).toBe('ready');
    sim.abandonQuest(RECOVERY);
    sim.acceptQuest(RECOVERY);
    expect(sim.countItem(EMBER)).toBe(1);
    expect(sim.questState(RECOVERY)).toBe('ready');
  });

  it('preserves every reagent and one-use knowledge when output has no bag space', () => {
    const { sim, meta } = learnHammer();
    atForge(sim);
    // Every reagent stack survives one craft, so no ingredient frees a slot.
    sim.addItem(EMBER, 1);
    materials(sim);
    materials(sim);
    // Two full core stacks: a 30-core stock has a partial stack of ten,
    // which plain-first removal is allowed to empty and reuse for output.
    sim.addItem('lastflame_core', 10);
    fillBags(meta);
    const inventoryBefore = structuredClone(meta.inventory);
    const copperBefore = meta.copper;
    runCraft(sim, RECIPE);
    expect(meta.lastCraftResult?.reason).toBe('no_bag_space');
    expect(meta.inventory).toEqual(inventoryBefore);
    expect(meta.copper).toBe(copperBefore);
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
    expect(sim.countItem(HAMMER)).toBe(0);
    meta.inventory.pop();
    runCraft(sim, RECIPE);
    expect(sim.countItem(HAMMER)).toBe(1);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
  });

  it('preserves the relic and knowledge when materials are missing or the cast is cancelled', () => {
    const { sim, meta } = learnHammer();
    atForge(sim);
    runCraft(sim, RECIPE);
    expect(meta.lastCraftResult?.reason).toBe('insufficient_materials');
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
    expect(sim.countItem(EMBER)).toBe(1);
    materials(sim);
    sim.craftItem(RECIPE);
    sim.ctx.cancelCast(sim.player);
    completeCraftCast(sim);
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
    expect(sim.countItem(EMBER)).toBe(1);
    expect(sim.countItem('lastflame_core')).toBe(15);
    expect(sim.countItem(HAMMER)).toBe(0);
  });

  it('allows crafting before the follow-up and keeps a worn hammer on ownership turn-in', () => {
    const { sim, meta, projection } = learnHammer();
    atForge(sim);
    materials(sim);
    runCraft(sim, RECIPE);
    expect(sim.countItem(HAMMER)).toBe(1);
    sim.player.pos = { ...projection.pos };
    sim.acceptQuest(FORGING);
    expect(sim.questState(FORGING)).toBe('ready');
    sim.equipItem(HAMMER);
    expect(meta.equipment.mainhand).toBe(HAMMER);
    expect(sim.questState(FORGING)).toBe('ready');
    sim.abandonQuest(FORGING);
    sim.acceptQuest(FORGING);
    expect(sim.questState(FORGING)).toBe('ready');
    evaluateDeedsFor(sim.ctx, meta, sim.player, false);
    expect(meta.deedsEarned.has('hid_forgebreaker')).toBe(false);
    sim.turnInQuest(FORGING);
    expect(meta.questsDone.has(FORGING)).toBe(true);
    expect(meta.equipment.mainhand).toBe(HAMMER);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    evaluateDeedsFor(sim.ctx, meta, sim.player, false);
    expect(meta.deedsEarned.has('hid_forgebreaker')).toBe(true);
  });

  it('round-trips learned and spent recipe states without reopening the mint', () => {
    const { sim, pid } = learnHammer();
    const saved = expectDefined(sim.serializeCharacter(pid), 'learned character save');
    const restored = new Sim({ seed: 83, noPlayer: true, playerClass: 'warrior' });
    const restoredPid = restored.addPlayer('warrior', 'Smith', { state: saved });
    const restoredMeta = expectDefined(restored.players.get(restoredPid), 'restored smith');
    expect(restoredMeta.knownRecipes.has(RECIPE)).toBe(true);
    expect(restoredMeta.questsDone.has(RECOVERY)).toBe(true);
    expect(restored.countItem(EMBER, restoredPid)).toBe(1);
    atForge(sim);
    materials(sim);
    runCraft(sim, RECIPE);
    const spent = expectDefined(sim.serializeCharacter(pid), 'spent character save');
    const spentPid = restored.addPlayer('warrior', 'Spent', { state: spent });
    const spentMeta = expectDefined(restored.players.get(spentPid), 'spent smith');
    expect(spentMeta.knownRecipes.has(RECIPE)).toBe(false);
    expect(spentMeta.questsDone.has(RECOVERY)).toBe(true);
    expect(restored.countItem(HAMMER, spentPid)).toBe(1);
  });

  it('counts carried and equipped copies only for ownership objectives', () => {
    const { meta } = smith();
    meta.equipment.mainhand = HAMMER;
    expect(ownedItemCount(0, meta, HAMMER)).toBe(1);
    expect(ownedItemCount(1, meta, HAMMER)).toBe(2);
    meta.equipment.mainhand = undefined;
    expect(ownedItemCount(0, meta, HAMMER)).toBe(0);
  });

  it('catalogues the newly obtainable legendary and its quest deed', () => {
    expect(isCataloguedRelicItem(HAMMER)).toBe(true);
    expect(RELIQUARY_PAGES_BY_ID.professions_forgebreaker).toMatchObject({
      shelf: 'professions',
      excludeFromCompletion: 'personal',
      sourceDefault: { sourceKind: 'profession', sourceId: 'weaponcrafting' },
      relics: [{ kind: 'item', itemId: HAMMER }],
    });
    const hammerOnly = { itemsDiscovered: new Set([HAMMER]) };
    expect(catalogCharacterCompletion(hammerOnly).owned).toBe(0);
    expect(catalogRankOwned(hammerOnly)).toBe(0);
    expect(DEEDS.hid_forgebreaker).toMatchObject({
      hidden: true,
      renown: 0,
      trigger: { kind: 'quest', questId: FORGING },
    });
    expect(countsTowardCompletion(DEEDS.hid_forgebreaker, false)).toBe(false);
  });
});
