// The guild-signpost lesson (tutorial island): sim-side, server-authoritative
// credit for q_ps_the_signpost. The quest's one objective is an 'interact'
// keyed on the sentinel ps_guild_signpost with NO ground entity or item of
// its own (the ps_gauntlet_flag / train_valorsteed idiom): the board the
// player actually clicks is the camp's real noticeboard service
// (content/noticeboards.ts PROVING_SHORE_NOTICEBOARD), whose interaction arm
// (interaction.ts pickUpObject) calls creditSignpostRead beside its
// noticeboard event, so the quest credit and the notice feedback ride the
// same click and can never disagree.
//
// Zero rng (it only credits a count and emits events), so its position in
// the interact path cannot fork the deterministic draw order. `src/sim`-pure:
// no DOM/render/ui/game/net imports, no Math.random/Date.now
// (tests/architecture.test.ts).

import { QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

export const SIGNPOST_QUEST_ID = 'q_ps_the_signpost';
export const SIGNPOST_OBJECT_ITEM_ID = 'ps_guild_signpost';
/** The one board whose read satisfies the lesson: Dawnrest Camp's own
 *  signpost (a NoticeboardDef id, not a templateId, which Eastbrook's board
 *  shares). */
export const SIGNPOST_NOTICEBOARD_ID = 'proving_shore_noticeboard';

/** Credit the signpost lesson when its reader is mid-quest. Called from the
 *  noticeboard interaction arm with the clicked board's def id; boards other
 *  than the camp signpost read normally and credit nothing. */
export function creditSignpostRead(
  ctx: SimContext,
  meta: PlayerMeta,
  noticeboardDefId: string,
): void {
  if (noticeboardDefId !== SIGNPOST_NOTICEBOARD_ID) return;
  const qp = meta.questLog.get(SIGNPOST_QUEST_ID);
  if (!qp || qp.state !== 'active') return;
  const quest = QUESTS[SIGNPOST_QUEST_ID];
  const objective = quest?.objectives[0];
  if (!objective || objective.type !== 'interact') return;
  if (objective.targetObjectItemId !== SIGNPOST_OBJECT_ITEM_ID) return;
  const current = qp.counts[0] ?? 0;
  if (current >= objective.count) return;
  qp.counts[0] = current + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
}
