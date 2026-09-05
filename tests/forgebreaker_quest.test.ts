import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { createMob, createNpc } from '../src/sim/entity';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { itemLevel } from '../src/sim/item_level';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { requiredReagentCountFor } from '../src/sim/professions/crafting';
import { ownedItemCount } from '../src/sim/quests/quest_owned_count';
import { isCataloguedRelicItem } from '../src/sim/reliquary';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
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
  const meta = sim.players.get(pid)!;
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
  const forge = sim.ctx.stationPlacements.find((station) => station.type === 'forge');
  expect(forge).toBeDefined();
  sim.player.pos = { x: forge!.pos.x, y: sim.player.pos.y, z: forge!.pos.z };
  sim.player.prevPos = { ...sim.player.pos };
}

function materials(sim: Sim) {
  sim.addItem('lastflame_core', 15);
  sim.addItem('fine_thorium_ore', 10);
  sim.addItem('fine_elderwood_log', 6);
}

describe('Forgebreaker one-time quest route', () => {
  it('registers a skill-125 quest-only recipe without retuning the existing legendary', () => {
    const recipe = recipeById(RECIPE);
    expect(recipe).toMatchObject({
      professionId: 'weaponcrafting', resultItemId: HAMMER, resultCount: 1,
      skillReq: 125, level: 45, stationType: 'forge', acquisition: ['quest'],
      consumeOnCraft: true,
    });
    expect(recipe!.reagents).toEqual([
      { itemId: EMBER, count: 1, noDiscount: true },
      { itemId: 'lastflame_core', count: 15, noDiscount: true },
      { itemId: 'fine_thorium_ore', count: 10 },
      { itemId: 'fine_elderwood_log', count: 6 },
    ]);
    expect(ITEMS[HAMMER]).toMatchObject({
      soulbound: true, quality: 'legendary', weapon: { min: 77, max: 115, speed: 3.6 },
      stats: { str: 44, sta: 32, agi: 19 },
      requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
    });
    expect(ITEMS[HAMMER].masterwrought).toBeUndefined();
    expect(itemLevel(ITEMS[HAMMER])).toBe(55);
    expect(requiredReagentCountFor(true, recipe!.reagents[1], { weaponcrafting: 125 }, 'weaponcrafting', true).count).toBe(15);
  });

  it('keeps the recovered relic, teaches once, and never grants a free replacement', () => {
    const { sim, meta } = learnHammer();
    expect(sim.countItem(EMBER)).toBe(1);
    expect(ITEMS[EMBER]).toMatchObject({ kind: 'quest', soulbound: true, noDiscard: true, questId: RECOVERY });
    expect(QUESTS[RECOVERY].requiresQuest).toBe('q_ignivar_the_forgefather');
    expect(QUESTS[RECOVERY].requiredItems).toBeUndefined();
    expect(QUESTS[FORGING].requiredItems).toBeUndefined();
    expect(QUESTS[FORGING]).toMatchObject({
      requiresQuest: RECOVERY, keepsCollectedItems: true,
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

  it.each<PlayerClass>(['warrior', 'paladin', 'shaman', 'druid'])('offers the chain to an eligible %s', (cls) => {
    const { sim } = smith(cls);
    expect(sim.questState(RECOVERY)).toBe('available');
  });

  it.each<PlayerClass>(['rogue', 'hunter', 'mage', 'warlock', 'priest'])('does not offer the chain to a %s', (cls) => {
    const { sim } = smith(cls);
    expect(QUESTS[RECOVERY]).toBeDefined();
    expect(sim.questState(RECOVERY)).toBe('unavailable');
  });

  it('adds the personal quest relic after existing boss loot without a difficulty restriction', () => {
    const { sim, meta } = smith();
    expect(QUESTS[RECOVERY]).toBeDefined();
    const drop = MOBS[VARKHUL_BOSS_ID].loot.find((entry) => entry.itemId === EMBER);
    expect(drop).toEqual({ itemId: EMBER, chance: 1, questId: RECOVERY });
    const boss = createMob(90002, MOBS[VARKHUL_BOSS_ID], 20, { ...sim.player.pos });
    sim.addEntity(boss);
    rollLoot(sim.ctx, boss, meta);
    expect(boss.loot?.items.some((entry) => entry.itemId === EMBER)).toBe(false);
    sim.acceptQuest(RECOVERY);
    rollLoot(sim.ctx, boss, meta);
    expect(boss.loot?.items.find((entry) => entry.itemId === EMBER)?.personalFor).toEqual([sim.playerId]);
    sim.addItem(EMBER, 1);
    rollLoot(sim.ctx, boss, meta);
    expect(boss.loot?.items.some((entry) => entry.itemId === EMBER)).toBe(false);
  });

  it('consumes the proof and recipe once even when a batch requests multiple hammers', () => {
    const { sim, meta } = learnHammer();
    atForge(sim);
    materials(sim);
    // Extra stale corpse loot cannot bypass the one-use recipe after the first craft.
    sim.addItem(EMBER, 1);
    materials(sim);
    runCraft(sim, RECIPE, false, sim.playerId, 2);
    completeCraftCast(sim);
    expect(sim.countItem(HAMMER)).toBe(1);
    expect(sim.countItem('lastflame_core')).toBe(15);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(meta.inventory.find((slot) => slot.itemId === HAMMER)?.instance?.signer).toBe(meta.name);
    runCraft(sim, RECIPE);
    expect(meta.lastCraftResult?.reason).toBe('recipe_not_learned');
    expect(sim.countItem(HAMMER)).toBe(1);
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
    sim.turnInQuest(FORGING);
    expect(meta.questsDone.has(FORGING)).toBe(true);
    expect(meta.equipment.mainhand).toBe(HAMMER);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
  });

  it('round-trips learned and spent recipe states without reopening the mint', () => {
    const { sim, pid } = learnHammer();
    const saved = sim.serializeCharacter(pid)!;
    const restored = new Sim({ seed: 83, noPlayer: true, playerClass: 'warrior' });
    const restoredPid = restored.addPlayer('warrior', 'Smith', { state: saved });
    const restoredMeta = restored.players.get(restoredPid)!;
    expect(restoredMeta.knownRecipes.has(RECIPE)).toBe(true);
    expect(restoredMeta.questsDone.has(RECOVERY)).toBe(true);
    expect(restored.countItem(EMBER, restoredPid)).toBe(1);
    atForge(sim);
    materials(sim);
    runCraft(sim, RECIPE);
    const spent = sim.serializeCharacter(pid)!;
    const spentPid = restored.addPlayer('warrior', 'Spent', { state: spent });
    expect(restored.players.get(spentPid)!.knownRecipes.has(RECIPE)).toBe(false);
    expect(restored.players.get(spentPid)!.questsDone.has(RECOVERY)).toBe(true);
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
    expect(DEEDS.hid_forgebreaker).toMatchObject({
      hidden: true, renown: 0, trigger: { kind: 'quest', questId: FORGING },
    });
  });
});
