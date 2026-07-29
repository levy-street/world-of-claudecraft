// Pure quest-objective target/location resolution over the static content
// tables, shared by the presentation layers: the world map draws translucent
// "your objective lives here" areas from questObjectiveAreas(), the quest-giver
// glyphs from questGiverNpcMarkers(), and the mob hover tooltip lists the
// objectives a mob advances via questObjectivesForMob(). A host-agnostic leaf
// like threat.ts / format_money.ts: no DOM, no rng, no Sim state. Everything
// derives from the QUESTS/CAMPS/MOBS/GROUND_OBJECTS/NPCS content plus the
// player's live quest log, so the offline Sim and the online ClientWorld
// mirror produce identical output, and (unlike world.entities) none of it is
// interest-radius limited: a camp or quest giver far across the zone still resolves.

import { CAMPS, ESCORTS, GATHER_NODES, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from './data';
import { nodeMaterialFor } from './professions/gathering';
import { fineGradeReachable, fineMaterialFor } from './professions/material_grades';
import {
  npcQuestMarkerKind,
  type QuestMarkerKind,
  questMarkerRank,
} from './quests/quest_marker_kind';
import {
  type GatherNodeType,
  type QuestObjective,
  type QuestProgress,
  type QuestState,
  questObjectiveRequired,
} from './types';

/** Identity of one quest objective (the map tooltip resolves its localized
 *  label + live counts from this; the pure layers never carry text). */
export interface QuestObjectiveRef {
  questId: string;
  objectiveIndex: number;
}

/** One circular "this objective happens here" area, in world coords. When
 *  several objectives share the exact circle (two quests hunting one camp),
 *  their refs merge onto one area instead of stacking translucent fills. */
export interface QuestObjectiveArea {
  center: { x: number; z: number };
  radius: number;
  objectives: QuestObjectiveRef[];
}

// Padding added around a camp's spawn radius so the drawn area comfortably
// covers mobs that wandered a little off their spawn ring.
const CAMP_AREA_PAD = 4;
// Radius drawn around a lone point target (an interact NPC or single object).
const POINT_AREA_RADIUS = 6;
/**
 * How close two gather nodes have to be to read as ONE place on the map, used by
 * gatherNodeClusters below. The tuned strip and the phase 20 bottom-map zones
 * carry six nodes of every type, the other expansion zones their two-per-type
 * starter kits (content/gather_nodes.ts), so a circle per node put up to six
 * translucent fills and six numbered badges on one zone map. The fills
 * composite per circle rather than merging, so overlapping ones darken toward
 * opaque, and each carries its own opaque badge as wide as the blob it labels.
 * Grouping first fixes that. The worked measurements below predate the phase
 * 20 additions; that pass verified the whole partition unchanged for every
 * pre-existing group (its 36 additions all land as singletons at link 30, the
 * nearest added-to-existing same-type pair measuring 39.40 yards), so the
 * edges they pin still stand.
 *
 * How completely depends on the type, and only ore was a true pile: Eastbrook's
 * six veins are held inside one 20-yard ring by tests/gather_nodes.test.ts and
 * collapse 6 circles to 1, while the wood and herb additions were deliberately
 * spread 40 to 80 yards apart, so those go 6 to 4 and were never a smear. Ore is
 * the worst case this constant is sized for, not the typical one.
 *
 * 30 yards is not a knife edge, but the margin is smaller than it looks and the
 * measured numbers belong here rather than a comfortable round one. Single
 * linkage is transitive, so a cluster can be much wider than the link distance:
 * the widest pair inside one cluster is wood_thornpeak_t2 to wood_thornpeak_t3
 * at 49.98 yards, chained through two intermediate stands. Going the other
 * way, the nearest pair in two DIFFERENT clusters is a v0.32.0 expansion
 * hub-outskirt pair (herb_veiled_hollow_1 to herb_veiled_hollow_2; every
 * expansion zone authors its per-type pair exactly (32,8) apart) at 32.98
 * yards, 2.98 yards of headroom above 30. Downward the tightest margin is
 * 3.07 yards: the partition is identical for every integer link from 27 to
 * 32, and at 26 a wood cluster already splits. Nudge one of those pairs a
 * few yards and two blobs silently merge or split, which is why
 * tests/quest_targets.test.ts pins the grouping across that whole band and
 * asserts both edges are real.
 *
 * On scale, and on the objection this invites ("a blob that swallows the view at
 * high zoom is worse than the pile it replaced"): the closest precedent is not a
 * mob camp but pushEnclosing's OTHER caller. pushObjectCluster has always drawn
 * one circle per GROUND_OBJECTS def rather than one per position, over content
 * that is just as point-shaped as a gather node, and it already ships a 50.3-yard
 * circle over the seven lost_caravan_goods crates and a 32.2-yard one over the
 * six supply_crate spawns in the STARTING zone. The largest blob the gather
 * clustering produces is 29.9 yards (the four-stand Glimmermere chain), so 59
 * percent of the biggest circle this helper already draws, and smaller than the
 * one in zone 1. That 29.9 is the widest the helper CAN produce rather than the
 * widest a player sees: no shipped quest gathers wood, so the widest blob
 * actually drawn today is 26.5 yards, the Thornpeak ore field. A world-space
 * objective region that scales with zoom is what
 * this whole layer is; clustering in canvas space instead would make gather blobs
 * the only ones that did not.
 *
 * The tradeoff it does buy: the world map no longer shows individual vein
 * positions, because the old per-node circles were centred ON the nodes. The
 * minimap still marks every node individually inside its rim
 * (src/ui/minimap_markers.ts), which is the surface for "exactly where".
 */
const NODE_CLUSTER_LINK_YD = 30;

/**
 * Gather nodes of one type, grouped into the clusters the map draws one circle
 * around each of. Single linkage at `linkYd`: two nodes are in the same group
 * when a chain of within-`linkYd` hops connects them, which is exactly the
 * connected components of that symmetric relation and therefore independent of
 * the order the pairs are visited in.
 *
 * Exported for the grouping pin in tests/quest_targets.test.ts, which is the
 * only reason `linkYd` is a parameter: a derived grouping with no stability pin
 * is one content nudge away from silently merging two blobs.
 *
 * Deterministic in ORDER as well as membership. Groups come back sorted by their
 * lowest GATHER_NODES index and members in table order. The sort is a no-op
 * today, since byRoot is filled in ascending index so insertion order already
 * matches, and it is written anyway so the guarantee is in the code rather than
 * in a property of Map that a rewrite to a plain object would quietly drop. What
 * that order actually controls is paint order and the order of refs the map's
 * hover tooltip lists, NOT the numbers on the badges: those come from quest
 * acceptance order in map_window_view's questNumbersByLog.
 */
export function gatherNodeClusters(
  nodeType: GatherNodeType,
  linkYd: number = NODE_CLUSTER_LINK_YD,
): { x: number; z: number }[][] {
  return clusterNodes(
    GATHER_NODES.filter((n) => n.type === nodeType),
    linkYd,
  );
}

/**
 * The clusters of nodes whose HARVEST feeds a collect objective for `itemId`
 * (the UX pass): a node counts when its zone-and-type yield IS the item, or
 * when the item is that yield's fine grade AND the vein can actually mint
 * it (fineGradeReachable, the grant's own node-tier arm: a tier-1 vein of a
 * gatherTier-2 material yields the plain grade forever, whatever the tool,
 * so circling it for a fine objective would guide the player to nodes that
 * can categorically never drop the item). Before this arm, a collect
 * objective for a node-yield material drew NO map guidance at all: no mob
 * drops it and no ground object carries it, so the classic blobs
 * (questObjectiveAreas below) skipped it entirely, while the four
 * 'gather'-typed objectives in content drew theirs. Same linkage and pin
 * story as gatherNodeClusters.
 *
 * Memoized per (item id, link distance): every input is static content
 * (GATHER_NODES and the grade tables) and the map view re-asks per redraw
 * for every incomplete collect objective, so the filter-and-union work
 * runs once per distinct ask for the process lifetime. The RETURN IS THE
 * LIVE CACHE, shared across every Sim in the process (unlike the sibling
 * gatherNodeClusters, which builds fresh): callers must never mutate it,
 * which the readonly type enforces at compile time.
 */
const yieldClusterMemo = new Map<string, readonly (readonly { x: number; z: number }[])[]>();
export function nodeYieldClusters(
  itemId: string,
  linkYd: number = NODE_CLUSTER_LINK_YD,
): readonly (readonly { x: number; z: number }[])[] {
  const key = `${itemId}:${linkYd}`;
  const hit = yieldClusterMemo.get(key);
  if (hit) return hit;
  const clusters = clusterNodes(
    GATHER_NODES.filter((n) => {
      const base = nodeMaterialFor(n.type, n.zoneId).itemId;
      if (base === itemId) return true;
      return fineMaterialFor(base) === itemId && fineGradeReachable(base, n.tier);
    }),
    linkYd,
  );
  yieldClusterMemo.set(key, clusters);
  return clusters;
}

function clusterNodes(
  nodes: readonly (typeof GATHER_NODES)[number][],
  linkYd: number,
): { x: number; z: number }[][] {
  const root = nodes.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (root[r] !== r) r = root[r];
    // path-compress so repeated finds stay cheap on long chains
    while (root[i] !== r) {
      const next = root[i];
      root[i] = r;
      i = next;
    }
    return r;
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].pos.x - nodes[j].pos.x, nodes[i].pos.z - nodes[j].pos.z);
      if (d <= linkYd) root[find(i)] = find(j);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const key = find(i);
    const members = byRoot.get(key);
    if (members) members.push(i);
    else byRoot.set(key, [i]);
  }
  return (
    [...byRoot.values()]
      .sort((a, b) => a[0] - b[0])
      // fresh {x,z}: never alias the shared GATHER_NODES content
      .map((members) => members.map((i) => ({ x: nodes[i].pos.x, z: nodes[i].pos.z })))
  );
}

