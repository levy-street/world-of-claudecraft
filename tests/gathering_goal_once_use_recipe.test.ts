// A Gathering Goal on a consumeOnCraft recipe (one-time quest knowledge,
// removed after the first successful craft) must never project a batch above
// 1: the projection's batch_limit gate has to agree with the real craft
// gate's cap (professions/crafting.ts maxCraftCountForRecipe). Exercised
// through the real Forgebreaker quest chain and craft cast, mirroring
// tests/forgebreaker_quest.test.ts's own fixtures.

import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import { NPCS, QUESTS } from '../src/sim/data';
import { createNpc } from '../src/sim/entity';
import { GATHERING_GOAL_REFRESH_TICKS } from '../src/sim/professions/gathering_goal_projection';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';
import { completeCraftCast, runCraft } from './helpers/enchant_family_cast';

const RECOVERY = 'q_forgefathers_requiem';
const RECIPE = 'recipe_varkhul_forgebreaker';
const EMBER = 'forgefathers_ember';
const HAMMER = 'varkhul_forgebreaker';
const MAELIN = 'archivist_maelin_ember_projection';

function smith() {
  const sim = new Sim({ seed: 83, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const meta = expectDefined(sim.players.get(pid), 'smith');
  meta.craftSkills.weaponcrafting = 125;
  meta.copper = 100000;
  meta.questsDone.add('q_ignivar_the_forgefather');
  const projection = createNpc(90001, NPCS[MAELIN], { ...sim.player.pos });
  sim.addEntity(projection);
  return { sim, pid, meta };
}

/** Real unlock: accept and turn in the recovery quest through the live quest
 * verbs, exactly as tests/forgebreaker_quest.test.ts's own learnHammer does. */
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

function oneCraftWorth(sim: Sim) {
  sim.addItem('lastflame_core', 15);
  sim.addItem('fine_thorium_ore', 10);
  sim.addItem('fine_elderwood_log', 6);
}

function passRefreshWindow(sim: Sim) {
  for (let i = 0; i < GATHERING_GOAL_REFRESH_TICKS; i++) sim.tick();
}

describe('Gathering Goal projection vs a real consumeOnCraft recipe (Varkhul Forgebreaker)', () => {
  it('is unavailable before the quest unlock, even with a trackable goal', () => {
    const { sim, pid, meta } = smith();
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(sim.trackGatheringRecipe(RECIPE, 1, pid)).toBe(true);

    const view = sim.gatheringGoalFor(pid);
    expect(view?.status).toBe('unavailable');
    expect(view?.reason).toBe('recipe_unavailable');
    expect(view?.materials).toEqual([]);
    expect(view?.payableCrafts).toBe(0);
  });

  it('projects a real qty-1 goal as ready once unlocked and materials are on hand', () => {
    const { sim, pid, meta } = learnHammer();
    oneCraftWorth(sim);
    // learnHammer's recovery turn-in keeps the recovered Ember rather than
    // consuming it (see tests/forgebreaker_quest.test.ts), so exactly one
    // proof copy is already on hand: the reagent the recipe itself needs.
    expect(sim.countItem(EMBER)).toBe(1);
    expect(sim.trackGatheringRecipe(RECIPE, 1, pid)).toBe(true);

    const view = sim.gatheringGoalFor(pid);
    expect(view?.goal).toEqual({ kind: 'recipe', recipeId: RECIPE, count: 1 });
    expect(view?.status).toBe('ready');
    expect(view?.reason).toBeNull();
    expect(view?.payableCrafts).toBe(1);
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
  });

  it('refuses a qty-2 goal as batch_limit with no material rows and zero payable crafts, even holding materials for two full crafts', () => {
    const { sim, pid, meta } = learnHammer();
    const recipe = expectDefined(recipeById(RECIPE), 'Forgebreaker recipe');
    // consumeOnCraft, not oncePerDay: the real recipe shape this regression exists for.
    expect(recipe.consumeOnCraft).toBe(true);
    expect(recipe.oncePerDay).toBeUndefined();
    // Two full crafts' worth of every reagent, including two proof-of-Ember
    // copies: only real crafting knowledge, never material scarcity, must be
    // what refuses the second craft.
    oneCraftWorth(sim);
    oneCraftWorth(sim);
    // learnHammer already left exactly one Ember on hand (kept, not consumed,
    // by the recovery turn-in); top up to a second proof copy.
    sim.addItem(EMBER, 1);
    expect(sim.countItem('lastflame_core')).toBe(30);
    expect(sim.countItem(EMBER)).toBe(2);

    expect(sim.trackGatheringRecipe(RECIPE, 2, pid)).toBe(true);
    const view = sim.gatheringGoalFor(pid);
    expect(view?.goal).toEqual({ kind: 'recipe', recipeId: RECIPE, count: 2 });
    expect(view?.status).toBe('unavailable');
    expect(view?.reason).toBe('batch_limit');
    expect(view?.materials).toEqual([]);
    expect(view?.payableCrafts).toBe(0);
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
  });

  it('drops the tracked qty-1 goal to recipe_unavailable once a real craft consumes the one-time knowledge', () => {
    const { sim, pid, meta } = learnHammer();
    atForge(sim);
    oneCraftWorth(sim);
    expect(sim.trackGatheringRecipe(RECIPE, 1, pid)).toBe(true);
    expect(sim.gatheringGoalFor(pid)?.status).toBe('ready');

    runCraft(sim, RECIPE, false, pid, 1);
    completeCraftCast(sim, pid);
    expect(sim.countItem(HAMMER)).toBe(1);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);

    passRefreshWindow(sim);
    const view = sim.gatheringGoalFor(pid);
    expect(view?.goal).toEqual({ kind: 'recipe', recipeId: RECIPE, count: 1 });
    expect(view?.status).toBe('unavailable');
    expect(view?.reason).toBe('recipe_unavailable');
    expect(view?.materials).toEqual([]);
    expect(view?.payableCrafts).toBe(0);
  });
});
