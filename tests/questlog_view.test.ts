// Tests for the quest-log window pure core (questlog_view.ts):
//  - the empty state (no quests),
//  - list rows: ready vs active, the selected flag,
//  - selection resolution (stale / unset falls back to the first quest),
//  - the title summary counts,
//  - the selected quest's detail structure: objectives with progress + done flag,
//    rewards, the class reward item, the turn-in npc,
//  - parity: a Sim-shaped and a ClientWorld-mirror-shaped quest set
//    carrying the same logical data render an identical model, plus determinism.
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the localized
// markup + abandon/chat-link wiring is covered by the questlog_window.ts guard.

import { describe, expect, it } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { PlayerClass, QuestProgress } from '../src/sim/types';
import { buildQuestLogView, type QuestLogInput } from '../src/ui/hud/quest/questlog_view';

// Two real quests with at least one objective, so the detail panel is exercised.
const [QUEST_A, QUEST_B] = Object.values(QUESTS).filter((q) => q.objectives.length >= 1);
const CLASS_ID = 'warrior' as PlayerClass;

// A QuestProgress with all objectives complete (ready) or in progress (active).
// shape: 'sim' carries an extra field the core must ignore.
function progress(
  shape: 'sim' | 'client',
  questId: string,
  state: QuestProgress['state'],
  complete = false,
): QuestProgress {
  const objectives = QUESTS[questId].objectives;
  const counts = objectives.map((o) => (complete ? o.count : 0));
  const junk = shape === 'sim' ? { _saveSeq: 4 } : {};
  return { questId, counts, state, ...junk } as unknown as QuestProgress;
}

function input(over: Partial<QuestLogInput> = {}): QuestLogInput {
  return {
    quests: [],
    selectedQuestId: null,
    playerClass: CLASS_ID,
    completedCount: 0,
    ...over,
  };
}

describe('buildQuestLogView: empty state + summary', () => {
  it('reports the empty state with a null detail and zero active count', () => {
    const v = buildQuestLogView(input({ completedCount: 3 }));
    expect(v.empty).toBe(true);
    expect(v.items).toEqual([]);
    expect(v.detail).toBeNull();
    expect(v.selectedQuestId).toBeNull();
    expect(v.summary).toEqual({ active: 0, completed: 3 });
  });

  it('counts active quests from the log and completed from the input', () => {
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active'), progress('sim', QUEST_B.id, 'ready')],
        completedCount: 7,
      }),
    );
    expect(v.summary).toEqual({ active: 2, completed: 7 });
  });
});

