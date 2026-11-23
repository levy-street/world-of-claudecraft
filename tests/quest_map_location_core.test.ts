// The one place a quest's map position is decided, shared by the atlas rail's
// "Show Route" and the quest log's "Show on Map". Before the extraction the log's
// button clicked the generic map launcher and so opened the player's current zone
// instead; these pin that both controls now resolve the SAME point.

import { describe, expect, it } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { buildMapSidebarView, DEFAULT_MAP_ATLAS_FILTERS } from '../src/ui/map_sidebar_view';
import { liveNpcPosLookup, questMapLocation } from '../src/ui/quest_map_location_core';
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

  it('points at where the turn-in NPC actually stands in the loaded map', () => {
    // A map can move the NPC (a Studio map stands Marshal Redbrook on the
    // quay): the map control must lead to the NPC the player can see.
    const moved = { x: -86.2, z: -44.4 };
    const turnIn = QUESTS.q_wolves.turnInNpcId;
    const entities = new Map([
      [3, { kind: 'mob', templateId: turnIn, pos: { x: 0, y: 0, z: 0 } }],
      [4, { kind: 'npc', templateId: turnIn, pos: { x: moved.x, y: 0, z: moved.z } }],
    ]);
    const livePos = liveNpcPosLookup(entities);
    expect(questMapLocation('q_wolves', log(ready('q_wolves')), livePos)).toEqual({
      questId: 'q_wolves',
      ...moved,
    });
    // No live NPC (out of range, despawned): the content position still answers.
    const npc = NPCS[turnIn];
    expect(
      questMapLocation('q_wolves', log(ready('q_wolves')), liveNpcPosLookup(new Map())),
    ).toEqual({ questId: 'q_wolves', x: npc.pos.x, z: npc.pos.z });
    // A dead copy never answers for the living NPC.
    const dead = new Map([
      [5, { kind: 'npc', templateId: turnIn, dead: true, pos: { x: 1, y: 0, z: 1 } }],
    ]);
    expect(questMapLocation('q_wolves', log(ready('q_wolves')), liveNpcPosLookup(dead))?.x).toBe(
      npc.pos.x,
    );
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
