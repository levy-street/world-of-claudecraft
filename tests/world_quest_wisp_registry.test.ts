import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { WISP_MAZE_NPC_DEF, WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { NPCS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';

describe('wisp maze content registration', () => {
  it('offers the maze every day beside, never instead of, the rotating Evergarden quest', () => {
    // Evergarden's rotating pool is four deep since the round-2 zone hunts
    // (the Hedge Knights watch plus three hunts), so the watch itself comes
    // round every fourth day; the maze is on the board every day regardless.
    const watchDays: number[] = [];
    for (let day = 0; day < 32; day++) {
      const quests = activeWorldQuestsForCycle(`wq1_${day}`);
      const ids = quests.map((quest) => quest.id);
      expect(ids.filter((id) => id === WISP_MAZE_QUEST_ID)).toHaveLength(1);
      const evergarden = quests.filter(
        (quest) => quest.zoneId === 'evergarden' && quest.id !== WISP_MAZE_QUEST_ID,
      );
      expect(evergarden, `cycle wq1_${day}`).toHaveLength(1);
      if (ids.includes('wq_evergarden_watch')) watchDays.push(day);
      expect(ids).toHaveLength(16);
    }
    expect(watchDays).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
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
