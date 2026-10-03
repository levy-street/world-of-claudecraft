// World quest reward items that meet full bags: the one grant rule every
// world quest item payout shares (the quest's fixed extra and the day's item
// slot piece in world_quests.ts awardWorldQuest, the slate's treasure map and
// the treasure hunt's casket in clue_scrolls.ts, and the weekly charge's cache
// in weekly_quests.ts creditWeeklyQuest). Each item that fits lands in the
// bags through the inventory hub as before; each one that does not is booked
// onto a Ravenpost letter (WORLD_QUEST_REWARD_LETTER) instead of being lost,
// and the player is told with a worldQuestRewardMailed event the HUD shows as
// a banner. These rewards pay once (per cycle, week, or hunt), so there is no
// second turn-in to defer to: the mailbox is the only place one can wait.
//
// Unlike the awarded-loot hold (loot/awarded_loot_hold.ts), which keeps an
// overflow on the corpse precisely so the mailbox never becomes an unlimited
// bag, a world quest reward has no corpse to wait on and is bounded to a few
// items per character per day.
//
// `src/sim`-pure: no DOM/Three, no wall clock, and no rng (the item ids are
// decided by the caller before this runs, so bag space never shifts a draw).

import { bagPools, canAddItem } from './bags';
import { WORLD_QUEST_REWARD_LETTER } from './content/letters';
import { MAIL_MAX_ATTACHMENTS } from './mail/post_office';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';

export interface WorldQuestRewardItem {
  itemId: string;
  count: number;
}

/** Grants each reward in order: into the bags when it fits (all of the stack
 *  or none of it), otherwise onto a reward letter. Mailed items share letters
 *  of at most MAIL_MAX_ATTACHMENTS stacks, and one worldQuestRewardMailed
 *  event names them all. Returns the item ids that were mailed. */
export function grantWorldQuestRewardItems(
  ctx: SimContext,
  meta: PlayerMeta,
  items: readonly WorldQuestRewardItem[],
): string[] {
  const pid = meta.entityId;
  const mailed: WorldQuestRewardItem[] = [];
  for (const item of items) {
    if (item.count <= 0) continue;
    if (canAddItem(meta.inventory, bagPools(meta.bags), item.itemId, item.count))
      ctx.addItem(item.itemId, item.count, pid);
    else mailed.push({ itemId: item.itemId, count: item.count });
  }
  if (mailed.length === 0) return [];
  for (let i = 0; i < mailed.length; i += MAIL_MAX_ATTACHMENTS) {
    ctx.mailAuthoredLetter(meta, {
      ...WORLD_QUEST_REWARD_LETTER,
      items: mailed.slice(i, i + MAIL_MAX_ATTACHMENTS),
    });
  }
  const itemIds = mailed.map((item) => item.itemId);
  ctx.emit({ type: 'worldQuestRewardMailed', itemIds, pid });
  return itemIds;
}
