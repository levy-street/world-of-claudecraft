// The muster's weekly: every hand in the fight that brings Balgath down gets the credit.
//
// "A Chip Off the Foreman" (content/mirefen_muster_quests.ts) is a kill objective on
// Balgath. The ordinary kill path (combat/damage.ts) only credits the tagging party, and a
// world boss is fought by a raid of strangers: the healer in another group, the pike
// carrier who blinded him and died, the late arrival. So when he falls, the weekly's kill
// counts for EVERY contributor (worldBossLootContributors, the same hate-table snapshot
// his personal loot is rolled from) who has the weekly active, and for that one quest
// only. Capped, so the tagging party is never counted twice. Draws no rng.

import { MUSTER_BOSS_TEMPLATE_ID } from './content/mirefen_muster';
import { MUSTER_TROPHY_QUEST_ID } from './content/mirefen_muster_quests';
import { onMobKilledForQuest } from './quests/quest_credit';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** Balgath fell: credit the weekly's kill to every contributor carrying it. */
export function creditMusterTrophyKill(
  ctx: SimContext,
  mob: Entity,
  contributors: readonly PlayerMeta[],
): void {
  if (mob.templateId !== MUSTER_BOSS_TEMPLATE_ID) return;
  for (const meta of contributors) creditMusterTrophyKillFor(ctx, meta);
}

/** One player's share of that credit (also `/dev balgath trophy`). A no-op unless the
 *  weekly is active and its kill is still owed. */
export function creditMusterTrophyKillFor(ctx: SimContext, meta: PlayerMeta): void {
  onMobKilledForQuest(ctx, MUSTER_BOSS_TEMPLATE_ID, meta, MUSTER_TROPHY_QUEST_ID);
}