// The player's active quests' objectives that still need progress. 'ready'
// and 'done' quests contribute nothing (the '?' turn-in marker guides those).
function incompleteObjectives(
  questLog: ReadonlyMap<string, QuestProgress>,
): { questId: string; objectiveIndex: number; obj: QuestObjective; required: number }[] {
  const out: {
    questId: string;
    objectiveIndex: number;
    obj: QuestObjective;
    required: number;
  }[] = [];
  for (const qp of questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    if (!quest) continue;
    quest.objectives.forEach((obj, i) => {
      const required = questObjectiveRequired(quest, qp, i);
      if ((qp.counts[i] ?? 0) < required)
        out.push({ questId: qp.questId, objectiveIndex: i, obj, required });
    });
  }
  return out;
}

// Mobs whose loot feeds this quest's collect objective. Loot entries are
// tagged with the questId they exist for, the same key quest_credit joins on.
function mobsDroppingQuestItem(itemId: string, questId: string): string[] {
  const out: string[] = [];
  for (const [mobId, def] of Object.entries(MOBS)) {
    if (def.loot.some((l) => l.itemId === itemId && l.questId === questId)) out.push(mobId);
  }
  return out;
}

/** One quest objective a hovered mob advances, with its live counts: the
 *  identity + numbers behind the Questie-style mob-tooltip quest lines. */
