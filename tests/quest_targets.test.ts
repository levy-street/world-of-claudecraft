// Tests for the pure quest-objective target/location resolver
// (src/sim/quest_targets.ts): the shared derivation behind the world map's
// quest-area blobs and the mob tooltip's Questie-style quest lines. Driven with the
// real content tables (QUESTS/CAMPS/MOBS/GROUND_OBJECTS) so the fixtures can
// never drift from shipped content.

import { afterEach, describe, expect, it } from 'vitest';
import {
  CAMPS,
  ESCORTS,
  GATHER_NODE_TYPES,
  GATHER_NODES,
  GROUND_OBJECTS,
  MOBS,
  NPCS,
  QUESTS,
  zoneAt,
} from '../src/sim/data';
import { nodeMaterialFor } from '../src/sim/professions/gathering';
import { fineMaterialFor } from '../src/sim/professions/material_grades';
import {
  gatherNodeClusters,
  nodeYieldClusters,
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

  it("marks an escort objective at the idle escortee's start point", () => {
    // The escort arm arrived with the v0.32.0 expansion and neither parent
    // tested it: without this pin a future merge could drop the whole arm
    // (or its ESCORTS lookup) and nothing would red. Derived over the live
    // tables like every fixture here, with non-vacuity on both.
    const quest = Object.values(QUESTS).find((q) => q.objectives.some((o) => o.type === 'escort'));
    expect(quest, 'no shipped quest carries an escort objective').toBeTruthy();
    if (!quest) return;
    const objIndex = quest.objectives.findIndex((o) => o.type === 'escort');
    const obj = quest.objectives[objIndex];
    const escort = obj.type === 'escort' ? ESCORTS[obj.escortId] : undefined;
    expect(escort, `escort def missing for ${quest.id}`).toBeTruthy();
    if (!escort) return;
    const areas = questObjectiveAreas(activeLog(quest));
    const area = areas.find((a) => a.center.x === escort.start.x && a.center.z === escort.start.z);
    expect(area, 'expected an area at the escortee start point').toBeTruthy();
    expect(
      area?.objectives.some((o) => o.questId === quest.id && o.objectiveIndex === objIndex),
    ).toBe(true);
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

  it('a collect objective for a node-yield material draws the yield clusters (the UX pass)', () => {
    // The blind arm the pass-2 accepted-quest capture exposed: the shipped
    // work-order quests collect materials that come out of veins/stands/
    // patches, which no mob drops and no ground object carries, so the map
    // drew NOTHING for them. Derived over the live tables with non-vacuity:
    // at least one shipped quest must be in this class.
    const yields = new Set(GATHER_NODES.map((n) => nodeMaterialFor(n.type, n.zoneId).itemId));
    let found: { quest: QuestDef; itemId: string; objIndex: number } | null = null;
    for (const q of Object.values(QUESTS)) {
      for (const [i, objective] of q.objectives.entries()) {
        if (objective.type === 'collect' && objective.itemId && yields.has(objective.itemId)) {
          found = { quest: q, itemId: objective.itemId, objIndex: i };
          break;
        }
      }
      if (found) break;
    }
    expect(found, 'no shipped collect-of-node-yield quest (the work orders)').toBeTruthy();
    if (!found) return;
    const clusters = nodeYieldClusters(found.itemId);
    expect(clusters.length).toBeGreaterThan(0);
    const areas = questObjectiveAreas(activeLog(found.quest));
    // Every yield cluster earned a circle carrying this objective's ref.
    for (const group of clusters) {
      const cx = group.reduce((sum, node) => sum + node.x, 0) / group.length;
      const cz = group.reduce((sum, node) => sum + node.z, 0) / group.length;
      const area = areas.find((a) => a.center.x === cx && a.center.z === cz);
      expect(area, `yield cluster at ${cx},${cz} should have an area`).toBeTruthy();
      expect(
        area?.objectives.some(
          (o) => o.questId === found?.quest.id && o.objectiveIndex === found?.objIndex,
        ),
      ).toBe(true);
    }
    // And only matching nodes feed the clusters: a yield id never clusters
    // a node whose zone-and-type yield is a different material.
    for (const group of nodeYieldClusters(found.itemId)) {
      for (const point of group) {
        const node = GATHER_NODES.find((n) => n.pos.x === point.x && n.pos.z === point.z);
        expect(node).toBeTruthy();
        if (node) {
          const base = nodeMaterialFor(node.type, node.zoneId).itemId;
          expect(base === found.itemId || fineMaterialFor(base) === found.itemId).toBe(true);
        }
      }
    }
  });

  it('the fine-grade arm circles only veins that can actually mint the fine item', () => {
    // The grant's node-tier arm (fineGradeReachable): iron_ore is a
    // gatherTier-2 material, so mirefen's tier-1 ore nodes yield plain
    // iron_ore forever, whatever the tool. A fine_iron_ore collect
    // objective must not guide the player to them. Literal coordinates from
    // src/sim/content/gather_nodes.ts pin the split: ore_mirefen_2 (tier 1,
    // -30/360) excluded, ore_mirefen_t2b (tier 2, 45/491) included.
    const points = nodeYieldClusters('fine_iron_ore').flat();
    expect(points.length).toBeGreaterThan(0);
    expect(points.some((p) => p.x === -30 && p.z === 360)).toBe(false);
    expect(points.some((p) => p.x === 45 && p.z === 491)).toBe(true);
    // The BASE arm keeps every vein: a plain iron_ore objective still
    // circles the tier-1 nodes that yield it.
    const basePoints = nodeYieldClusters('iron_ore').flat();
    expect(basePoints.some((p) => p.x === -30 && p.z === 360)).toBe(true);
    // And the memo returns the identical object per (item, distance) ask:
    // static content, computed once.
    expect(nodeYieldClusters('fine_iron_ore')).toBe(nodeYieldClusters('fine_iron_ore'));
  });

  it('a gather objective still draws its node clusters (the hand-verify arm)', () => {
    // The pass-2 capture question resolved: the GATHER arm works (this
    // drive), so the captured quest with no circle was the collect class
    // above. Derived over live content: zone1 ships gather objectives.
    const quest = Object.values(QUESTS).find((q) =>
      q.objectives.some((o) => o.type === 'gather' && o.nodeType),
    );
    expect(quest, 'no shipped gather-typed objective').toBeTruthy();
    if (!quest) return;
    const areas = questObjectiveAreas(activeLog(quest));
    expect(areas.length).toBeGreaterThan(0);
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
    if (!containing) return;
    // And the EXACT circle, not just a containing one. Containment alone survives
    // dividing by the wrong count, dropping CAMP_AREA_PAD, or taking a min instead
    // of a max on the radius, all of which would still cover most clusters. This
    // matters because the centroid-plus-farthest arithmetic is now shared with the
    // gather-node path (pushEnclosing), so the ground-object caller is the pin that
    // proves the extraction was a move and not a rewrite.
    const n = def.positions.length;
    const cx = def.positions.reduce((s, p) => s + p.x, 0) / n;
    const cz = def.positions.reduce((s, p) => s + p.z, 0) / n;
    const far = Math.max(...def.positions.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    expect(containing.center.x).toBeCloseTo(cx, 9);
    expect(containing.center.z).toBeCloseTo(cz, 9);
    // POINT_AREA_RADIUS 6 and CAMP_AREA_PAD 4 are module-private, so the expected
    // radius is spelled out: max(6, farthest + 4).
    expect(containing.radius).toBeCloseTo(Math.max(6, far + 4), 9);
  });

  it('groups gather nodes into stable clusters across the whole threshold plateau', () => {
    // gatherNodeClusters is exported ONLY for this pin. The grouping is derived
    // from coordinates rather than authored, so without a stability assertion a
    // content nudge silently merges two blobs into one and nothing reds. The
    // tightest real margins: the widest pair inside one cluster is 49.98 yards
    // (chained, single linkage is transitive) and the nearest pair in two
    // different clusters is 32.98 yards (the v0.32.0 expansion zones author
    // their per-type hub-outskirt pairs exactly (32,8) apart), so the
    // identical-partition band is 27 to 32: the shipped 30 sits 2.98 yards
    // under its upper edge and 3.07 above its lower one.
    const key = (groups: { x: number; z: number }[][]) =>
      groups.map((g) => g.map((p) => `${p.x},${p.z}`).join(' ')).join(' | ');
    for (const type of GATHER_NODE_TYPES) {
      const at30 = key(gatherNodeClusters(type));
      // Both edges, so a future bump in either direction reds. 26 and 33 are
      // outside the band for at least one type, which is what makes this decisive
      // rather than a restatement of the default.
      expect(key(gatherNodeClusters(type, 27)), `${type} at 27yd`).toBe(at30);
      expect(key(gatherNodeClusters(type, 32)), `${type} at 32yd`).toBe(at30);
      // Every node lands in exactly one group, and groups come back ordered by
      // their first member so the badge numbering a player sees is stable.
      const groups = gatherNodeClusters(type);
      const total = groups.reduce((s, g) => s + g.length, 0);
      expect(total, `${type} clusters must cover every node exactly once`).toBe(
        GATHER_NODES.filter((n) => n.type === type).length,
      );
      expect(gatherNodeClusters(type), `${type} must be call-stable`).toEqual(groups);
    }
    // The band is not open-ended in either direction: 60 yards merges groups
    // that 30 keeps apart, and 26 splits a wood cluster that 30 chains, so
    // moving the constant past either edge cannot pass unnoticed.
    expect(key(gatherNodeClusters('wood', 60))).not.toBe(key(gatherNodeClusters('wood')));
    expect(key(gatherNodeClusters('wood', 26))).not.toBe(key(gatherNodeClusters('wood')));
    // The UPPER edge belongs to HERB (the expansion's (32,8) pairs merge at
    // 33); wood does not flip again until 60, so without this arm the band's
    // stated ceiling was unpinned.
    expect(key(gatherNodeClusters('herb', 33))).not.toBe(key(gatherNodeClusters('herb')));
  });

  it('keeps the derived cluster radius inside what authored clusters already draw', () => {
    // The arms above pin WHICH nodes group together; none of them bounds how big
    // the resulting circle gets, and that number is derived rather than authored.
    // Every other blob in this layer has its size visible at the authoring site: a
    // human writes `radius: 24` on a camp, or writes out seven crate positions. A
    // cluster radius is nobody's decision, and single linkage is transitive, so a
    // chain of nodes each within 30 yards merges however far the chain runs. Adding
    // one stand between wood_mirefen_1 and wood_mirefen_3 (33.54 yards apart)
    // legitimately re-mints the partition pin above while the blob grows, and
    // without this arm that growth is invisible.
    const radiusOf = (points: { x: number; z: number }[]) => {
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
      const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
      const far = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.z - cz)));
      return Math.max(6, far + 4); // POINT_AREA_RADIUS, CAMP_AREA_PAD: module-private
    };
    let worst = 0;
    let worstType = '';
    for (const type of GATHER_NODE_TYPES) {
      for (const group of gatherNodeClusters(type)) {
        const r = radiusOf(group);
        if (r > worst) {
          worst = r;
          worstType = type;
        }
      }
    }
    // Ceiling one: the same helper's other caller, computed live rather than
    // asserted as a number. pushObjectCluster has always collapsed point-shaped
    // ground-object spawns into one circle, and its widest (the seven
    // lost_caravan_goods crates, 50.32yd) is what this layer demonstrably
    // tolerates. Two different content tables, so this is a real comparison and
    // not a value compared against itself.
    const authoredWidest = Math.max(
      ...GROUND_OBJECTS.filter((def) => def.positions.length > 0).map((def) =>
        radiusOf([...def.positions]),
      ),
    );
    expect(authoredWidest).toBeGreaterThan(40); // the precedent is real, not empty
    expect(
      worst,
      `widest ${worstType} cluster is ${worst.toFixed(2)}yd against the widest authored cluster's ${authoredWidest.toFixed(2)}`,
    ).toBeLessThanOrEqual(authoredWidest);
    // Ceiling two, tight enough to notice: 29.89yd ships today, so a chain that
    // grows past 35 reds here and gets looked at rather than shipping quietly.
    expect(worst, `widest cluster ${worst.toFixed(2)}yd`).toBeLessThan(35);
  });

  it('encloses each cluster of gather nodes in one circle, never one per node', () => {
    // This used to look for a circle centred exactly ON each node, because the
    // gather branch drew one per node. Six nodes of every type in every zone made
    // that a smear: the fills are translucent and composite per circle, so
    // overlapping blobs darkened toward opaque, and each carried its own opaque
    // numbered badge. Clustered circles are the fix, and the properties that
    // matter are containment (no node loses its marker) and zone residency (an
    // area whose centre lands in the wrong band is culled off every map).
    // Driven by every node type that a shipped quest actually gathers, not just
    // ore: today that is ore and herb, and herb is the one three of the four
    // gather objectives use, so pinning ore alone would leave the common case
    // uncovered. Wood has no gather quest yet and so cannot be reached through
    // this path at all; the type-level property that would catch it lives in the
    // zone-residency arm below, which loops all three.
    const typed = GATHER_NODE_TYPES.map((type) => {
      for (const quest of Object.values(QUESTS)) {
        const objectiveIndex = quest.objectives.findIndex(
          (o) => o.type === 'gather' && o.nodeType === type,
        );
        if (objectiveIndex >= 0) return { type, quest, objectiveIndex };
      }
      return null;
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    expect(typed.map((t) => t.type)).toEqual(['ore', 'herb']);

    for (const { type, quest, objectiveIndex } of typed) {
      const areas = questObjectiveAreas(activeLog(quest));
      const nodes = GATHER_NODES.filter((node) => node.type === type);
      expect(nodes.length).toBeGreaterThan(0);

      // 1. Every node still sits inside an area, and that area carries the ref.
      const areaFor = new Map<string, (typeof areas)[number]>();
      for (const node of nodes) {
        const area = areas.find(
          (candidate) =>
            Math.hypot(candidate.center.x - node.pos.x, candidate.center.z - node.pos.z) <=
            candidate.radius + 1e-9,
        );
        expect(area, `gather node ${node.id} should sit inside an objective area`).toBeTruthy();
        if (!area) continue;
        expect(area.objectives).toContainEqual({ questId: quest.id, objectiveIndex });
        areaFor.set(node.id, area);
      }

      // 2. Fewer circles than nodes: the clustering is doing something. A per-node
      // implementation passes arm 1 trivially, so without this the rewrite would
      // not be pinned at all.
      const distinct = new Set(areaFor.values());
      expect(
        distinct.size,
        `${distinct.size} circles for ${nodes.length} ${type} nodes`,
      ).toBeLessThan(nodes.length);

      // 3. Every area's centre resolves to the same zone as the nodes inside it.
      // map_window_view culls areas by centre z against the committed zone band, so
      // a cluster straddling a boundary would vanish from both maps rather than
      // render twice.
      for (const node of nodes) {
        const area = areaFor.get(node.id);
        if (!area) continue;
        expect(
          zoneAt(area.center.x, area.center.z).id,
          `the ${type} circle holding ${node.id} is centred in ${zoneAt(area.center.x, area.center.z).id}, not ${node.zoneId}`,
        ).toBe(node.zoneId);
      }

      // 4. The worst case specifically, and only ore has one: Eastbrook's six
      // veins are all held inside a 20-yard ring around the Copper Dig landmark
      // (tests/gather_nodes.test.ts), which is exactly the pile the old loop drew
      // six times over. They must resolve to ONE circle holding all six. The
      // Eastbrook herb patches are deliberately spread instead, so herb has no
      // equivalent pile and asserting one for it would be asserting a coincidence.
      if (type === 'ore') {
        const eastbrook = nodes.filter((n) => n.zoneId === 'eastbrook_vale');
        expect(eastbrook.length).toBe(6);
        const digAreas = [...new Set(eastbrook.map((n) => areaFor.get(n.id)))];
        expect(digAreas.length, 'the Copper Dig ore field should be one circle').toBe(1);
        // And the EXACT circle, computed from the six veins rather than restated.
        // Every other grouping pin in this file reads gatherNodeClusters, so a
        // caller that re-grouped WITHOUT the helper (grouping by zoneId, say) would
        // satisfy containment, fewer-circles, one-circle and zone residency alike.
        // This is the arm that reads what questObjectiveAreas actually emitted.
        const cx = eastbrook.reduce((s, n) => s + n.pos.x, 0) / 6;
        const cz = eastbrook.reduce((s, n) => s + n.pos.z, 0) / 6;
        const far = Math.max(...eastbrook.map((n) => Math.hypot(n.pos.x - cx, n.pos.z - cz)));
        expect(digAreas[0]?.center.x).toBeCloseTo(cx, 9);
        expect(digAreas[0]?.center.z).toBeCloseTo(cz, 9);
        expect(digAreas[0]?.radius).toBeCloseTo(Math.max(6, far + 4), 9);
      }
    }
  });

  it('every cluster of every type is centred in its own members zone', () => {
    // The silent-cull hazard for the two types no shipped quest gathers. The map's
    // pure core drops an area whose centre z falls outside the committed zone
    // band, so a cluster spanning a boundary would disappear from both maps with
    // nothing red, and the arm above can only reach the types a quest exists for.
    for (const type of GATHER_NODE_TYPES) {
      for (const group of gatherNodeClusters(type)) {
        const zones = new Set(
          group.map(
            (p) =>
              GATHER_NODES.find((n) => n.type === type && n.pos.x === p.x && n.pos.z === p.z)
                ?.zoneId,
          ),
        );
        expect(zones.size, `a ${type} cluster spans ${[...zones].join(' and ')}`).toBe(1);
        const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
        const cz = group.reduce((s, p) => s + p.z, 0) / group.length;
        expect(zoneAt(cx, cz).id, `a ${type} cluster centroid lands outside its zone`).toBe(
          [...zones][0],
        );
      }
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
      // The arm draws through the same grade-aware cluster resolution the
      // collect arm uses (nodeYieldClusters; the credit path is grade-aware
      // per quest_credit.ts D8), so the pin is COVERAGE: every node whose
      // yield is the item sits inside an area carrying this objective's ref,
      // wherever the enclosing cluster circle centered itself.
      for (const node of nodesYieldingItem) {
        const covering = areas.find(
          (a) =>
            Math.hypot(node.pos.x - a.center.x, node.pos.z - a.center.z) <= a.radius + 1e-9 &&
            a.objectives.some((o) => o.questId === TEST_QUEST_ID && o.objectiveIndex === 0),
        );
        expect(
          covering,
          `gather node ${node.id} should be covered by an objective area`,
        ).toBeTruthy();
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
  const NO_HISTORY = new Set<string>();

  it('is empty when no quest is available, ready, or inside a cooldown window', () => {
    expect(questGiverNpcMarkers(() => 'unavailable', NO_HISTORY)).toEqual([]);
  });

  it('draws nothing for in-progress quests: the active state is filtered, not thrown on', () => {
    // The map never marked in-progress quests (only the nameplate shows the
    // gray '?'), and the filter is load-bearing twice over: an NPC whose only
    // quest is active must produce NO marker at all, never a marker whose
    // quests array came out empty (the quests[0] deref would throw).
    expect(questGiverNpcMarkers(() => 'active', NO_HISTORY)).toEqual([]);
  });

  it('returns fresh positions, never aliasing the shared NPCS content', () => {
    const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
    if (!quest) throw new Error('expected a quest with a giverNpcId');
    const giver = NPCS[quest.giverNpcId as string];
    const marker = questGiverNpcMarkers(
      (q) => (q === quest.id ? 'available' : 'unavailable'),
      NO_HISTORY,
    ).find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    if (!marker) throw new Error('expected the giver marker');
    // Equal by value, never the same object: a consumer mutating marker.pos
    // must not write through into the content table the sim places from.
    expect(marker.pos).not.toBe(giver.pos);
  });

  it("resolves a real giver's static position for an available quest ('!' glyph)", () => {
    const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
    if (!quest) throw new Error('expected a quest with a giverNpcId');
    const giver = NPCS[quest.giverNpcId as string];
    const markers = questGiverNpcMarkers(
      (q) => (q === quest.id ? 'available' : 'unavailable'),
      NO_HISTORY,
    );
    const marker = markers.find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker, "expected a marker at the giver's static content position").toBeTruthy();
    expect(marker?.kind).toBe('available');
    expect(marker?.quests).toContainEqual({ questId: quest.id, kind: 'available' });
  });

  it("marks ready ('?') ahead of available ('!') for a giver that is also its own turn-in npc", () => {
    const quest = Object.values(QUESTS).find(
      (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
    );
    if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
    const giver = NPCS[quest.giverNpcId as string];
    const markers = questGiverNpcMarkers(
      (q) => (q === quest.id ? 'ready' : 'unavailable'),
      NO_HISTORY,
    );
    const marker = markers.find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker?.kind).toBe('ready');
  });

  it('classifies a completed repeatable as the blue repeat variant, and only then', () => {
    // A real repeatable work order: available again with the id in
    // questsDone is the settled Q30 rule for the blue "!", while the same
    // offer WITHOUT history keeps the first-offer gold (the negative arm).
    const quest = Object.values(QUESTS).find((q) => q.repeatable && q.giverNpcId);
    if (!quest) throw new Error('expected a repeatable quest with a giver');
    const giver = NPCS[quest.giverNpcId as string];
    const state = (q: string) =>
      q === quest.id ? ('available' as const) : ('unavailable' as const);
    const fresh = questGiverNpcMarkers(state, NO_HISTORY).find(
      (m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z,
    );
    expect(fresh?.kind).toBe('available');
    const done = questGiverNpcMarkers(state, new Set([quest.id])).find(
      (m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z,
    );
    expect(done?.kind).toBe('repeat');
    expect(done?.quests).toContainEqual({ questId: quest.id, kind: 'repeat' });
  });

  it('surfaces a cadence-blocked work order as the dimmed cooldown marker, from the set only', () => {
    // Today the giver shows nothing inside the 30-minute window; with the
    // blocked set the marker resolves cooldown, and WITHOUT the set the same
    // unavailable state stays markerless (an older server payload degrades
    // to the pre-phase map rather than guessing).
    const quest = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
    if (!quest) throw new Error('expected a cadenced work order');
    const giver = NPCS[quest.giverNpcId as string];
    const state = () => 'unavailable' as const;
    const blocked = questGiverNpcMarkers(state, new Set([quest.id]), new Set([quest.id])).find(
      (m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z,
    );
    expect(blocked?.kind).toBe('cooldown');
    expect(blocked?.quests).toContainEqual({ questId: quest.id, kind: 'cooldown' });
    expect(
      questGiverNpcMarkers(state, new Set([quest.id])).find(
        (m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z,
      ),
    ).toBeUndefined();
  });

  it("lists a marker's quests strongest kind first, across the whole fold order", () => {
    // The profession masters hold the full real mix on one NPC: a plain
    // attunement quest, a repeatable amends return, and a cadenced work
    // order (forgemistress_darva's three, giver and turn-in alike). Two
    // arms pin every adjacent pair of the ready > available > repeat >
    // cooldown listing order, so a reorder of any two neighbors reddens.
    const ATTUNE = 'q_prof_attune_smith';
    const AMENDS = 'q_prof_amends_smith';
    const WORK_ORDER = 'q_prof_workorder_forge';
    const giver = NPCS[QUESTS[WORK_ORDER].giverNpcId];
    const at = (m: { pos: { x: number; z: number } }) =>
      m.pos.x === giver.pos.x && m.pos.z === giver.pos.z;

    // Arm A: ready + available + repeat (the amends fresh, the work order
    // completed and offered again).
    const armA = questGiverNpcMarkers(
      (q) =>
        q === ATTUNE ? 'ready' : q === AMENDS || q === WORK_ORDER ? 'available' : 'unavailable',
      new Set([WORK_ORDER]),
    ).find(at);
    expect(armA?.kind).toBe('ready');
    expect(armA?.quests.map((q) => q.kind)).toEqual(['ready', 'available', 'repeat']);

    // Arm B: ready + repeat + cooldown (the amends completed and offered
    // again, the work order inside its window).
    const armB = questGiverNpcMarkers(
      (q) => (q === ATTUNE ? 'ready' : q === AMENDS ? 'available' : 'unavailable'),
      new Set([AMENDS, WORK_ORDER]),
      new Set([WORK_ORDER]),
    ).find(at);
    expect(armB?.kind).toBe('ready');
    expect(armB?.quests.map((q) => q.kind)).toEqual(['ready', 'repeat', 'cooldown']);
  });

  it('sorts the listing even when the strongest kind arrives LAST in content order', () => {
    // Both arms above happen to classify in already-sorted content order, so
    // deleting the sort (or the glyph reading quests[0]) would leave them
    // green. Here the work order, LAST in the giver's questIds, is the ready
    // turn-in while the attune quest is merely available: the sort must lift
    // it to the front and the glyph must take its kind.
    const ATTUNE = 'q_prof_attune_smith';
    const WORK_ORDER = 'q_prof_workorder_forge';
    const giver = NPCS[QUESTS[WORK_ORDER].giverNpcId];
    const marker = questGiverNpcMarkers(
      (q) => (q === ATTUNE ? 'available' : q === WORK_ORDER ? 'ready' : 'unavailable'),
      NO_HISTORY,
    ).find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker?.kind).toBe('ready');
    expect(marker?.quests.map((q) => q.questId)).toEqual([WORK_ORDER, ATTUNE]);
    expect(marker?.quests.map((q) => q.kind)).toEqual(['ready', 'available']);
  });

  it('keeps questIds order WITHIN a kind: the stable half of the sort contract', () => {
    // The amends return and the work order both classify 'repeat'; the
    // giver's content order lists amends first, and the stable sort must
    // keep it there for the tooltip rows.
    const AMENDS = 'q_prof_amends_smith';
    const WORK_ORDER = 'q_prof_workorder_forge';
    const giver = NPCS[QUESTS[WORK_ORDER].giverNpcId];
    const marker = questGiverNpcMarkers(
      (q) => (q === AMENDS || q === WORK_ORDER ? 'available' : 'unavailable'),
      new Set([AMENDS, WORK_ORDER]),
    ).find((m) => m.pos.x === giver.pos.x && m.pos.z === giver.pos.z);
    expect(marker?.kind).toBe('repeat');
    expect(marker?.quests.map((q) => q.questId)).toEqual([AMENDS, WORK_ORDER]);
    expect(marker?.quests.map((q) => q.kind)).toEqual(['repeat', 'repeat']);
  });

  it('skips a dynamic NPC (spawned on demand by its owning system) even when it lists a matching turn-in quest', () => {
    const dynamicNpc = Object.values(NPCS).find(
      (n) => n.dynamic && n.questIds.some((q) => QUESTS[q] && isQuestTurnInNpc(QUESTS[q], n.id)),
    );
    if (!dynamicNpc) throw new Error('expected a dynamic NPC carrying a turn-in quest');
    const questId = dynamicNpc.questIds.find((q) => isQuestTurnInNpc(QUESTS[q], dynamicNpc.id));
    if (!questId) throw new Error('expected a turn-in questId on the dynamic NPC');
    const markers = questGiverNpcMarkers(
      (q) => (q === questId ? 'ready' : 'unavailable'),
      NO_HISTORY,
    );
    expect(markers.some((m) => m.pos.x === dynamicNpc.pos.x && m.pos.z === dynamicNpc.pos.z)).toBe(
      false,
    );
  });
});
