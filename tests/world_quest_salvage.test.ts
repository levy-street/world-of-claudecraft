import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  FARSHORE_HULL_FRAGMENT_PLACEMENT,
  FARSHORE_SALVAGE_PLACEMENTS,
  FARSHORE_SHIPWRECK_PLACEMENT,
} from '../src/sim/content/farshore_shipwreck_layout';
import { FARSHORE_SALVAGE_ENTITY_ID_START } from '../src/sim/content/world_quests';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { interactObjectCreditKey } from '../src/sim/quests/interact_object_credit';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, type WorldQuestProgress } from '../src/sim/types';
import { terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';
import {
  isWorldQuestSalvageObject,
  isWorldQuestSalvageObjectHidden,
  worldQuestSalvageLayout,
  worldQuestSalvageVisualIndex,
} from '../src/sim/world_quest_salvage';
import { worldQuestCycleForResetDay } from '../src/sim/world_quests';
import { WORLD_SEED } from '../src/sim/world_seed';

const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;

function salvageEntity(id: number, x = 302.7, z = 117.75): Entity {
  return {
    id,
    kind: 'object',
    templateId: 'ground_wreckfield_flotsam_crate',
    objectItemId: 'wreckfield_flotsam_crate',
    pos: { x, y: 0, z },
  } as Entity;
}

describe('Farshore authored shipwreck salvage', () => {
  it('pins every transform in the approved Placer export independently of the spawn code', () => {
    expect([
      FARSHORE_SHIPWRECK_PLACEMENT,
      FARSHORE_HULL_FRAGMENT_PLACEMENT,
      ...FARSHORE_SALVAGE_PLACEMENTS,
    ]).toEqual([
      { key: 'wq_shipwreck', x: 306, y: -4.75, z: 123.05, rot: 90, scale: 14 },
      { key: 'wq_hull_fragment', x: 302.7, y: -6, z: 117.75, rot: 330, scale: 6 },
      { key: 'wq_waterlogged_barrel', x: 326.2, y: -4.5, z: 140.6, rot: 105, scale: 2 },
      { key: 'wq_damaged_crate', x: 344, y: -4.5, z: 144.7, rot: 270, scale: 1.5 },
      { key: 'wq_broken_planks', x: 369.9, y: -4, z: 136.3, rot: 270, scale: 2 },
      { key: 'wq_damaged_crate', x: 322.1, y: 0, z: 108.2, rot: 135, scale: 1.5 },
      { key: 'wq_damaged_crate', x: 324.1, y: 0, z: 108.2, rot: 15, scale: 1 },
      { key: 'wq_capsized_rowboat', x: 387.1, y: -4, z: 126.5, rot: 330, scale: 5 },
      { key: 'wq_damaged_crate', x: 381.6, y: -3, z: 126, rot: 45, scale: 1.5 },
      { key: 'wq_waterlogged_barrel', x: 342.2, y: -4.5, z: 126.7, rot: 75, scale: 2 },
      { key: 'wq_fallen_anchor', x: 320.6, y: -4.25, z: 130.05, rot: 345, scale: 2 },
      { key: 'wq_damaged_crate', x: 366.1, y: -2.25, z: 112.5, rot: 90, scale: 1.5 },
      { key: 'wq_broken_planks', x: 392.5, y: -4.5, z: 125.3, rot: 270, scale: 2 },
    ]);
  });

  it('offers all eleven smaller pieces, requiring eight, with the authored repeated models', () => {
    if (quest.objective.type !== 'salvage') throw new Error('Expected salvage fixture');
    expect(quest.count).toBe(8);
    expect(quest.objective.layouts).toHaveLength(1);
    expect(quest.objective.layouts[0]).toEqual([
      2147100101, 2147100102, 2147100103, 2147100104, 2147100105, 2147100106, 2147100107,
      2147100108, 2147100109, 2147100110, 2147100111,
    ]);
    expect(quest.objective.layouts[0].map(worldQuestSalvageVisualIndex)).toEqual([
      1, 2, 0, 2, 2, 5, 2, 1, 3, 2, 0,
    ]);
    for (const id of [2147100100, 2147100099, 2147100112, 2147100123, 2147100100.5]) {
      expect(worldQuestSalvageVisualIndex(id)).toBeNull();
    }
  });

  it.each(['2026-09-04', '2026-09-16', '2026-10-02'])(
    'keeps the approved layout on offer %s, including legacy variant progress',
    (resetDay) => {
      if (quest.objective.type !== 'salvage') throw new Error('Expected salvage fixture');
      const cycle = worldQuestCycleForResetDay(resetDay);
      for (const variant of [undefined, 0, 1, 2]) {
        const progress =
          variant === undefined
            ? undefined
            : {
                questId: quest.id,
                count: 0,
                state: 'active' as const,
                puzzleVariant: variant,
              };
        expect(worldQuestSalvageLayout(quest, progress, cycle)).toBe(quest.objective.layouts[0]);
      }
    },
  );

  it('hides recovered debris per viewer and all remaining debris after completion', () => {
    const cycle = worldQuestCycleForResetDay('2026-09-04');
    const layout = worldQuestSalvageLayout(quest, undefined, cycle);
    const visible = salvageEntity(layout[0]);
    expect(isWorldQuestSalvageObject(visible, quest)).toBe(true);
    expect(isWorldQuestSalvageObject(salvageEntity(2147100112), quest)).toBe(false);
    expect(isWorldQuestSalvageObjectHidden(visible, quest, cycle, new Map())).toBe(false);
    const progress: WorldQuestProgress = {
      questId: quest.id,
      count: 1,
      state: 'active',
      puzzleVariant: 0,
      creditedObjects: [interactObjectCreditKey(0, visible.pos)],
    };
    const log = new Map([[quest.id, progress]]);
    expect(isWorldQuestSalvageObjectHidden(visible, quest, cycle, log)).toBe(true);
    expect(isWorldQuestSalvageObjectHidden(visible, quest, cycle, new Map())).toBe(false);
    progress.state = 'completed';
    for (const [i, p] of FARSHORE_SALVAGE_PLACEMENTS.entries()) {
      expect(
        isWorldQuestSalvageObjectHidden(salvageEntity(layout[i], p.x, p.z), quest, cycle, log),
      ).toBe(true);
    }
  });
});

describe('Farshore salvage placement', () => {
  it('keeps the hull decorative with no pickup entity or quest credit', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.resetDay = '2026-09-04';
    sim.chat('/dev salvage');
    sim.player.pos = sim.groundPos(302.7, 117.75);
    expect(sim.entities.has(2147100100)).toBe(false);
    expect(sim.pickUpObject(2147100100)).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)!.count).toBe(0);
  });

  it('spawns the exact transforms with walkable collection spots inside the enlarged quest area', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    expect(quest.area).toEqual({ x: 347.6, z: 126.45, radius: 54 });
    for (const [index, p] of FARSHORE_SALVAGE_PLACEMENTS.entries()) {
      const object = sim.entities.get(FARSHORE_SALVAGE_ENTITY_ID_START + index);
      const pos = { x: p.x, y: p.y, z: p.z };
      expect(object).toMatchObject({
        pos,
        prevPos: pos,
        spawnPos: pos,
        facing: (p.rot * Math.PI) / 180,
        prevFacing: (p.rot * Math.PI) / 180,
        scale: p.scale,
      });
      expect(isBlocked(WORLD_SEED, p.x, p.z, PLAYER_BODY_RADIUS)).toBe(false);
      expect(terrainSteepnessAt(p.x, p.z, WORLD_SEED)).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      // The authored props may be partially submerged; their collection spots
      // remain within wading depth, with no diving required to reach them.
      expect(WATER_LEVEL - sim.groundPos(p.x, p.z).y).toBeLessThanOrEqual(PLAYER_SWIM_DEPTH);
      expect(
        Math.hypot(p.x - quest.area.x, p.z - quest.area.z) + INTERACT_RANGE,
      ).toBeLessThanOrEqual(quest.area.radius);
    }
    for (let index = 11; index < 24; index++) {
      expect(sim.entities.has(FARSHORE_SALVAGE_ENTITY_ID_START + index)).toBe(false);
    }
  });

  it.each([0, 3])(
    'completes from eight unique pieces starting at index %i, never repeat clicks',
    (start) => {
      const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
      sim.resetDay = '2026-09-04';
      sim.chat('/dev salvage');
      const progress = sim.worldQuestLog.get(quest.id)!;
      for (let index = start; index < start + 8; index++) {
        const object = sim.entities.get(FARSHORE_SALVAGE_ENTITY_ID_START + index)!;
        sim.player.pos = sim.groundPos(object.pos.x, object.pos.z);
        expect(sim.pickUpObject(object.id)).toBe(true);
        expect(progress.count).toBe(index - start + 1);
        if (progress.count < 8) {
          expect(sim.pickUpObject(object.id)).toBe(true);
          expect(progress.count).toBe(index - start + 1);
          expect(progress.state).toBe('active');
        }
      }
      expect(progress.state).toBe('completed');
      expect(
        sim
          .drainEvents()
          .filter((event) => event.type === 'worldQuestDone' && event.questId === quest.id),
      ).toHaveLength(1);
    },
  );

  it('restores earned hull credit and completes after seven other recoveries', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.resetDay = '2026-09-04';
    sim.chat('/dev salvage');
    const state = sim.serializeCharacter(sim.playerId)!;
    state.worldQuests!.progress = [
      {
        questId: quest.id,
        count: 1,
        state: 'active',
        puzzleVariant: 0,
        creditedObjects: ['0@302.7,117.8'],
      },
    ];
    const restored = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = '2026-09-04';
    const pid = restored.addPlayer('warrior', 'Salvager', { state });
    const progress = restored.meta(pid)!.worldQuestLog.get(quest.id)!;
    expect(progress.count).toBe(1);
    expect(progress.creditedObjects).toEqual(['0@302.7,117.8']);
    for (const id of [
      2147100101, 2147100102, 2147100103, 2147100104, 2147100105, 2147100106, 2147100107,
    ]) {
      const object = restored.entities.get(id)!;
      restored.entities.get(pid)!.pos = restored.groundPos(object.pos.x, object.pos.z);
      expect(restored.pickUpObject(id, pid)).toBe(true);
    }
    expect(progress).toMatchObject({ count: 8, state: 'completed' });
    expect(
      restored
        .drainEvents()
        .filter((event) => event.type === 'worldQuestDone' && event.questId === quest.id),
    ).toHaveLength(1);
  });
});