export interface MobQuestObjective {
  questId: string;
  objectiveIndex: number;
  current: number;
  total: number;
}

/**
 * The player's active, incomplete objectives this mob's template advances:
 * kill objectives targeting it, plus collect objectives fed by its tagged
 * loot. The mob tooltip renders one quest-title + progress pair per entry,
 * so the player knows "this one counts" (and how far along they are).
 */
export function questObjectivesForMob(
  questLog: ReadonlyMap<string, QuestProgress>,
  mobTemplateId: string,
): MobQuestObjective[] {
  const out: MobQuestObjective[] = [];
  const loot = MOBS[mobTemplateId]?.loot;
  for (const { questId, objectiveIndex, obj, required } of incompleteObjectives(questLog)) {
    const advances =
      (obj.type === 'kill' && obj.targetMobId === mobTemplateId) ||
      (obj.type === 'collect' &&
        !!obj.itemId &&
        !!loot?.some((l) => l.itemId === obj.itemId && l.questId === questId));
    if (!advances) continue;
    const qp = questLog.get(questId);
    out.push({
      questId,
      objectiveIndex,
      current: Math.min(qp?.counts[objectiveIndex] ?? 0, required),
      total: required,
    });
  }
  return out;
}

/**
 * Circular world areas where the player's active, incomplete objectives are
 * carried out (the classic quest-POI blobs): the camps of kill/collect target
 * mobs, the spread of collect/interact ground objects, and interact NPCs.
 * Deduped by circle so overlapping objectives don't stack translucent fills.
 */
