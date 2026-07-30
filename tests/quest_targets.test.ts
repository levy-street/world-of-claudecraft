// Tests for the pure quest-objective target/location resolver
// (src/sim/quest_targets.ts): the shared derivation behind the world map's
// quest-area blobs and the mob tooltip's Questie-style quest lines. Driven with the
// real content tables (QUESTS/CAMPS/MOBS/GROUND_OBJECTS) so the fixtures can
// never drift from shipped content.

import { afterEach, describe, expect, it } from 'vitest';
import { CAMPS, GATHER_NODES, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import {
  questGiverNpcMarkers,
  questObjectiveAreas,
  questObjectivesForMob,
} from '../src/sim/quest_targets';
import { isQuestTurnInNpc, type QuestDef, type QuestProgress } from '../src/sim/types';

function activeLog(quest: QuestDef, counts?: number[]): Map<string, QuestProgress> {
  return new Map([
    [
      quest.id,
      {
        questId: quest.id,
        counts: counts ?? quest.objectives.map(() => 0),
        state: 'active' as const,
      },
    ],
  ]);
}

// Real-content fixtures, found by shape (not hardcoded ids) so a content
// rename fails loudly here rather than silently testing nothing.
function requireKillQuest(): { quest: QuestDef; mobId: string; objIndex: number } {
  for (const q of Object.values(QUESTS)) {
    for (const [i, objective] of q.objectives.entries()) {
      if (objective.type !== 'kill') continue;
      if (CAMPS.some((camp) => camp.mobId === objective.targetMobId)) {
        return { quest: q, mobId: objective.targetMobId, objIndex: i };
      }
    }
  }
  throw new Error('expected a kill quest whose target mob has camps');
}

function requireLootCollectQuest(): { quest: QuestDef; mobId: string } {
  for (const q of Object.values(QUESTS)) {
    for (const o of q.objectives) {
      if (o.type !== 'collect' || !o.itemId) continue;
      for (const [mobId, def] of Object.entries(MOBS)) {
        if (def.loot.some((l) => l.itemId === o.itemId && l.questId === q.id))
          return { quest: q, mobId };
      }
    }
  }
  throw new Error('expected a collect quest fed by tagged mob loot');
}

function requireGroundObjectQuest(): { quest: QuestDef; itemId: string } {
  for (const q of Object.values(QUESTS)) {
    for (const o of q.objectives) {
      const itemId =
        o.type === 'collect' ? o.itemId : o.type === 'interact' ? o.targetObjectItemId : undefined;
      if (itemId && GROUND_OBJECTS.some((g) => g.itemId === itemId && g.positions.length > 0))
        return { quest: q, itemId };
    }
  }
  throw new Error('expected a quest fed by ground objects');
}

describe('questObjectivesForMob (the mob tooltip quest lines)', () => {
  it('is empty with no active quests', () => {
    expect(questObjectivesForMob(new Map(), 'forest_wolf')).toEqual([]);
  });

  it('lists an incomplete kill objective with its live counts', () => {
    const { quest, mobId, objIndex } = requireKillQuest();
    const counts = quest.objectives.map(() => 0);
    counts[objIndex] = 3;
    const lines = questObjectivesForMob(activeLog(quest, counts), mobId);
    expect(lines).toContainEqual({
      questId: quest.id,
      objectiveIndex: objIndex,
      current: 3,
      total: quest.objectives[objIndex].count,
    });
    // an unrelated mob gets no lines from this quest's kill objective
    expect(
      questObjectivesForMob(activeLog(quest, counts), 'no_such_mob').some(
        (l) => l.questId === quest.id && l.objectiveIndex === objIndex,
      ),
    ).toBe(false);
  });

  it('drops the line once its objective is complete (even while the quest is active)', () => {
    const { quest, mobId, objIndex } = requireKillQuest();
    const counts = quest.objectives.map((o) => o.count);
    counts[objIndex] = quest.objectives[objIndex].count;
    expect(questObjectivesForMob(activeLog(quest, counts), mobId)).toEqual([]);
  });

  it('lists collect objectives fed by the mob tagged loot', () => {
    const { quest, mobId } = requireLootCollectQuest();
    const lines = questObjectivesForMob(activeLog(quest), mobId);
    expect(lines.some((l) => l.questId === quest.id)).toBe(true);
  });

  it('lists nothing for ready quests (turn-in is the ? marker, not a target)', () => {
    const { quest, mobId } = requireKillQuest();
    const log: Map<string, QuestProgress> = new Map([
      [
        quest.id,
        { questId: quest.id, counts: quest.objectives.map((o) => o.count), state: 'ready' },
      ],
    ]);
    expect(questObjectivesForMob(log, mobId)).toEqual([]);
  });
});

describe('questObjectiveAreas', () => {
  it('is empty with no active quests', () => {
    expect(questObjectiveAreas(new Map())).toEqual([]);
  });

  it('covers every camp of a kill target, padded past the spawn radius', () => {
    const { quest, mobId, objIndex } = requireKillQuest();
    const areas = questObjectiveAreas(activeLog(quest));
    const camps = CAMPS.filter((c) => c.mobId === mobId);
    for (const camp of camps) {
      const area = areas.find((a) => a.center.x === camp.center.x && a.center.z === camp.center.z);
      expect(area, `camp at ${camp.center.x},${camp.center.z} should have an area`).toBeTruthy();
      if (area) {
        expect(area.radius).toBeGreaterThan(camp.radius);
        // the area knows which objective it stands for (the hover tooltip's key)
        expect(
          area.objectives.some((o) => o.questId === quest.id && o.objectiveIndex === objIndex),
        ).toBe(true);
      }
    }
  });

  it('encloses a ground-object cluster in one finite circle', () => {
    const { quest, itemId } = requireGroundObjectQuest();
    const areas = questObjectiveAreas(activeLog(quest));
    const def = GROUND_OBJECTS.find((g) => g.itemId === itemId && g.positions.length > 0);
    expect(def).toBeTruthy();
    if (!def) return;
    // at least one area contains every position of the cluster
    const containing = areas.find((a) =>
      def.positions.every((p) => Math.hypot(p.x - a.center.x, p.z - a.center.z) <= a.radius + 1e-9),
    );
    expect(containing, 'expected one area enclosing the whole object cluster').toBeTruthy();
  });

  it('marks every node of a gather objective type', () => {
    const quest = QUESTS.q_prof_intro;
    const objectiveIndex = quest.objectives.findIndex((objective) => objective.type === 'gather');
    expect(objectiveIndex).toBeGreaterThanOrEqual(0);
    const areas = questObjectiveAreas(activeLog(quest));
    const oreNodes = GATHER_NODES.filter((node) => node.type === 'ore');
    for (const node of oreNodes) {
      const area = areas.find(
        (candidate) => candidate.center.x === node.pos.x && candidate.center.z === node.pos.z,
      );
      expect(area, `gather node ${node.id} should have an objective area`).toBeTruthy();
      expect(area?.objectives).toContainEqual({ questId: quest.id, objectiveIndex });
    }
  });

  it('never emits duplicate circles across a multi-quest log', () => {
    const log = new Map<string, QuestProgress>();
    for (const q of Object.values(QUESTS)) {
      log.set(q.id, { questId: q.id, counts: q.objectives.map(() => 0), state: 'active' });
    }
    const areas = questObjectiveAreas(log);
    const keys = new Set(areas.map((a) => `${a.center.x},${a.center.z},${a.radius}`));
    expect(keys.size).toBe(areas.length);
    for (const a of areas) {
      expect(Number.isFinite(a.center.x)).toBe(true);
      expect(Number.isFinite(a.center.z)).toBe(true);
      expect(a.radius).toBeGreaterThan(0);
      // a shared circle merges objective refs instead of duplicating them
      expect(a.objectives.length).toBeGreaterThan(0);
      const refKeys = new Set(a.objectives.map((o) => `${o.questId}#${o.objectiveIndex}`));
      expect(refKeys.size).toBe(a.objectives.length);
      // every ref points at a real objective of a real quest
      for (const o of a.objectives)
        expect(QUESTS[o.questId]?.objectives[o.objectiveIndex]).toBeTruthy();
    }
  });

  describe('gather objective with only an itemId (no nodeType)', () => {
    // No shipped quest uses this shape yet (every gather objective in content
    // pins a nodeType), so it is installed as a temporary test-only quest, the
    // same pattern tests/profession_quest_objectives.test.ts uses for a latent
    // objective shape. Restored after each test so no other suite sees it.
    const TEST_QUEST_ID = 'q_test_gather_itemid_only';
    const originalQuest = QUESTS[TEST_QUEST_ID];
    afterEach(() => {
      if (originalQuest) QUESTS[TEST_QUEST_ID] = originalQuest;
      else delete QUESTS[TEST_QUEST_ID];
    });

    it('resolves the gather node whose material yields the item, matching the credit path', () => {
      // Credit for a gather objective only ever flows through
      // onNodeGatheredForQuests, fired from harvesting a matching node
      // (src/sim/professions/gathering.ts). The itemId-only shape must
      // therefore pin the same nodes the nodeType arm above would, found by
      // walking GATHER_NODES through nodeMaterialFor rather than mob camps or
      // ground-object clusters, which never grant this objective's credit.
      const targetNode = GATHER_NODES.find((n) => nodeMaterialFor(n.type, n.zoneId).itemId);
      expect(targetNode).toBeTruthy();
      if (!targetNode) return;
      const itemId = nodeMaterialFor(targetNode.type, targetNode.zoneId).itemId;

      const quest: QuestDef = {
        id: TEST_QUEST_ID,
        name: 'Test Gather ItemId Only',
        giverNpcId: 'foreman_odell',
        turnInNpcId: 'foreman_odell',
        text: 'Test only.',
        completionText: 'Test complete.',
        objectives: [{ type: 'gather', itemId, count: 1, label: 'Test gather' }],
        xpReward: 0,
        copperReward: 0,
        itemRewards: {},
        retired: true,
      };
      QUESTS[TEST_QUEST_ID] = quest;

      const areas = questObjectiveAreas(activeLog(quest));
      const nodesYieldingItem = GATHER_NODES.filter(
        (n) => nodeMaterialFor(n.type, n.zoneId).itemId === itemId,
      );
      expect(nodesYieldingItem.length).toBeGreaterThan(0);
      for (const node of nodesYieldingItem) {
        const area = areas.find((a) => a.center.x === node.pos.x && a.center.z === node.pos.z);
        expect(area, `gather node ${node.id} should have an objective area`).toBeTruthy();
        expect(
          area?.objectives.some((o) => o.questId === TEST_QUEST_ID && o.objectiveIndex === 0),
        ).toBe(true);
      }

      // Negative case: a ground-object cluster or mob camp tagged with the
      // same itemId (if any exist) must NOT produce an area, since neither
      // path grants this objective's credit and a pin there would mislead
      // the player into farming a source that never advances the quest.
      const groundDef = GROUND_OBJECTS.find((g) => g.itemId === itemId && g.positions.length > 0);
      if (groundDef) {
        const misleadingArea = areas.find((a) =>
          groundDef.positions.every(
            (p) => Math.hypot(p.x - a.center.x, p.z - a.center.z) <= a.radius + 1e-9,
          ),
        );
        expect(misleadingArea).toBeUndefined();
      }
    });
  });
});

describe('questGiverNpcMarkers (the world-map quest-giver glyphs, resolved from static content)', () => {
  it('is empty when no quest is available or ready', () => {
    expect(questGiverNpcMarkers(() => 'unavailable')).toEqual([]);
  });

  it("resolves a real giver's static position for an available quest ('!' glyph)", () => {
    const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
    if (!quest) throw new Error('expected a quest with a giverNpcId');
    const giver = NPCS[quest.giverNpcId as string];
    const markers = questGiverNpcMarkers((q) => (q === quest.id ? 'available' : 'unavailable'));
    const marker = markers.find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker, "expected a marker at the giver's static content position").toBeTruthy();
    expect(marker?.ready).toBe(false);
    expect(marker?.quests).toContainEqual({ questId: quest.id, ready: false });
  });

  it("marks ready ('?') ahead of available ('!') for a giver that is also its own turn-in npc", () => {
    const quest = Object.values(QUESTS).find(
      (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
    );
    if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
    const giver = NPCS[quest.giverNpcId as string];
    const markers = questGiverNpcMarkers((q) => (q === quest.id ? 'ready' : 'unavailable'));
    const marker = markers.find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker?.ready).toBe(true);
  });

  it('skips a dynamic NPC (spawned on demand by its owning system) even when it lists a matching turn-in quest', () => {
    const dynamicNpc = Object.values(NPCS).find(
      (n) => n.dynamic && n.questIds.some((q) => QUESTS[q] && isQuestTurnInNpc(QUESTS[q], n.id)),
    );
    if (!dynamicNpc) throw new Error('expected a dynamic NPC carrying a turn-in quest');
    const questId = dynamicNpc.questIds.find((q) => isQuestTurnInNpc(QUESTS[q], dynamicNpc.id));
    if (!questId) throw new Error('expected a turn-in questId on the dynamic NPC');
    const markers = questGiverNpcMarkers((q) => (q === questId ? 'ready' : 'unavailable'));
    expect(markers.some((m) => m.pos.x === dynamicNpc.pos.x && m.pos.z === dynamicNpc.pos.z)).toBe(
      false,
    );
  });
});
