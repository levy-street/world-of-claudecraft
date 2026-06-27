import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { resolveObjectiveLocations } from '../src/sim/quests/quest_objective_locator';
import { trackedQuestMapMarkers } from '../src/ui/map_quest_markers';

// a quest with at least one resolvable objective location
const quest = Object.values(QUESTS).find((q) => q.objectives.some((o) => resolveObjectiveLocations(o)))!;

describe('trackedQuestMapMarkers', () => {
  it('returns nothing when no quest is tracked', () => {
    expect(trackedQuestMapMarkers(null, undefined, -9999, 9999)).toEqual([]);
  });

  it('returns the tracked quest\'s objective markers within a wide band', () => {
    const markers = trackedQuestMapMarkers(quest.id, undefined, -100000, 100000);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((m) => typeof m.x === 'number' && typeof m.z === 'number')).toBe(true);
  });

  it('filters out markers outside the shown zone band', () => {
    const all = trackedQuestMapMarkers(quest.id, undefined, -100000, 100000);
    const minZ = Math.min(...all.map((m) => m.z));
    // a band entirely below the lowest marker should yield none
    expect(trackedQuestMapMarkers(quest.id, undefined, minZ - 50, minZ - 10)).toEqual([]);
  });
});
