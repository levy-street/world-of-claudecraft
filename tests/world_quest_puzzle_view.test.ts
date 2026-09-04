import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { buildWorldQuestPuzzleView } from '../src/ui/world_quest_puzzle_view';

describe('world quest puzzle view', () => {
  it('projects connectors, source, target, and authoritative powered tiles', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
    if (quest.objective.type !== 'puzzle') throw new Error('Expected puzzle fixture');
    const rotations = quest.objective.puzzles[0].tiles.map((tile) => tile.initialRotation);
    rotations[1] = 1;
    rotations[2] = 1;
    rotations[3] = 1;
    rotations[4] = 3;
    const view = buildWorldQuestPuzzleView(quest.id, {
      questId: quest.id,
      count: 0,
      state: 'active',
      puzzleVariant: 0,
      puzzleRotations: rotations,
    });
    expect(view?.solved).toBe(true);
    expect(view?.tiles.filter((tile) => tile.powered).map((tile) => tile.index)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(view?.tiles[3].sourceSide).toBe('west');
    expect(view?.tiles[2].targetSide).toBe('east');
    expect(view?.tiles.every((tile) => tile.ariaLabel.length > 0)).toBe(true);
  });

  it('refuses non-puzzle and completed rows', () => {
    expect(
      buildWorldQuestPuzzleView('wq_mirefen_gravecallers', {
        questId: 'wq_mirefen_gravecallers',
        count: 0,
        state: 'active',
      }),
    ).toBeNull();
    expect(
      buildWorldQuestPuzzleView('wq_galecrest_wisps', {
        questId: 'wq_galecrest_wisps',
        count: 1,
        state: 'completed',
      }),
    ).toBeNull();
  });
});
