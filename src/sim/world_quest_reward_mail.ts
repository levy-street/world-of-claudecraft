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
// `src/sim`-pure: no DOM/Three or wall clock. Item ids are decided by the
// caller; permanent quality rolls before delivery, so bag space never shifts a draw.

import { bagPools, fitsAll } from './bags';
import { WORLD_QUEST_REWARD_LETTER } from './content/letters';
import { grantFreshLoot } from './loot/fresh_quality_grant';
import { MAIL_MAX_ATTACHMENTS } from './mail/post_office';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { InvSlot } from './types';

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
  const mailed: InvSlot[] = [];
  const mailedIds: string[] = [];
  const copies: InvSlot[] = [];
  // Share the earned-source roller; delivery preserves each rolled descriptor
  // through either the inventory hub or the authored letter, never a second roll.
  const freshHost: Pick<SimContext, 'rng' | 'addItem' | 'addItemInstance'> = {
    rng: ctx.rng,
    addItem: (itemId, count) => {
      copies.push({ itemId, count });
    },
    addItemInstance: (itemId, instance, _pid, count = 1) => {
      copies.push({ itemId, count, instance });
    },
  };
  for (const item of items) {
    if (item.count <= 0) continue;
    copies.length = 0;
    grantFreshLoot(freshHost, item.itemId, item.count, pid);
    // Preserve the whole-reward capacity rule even when quality splits it into
    // several payload-bearing lines: all copies bag together or mail together.
    if (!fitsAll(meta.inventory, bagPools(meta.bags), copies)) {
      mailed.push(...copies);
      mailedIds.push(item.itemId);
      continue;
    }
    for (const copy of copies) {
      if (copy.instance) ctx.addItemInstance(copy.itemId, copy.instance, pid, copy.count);
      else ctx.addItem(copy.itemId, copy.count, pid);
    }
  }
  if (mailed.length === 0) return [];
  for (let i = 0; i < mailed.length; i += MAIL_MAX_ATTACHMENTS) {
    ctx.mailAuthoredLetter(meta, {
      ...WORLD_QUEST_REWARD_LETTER,
      items: mailed.slice(i, i + MAIL_MAX_ATTACHMENTS),
    });
  }
  const itemIds = mailedIds;
  ctx.emit({ type: 'worldQuestRewardMailed', itemIds, pid });
  return itemIds;
}
