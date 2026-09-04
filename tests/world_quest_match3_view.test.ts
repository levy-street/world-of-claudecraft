import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { buildWorldQuestMatch3View } from '../src/ui/world_quest_match3_view';

describe('world quest match-three view', () => {
  it('projects the selected weekly level and accessible candy identities', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const level = quest.objective.levels[1];
    const board = [...level.board];
    board.splice(0, 5, 0, 1, 2, 3, 4);
    const view = buildWorldQuestMatch3View(quest.id, {
      questId: quest.id,
      count: 7,
      state: 'active',
      puzzleVariant: 1,
      match3Board: board,
      match3Moves: 4,
      match3RefillIndex: 0,
    });
    expect(view).toMatchObject({ level: 2, moves: 4, cleared: 7, target: 72 });
    expect(view?.cells).toHaveLength(36);
    expect(view?.cells[0]).toMatchObject({ row: 1, column: 1 });
    expect(view?.cells.slice(0, 5).map((cell) => cell.ariaLabel)).toEqual([
      'Row 1, column 1: berry crystal',
      'Row 1, column 2: citrus orb',
      'Row 1, column 3: mint triangle',
      'Row 1, column 4: grape square',
      'Row 1, column 5: sugar star',
    ]);
    expect(view?.cells[6]).toMatchObject({ row: 2, column: 1 });
    expect(new Set(view?.cells.map((cell) => cell.symbol)).size).toBeGreaterThan(3);
  });

  it('refuses non-match-three and completed rows', () => {
    expect(
      buildWorldQuestMatch3View('wq_galecrest_wisps', {
        questId: 'wq_galecrest_wisps',
        count: 0,
        state: 'active',
      }),
    ).toBeNull();
    expect(
      buildWorldQuestMatch3View('wq_palmreach_confections', {
        questId: 'wq_palmreach_confections',
        count: 72,
        state: 'completed',
      }),
    ).toBeNull();
  });
});
