import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { WISP_MAZE_NPC_DEF, WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { NPCS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';

describe('wisp maze content registration', () => {
  it('offers the maze every day without replacing the existing Evergarden quest', () => {
    for (let day = 0; day < 32; day++) {
      const ids = activeWorldQuestsForCycle(`wq1_${day}`).map((quest) => quest.id);
      expect(ids.filter((id) => id === WISP_MAZE_QUEST_ID)).toHaveLength(1);
      expect(ids).toContain('wq_evergarden_watch');
      expect(ids).toHaveLength(16);
    }
  });
  it('registers the instructor and a cosmetic-only completion deed', () => {
    expect(NPCS[WISP_MAZE_NPC_DEF.id]).toBe(WISP_MAZE_NPC_DEF);
    expect(WORLD_QUESTS_BY_ID[WISP_MAZE_QUEST_ID].objective).toEqual({
      type: 'wisp_maze',
      instructorNpcId: WISP_MAZE_NPC_DEF.id,
    });
    expect(DEEDS.exp_wisp_maze.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS.exp_wisp_maze.reward).toBeUndefined();
  });
});
