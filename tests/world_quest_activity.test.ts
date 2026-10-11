import { describe, expect, it } from 'vitest';
import { startWorldQuestActivityWire } from '../server/quest_command_wire';
import { WISP_MAZE_PROFILES } from '../src/sim/content/wisp_maze_layouts';
import { WISP_MAZE_NPC_ID, WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { Sim } from '../src/sim/sim';
import {
  isWorldQuestDifficulty,
  WORLD_QUEST_DIFFICULTIES,
  worldQuestOffersDifficulty,
} from '../src/sim/world_quest_activity';
import { WISP_MAZE_HARD_BONUS, worldQuestBonusCopper } from '../src/sim/world_quest_bonus';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';

function armed(): Sim {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-09-06';
  // The developer selector arms the offer and teleports beside the keeper.
  sim.chat('/dev wisps normal');
  sim.tick();
  const meta = sim.meta(sim.playerId)!;
  delete meta.worldQuestLog.get(WISP_MAZE_QUEST_ID)!.wispMaze;
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest(
    sim.ctx.currentWorldQuestRotation().cycle,
    WISP_MAZE_QUEST_ID,
  );
  const keeper = sim.entities.get(WISP_MAZE_NPC_ID)!;
  sim.player.pos = sim.groundPos(keeper.pos.x + 1, keeper.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  return sim;
}

describe('explicit-difficulty world quest starts', () => {
  it('exposes exactly the two keeper choices and only for the maze', () => {
    expect(WORLD_QUEST_DIFFICULTIES).toEqual(['normal', 'hard']);
    expect(isWorldQuestDifficulty('hard')).toBe(true);
    expect(isWorldQuestDifficulty('easy')).toBe(false);
    expect(isWorldQuestDifficulty(undefined)).toBe(false);
    expect(worldQuestOffersDifficulty(WISP_MAZE_QUEST_ID)).toBe(true);
    expect(worldQuestOffersDifficulty('wq_evergarden_watch')).toBe(false);
    expect(WISP_MAZE_PROFILES.hard.enemyCount).toBe(WISP_MAZE_PROFILES.normal.enemyCount + 2);
  });

  it('starts the maze on the picked profile, dismounting a rider first', () => {
    const sim = armed();
    sim.player.mountKey = 'valorsteed';
    sim.startWorldQuestActivity(WISP_MAZE_QUEST_ID, 'hard');
    const state = sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze;
    expect(state?.difficulty).toBe('hard');
    expect(state?.enemies).toHaveLength(WISP_MAZE_PROFILES.hard.enemyCount);
    expect(new Set(state?.enemies.map((enemy) => enemy.cell)).size).toBe(
      WISP_MAZE_PROFILES.hard.enemyCount,
    );
    expect(sim.player.mountKey).toBe('');
  });

  it('keeps the plain keeper talk on Normal', () => {
    const sim = armed();
    sim.talkToNpc(WISP_MAZE_NPC_ID);
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze?.difficulty).toBe('normal');
  });

  it('refuses a far player, a wrong quest and an unknown profile', () => {
    const sim = armed();
    sim.startWorldQuestActivity('wq_evergarden_watch', 'hard');
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    sim.startWorldQuestActivity(WISP_MAZE_QUEST_ID, 'nightmare' as never);
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    sim.player.pos = sim.groundPos(0, 0);
    sim.startWorldQuestActivity(WISP_MAZE_QUEST_ID, 'hard');
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
  });

  it('validates the wire payload before reaching the sim', () => {
    const sim = armed();
    startWorldQuestActivityWire(
      sim,
      { quest: WISP_MAZE_QUEST_ID, difficulty: 'easy' },
      sim.playerId,
    );
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    startWorldQuestActivityWire(sim, { quest: 7, difficulty: 'hard' }, sim.playerId);
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze).toBeUndefined();
    startWorldQuestActivityWire(
      sim,
      { quest: WISP_MAZE_QUEST_ID, difficulty: 'hard' },
      sim.playerId,
    );
    expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze?.difficulty).toBe('hard');
  });

  it('scales the hard purse with level and never pays a zero or negative one', () => {
    expect(
      worldQuestBonusCopper(WISP_MAZE_HARD_BONUS.base, WISP_MAZE_HARD_BONUS.perLevel, 20),
    ).toBe(3_500);
    expect(worldQuestBonusCopper(0, 0, 1)).toBe(0);
    expect(worldQuestBonusCopper(-50, 0, 1)).toBe(0);
  });
});