describe('buildQuestLogView: list rows + selection', () => {
  it('flags ready rows and resolves the first quest as selected when none is set', () => {
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active'), progress('sim', QUEST_B.id, 'ready')],
      }),
    );
    expect(v.items.map((i) => i.ready)).toEqual([false, true]);
    expect(v.selectedQuestId).toBe(QUEST_A.id);
    expect(v.items.map((i) => i.selected)).toEqual([true, false]);
  });

  it('keeps a valid selection', () => {
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active'), progress('sim', QUEST_B.id, 'active')],
        selectedQuestId: QUEST_B.id,
      }),
    );
    expect(v.selectedQuestId).toBe(QUEST_B.id);
    expect(v.items.find((i) => i.questId === QUEST_B.id)!.selected).toBe(true);
  });

  it('falls back to the first quest when the selection is stale', () => {
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active')],
        selectedQuestId: 'no_such_quest',
      }),
    );
    expect(v.selectedQuestId).toBe(QUEST_A.id);
  });

  it('groups active quests by their giver zone and keeps the completed tally unexpandable', () => {
    const questsByZone = new Map<string, (typeof QUEST_A)[]>();
    for (const quest of Object.values(QUESTS)) {
      const giver = NPCS[quest.giverNpcId];
      if (!giver || quest.objectives.length === 0) continue;
      const zoneId = zoneAt(giver.pos.x, giver.pos.z).id;
      const zoneQuests = questsByZone.get(zoneId) ?? [];
      zoneQuests.push(quest);
      questsByZone.set(zoneId, zoneQuests);
    }
    const distinctZoneQuests = [...questsByZone.entries()].slice(0, 2);
    expect(distinctZoneQuests, 'fixture needs quests from two giver zones').toHaveLength(2);
    const [[zoneA, [questA]], [zoneB, [questB]]] = distinctZoneQuests;
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', questA.id, 'active'), progress('sim', questB.id, 'ready')],
        completedCount: 7,
        collapsedGroupIds: ['completed'],
      }),
    );
    const activeGroups = v.groups.filter((group) => group.id !== 'completed');
    expect(activeGroups).toHaveLength(2);
    expect(activeGroups.map((group) => group.zoneId)).toEqual([zoneA, zoneB]);
    expect(activeGroups.map((group) => group.items.map((item) => item.questId))).toEqual([
      [questA.id],
      [questB.id],
    ]);
    expect(activeGroups.map((group) => group.readyCount)).toEqual([0, 1]);
    expect(activeGroups.every((group) => group.expandable)).toBe(true);
    // Pin moved: the completed tally carries a count but never rows (the log
    // mirrors only ACTIVE quests), so it is not expandable and its collapse
    // state is meaningless: a stored 'completed' collapse id must not make it
    // one, or the painter offers a disclosure onto nothing.
    expect(v.groups.at(-1)).toMatchObject({
      id: 'completed',
      zoneId: null,
      count: 7,
      collapsed: false,
      dimmed: true,
      expandable: false,
      items: [],
    });
  });

  it('carries painter-owned collapse state into matching zone groups', () => {
    const first = buildQuestLogView(input({ quests: [progress('sim', QUEST_A.id, 'active')] }))
      .groups[0];
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active')],
        collapsedGroupIds: [first.id],
      }),
    );
    expect(v.groups[0]).toMatchObject({ id: first.id, collapsed: true });
  });
});

describe('buildQuestLogView: selected quest detail', () => {
  it('derives objectives with progress + the done flag', () => {
    const v = buildQuestLogView(
      input({ quests: [progress('sim', QUEST_A.id, 'ready', true)], selectedQuestId: QUEST_A.id }),
    );
    expect(v.detail).not.toBeNull();
    expect(v.detail!.questId).toBe(QUEST_A.id);
    expect(v.detail!.objectives).toHaveLength(QUEST_A.objectives.length);
    expect(v.detail!.objectives.every((o) => o.done)).toBe(true);
    expect(v.detail!.objectives.map((o) => o.required)).toEqual(
      QUEST_A.objectives.map((o) => o.count),
    );
  });

  it('marks objectives not done when counts are below the requirement', () => {
    const v = buildQuestLogView(
      input({
        quests: [progress('sim', QUEST_A.id, 'active', false)],
        selectedQuestId: QUEST_A.id,
      }),
    );
    expect(v.detail!.objectives.some((o) => o.done)).toBe(false);
  });

  it('carries the rewards, reward item id, and turn-in npc through', () => {
    const v = buildQuestLogView(
      input({ quests: [progress('sim', QUEST_A.id, 'active')], selectedQuestId: QUEST_A.id }),
    );
    const d = v.detail!;
    expect(d.xpReward).toBe(QUEST_A.xpReward);
    expect(d.copperReward).toBe(QUEST_A.copperReward);
    expect(d.turnInNpcId).toBe(QUEST_A.turnInNpcId);
    expect(d.suggestedPlayers).toBe(QUEST_A.suggestedPlayers);
    // rewardItemId is the class-appropriate reward or null (never undefined).
    expect(d.rewardItemId === null || typeof d.rewardItemId === 'string').toBe(true);
  });
});

describe('buildQuestLogView: ClientWorld-vs-Sim parity', () => {
  it('renders identically from a Sim-shaped and a ClientWorld-mirror-shaped quest set', () => {
    const make = (shape: 'sim' | 'client') =>
      buildQuestLogView(
        input({
          quests: [
            progress(shape, QUEST_A.id, 'ready', true),
            progress(shape, QUEST_B.id, 'active'),
          ],
          selectedQuestId: QUEST_A.id,
          completedCount: 2,
        }),
      );
    expect(make('sim')).toEqual(make('client'));
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    const i = input({ quests: [progress('sim', QUEST_A.id, 'active')] });
    expect(buildQuestLogView(i)).toEqual(buildQuestLogView(i));
  });
});
