// The hub dummy lesson (Eastbrook quay): sim-side, server-authoritative
// credit for q_hub_know_your_numbers, Drillmaster Hale's one quest.
//
// The Proving Shore teaches the swing and the button. Nothing teaches the
// Damage Meters window, and a training dummy standing alone on the quay tells
// a newcomer nothing about what it is for. This drill is the pointer: Hale's
// text names the meters keybind, and the objective is "land ten blows on the
// dummy", which is exactly the run the meters and the practice strip count.
//
// Unlike the island's ability drill (ability_drill.ts), a plain autoattack
// COUNTS here: the lesson is the readout, not the press. The objective is a
// sentinel 'interact' with no ground entity of its own (the ps_ability_drill
// idiom), credited from the shared dealDamage tail once a hit has landed for
// more than zero, so the count can never disagree with what the meters show.
//
// Zero rng (it credits a count and emits events), so its position in the
// damage path cannot fork the draw order. `src/sim`-pure: no DOM/render/ui/
// game/net imports, no Math.random/Date.now (tests/architecture.test.ts).

import {
  HUB_DUMMY_DRILL_OBJECT_ITEM_ID,
  HUB_DUMMY_DRILL_QUEST_ID,
} from '../content/practice_dummies';
import { MOBS, QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const DUMMY_DRILL_QUEST_ID = HUB_DUMMY_DRILL_QUEST_ID;
export const DUMMY_DRILL_OBJECT_ITEM_ID = HUB_DUMMY_DRILL_OBJECT_ITEM_ID;

/** Any practice dummy counts (the hub one, the Highwatch row): the lesson is
 *  about the meters, and the meters count every one of them the same way. */
export function isTrainingDummy(target: Entity): boolean {
  return target.kind === 'mob' && MOBS[target.templateId]?.dummy === true;
}

/**
 * Credit one landed blow, called from dealDamage once damage has actually
 * been applied. Guards in the order that keeps the common case cheapest:
 * the target has to be a dummy, the source a player (a pet's bite is its
 * owner's number on the meters, but the lesson asks the player to swing),
 * and the lesson active.
 */
export function creditDummyDrill(ctx: SimContext, source: Entity, target: Entity): void {
  if (!isTrainingDummy(target)) return;
  if (source.kind !== 'player') return;
  const meta = ctx.players.get(source.id);
  if (!meta) return;
  const qp = meta.questLog.get(DUMMY_DRILL_QUEST_ID);
  if (!qp || qp.state !== 'active') return;
  const objective = QUESTS[DUMMY_DRILL_QUEST_ID]?.objectives[0];
  if (!objective || objective.type !== 'interact') return;
  if (objective.targetObjectItemId !== DUMMY_DRILL_OBJECT_ITEM_ID) return;
  const current = qp.counts[0] ?? 0;
  if (current >= objective.count) return;
  qp.counts[0] = current + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
}
