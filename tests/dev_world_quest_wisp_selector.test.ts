import { describe, expect, it } from 'vitest';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { Sim } from '../src/sim/sim';

describe('wisp maze developer difficulty selector', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'starts %s through both documented commands',
    (difficulty) => {
      const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: true });
      for (const prefix of ['/dev wisps', '/dev wq wisps']) {
        sim.chat(`${prefix} ${difficulty}`);
        expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze?.difficulty).toBe(difficulty);
        expect(sim.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze?.phase).toBe('countdown');
      }
    },
  );
  it('does not arm an invalid profile or enable developer commands on production', () => {
    for (const enabled of [false, true]) {
      const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: enabled });
      sim.chat(enabled ? '/dev wisps impossible' : '/dev wisps hard');
      expect(sim.worldQuestLog.has(WISP_MAZE_QUEST_ID)).toBe(false);
    }
  });
});
