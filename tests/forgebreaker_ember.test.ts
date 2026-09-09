import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_HAMMER_QUEST_IDS,
  IGNIVAR_LORE_QUEST_IDS,
} from '../src/sim/content/ignivar_raid_lore';
import { CRAFT_GOLD_SINK_COPPER_PER_BUDGET } from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { createMob, createNpc } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';
import { completeCraftCast, runCraft } from './helpers/enchant_family_cast';

const RECOVERY = CRUCIBLE_HAMMER_QUEST_IDS.requiem;
const FORGING = CRUCIBLE_HAMMER_QUEST_IDS.forging;
const RECIPE = 'recipe_varkhul_forgebreaker';
const EMBER = 'forgefathers_ember';
const HAMMER = 'varkhul_forgebreaker';
const XP = 5300;
const COPPER = 25000;

function smith() {
  const sim = new Sim({ seed: 83, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
  const meta = expectDefined(sim.players.get(sim.playerId), 'smith');
  meta.craftSkills.weaponcrafting = 125;
  meta.questsDone.add(IGNIVAR_LORE_QUEST_IDS.forgefather);
  const npc = createNpc(90001, NPCS[QUESTS[RECOVERY].giverNpcId], { ...sim.player.pos });
  sim.addEntity(npc);
  sim.acceptQuest(RECOVERY);
  sim.addItem(EMBER, 1);
  sim.ctx.dropEntity(npc.id);
  return { sim, meta };
}

function atForge(sim: Sim) {
  const forge = expectDefined(
    sim.ctx.stationPlacements.find((s) => s.type === 'forge'),
    'forge',
  );
  sim.player.pos = { ...sim.player.pos, x: forge.pos.x, z: forge.pos.z };
  sim.player.prevPos = { ...sim.player.pos };
  sim.addItem('lastflame_core', 15);
  sim.addItem('fine_thorium_ore', 10);
  sim.addItem('fine_elderwood_log', 6);
}

describe('Forgebreaker Ember quest use and completion', () => {
  it('uses the carried Ember away from an NPC to teach and start, paying each quest once', () => {
    const { sim, meta } = smith();
    const before = { xp: meta.lifetimeXp, copper: meta.copper };
    expect(ITEMS[EMBER].use).toBeDefined();
    sim.useItem(EMBER);
    expect(meta.questsDone.has(RECOVERY)).toBe(true);
    expect(sim.questState(FORGING)).toBe('active');
    expect(meta.knownRecipes.has(RECIPE)).toBe(true);
    expect(sim.countItem(EMBER)).toBe(1);
    expect(meta.lifetimeXp - before.xp).toBe(XP);
    expect(meta.copper - before.copper).toBe(COPPER);
    sim.useItem(EMBER);
    expect(meta.lifetimeXp - before.xp).toBe(XP);
    expect(meta.copper - before.copper).toBe(COPPER);
    atForge(sim);
    sim.craftItem(RECIPE);
    sim.ctx.cancelCast(sim.player);
    completeCraftCast(sim);
    expect(sim.questState(FORGING)).toBe('active');
    expect(meta.lifetimeXp - before.xp).toBe(XP);
    runCraft(sim, RECIPE);
    expect(sim.countItem(HAMMER)).toBe(1);
    expect(sim.countItem(EMBER)).toBe(0);
    expect(sim.questState(FORGING)).toBe('done');
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(meta.lifetimeXp - before.xp).toBe(XP * 2);
    const craftFee = Math.ceil(
      expectDefined(recipeById(RECIPE), 'recipe').itemLevelBudget *
        CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
    );
    expect(meta.copper - before.copper).toBe(COPPER * 2 - craftFee);
    // Extra stale quest loot cannot reteach the spent shaping or repay either quest.
    sim.addItem(EMBER, 1);
    sim.useItem(EMBER);
    sim.ctx.onRecipeCraftedForQuests(RECIPE, meta);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
    expect(meta.lifetimeXp - before.xp).toBe(XP * 2);
    expect(meta.copper - before.copper).toBe(COPPER * 2 - craftFee);
  });

  it.each(['dead', 'skill', 'prerequisite', 'slot'] as const)(
    'refuses %s without spending or rewarding',
    (reason) => {
      const { sim, meta } = smith();
      if (reason === 'dead') sim.player.dead = true;
      if (reason === 'skill') meta.craftSkills.weaponcrafting = 124;
      if (reason === 'prerequisite') {
        meta.questLog.clear();
        meta.questsDone.clear();
      }
      const before = { xp: meta.lifetimeXp, copper: meta.copper };
      sim.useItem(EMBER, sim.playerId, reason === 'slot' ? -1 : undefined);
      expect(meta.questsDone.has(RECOVERY)).toBe(false);
      expect(meta.questLog.has(FORGING)).toBe(false);
      expect(meta.knownRecipes.has(RECIPE)).toBe(false);
      expect(sim.countItem(EMBER)).toBe(1);
      expect({ xp: meta.lifetimeXp, copper: meta.copper }).toEqual(before);
    },
  );

  it('resumes after abandoning the follow-up without teaching or paying recovery again', () => {
    const { sim, meta } = smith();
    sim.useItem(EMBER);
    sim.abandonQuest(FORGING);
    const before = { xp: meta.lifetimeXp, copper: meta.copper };
    sim.useItem(EMBER);
    expect(sim.questState(FORGING)).toBe('active');
    expect({ xp: meta.lifetimeXp, copper: meta.copper }).toEqual(before);
    expect(sim.countItem(EMBER)).toBe(1);
  });

  it('preserves active and completed quest states across save/load without duplicate rewards', () => {
    const { sim } = smith();
    sim.useItem(EMBER);
    const saved = expectDefined(sim.serializeCharacter(sim.playerId), 'active save');
    const restored = new Sim({
      seed: 83,
      noPlayer: true,
      playerClass: 'warrior',
      autoEquip: false,
    });
    restored.addPlayer('warrior', 'Smith', { state: saved });
    const meta = expectDefined(restored.players.get(restored.playerId), 'restored smith');
    expect(restored.questState(FORGING)).toBe('active');
    const before = { xp: meta.lifetimeXp, copper: meta.copper };
    restored.useItem(EMBER);
    expect({ xp: meta.lifetimeXp, copper: meta.copper }).toEqual(before);
    atForge(restored);
    runCraft(restored, RECIPE);
    expect(restored.questState(FORGING)).toBe('done');
    const completed = expectDefined(
      restored.serializeCharacter(restored.playerId),
      'completed save',
    );
    const rejoined = new Sim({ seed: 83, noPlayer: true, playerClass: 'warrior' });
    const pid = rejoined.addPlayer('warrior', 'Smith', { state: completed });
    const joinedMeta = expectDefined(rejoined.players.get(pid), 'rejoined smith');
    const rewarded = { xp: joinedMeta.lifetimeXp, copper: joinedMeta.copper };
    rejoined.addItem(EMBER, 1, pid);
    rejoined.useItem(EMBER, pid);
    expect(rejoined.questState(FORGING, pid)).toBe('done');
    expect(joinedMeta.knownRecipes.has(RECIPE)).toBe(false);
    expect({ xp: joinedMeta.lifetimeXp, copper: joinedMeta.copper }).toEqual(rewarded);
  });

  it('does not complete forging from an unrelated craft or an inventory grant', () => {
    const { sim, meta } = smith();
    sim.useItem(EMBER);
    sim.addItem(HAMMER, 1);
    sim.ctx.onRecipeCraftedForQuests('recipe_not_the_hammer', meta);
    expect(meta.questsDone.has(FORGING)).toBe(false);
  });
});

describe('Crucible raid quest rewards', () => {
  it.each(Object.values(IGNIVAR_LORE_QUEST_IDS))(
    '%s grants the displayed XP and gold once',
    (questId) => {
      const sim = new Sim({ seed: 84, playerClass: 'warrior' });
      sim.setPlayerLevel(20);
      const meta = expectDefined(sim.players.get(sim.playerId), 'raider');
      const quest = QUESTS[questId];
      if (quest.requiresQuest) meta.questsDone.add(quest.requiresQuest);
      sim.addEntity(createNpc(90001, NPCS[quest.giverNpcId], { ...sim.player.pos }));
      sim.addEntity(createNpc(90002, NPCS[quest.turnInNpcId], { ...sim.player.pos }));
      sim.acceptQuest(questId);
      const before = { xp: meta.lifetimeXp, copper: meta.copper };
      for (const objective of quest.objectives) {
        if (objective.type !== 'kill') throw new Error('Expected a raid kill objective');
        const mob = createMob(
          90003,
          MOBS[expectDefined(objective.targetMobId, 'kill target')],
          20,
          { ...sim.player.pos },
        );
        for (let i = 0; i < objective.count; i++) sim.ctx.onMobKilledForQuests(mob, meta);
      }
      expect(sim.questState(questId)).toBe('ready');
      expect(quest).toMatchObject({ xpReward: XP, copperReward: COPPER });
      sim.turnInQuest(questId);
      expect(meta.lifetimeXp - before.xp).toBe(XP);
      expect(meta.copper - before.copper).toBe(COPPER);
      sim.turnInQuest(questId);
      expect(meta.lifetimeXp - before.xp).toBe(XP);
      expect(meta.copper - before.copper).toBe(COPPER);
    },
  );
});