export function questObjectiveAreas(
  questLog: ReadonlyMap<string, QuestProgress>,
): QuestObjectiveArea[] {
  const out: QuestObjectiveArea[] = [];
  const byCircle = new Map<string, QuestObjectiveArea>();
  const push = (ref: QuestObjectiveRef, center: { x: number; z: number }, radius: number): void => {
    const key = `${center.x},${center.z},${radius}`;
    const existing = byCircle.get(key);
    if (existing) {
      // Same circle again: merge the objective identity instead of a second fill.
      if (
        !existing.objectives.some(
          (o) => o.questId === ref.questId && o.objectiveIndex === ref.objectiveIndex,
        )
      )
        existing.objectives.push(ref);
      return;
    }
    const area: QuestObjectiveArea = { center, radius, objectives: [ref] };
    byCircle.set(key, area);
    out.push(area);
  };
  const pushMobCamps = (ref: QuestObjectiveRef, mobId: string): void => {
    for (const camp of CAMPS) {
      // fresh {x,z}: never alias the shared CAMPS content the sim spawns from
      if (camp.mobId === mobId)
        push(ref, { x: camp.center.x, z: camp.center.z }, camp.radius + CAMP_AREA_PAD);
    }
  };
  // Centroid of a set of points plus its farthest member: a simple enclosing
  // bound, which is plenty at map scale (this is not a minimal enclosing circle
  // and does not need to be). An empty set has no centroid, so it draws nothing
  // rather than a NaN circle: both callers below already guarantee a member, and
  // this keeps that a precondition rather than a latent garbage blob.
  const pushEnclosing = (
    ref: QuestObjectiveRef,
    points: readonly { x: number; z: number }[],
  ): void => {
    if (points.length === 0) return;
    let cx = 0;
    let cz = 0;
    for (const p of points) {
      cx += p.x;
      cz += p.z;
    }
    cx /= points.length;
    cz /= points.length;
    let r = 0;
    for (const p of points) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
    push(ref, { x: cx, z: cz }, Math.max(POINT_AREA_RADIUS, r + CAMP_AREA_PAD));
  };
  // One enclosing circle per ground-object definition: each def already carries
  // its own authored cluster of spawn positions.
  const pushObjectCluster = (ref: QuestObjectiveRef, itemId: string): void => {
    for (const def of GROUND_OBJECTS) {
      if (def.itemId !== itemId || def.positions.length === 0) continue;
      pushEnclosing(ref, def.positions);
    }
  };
  // The same enclosing circle for gather nodes, one per CLUSTER.
  const pushNodeCluster = (ref: QuestObjectiveRef, nodeType: GatherNodeType): void => {
    for (const group of gatherNodeClusters(nodeType)) pushEnclosing(ref, group);
  };
  // And per yield-matched cluster for a collect objective naming a
  // node-yield material (the UX pass; nodeYieldClusters above).
  const pushYieldClusters = (ref: QuestObjectiveRef, itemId: string): void => {
    for (const group of nodeYieldClusters(itemId)) pushEnclosing(ref, group);
  };
  for (const { questId, objectiveIndex, obj } of incompleteObjectives(questLog)) {
    const ref: QuestObjectiveRef = { questId, objectiveIndex };
    if (obj.type === 'kill' && obj.targetMobId) pushMobCamps(ref, obj.targetMobId);
    else if (obj.type === 'collect' && obj.itemId) {
      for (const mobId of mobsDroppingQuestItem(obj.itemId, questId)) pushMobCamps(ref, mobId);
      pushObjectCluster(ref, obj.itemId);
      pushYieldClusters(ref, obj.itemId);
    } else if (obj.type === 'interact') {
      if (obj.targetObjectItemId) pushObjectCluster(ref, obj.targetObjectItemId);
      const npc = obj.targetNpcId ? NPCS[obj.targetNpcId] : undefined;
      // fresh {x,z}: never alias the shared NPCS content the sim places from
      if (npc) push(ref, { x: npc.pos.x, z: npc.pos.z }, POINT_AREA_RADIUS);
    } else if (obj.type === 'gather' && obj.nodeType) {
      pushNodeCluster(ref, obj.nodeType);
    } else if (obj.type === 'gather' && obj.itemId) {
      // itemId-only gather objective (no nodeType): credit only flows through
      // onNodeGatheredForQuests when a matching node is harvested, so the pin
      // must be the nodes whose yield resolves to this itemId, the symmetric
      // counterpart of the nodeType arm above (never mob camps or
      // ground-object clusters, which never grant this objective's credit).
      // The credit arm is grade-aware (quest_credit.ts, D8), so the guidance
      // reuses the same grade-aware cluster resolution the collect arm draws
      // from (nodeYieldClusters: base yield, or its fine grade where the
      // node tier can actually mint it).
      pushYieldClusters(ref, obj.itemId);
    } else if (obj.type === 'escort') {
      // The escort begins where the idle escortee stands (its def start point).
      const escort = ESCORTS[obj.escortId];
      if (escort) push(ref, { x: escort.start.x, z: escort.start.z }, POINT_AREA_RADIUS);
    }
  }
  return out;
}

