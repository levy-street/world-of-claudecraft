import { describe, expect, it } from 'vitest';

import { CAMPS, ITEMS, MOBS, NPCS, QUEST_ORDER, QUESTS } from '../src/sim/data';
import {
  REMOVED_ZONE1_MOB_IDS,
  REMOVED_ZONE1_OBJECTIVE_ITEM_IDS,
  REMOVED_ZONE1_QUEST_IDS,
  RETIRED_ZONE1_ITEM_IDS,
  sanitizeRemovedZone1Content,
} from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';

function baseState(extra: Partial<CharacterState> = {}): CharacterState {
  return {
    level: 6,
    xp: 0,
    copper: 0,
    hp: 100,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: { mainhand: 'worn_sword' },
    inventory: [],
    questLog: [],
    questsDone: [],
    ...extra,
  };
}

describe('removed Eastbrook Vale quest content', () => {
  it('removes retired quest IDs from the live quest registry and NPC quest lists', () => {
    for (const questId of REMOVED_ZONE1_QUEST_IDS) {
      expect(QUESTS[questId], questId).toBeUndefined();
      expect(QUEST_ORDER, questId).not.toContain(questId);
    }

    for (const npc of Object.values(NPCS)) {
      for (const questId of REMOVED_ZONE1_QUEST_IDS) {
        expect(npc.questIds, `${npc.id} should not offer ${questId}`).not.toContain(questId);
      }
    }
  });

  it('removes Ranger Elwyn and objective items while preserving retired reward items', () => {
    expect(NPCS.ranger_elwyn).toBeUndefined();
    for (const itemId of RETIRED_ZONE1_ITEM_IDS) {
      expect(ITEMS[itemId], itemId).toBeTruthy();
    }
    for (const itemId of REMOVED_ZONE1_OBJECTIVE_ITEM_IDS) {
      expect(ITEMS[itemId], itemId).toBeUndefined();
    }
  });

  it('removes orphaned mobs and prevents them from spawning in live camps', () => {
    for (const mobId of REMOVED_ZONE1_MOB_IDS) {
      expect(MOBS[mobId], mobId).toBeUndefined();
      expect(
        CAMPS.some((camp) => camp.mobId === mobId),
        mobId,
      ).toBe(false);
    }
  });

  it('moves Mogger Must Fall directly after the former trail prerequisite', () => {
    expect(QUESTS.q_mogger).toBeTruthy();
    expect(QUESTS.q_mogger.requiresQuest).toBe('q_gravecallers_trail');
    expect(QUEST_ORDER[QUEST_ORDER.indexOf('q_gravecallers_trail') + 1]).toBe('q_mogger');
  });

  it('scrubs removed quests and objective items while preserving reward items', () => {
    const state = baseState({
      equipment: {
        mainhand: 'worn_sword',
        chest: 'bramblehide_jerkin',
        helmet: 'monarch_crown_helm',
      },
      inventory: [
        { itemId: 'glade_pelt', count: 4 },
        { itemId: 'spring_water', count: 2 },
        { itemId: 'monarch_heart', count: 1 },
      ],
      vendorBuyback: [
        { itemId: 'bramblehide_jerkin', count: 1 },
        { itemId: 'glade_pelt', count: 2 },
        { itemId: 'tough_jerky', count: 3 },
      ],
      questLog: [
        { questId: 'q_ledger_first_duty', counts: [3], state: 'active' },
        { questId: 'q_mogger_tracks', counts: [8], state: 'ready' },
        { questId: 'q_wolves', counts: [2], state: 'active' },
      ],
      questsDone: ['q_brightwood_thinning', 'q_ledger_outlaw_captain', 'q_gravecallers_trail'],
    });

    const result = sanitizeRemovedZone1Content(state);

    expect(result.changed).toBe(true);
    expect(result.state.questLog.map((q) => q.questId)).toEqual(['q_wolves']);
    expect(result.state.questsDone).toEqual(['q_gravecallers_trail']);
    expect(result.state.inventory).toEqual([{ itemId: 'spring_water', count: 2 }]);
    expect(result.state.vendorBuyback).toEqual([
      { itemId: 'bramblehide_jerkin', count: 1 },
      { itemId: 'tough_jerky', count: 3 },
    ]);
    expect(result.state.equipment).toEqual({
      mainhand: 'worn_sword',
      chest: 'bramblehide_jerkin',
      helmet: 'monarch_crown_helm',
    });
  });
});
