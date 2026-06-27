import { describe, expect, it } from 'vitest';
import { CAMPS, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { questObjectiveLocations, resolveObjectiveLocations } from '../src/sim/quests/quest_objective_locator';
import type { QuestObjective } from '../src/sim/types';

const allObjectives = Object.values(QUESTS).flatMap((q) => q.objectives);
const isPoint = (p: any) => typeof p.x === 'number' && typeof p.z === 'number' && typeof p.radius === 'number';

describe('resolveObjectiveLocations', () => {
  it('resolves kill objectives to the mob camp(s) as search areas (radius > 0)', () => {
    const kill = allObjectives.find((o) => o.type === 'kill' && o.targetMobId && CAMPS.some((c) => c.mobId === o.targetMobId));
    expect(kill, 'expected at least one kill objective with a camp').toBeTruthy();
    const locs = resolveObjectiveLocations(kill!);
    expect(locs).toBeTruthy();
    expect(locs!.length).toBeGreaterThan(0);
    expect(locs!.every(isPoint)).toBe(true);
    expect(locs!.every((l) => l.radius > 0)).toBe(true);
  });

  it('resolves ground-object collect objectives to exact positions (radius 0)', () => {
    const collect = allObjectives.find((o) => o.type === 'collect' && o.itemId && GROUND_OBJECTS.some((g) => g.itemId === o.itemId));
    expect(collect, 'expected a ground-object collect objective').toBeTruthy();
    const locs = resolveObjectiveLocations(collect!);
    expect(locs!.length).toBeGreaterThan(0);
    expect(locs!.every((l) => l.radius === 0)).toBe(true);
  });

  it('resolves drop-collect objectives to the dropping mob\'s camp', () => {
    const groundIds = new Set(GROUND_OBJECTS.map((g) => g.itemId));
    const drop = allObjectives.find((o) => o.type === 'collect' && o.itemId && !groundIds.has(o.itemId) &&
      Object.values(MOBS).some((m) => (m.loot || []).some((l) => l.itemId === o.itemId) && CAMPS.some((c) => c.mobId === m.id)));
    if (!drop) return; // content may not have such a quest; skip rather than fail
    const locs = resolveObjectiveLocations(drop);
    expect(locs!.length).toBeGreaterThan(0);
    expect(locs!.every(isPoint)).toBe(true);
  });

  it('resolves interact objectives to the ground object or NPC position', () => {
    const interact = allObjectives.find((o) => o.type === 'interact' && ((o.targetObjectItemId && GROUND_OBJECTS.some((g) => g.itemId === o.targetObjectItemId)) || (o.targetNpcId && NPCS[o.targetNpcId])));
    if (!interact) return;
    const locs = resolveObjectiveLocations(interact);
    expect(locs!.length).toBeGreaterThan(0);
  });

  it('returns null for an unresolvable objective', () => {
    const bogus: QuestObjective = { type: 'kill', targetMobId: '__nope__', count: 1, label: 'x' };
    expect(resolveObjectiveLocations(bogus)).toBeNull();
  });
});

describe('questObjectiveLocations', () => {
  it('returns objective pins for an incomplete tracked quest', () => {
    const q = Object.values(QUESTS).find((x) => x.objectives.some((o) => resolveObjectiveLocations(o)));
    expect(q).toBeTruthy();
    const locs = questObjectiveLocations(q!.id);
    expect(locs.length).toBeGreaterThan(0);
  });

  it('points at the turn-in NPC once every objective is complete', () => {
    const q = Object.values(QUESTS).find((x) => {
      const id = (x.turnInNpcIds && x.turnInNpcIds[0]) || x.turnInNpcId;
      return id && NPCS[id];
    });
    expect(q).toBeTruthy();
    const doneCounts = q!.objectives.map((o) => o.count); // all complete
    const locs = questObjectiveLocations(q!.id, doneCounts);
    const turnIn = NPCS[(q!.turnInNpcIds && q!.turnInNpcIds[0]) || q!.turnInNpcId];
    expect(locs).toEqual([{ x: turnIn.pos.x, z: turnIn.pos.z, radius: 0 }]);
  });

  it('returns [] for an unknown quest id', () => {
    expect(questObjectiveLocations('__nope__')).toEqual([]);
  });
});
