// The one place a quest's map position is decided, shared by the atlas rail's
// "Show Route" and the quest log's "Show on Map". Before the extraction the log's
// button clicked the generic map launcher and so opened the player's current zone
// instead; these pin that both controls now resolve the SAME point.

import { describe, expect, it } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { buildMapSidebarView, DEFAULT_MAP_ATLAS_FILTERS } from '../src/ui/map_sidebar_view';
import { questMapLocation } from '../src/ui/quest_map_location_core';
import type { IWorld } from '../src/world_api';

function log(...entries: QuestProgress[]): Map<string, QuestProgress> {
  return new Map(entries.map((entry) => [entry.questId, entry]));
}

function active(questId: string): QuestProgress {
  return { questId, counts: QUESTS[questId].objectives.map(() => 0), state: 'active' };
}

function ready(questId: string): QuestProgress {
  return {
    questId,
    counts: QUESTS[questId].objectives.map((objective) => objective.count),
    state: 'ready',
  };
}

describe('questMapLocation', () => {
  it('returns null for no selection, an unaccepted quest, or an unknown id', () => {
    expect(questMapLocation(null, log())).toBeNull();
    expect(questMapLocation('q_wolves', log())).toBeNull();
    expect(
      questMapLocation(
        'q_not_a_real_quest',
        log({
          questId: 'q_not_a_real_quest',
          counts: [0],
          state: 'active',
        }),
      ),
    ).toBeNull();
  });

  it('points at a real world position while the quest has work left', () => {
    const location = questMapLocation('q_wolves', log(active('q_wolves')));
    expect(location).not.toBeNull();
    expect(location?.questId).toBe('q_wolves');
    expect(Number.isFinite(location?.x ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(location?.z ?? Number.NaN)).toBe(true);
    // It is a place in the world, not the origin fallback a missing lookup gives.
    expect(zoneAt(location?.x ?? 0, location?.z ?? 0).id).toBeTruthy();
  });

  it('points at the turn-in NPC once the quest is ready to hand in', () => {
    const location = questMapLocation('q_wolves', log(ready('q_wolves')));
    const npc = NPCS[QUESTS.q_wolves.turnInNpcId];
    expect(location).toEqual({ questId: 'q_wolves', x: npc.pos.x, z: npc.pos.z });
  });

  it('agrees with the atlas rail route for the same quest (one rule, two controls)', () => {
    const questLog = log(active('q_wolves'));
    const giver = NPCS[QUESTS.q_wolves.giverNpcId];
    const world = {
      player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
      questLog,
      questState: () => 'unavailable',
    } as unknown as IWorld;
    const model = buildMapSidebarView({
      world,
      zone: zoneAt(giver.pos.x, giver.pos.z),
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_wolves',
    });
    expect(model.route).toEqual(questMapLocation('q_wolves', questLog));
  });
});
