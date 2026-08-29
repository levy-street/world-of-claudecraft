// The death lesson (tutorial island): the last thing the Proving Shore
// teaches, and the one nobody wants to learn for the first time in the vale
// with a wolf still chewing on them.
//
// A new player's first death is the single most confusing moment in the
// genre: the screen greys, they are somewhere else, they are translucent,
// and nothing tells them that the way back is to walk to their own body. So
// the island stages it, on purpose, somewhere nothing is hunting them.
//
// The death is SCRIPTED and consented to: Instructor Maren hands over a
// single-use Passing Stone, and using it from the bags lays the player down
// where they stand. It is free of consequence by construction, since this
// game charges no durability on death, and the corpse is left wherever they
// chose to use it.
//
// Two things keep it from ever stranding a character:
//   - The rite refuses unless the quest is active, so nobody can click the
//     stone into a pointless death.
//   - Credit lands on EITHER resurrection path. The coach teaches the corpse
//     run, and the copy sends them to their body, but a player who takes the
//     Spirit Healer instead still finishes the lesson rather than being left
//     holding a quest whose corpse no longer exists.
//
// Zero rng (it credits a count, emits events, and hands off to the shared
// death path, which draws its own), so its position cannot fork the draw
// order. `src/sim`-pure: no DOM/render/ui/game/net imports, no
// Math.random/Date.now (tests/architecture.test.ts).

import { QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const DEATH_LESSON_QUEST_ID = 'q_ps_the_long_walk';
export const DEATH_LESSON_OBJECT_ITEM_ID = 'ps_passing_stone';

/** The carried rite item. Shares the sentinel id with the objective: one
 *  stone, one lesson. */
export const PASSING_STONE_ITEM_ID = DEATH_LESSON_OBJECT_ITEM_ID;

/** Is this player mid-lesson? The gate both halves share. */
function lessonActive(meta: PlayerMeta): boolean {
  return meta.questLog.get(DEATH_LESSON_QUEST_ID)?.state === 'active';
}

/**
 * The staged death, routed from the item-use dispatcher (items.ts).
 *
 * A CARRIED single-use item rather than a fixture to walk to: a new player
 * told "go and die" needs the thing that does it in their hand, and the bags
 * press is one they have already learned by this point in the rail (CX).
 *
 * Refuses anyone who has not been asked, with an explanation, so a stray
 * click can never cost someone a corpse run they did not sign up for.
 */
export function usePassingStone(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.ghost) return;
  if (!lessonActive(meta)) {
    ctx.error(p.id, 'The stone is cold. Instructor Maren has not asked this of you.');
    return;
  }
  // Consumed on use: one death, one stone. requiredItems on the quest
  // re-grants it if the lesson somehow needs running again.
  ctx.removeItem(PASSING_STONE_ITEM_ID, 1, meta.entityId);
  ctx.emit({
    type: 'log',
    text: 'You close your hand on the Passing Stone, and the shore lets you go.',
    color: '#c8b8ff',
    entityId: p.id,
  });
  // The shared death path: corpse left where they stood, spirit released by
  // the player as usual. No killer, so nothing takes credit and no threat or
  // loot table is involved.
  ctx.handleDeath(p, null, null);
}

/**
 * Credit the walk back, called from BOTH resurrection paths (spirit.ts).
 *
 * `atCorpse` records which way they came so the completion copy can tell the
 * two apart; the credit itself is deliberately identical, because a lesson
 * that only completes on the ideal path strands the player who did not take
 * it.
 */
export function creditDeathLesson(ctx: SimContext, meta: PlayerMeta, atCorpse: boolean): void {
  if (!lessonActive(meta)) return;
  const qp = meta.questLog.get(DEATH_LESSON_QUEST_ID);
  if (!qp) return;
  const objective = QUESTS[DEATH_LESSON_QUEST_ID]?.objectives[0];
  if (!objective || objective.type !== 'interact') return;
  if (objective.targetObjectItemId !== DEATH_LESSON_OBJECT_ITEM_ID) return;
  const current = qp.counts[0] ?? 0;
  if (current >= objective.count) return;
  qp.counts[0] = current + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
  ctx.emit({
    type: 'log',
    text: atCorpse
      ? 'You are whole again, and you found your own way back.'
      : 'The Keeper set you on your feet. Next time, walk to your body: it costs you nothing.',
    color: '#8fd3ff',
    entityId: meta.entityId,
  });
}
