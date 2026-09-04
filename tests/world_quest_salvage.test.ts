import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { interactObjectCreditKey } from '../src/sim/quests/interact_object_credit';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import {
  isWorldQuestSalvageObject,
  isWorldQuestSalvageObjectHidden,
  worldQuestSalvageLayout,
  worldQuestSalvageVisualIndex,
} from '../src/sim/world_quest_salvage';
import { worldQuestCycleForResetDay } from '../src/sim/world_quests';

const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;

function salvageEntity(id: number, x = 281, z = 82): Entity {
  return {
    id,
    kind: 'object',
    templateId: 'ground_wreckfield_flotsam_crate',
    objectItemId: 'wreckfield_flotsam_crate',
    pos: { x, y: 0, z },
  } as Entity;
}

describe('Farshore rotating shipwreck salvage', () => {
  it('authors three eight-piece layouts containing every bespoke visual', () => {
    expect(quest.objective.type).toBe('salvage');
    if (quest.objective.type !== 'salvage') throw new Error('Expected salvage fixture');

    expect(quest.objective.layouts).toHaveLength(3);
    expect(quest.objective.layouts.map((layout) => layout.length)).toEqual([8, 8, 8]);
    expect(new Set(quest.objective.layouts.flat()).size).toBe(24);
    for (const layout of quest.objective.layouts) {
      expect(new Set(layout.map(worldQuestSalvageVisualIndex))).toEqual(
        new Set([0, 1, 2, 3, 4, 5]),
      );
    }
  });

  it.each([
    ['2026-09-06', 0],
    ['2026-09-15', 2],
    ['2026-10-03', 1],
  ] as const)('selects the weekly layout for offer %s (variant %i)', (resetDay, variant) => {
    if (quest.objective.type !== 'salvage') throw new Error('Expected salvage fixture');
    const cycle = worldQuestCycleForResetDay(resetDay);
    expect(worldQuestSalvageLayout(quest, undefined, cycle)).toBe(quest.objective.layouts[variant]);
  });

  it("shows only this offer's layout and hides each piece after personal recovery", () => {
    const cycle = worldQuestCycleForResetDay('2026-09-06');
    const layout = worldQuestSalvageLayout(quest, undefined, cycle);
    expect(layout).toHaveLength(8);
    const visible = salvageEntity(layout[0], 281, 82);
    const otherLayoutId = quest.objective.type === 'salvage' ? quest.objective.layouts[1][0] : -1;
    const rotatedOut = salvageEntity(otherLayoutId, 273, 78);

    expect(isWorldQuestSalvageObject(visible, quest)).toBe(true);
    expect(isWorldQuestSalvageObjectHidden(visible, quest, cycle, new Map())).toBe(false);
    expect(isWorldQuestSalvageObjectHidden(rotatedOut, quest, cycle, new Map())).toBe(true);

    const progress: WorldQuestProgress = {
      questId: quest.id,
      count: 1,
      state: 'active',
      puzzleVariant: 0,
      creditedObjects: [interactObjectCreditKey(0, visible.pos)],
    };
    expect(
      isWorldQuestSalvageObjectHidden(visible, quest, cycle, new Map([[quest.id, progress]])),
    ).toBe(true);

    progress.state = 'completed';
    expect(
      isWorldQuestSalvageObjectHidden(
        salvageEntity(layout[1], 285, 82),
        quest,
        cycle,
        new Map([[quest.id, progress]]),
      ),
    ).toBe(true);
  });
});
