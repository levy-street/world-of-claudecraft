// One state, two pure marker cores (phase 23): the minimap model and the
// world-map marker resolver must agree on every kind they BOTH render, over
// identical inputs. The review round caught exactly this divergence: the
// minimap folded 'active' into the winner before collapsing it while the map
// filtered it per quest, so an in-progress turn-in swallowed a cooldown mark
// on the minimap that the map drew, on every profession master. The
// nameplate's deliberate divergence (it alone renders the gray in-progress
// state, which then outranks cooldown) is pinned separately in
// tests/nameplate_quest_marker.test.ts.

import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
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

const questState = (q: string): 'active' | 'unavailable' =>
  q === SIBLING.id ? 'active' : 'unavailable';
const questsDone = new Set([WORK_ORDER.id]);
const cadenceBlocked = new Set([WORK_ORDER.id]);

function minimapWorld(): IWorld {
  const player = { id: 1, kind: 'player', name: 'Me', pos: { x: 0, z: 100 }, facing: 0 };
  const npc = {
    id: 2,
    kind: 'npc',
    name: 'Master',
    templateId: WORK_ORDER.giverNpcId,
    questIds: [SIBLING.id, WORK_ORDER.id],
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
    nodeHarvestableByMe: () => false,
    questState,
    questsDone,
    craftingIdentity: { version: 1, synced: true, cadenceBlockedQuests: [...cadenceBlocked] },
  } as unknown as IWorld;
}

describe('minimap and map marker cores agree over one state', () => {
  it('an in-progress turn-in never swallows the cooldown mark on either core', () => {
    const npcMarkers = createMinimapMarkers()
      .build(minimapWorld(), 162, 1.7)
      .markers.filter((m) => m.kind === 'npc') as Extract<MinimapMarker, { kind: 'npc' }>[];
    expect(npcMarkers).toHaveLength(1);
    expect(npcMarkers[0].glyph).toBe('!');
    expect(npcMarkers[0].marker).toBe('cooldown');

    const giver = questGiverNpcMarkers(questState, questsDone, cadenceBlocked).find((m) =>
      m.quests.some((q) => q.questId === WORK_ORDER.id),
    );
    expect(giver?.kind).toBe('cooldown');

    // The agreement itself, stated as one assertion so a future divergence
    // names both surfaces in the failure.
    expect(npcMarkers[0].marker).toBe(giver?.kind);
  });
});
