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
    const visible = salvageEntity(layout[0], 296, 90);
    const otherLayoutId = quest.objective.type === 'salvage' ? quest.objective.layouts[1][0] : -1;
    const rotatedOut = salvageEntity(otherLayoutId, 267, 85);

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

describe('Farshore salvage placement', () => {
  it('scatters every piece across the dry strand, well apart, inside the work area', async () => {
    const { Sim } = await import('../src/sim/sim');
    const { WATER_LEVEL } = await import('../src/sim/world');
    const { WORLD_SEED } = await import('../src/sim/world_seed');
    const { WORLD_QUEST_OBJECTS } = await import('../src/sim/content/world_quests');
    const { FARSHORE_SHIPWRECK_PLAN } = await import('../src/render/farshore_shipwreck');
    const objective = quest.objective;
    if (objective.type !== 'salvage') throw new Error('Expected salvage fixture');
    const debris = WORLD_QUEST_OBJECTS.find((object) => object.itemId === objective.objectItemId);
    if (!debris) throw new Error('Missing salvage debris roster');
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const positions = debris.positions;
    expect(positions).toHaveLength(24);
    const slope = (x: number, z: number) =>
      Math.hypot(
        sim.groundPos(x + 1.5, z).y - sim.groundPos(x - 1.5, z).y,
        sim.groundPos(x, z + 1.5).y - sim.groundPos(x, z - 1.5).y,
      ) / 3;
    for (const [i, { x, z }] of positions.entries()) {
      const height = sim.groundPos(x, z).y - WATER_LEVEL;
      // On sand: above the tide, below the dune crest, never on a steep face.
      expect(height, `piece ${i} height`).toBeGreaterThan(5);
      expect(height, `piece ${i} height`).toBeLessThan(14);
      expect(slope(x, z), `piece ${i} slope`).toBeLessThan(0.65);
      expect(Math.hypot(x - quest.area.x, z - quest.area.z), `piece ${i} area`).toBeLessThan(
        quest.area.radius,
      );
      for (let j = 0; j < i; j++) {
        const other = positions[j];
        expect(Math.hypot(x - other.x, z - other.z), `pieces ${i}/${j}`).toBeGreaterThanOrEqual(6);
      }
    }
    // Each weekly layout spans the beach, hull to town edge, not one tight grid.
    for (const layout of objective.layouts) {
      const points = layout.map((id) => positions[id - debris.entityIds![0]]);
      const xs = points.map((p) => p.x);
      const zs = points.map((p) => p.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(35);
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThanOrEqual(30);
    }
    // The nearest piece keeps the hull as the visual anchor of the site.
    const nearest = Math.min(
      ...positions.map((p) =>
        Math.hypot(p.x - FARSHORE_SHIPWRECK_PLAN.ship.x, p.z - FARSHORE_SHIPWRECK_PLAN.ship.z),
      ),
    );
    expect(nearest).toBeLessThan(25);
  });
});
