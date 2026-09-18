// One state, two pure marker cores: the minimap model and the
// world-map marker resolver must agree on every kind they BOTH render, over
// identical inputs. The review round caught exactly this divergence: the
// minimap folded 'active' into the winner before collapsing it while the map
// filtered it per quest, so an in-progress turn-in swallowed a cooldown mark
// on the minimap that the map drew. That agreement is pinned on a SYNTHETIC
// non-profession work order, because the ambient policy hides every
// profession offer (including cooldown) on both surfaces: that policy is the
// second case here, pinned on the real profession order. The nameplate's
// deliberate divergence (it alone renders the gray in-progress state, which
// then outranks cooldown) is pinned separately in
// tests/nameplate_quest_marker.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NPCS, QUESTS } from '../src/sim/data';
import { questGiverNpcMarkers } from '../src/sim/quest_targets';
import { createMinimapMarkers, type MinimapMarker } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';

function requireWorkOrderQuest() {
  const quest = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
  if (!quest) throw new Error('expected a cadenced work order');
  return quest;
}
const WORK_ORDER = requireWorkOrderQuest();

/** A sibling quest that turns in at the work order's giver, so one NPC can
 *  hold an in-progress turn-in beside the cooling-down order. */
function requireTurnInSibling() {
  const quest = Object.values(QUESTS).find(
    (q) =>
      q.id !== WORK_ORDER.id &&
      (q.turnInNpcId === WORK_ORDER.giverNpcId ||
        (q.turnInNpcIds ?? []).includes(WORK_ORDER.giverNpcId)),
  );
  if (!quest) throw new Error('expected a turn-in sibling at the work-order giver');
  return quest;
}
const SIBLING = requireTurnInSibling();

/** The synthetic non-profession copy of the order, registered on the giver
 *  for the map resolver (it reads the NPCS table) and on the minimap entity. */
const SYNTH_ORDER = 'q_test_marker_workorder';
const giver = NPCS[WORK_ORDER.giverNpcId];
const originalGiverQuestIds = giver.questIds;
beforeEach(() => {
  QUESTS[SYNTH_ORDER] = { ...WORK_ORDER, id: SYNTH_ORDER };
  giver.questIds = [...originalGiverQuestIds, SYNTH_ORDER];
});
afterEach(() => {
  delete QUESTS[SYNTH_ORDER];
  giver.questIds = originalGiverQuestIds;
});

const questState = (q: string): 'active' | 'unavailable' =>
  q === SIBLING.id ? 'active' : 'unavailable';

function minimapWorld(orderId: string): IWorld {
  const player = { id: 1, kind: 'player', name: 'Me', pos: { x: 0, z: 100 }, facing: 0 };
  const npc = {
    id: 2,
    kind: 'npc',
    name: 'Master',
    templateId: WORK_ORDER.giverNpcId,
    questIds: [SIBLING.id, orderId],
    pos: { x: 4, z: 100 },
    dead: false,
    lootable: false,
    aggroTargetId: null,
  };
  return {
    player,
    entities: new Map<number, unknown>([
      [1, player],
      [2, npc],
    ]),
    partyInfo: null,
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    inventory: [],
    stationPlacements: [],
    farmPatches: [],
    nodeHarvestableByMe: () => false,
    questState,
    questsDone: new Set([orderId]),
    craftingIdentity: { version: 1, synced: true, cadenceBlockedQuests: [orderId] },
  } as unknown as IWorld;
}

function npcMinimapMarkers(orderId: string) {
  return createMinimapMarkers()
    .build(minimapWorld(orderId), 162, 1.7)
    .markers.filter((m) => m.kind === 'npc') as Extract<MinimapMarker, { kind: 'npc' }>[];
}

function mapGiverFor(orderId: string) {
  return questGiverNpcMarkers(questState, new Set([orderId]), new Set([orderId])).find((m) =>
    m.quests.some((q) => q.questId === orderId),
  );
}

describe('minimap and map marker cores agree over one state', () => {
  it('an in-progress turn-in never swallows the cooldown mark on either core', () => {
    const npcMarkers = npcMinimapMarkers(SYNTH_ORDER);
    expect(npcMarkers).toHaveLength(1);
    expect(npcMarkers[0].glyph).toBe('!');
    expect(npcMarkers[0].marker).toBe('cooldown');

    const mapGiver = mapGiverFor(SYNTH_ORDER);
    expect(mapGiver?.kind).toBe('cooldown');

    // The agreement itself, stated as one assertion so a future divergence
    // names both surfaces in the failure.
    expect(npcMarkers[0].marker).toBe(mapGiver?.kind);
  });

  it('a profession cooldown offer stays hidden beside an in-progress turn-in on both cores', () => {
    const npcMarkers = npcMinimapMarkers(WORK_ORDER.id);
    expect(npcMarkers).toHaveLength(1);
    expect(npcMarkers[0].glyph).toBe('\u2022');
    expect(npcMarkers[0].marker).toBe('none');

    // The map resolver drops a giver with nothing to show, so its side of
    // the agreement is the absence of a marker for this order.
    expect(mapGiverFor(WORK_ORDER.id)).toBeUndefined();
  });
});
