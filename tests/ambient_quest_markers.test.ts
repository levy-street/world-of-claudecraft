import { describe, expect, it } from 'vitest';
import { NPCS, QUESTS } from '../src/sim/data';
import { questGiverNpcMarkers } from '../src/sim/quest_targets';
import {
  ambientNpcQuestMarkerKind,
  isProfessionQuest,
} from '../src/sim/quests/ambient_quest_marker';
import { npcQuestMarkerKind } from '../src/sim/quests/quest_marker_kind';
import type { QuestState } from '../src/sim/types';
import { createMinimapMarkers } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';

const professionQuests = Object.values(QUESTS).filter(
  (q) => q.id.startsWith('q_prof_') || q.id === 'q_farm_intro',
);

/** The exact set the ambient policy hides, pinned so a quest that later
 *  grows a farm objective (or a renamed prefix) reddens this list instead of
 *  silently losing its marker on the nameplate, minimap and map. */
const HIDDEN_OFFER_QUEST_IDS = [
  'q_farm_intro',
  'q_prof_amends_apothecary',
  'q_prof_amends_bombardier',
  'q_prof_amends_outfitter',
  'q_prof_amends_smith',
  'q_prof_attune_apothecary',
  'q_prof_attune_bombardier',
  'q_prof_attune_outfitter',
  'q_prof_attune_smith',
  'q_prof_hobby_switch',
  'q_prof_intro',
  'q_prof_workorder_apothecary',
  'q_prof_workorder_forge',
  'q_prof_workorder_kitchens',
  'q_prof_workorder_kitchens_rice',
  'q_prof_workorder_kitchens_wheat',
  'q_prof_workorder_loom',
  'q_prof_workorder_tannery',
  'q_prof_workorder_toolworks',
];

describe('the hidden-offer predicate over the merged catalog', () => {
  it('hides exactly the profession onboarding quests and First Furrow', () => {
    const hidden = Object.values(QUESTS)
      .filter(isProfessionQuest)
      .map((q) => q.id)
      .sort();
    expect(hidden).toEqual(HIDDEN_OFFER_QUEST_IDS);
    expect(professionQuests.map((q) => q.id).sort()).toEqual(HIDDEN_OFFER_QUEST_IDS);
  });
});

function minimapMarker(
  questIds: string[],
  state: (id: string) => QuestState,
  done = new Set<string>(),
  blocked: string[] = [],
) {
  const npcId = QUESTS[questIds[0]].giverNpcId;
  const player = { id: 1, kind: 'player', pos: { x: 0, z: 100 }, facing: 0 };
  const npc = {
    id: 2,
    kind: 'npc',
    name: 'Quest giver',
    templateId: npcId,
    questIds,
    pos: { x: 4, z: 100 },
    dead: false,
  };
  const world = {
    player,
    playerId: 1,
    entities: new Map<number, unknown>([
      [1, player],
      [2, npc],
    ]),
    partyInfo: null,
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42 },
    inventory: [],
    stationPlacements: [],
    farmPatches: [],
    nodeHarvestableByMe: () => false,
    questState: state,
    questsDone: done,
    craftingIdentity: { version: 1, synced: true, cadenceBlockedQuests: blocked },
  } as unknown as IWorld;
  return createMinimapMarkers()
    .build(world, 162, 1.7)
    .markers.find((m) => m.kind === 'npc');
}

describe('ambient profession offers stay available in dialogue', () => {
  it('recognizes farming by its action objectives even without a profession-prefixed id', () => {
    const quest = { ...QUESTS.q_farm_intro, id: 'q_another_first_crop' };
    expect(ambientNpcQuestMarkerKind(quest, quest.giverNpcId, 'available', new Set())).toBe('none');
    expect(npcQuestMarkerKind(quest, quest.giverNpcId, 'available', new Set())).toBe('available');
  });

  it('covers the intro, attunements, amends, work orders and hobby switch', () => {
    const ids = professionQuests.map((q) => q.id);
    expect(ids).toContain('q_prof_intro');
    expect(ids).toContain('q_farm_intro');
    expect(ids).toContain('q_prof_hobby_switch');
    for (const prefix of ['q_prof_attune_', 'q_prof_amends_', 'q_prof_workorder_']) {
      expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
    }
  });

  it.each(professionQuests)(
    'hides $id on map and minimap, while dialogue still offers it',
    (quest) => {
      const state = (id: string): QuestState => (id === quest.id ? 'available' : 'unavailable');
      const done = new Set<string>();
      expect(questGiverNpcMarkers(state, done).flatMap((m) => m.quests)).toEqual([]);
      expect(minimapMarker([quest.id], state)).toMatchObject({ glyph: '•', marker: 'none' });
      expect(npcQuestMarkerKind(quest, quest.giverNpcId, 'available', done)).toBe('available');
      if (quest.repeatable) {
        done.add(quest.id);
        expect(questGiverNpcMarkers(state, done).flatMap((m) => m.quests)).toEqual([]);
        expect(minimapMarker([quest.id], state, done)).toMatchObject({
          glyph: '•',
          marker: 'none',
        });
        expect(npcQuestMarkerKind(quest, quest.giverNpcId, 'available', done)).toBe('repeat');
      }
    },
  );

  it('keeps ready profession hand-ins on both map surfaces', () => {
    const id = 'q_prof_intro';
    const state = (q: string): QuestState => (q === id ? 'ready' : 'unavailable');
    expect(questGiverNpcMarkers(state, new Set()).flatMap((m) => m.quests)).toContainEqual({
      questId: id,
      kind: 'ready',
    });
    expect(minimapMarker([id], state)).toMatchObject({ glyph: '?', marker: 'ready' });
  });

  it('keeps combat offers on mixed profession/combat givers in either order', () => {
    expect(NPCS.foreman_odell.questIds).toEqual(expect.arrayContaining(['q_prof_intro', 'q_mine']));
    const state = (id: string): QuestState =>
      ['q_prof_intro', 'q_mine'].includes(id) ? 'available' : 'unavailable';
    expect(questGiverNpcMarkers(state, new Set()).flatMap((m) => m.quests)).toEqual([
      { questId: 'q_mine', kind: 'available' },
    ]);
    for (const ids of [
      ['q_prof_intro', 'q_mine'],
      ['q_mine', 'q_prof_intro'],
    ]) {
      expect(minimapMarker(ids, state)).toMatchObject({ glyph: '!', marker: 'available' });
    }
  });
});
