import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { QUESTS } from '../src/sim/data';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import type { QuestDef } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const RECIPE: ProfessionRecipeRecord & { consumeOnCraft: true } = {
  id: 'recipe_test_one_use_quest',
  professionId: 'weaponcrafting',
  resultItemId: 'eastbrook_arming_sword',
  resultCount: 1,
  reagents: [{ itemId: 'bone_fragments', count: 1 }],
  skillReq: 125,
  itemLevelBudget: 1,
  level: 1,
  acquisition: ['quest'],
  consumeOnCraft: true,
};

const QUEST: QuestDef & { recipeReward: string } = {
  id: 'q_test_recipe_reward',
  name: 'Test recipe reward',
  giverNpcId: 'foreman_odell',
  turnInNpcId: 'foreman_odell',
  text: '',
  completionText: '',
  objectives: [{ type: 'collect', itemId: 'spider_leg', count: 1, label: 'Leg' }],
  xpReward: 5,
  copperReward: 10,
  itemRewards: {},
  recipeReward: RECIPE.id,
};

function readySmith(skill = 125) {
  const sim = new Sim({ seed: 19, playerClass: 'warrior', autoEquip: false });
  const meta = expectDefined(sim.players.get(sim.playerId), 'smith');
  meta.craftSkills.weaponcrafting = skill;
  sim.addItem('spider_leg', 1);
  meta.questLog.set(QUEST.id, { questId: QUEST.id, state: 'ready', counts: [1] });
  return { sim, meta };
}

beforeEach(() => {
  ALL_RECIPES.push(RECIPE);
  QUESTS[QUEST.id] = QUEST;
});

afterEach(() => {
  const index = ALL_RECIPES.indexOf(RECIPE);
  if (index >= 0) ALL_RECIPES.splice(index, 1);
  delete QUESTS[QUEST.id];
});

describe('quest recipe rewards and single-use knowledge', () => {
  it('learns through the quest source alongside an ordinary turn-in', () => {
    const { sim, meta } = readySmith();
    expect(turnInQuestCore(sim.ctx, QUEST.id, QUEST, meta)).toBe(true);
    expect(meta.knownRecipes.has(RECIPE.id)).toBe(true);
    expect(meta.questsDone.has(QUEST.id)).toBe(true);
    expect(sim.countItem('spider_leg')).toBe(0);
  });

  it.each([124, 0, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses invalid or below-floor skill %s before rewards or consumption',
    (skill) => {
      const { sim, meta } = readySmith(skill);
      const before = sim.serializeCharacter(sim.playerId);
      expect(turnInQuestCore(sim.ctx, QUEST.id, QUEST, meta)).toBe(false);
      expect(sim.serializeCharacter(sim.playerId)).toEqual(before);
      expect(sim.countItem('spider_leg')).toBe(1);
    },
  );

  it('refuses an unknown recipe reward before marking the quest complete', () => {
    const { sim, meta } = readySmith();
    expect(
      turnInQuestCore(
        sim.ctx,
        QUEST.id,
        { ...QUEST, recipeReward: 'missing' } as typeof QUEST,
        meta,
      ),
    ).toBe(false);
    expect(meta.questsDone.has(QUEST.id)).toBe(false);
    expect(sim.countItem('spider_leg')).toBe(1);
  });

  it('refuses a recipe whose acquisition sources do not include quests', () => {
    const { sim, meta } = readySmith();
    const trainerOnly = {
      ...RECIPE,
      id: 'recipe_test_trainer_only',
      acquisition: ['trainer'] as const,
    };
    ALL_RECIPES.push({ ...trainerOnly, acquisition: ['trainer'] });
    try {
      const before = sim.serializeCharacter(sim.playerId);
      expect(
        turnInQuestCore(sim.ctx, QUEST.id, { ...QUEST, recipeReward: trainerOnly.id }, meta),
      ).toBe(false);
      expect(sim.serializeCharacter(sim.playerId)).toEqual(before);
    } finally {
      ALL_RECIPES.pop();
    }
  });

  it('completes an already-known recipe reward without duplicating knowledge or later replaying it', () => {
    const { sim, meta } = readySmith();
    meta.knownRecipes.add(RECIPE.id);
    expect(turnInQuestCore(sim.ctx, QUEST.id, QUEST, meta)).toBe(true);
    expect([...meta.knownRecipes].filter((id) => id === RECIPE.id)).toHaveLength(1);
    meta.knownRecipes.delete(RECIPE.id);
    expect(turnInQuestCore(sim.ctx, QUEST.id, QUEST, meta)).toBe(false);
    expect(meta.knownRecipes.has(RECIPE.id)).toBe(false);
  });

  it('preserves ordinary quest behavior without a recipe reward or profession skill', () => {
    const { sim, meta } = readySmith(0);
    const { recipeReward: _recipeReward, ...ordinary } = QUEST;
    expect(turnInQuestCore(sim.ctx, QUEST.id, ordinary, meta)).toBe(true);
    expect(meta.questsDone.has(QUEST.id)).toBe(true);
    expect(sim.countItem('spider_leg')).toBe(0);
    expect(meta.knownRecipes.has(RECIPE.id)).toBe(false);
  });

  it('does not consume learned knowledge on a denied craft', () => {
    const { sim, meta } = readySmith();
    meta.knownRecipes.add(RECIPE.id);
    expect(resolveCraftForRecipe(sim.ctx, sim.playerId, RECIPE).ok).toBe(false);
    expect(meta.knownRecipes.has(RECIPE.id)).toBe(true);
  });

  it('removes single-use knowledge only after the successful craft and refuses a replay', () => {
    const { sim, meta } = readySmith();
    meta.knownRecipes.add(RECIPE.id);
    meta.copper = 1000;
    sim.addItem('bone_fragments', 2);
    expect(resolveCraftForRecipe(sim.ctx, sim.playerId, RECIPE).ok).toBe(true);
    expect(meta.knownRecipes.has(RECIPE.id)).toBe(false);
    expect(resolveCraftForRecipe(sim.ctx, sim.playerId, RECIPE).reason).toBe('recipe_not_learned');
    expect(sim.countItem('eastbrook_arming_sword')).toBe(1);
    expect(sim.countItem('bone_fragments')).toBe(1);
  });
});
