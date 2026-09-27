import { describe, expect, it } from 'vitest';
import { ESCORTS, WORLD_QUESTS } from '../src/sim/data';
import { createWispMaze } from '../src/sim/minigames/wisp_maze';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import {
  isWorldQuestInstructorOrEscort,
  worldQuestInstructorDialog,
} from '../src/ui/world_quest_instructor_view';

describe('worldQuestInstructorDialog presentation', () => {
  function makeWorld(progressEntries: [string, WorldQuestProgress][] = []) {
    return {
      worldQuestLog: new Map(progressEntries),
      player: {
        id: 1,
        name: 'Hero',
        level: 60,
        dead: false,
        pos: { x: 0, y: 0, z: 0 },
      } as Entity,
    };
  }

  it('identifies every configured instructor and WQ escort', () => {
    const instructorIds = WORLD_QUESTS.flatMap((quest) =>
      'instructorNpcId' in quest.objective ? [quest.objective.instructorNpcId] : [],
    );
    const worldQuestEscortIds = Object.values(ESCORTS).flatMap((escort) =>
      escort.worldQuestId ? [escort.npcMobId] : [],
    );
    expect([...new Set(instructorIds), 'glider_apprentice'].sort()).toEqual(
      [
        'calligraphy_instructor',
        'forge_instructor',
        'glider_apprentice',
        'glider_instructor',
        'shadow_cloak_scout',
        'wisp_maze_keeper',
      ].sort(),
    );
    expect([...new Set(worldQuestEscortIds)].sort()).toEqual(
      ['eastbrook_freight_caravan', 'frostveil_supply_caravan', 'willowfen_remedy_caravan'].sort(),
    );
    const world = makeWorld(
      WORLD_QUESTS.map((quest) => [quest.id, { questId: quest.id, count: 0, state: 'active' }]),
    );

    for (const [index, templateId] of instructorIds.entries()) {
      const instructor = { id: 10 + index, kind: 'npc', templateId } as Entity;
      expect(isWorldQuestInstructorOrEscort(instructor), templateId).toBe(true);
      expect(worldQuestInstructorDialog(world, instructor)?.canStart, templateId).toBe(true);
    }
    for (const [index, templateId] of worldQuestEscortIds.entries()) {
      const escort = { id: 100 + index, kind: 'mob', templateId } as Entity;
      expect(isWorldQuestInstructorOrEscort(escort), templateId).toBe(true);
      expect(worldQuestInstructorDialog(world, escort)?.canStart, templateId).toBe(true);
    }

    const skye = { id: 4, kind: 'npc', templateId: 'glider_apprentice' } as Entity;
    const randomNpc = { id: 200, kind: 'npc', templateId: 'innkeeper_elena' } as Entity;
    expect(isWorldQuestInstructorOrEscort(skye)).toBe(true);
    expect(isWorldQuestInstructorOrEscort(randomNpc)).toBe(false);
  });

  it('allows a paused maze to resume but blocks duplicate active starts', () => {
    const progress: WorldQuestProgress = {
      questId: 'wq_evergarden_wisp_maze',
      count: 0,
      state: 'active',
      wispMaze: createWispMaze(1),
    };
    const world = makeWorld([[progress.questId, progress]]);
    const keeper = { id: 7, kind: 'npc', templateId: 'wisp_maze_keeper' } as Entity;
    expect(worldQuestInstructorDialog(world, keeper)?.canStart).toBe(false);
    if (!progress.wispMaze) throw new Error('Missing trial');
    progress.wispMaze.paused = true;
    expect(worldQuestInstructorDialog(world, keeper)?.canStart).toBe(true);
  });

  it('offers the maze keeper a Normal and a Hard entry and nobody else a choice', () => {
    const progress: WorldQuestProgress = {
      questId: 'wq_evergarden_wisp_maze',
      count: 0,
      state: 'active',
    };
    const world = makeWorld([[progress.questId, progress]]);
    const keeper = { id: 7, kind: 'npc', templateId: 'wisp_maze_keeper' } as Entity;
    const view = worldQuestInstructorDialog(world, keeper);
    expect(view?.questId).toBe('wq_evergarden_wisp_maze');
    expect(view?.difficulties?.map((choice) => choice.difficulty)).toEqual(['normal', 'hard']);
    expect(view?.difficulties?.map((choice) => choice.label)).toEqual([
      'Enter the maze: Normal (3 shadows)',
      'Enter the maze: Hard (5 shadows)',
    ]);
    progress.state = 'completed';
    expect(worldQuestInstructorDialog(world, keeper)?.difficulties).toHaveLength(2);
    const elian = { id: 8, kind: 'npc', templateId: 'calligraphy_instructor' } as Entity;
    const elianWorld = makeWorld([
      [
        'wq_eastbrook_calligraphy',
        { questId: 'wq_eastbrook_calligraphy', count: 0, state: 'active' },
      ],
    ]);
    expect(worldQuestInstructorDialog(elianWorld, elian)?.difficulties).toBeUndefined();
  });

  it('provides dialogue briefing and start button for calligraphy instructor Elian', () => {
    const world = makeWorld([
      [
        'wq_eastbrook_calligraphy',
        { questId: 'wq_eastbrook_calligraphy', count: 0, state: 'active' },
      ],
    ]);
    const elian = { id: 2, kind: 'npc', templateId: 'calligraphy_instructor' } as Entity;
    const dialog = worldQuestInstructorDialog(world, elian);

    expect(dialog).not.toBeNull();
    expect(dialog?.speakerName).toBe('Instructor Elian');
    expect(dialog?.canStart).toBe(true);
    expect(dialog?.questTitle).toBeTruthy();
    expect(dialog?.buttonLabel).toBeTruthy();
  });

  it('provides dialogue briefing and start button for glider instructor Zephyr', () => {
    const world = makeWorld([
      ['wq_galecrest_slalom', { questId: 'wq_galecrest_slalom', count: 0, state: 'active' }],
    ]);
    const zephyr = { id: 3, kind: 'npc', templateId: 'glider_instructor' } as Entity;
    const dialog = worldQuestInstructorDialog(world, zephyr);

    expect(dialog).not.toBeNull();
    expect(dialog?.speakerName).toBe('Flightmaster Zephyr');
    expect(dialog?.canStart).toBe(true);
  });

  it('offers Zephyr a reward-free replay after completion, but never while dead', () => {
    const world = makeWorld([
      ['wq_galecrest_slalom', { questId: 'wq_galecrest_slalom', count: 1, state: 'completed' }],
    ]);
    const zephyr = { id: 3, kind: 'npc', templateId: 'glider_instructor' } as Entity;
    expect(worldQuestInstructorDialog(world, zephyr)?.canStart).toBe(true);
    world.player.dead = true;
    expect(worldQuestInstructorDialog(world, zephyr)?.canStart).toBe(false);
  });

  it('allows glider apprentice Skye to retry even if previously completed', () => {
    const world = makeWorld([
      ['wq_galecrest_slalom', { questId: 'wq_galecrest_slalom', count: 1, state: 'completed' }],
    ]);
    const skye = { id: 4, kind: 'npc', templateId: 'glider_apprentice' } as Entity;
    const dialog = worldQuestInstructorDialog(world, skye);

    expect(dialog).not.toBeNull();
    expect(dialog?.canStart).toBe(true);
  });

  it('allows reward-free calligraphy after the world quest has been completed', () => {
    const world = makeWorld([
      [
        'wq_eastbrook_calligraphy',
        { questId: 'wq_eastbrook_calligraphy', count: 1, state: 'completed' },
      ],
    ]);
    const elian = { id: 2, kind: 'npc', templateId: 'calligraphy_instructor' } as Entity;
    const dialog = worldQuestInstructorDialog(world, elian);

    expect(dialog).not.toBeNull();
    expect(dialog?.canStart).toBe(true);
    expect(dialog?.hint).toBeTruthy();
  });

  it('provides dialogue briefing and start escort button for caravan driver Tobin', () => {
    const world = makeWorld([
      ['wq_eastbrook_caravan', { questId: 'wq_eastbrook_caravan', count: 0, state: 'active' }],
    ]);
    const tobin = { id: 8, kind: 'mob', templateId: 'eastbrook_freight_caravan' } as Entity;
    const dialog = worldQuestInstructorDialog(world, tobin);

    expect(dialog).not.toBeNull();
    expect(dialog?.speakerName).toBe('Tobin');
    expect(dialog?.speakerTitle).toBe('Caravan');
    expect(dialog?.canStart).toBe(true);
    expect(dialog?.buttonLabel).toBeTruthy();
  });

  it('does not offer a start action without active eligible progress', () => {
    const world = makeWorld();
    world.player.level = 1;
    const elian = { id: 2, kind: 'npc', templateId: 'calligraphy_instructor' } as Entity;
    expect(worldQuestInstructorDialog(world, elian)?.canStart).toBe(false);
  });

  it('returns null for entities that are not WQ instructors or escorts', () => {
    const world = makeWorld();
    const guard = { id: 10, kind: 'npc', templateId: 'eastbrook_guard' } as Entity;
    expect(worldQuestInstructorDialog(world, guard)).toBeNull();
  });
});
