// Gourdlight Eve's Book of Deeds marks: the write sites of the whole-event checklist
// (the mark ids and why they are lifetime: content/gourdlight_eve_deeds.ts; the deeds:
// content/deeds.ts feat_gourdlight_*). Each site is called from the place the act really
// resolves on the authoritative sim (a knock, a fright, an errand turn-in, the pumpkin
// hunt's last find; the Thatchgrin kill marks inside deeds.ts's world-boss hook), so the
// server decides every leaf and the client only mirrors the visited set it is sent.
// markVisited is idempotent and marks the player's deed bucket dirty, so the tick-tail
// evaluator grants a section Feat or the meta the tick its last leaf lands. Zero rng.

import { GOURDLIGHT_DAILY_POOL, TRICK_OR_TREAT_NPCS } from '../content/gourdlight_eve';
import {
  GOURDLIGHT_PUMPKIN_HUNT_MARK,
  GOURDLIGHT_THATCHGRIN_MARK,
  gourdlightBooMark,
  gourdlightErrandMark,
  gourdlightKnockMark,
} from '../content/gourdlight_eve_deeds';
import { markVisited } from '../deeds';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

function townOf(npcTemplateId: string): string | null {
  for (const [zoneId, ids] of Object.entries(TRICK_OR_TREAT_NPCS)) {
    if (ids.includes(npcTemplateId)) return zoneId;
  }
  return null;
}

/** An accepted knock (trick_or_treat.ts, after the door is spent). */
export function markGourdlightKnock(
  ctx: SimContext,
  meta: PlayerMeta,
  npcTemplateId: string,
): void {
  if (townOf(npcTemplateId) === null) return;
  markVisited(ctx, meta, gourdlightKnockMark(npcTemplateId));
}

/** A landed Boo! fright (gourdlight_dailies.ts booTownsfolk): the townsperson's town. */
export function markGourdlightFright(
  ctx: SimContext,
  meta: PlayerMeta,
  npcTemplateId: string,
): void {
  const town = townOf(npcTemplateId);
  if (town !== null) markVisited(ctx, meta, gourdlightBooMark(town));
}

/** A quest turned in (quests/quest_commands.ts): one of Hester's rotating errands only. */
export function markGourdlightErrand(ctx: SimContext, meta: PlayerMeta, questId: string): void {
  if (GOURDLIGHT_DAILY_POOL.includes(questId))
    markVisited(ctx, meta, gourdlightErrandMark(questId));
}

/** Every Haunted Pumpkin of the edition found (haunted_pumpkins.ts). */
export function markGourdlightPumpkinHunt(ctx: SimContext, meta: PlayerMeta): void {
  markVisited(ctx, meta, GOURDLIGHT_PUMPKIN_HUNT_MARK);
}

/**
 * The join-time proof refill (deeds_restore.ts, before the retro evaluation): a leaf
 * whose act already left a lasting trace in this character's save gets its mark, so a
 * character who did it before the checklist existed is not asked to do it again. An
 * errand in questsDone was turned in (questsDone keeps a repeatable's id); a Thatchgrin
 * kill counter proves the kill; the Pumpkin Hunter feat proves a whole hunt. Knocks and
 * frights live only in the day's ledger, so they have no proof and refill nothing.
 * Silent (no events, no dirty mark: the join pass is the full evaluation) and idempotent.
 */
export function refillGourdlightMarks(meta: PlayerMeta): void {
  const visited = meta.deedStats.visited;
  for (const questId of GOURDLIGHT_DAILY_POOL) {
    if (meta.questsDone.has(questId)) visited.add(gourdlightErrandMark(questId));
  }
  if (meta.deedStats.counters.thatchgrinKills > 0) visited.add(GOURDLIGHT_THATCHGRIN_MARK);
  if (meta.deedsEarned.has('feat_pumpkin_hunter')) visited.add(GOURDLIGHT_PUMPKIN_HUNT_MARK);
}