/** The kinds the map actually draws: 'none' has nothing to draw and the gray
 *  in-progress state stays a nameplate-only statement (both filtered below),
 *  so the type says so and every consumer sees only the four drawable kinds;
 *  the tooltip tag table (quest_marker_tags.ts) switches exhaustively over
 *  them, while the painter resolves glyph and color by comparison (the
 *  minimap's NpcMarkerVariant precedent). */
export type MapQuestMarkerKind = Exclude<QuestMarkerKind, 'none' | 'active'>;

/** One quest carried by a quest-giver/turn-in glyph, for its hover tooltip. */
export interface QuestGiverNpcQuestRef {
  questId: string;
  kind: MapQuestMarkerKind;
}

/** One quest-giver/turn-in glyph location: `kind` is the strongest state
 *  present under the shared fold order ('?' turn-in ready beats every '!'
 *  variant, exactly as the live map glyph always resolved). Carries the
 *  quest identities behind it so the hover tooltip can resolve their
 *  localized text. */
export interface QuestGiverNpcMarker {
  pos: { x: number; z: number };
  kind: MapQuestMarkerKind;
  quests: QuestGiverNpcQuestRef[];
}

/**
 * Every static NPC currently offering an available quest (first-offer gold or
 * repeatable blue), holding a ready turn-in, or holding a work order inside
 * its cooldown window (the dimmed marker where the NPC previously showed
 * nothing), resolved from the NPCS content table rather than world.entities
 * so (like questObjectiveAreas above) it is never interest-radius limited: a
 * quest giver far across an online zone still surfaces its glyph. Dynamic
 * NPCs (spawned on demand by their owning system, e.g. mid-encounter or
 * per-graveyard) are skipped: they carry no fixed placement to resolve here.
 *
 * Classification is the shared quest_marker_kind rule; `questsDone` and the
 * optional cadence-blocked set are the same inputs both worlds hand it
 * (IWorld questsDone, and craftingIdentity.cadenceBlockedQuests at the
 * caller's seam). The 'active' kind is deliberately filtered: the map never
 * marked in-progress quests and still does not.
 */
export function questGiverNpcMarkers(
  questState: (questId: string) => QuestState,
  questsDone: ReadonlySet<string>,
  cadenceBlocked?: ReadonlySet<string>,
): QuestGiverNpcMarker[] {
  const out: QuestGiverNpcMarker[] = [];
  for (const npc of Object.values(NPCS)) {
    if (npc.dynamic) continue;
    const refs: QuestGiverNpcQuestRef[] = [];
    for (const questId of npc.questIds) {
      const quest = QUESTS[questId];
      if (!quest) continue;
      const kind = npcQuestMarkerKind(
        quest,
        npc.id,
        questState(questId),
        questsDone,
        cadenceBlocked,
      );
      if (kind === 'none' || kind === 'active') continue;
      refs.push({ questId, kind });
    }
    if (refs.length === 0) continue;
    // Strongest kind first: the '?' state wins the glyph and its quests lead
    // the tooltip, then gold, blue, and dimmed. Ordered by the ONE fold table
    // the leaf exports (questMarkerRank), never a second local order, so the
    // map glyph can never disagree with the nameplate and minimap folds;
    // Array.prototype.sort is stable, preserving questIds order within a
    // kind. refs is built fresh above and aliases nothing shared, so it
    // sorts in place.
    refs.sort((a, b) => questMarkerRank(b.kind) - questMarkerRank(a.kind));
    out.push({
      // fresh {x,z}: never alias the shared NPCS content the sim places from
      pos: { x: npc.pos.x, z: npc.pos.z },
      kind: refs[0].kind,
      quests: refs,
    });
  }
  return out;
}
