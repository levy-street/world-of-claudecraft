// The ONE quest-indicator classification rule (Professions 2.0, the
// repeatable work-order marker): every surface that draws a quest glyph for
// an NPC (the nameplate marker div, the minimap NpcGlyph, the world-map
// questGiverNpcMarkers, and the gossip list) consumes THIS module instead of
// re-deriving available/ready with its own copy of the giver/turn-in
// predicate; the rule-of-three was already satisfied four times over when the
// fourth copy landed.
//
// src/sim-pure like its quest_targets.ts sibling: no DOM, no rng, no clock,
// no Sim state. Everything derives from the quest def, the QuestState the
// caller already resolved (world.questState / computeQuestState), the
// questsDone history, and the repeat-cadence blocked set both worlds expose
// (offline: re-derived from PlayerMeta.questCadence; online: the server's
// cprof.cadenceBlockedQuests mirror), so the offline Sim and the online
// ClientWorld classify identically by construction.

import { isQuestTurnInNpc, type QuestDef, type QuestState } from '../types';

/**
 * What a surface should draw for one quest at one NPC role:
 * - 'ready': the turn-in '?', gold. Wins over everything.
 * - 'available': the first-offer '!', gold. A repeatable quest that has
 *   never been completed classifies HERE, not 'repeat' (the settled Q30
 *   rule, a recorded divergence from type-based classic blue: the first
 *   offer genuinely pays quest XP and gold, so the gold mark is honest).
 * - 'repeat': the repeatable-turn-in '!', the rare-item blue. Only after at
 *   least one completion (quest.repeatable and questsDone has the id).
 * - 'active': the in-progress gray '?' at the turn-in NPC. Today only the
 *   nameplate renders it; the other surfaces map it to their neutral state.
 * - 'cooldown': a repeatable work order inside its cadence window, drawn
 *   dimmed where the NPC previously showed nothing (the settled Q31 rule,
 *   closing the deferral recorded when the cooldown-visibility issue
 *   closed). Giver-side only: it marks where the order will be offered
 *   again once WORK_ORDER_CADENCE_TICKS lapses. The trigger is the live
 *   cadence set alone, DELIBERATELY: a quest can sit inside its window and
 *   simultaneously behind another availability gate (q_prof_hobby_switch is
 *   cadenced AND identity-transition gated), and the marker still shows,
 *   because the window claim it makes stays true and the set drops the id
 *   the moment the window lapses, so the dim mark can never outlive the
 *   cadence it reports (pinned in tests/quest_marker_kind.test.ts).
 * - 'none': draw nothing for this quest.
 */
export type QuestMarkerKind = 'none' | 'available' | 'repeat' | 'ready' | 'active' | 'cooldown';

/** Which relationship the NPC has to the quest: its giver, or a turn-in. */
export type QuestMarkerRole = 'giver' | 'turnIn';

// The cross-quest fold order, matching what the surfaces already did for the
// states that existed: ready always won ('?' beats '!'), available beat the
// gray in-progress state on the nameplate, and the new states slot below the
// old ones (gold beats blue per the classic precedent that a fresh offer
// outranks a repeatable; any actionable pickup beats the gray '?'; the gray
// '?' beats the dimmed not-yet marker; anything beats nothing).
const MARKER_PRIORITY: Record<QuestMarkerKind, number> = {
  ready: 5,
  available: 4,
  repeat: 3,
  active: 2,
  cooldown: 1,
  none: 0,
};

/** The stronger of two marker kinds under the shared fold order (ties keep
 *  `a`, so folding left over a quest list is order-stable). Generic over the
 *  argument union because the result is ALWAYS one of the two arguments: a
 *  fold over a narrowed subset (the minimap's no-active variant) stays inside
 *  that subset by type, with no assertion for an edit to quietly defeat. */
export function strongerQuestMarker<K extends QuestMarkerKind>(a: K, b: K): K {
  return MARKER_PRIORITY[b] > MARKER_PRIORITY[a] ? b : a;
}

/** The fold rank of a kind, exported so list-producing consumers (the map's
 *  tooltip ordering in quest_targets.ts) sort by THE SAME table the fold
 *  uses instead of keeping a second hand-maintained order. Higher is
 *  stronger. */
export function questMarkerRank(kind: QuestMarkerKind): number {
  return MARKER_PRIORITY[kind];
}

/**
 * Classify one quest for one NPC role. `state` is the QuestState the caller
 * already resolved for this quest (world.questState on either world), so the
 * availability rules (prerequisites, level, retirement, the identity gate,
 * the cadence window itself) stay in computeQuestState and are never
 * re-derived here. `cadenceBlocked` distinguishes the cooldown window from
 * every other 'unavailable' cause; omitted, no quest classifies 'cooldown'
 * (an older server payload without the cprof field degrades to today's
 * no-marker behavior rather than guessing).
 */
export function questMarkerKind(
  quest: QuestDef,
  state: QuestState,
  questsDone: ReadonlySet<string>,
  role: QuestMarkerRole,
  cadenceBlocked?: ReadonlySet<string>,
): QuestMarkerKind {
  if (role === 'turnIn') {
    if (state === 'ready') return 'ready';
    if (state === 'active') return 'active';
    return 'none';
  }
  if (state === 'available') {
    return quest.repeatable && questsDone.has(quest.id) ? 'repeat' : 'available';
  }
  // The repeatable guard is defense in depth: only armCadence writes the
  // cadence store and only under repeatCadenceTicks (a repeatable-only
  // field), so a non-repeatable id cannot reach the set today; if one ever
  // does, it must not dress as a work-order cooldown.
  if (state === 'unavailable' && quest.repeatable && cadenceBlocked?.has(quest.id)) {
    return 'cooldown';
  }
  return 'none';
}

/**
 * Classify one quest for one NPC TEMPLATE, folding the giver and turn-in
 * roles the template actually holds (a work order's giver usually is its
 * turn-in). This is the form the per-NPC surfaces consume; the role
 * predicates live here so no surface keeps its own copy.
 */
export function npcQuestMarkerKind(
  quest: QuestDef,
  npcTemplateId: string,
  state: QuestState,
  questsDone: ReadonlySet<string>,
  cadenceBlocked?: ReadonlySet<string>,
): QuestMarkerKind {
  let kind: QuestMarkerKind = 'none';
  if (quest.giverNpcId === npcTemplateId) {
    kind = questMarkerKind(quest, state, questsDone, 'giver', cadenceBlocked);
  }
  if (isQuestTurnInNpc(quest, npcTemplateId)) {
    kind = strongerQuestMarker(
      kind,
      questMarkerKind(quest, state, questsDone, 'turnIn', cadenceBlocked),
    );
  }
  return kind;
}
