// The Coffer of the Highwatch Vigil: the Smith's Heart essence quest's reward chest
// (content/smith_heart_rewards.ts). Opening it hands the opener ONE item from the raid's
// Normal loot table (SMITH_HEART_NORMAL_LOOT_ITEM_IDS) that their class can equip, by the
// one equip rule every equip path shares (equipment_rules.ts canEquipItem: armor type,
// weapon proficiency, class locks), drawn once through the sim's Rng.
//
// The empty table (the raid's Normal items are not authored yet) is a first-class state, not
// an error: the coffer refuses to open with a localized line (src/ui/sim_i18n.ts) and is KEPT,
// so the player loses nothing and the same coffer pays out once the table is filled. A class
// with nothing it can use in a filled table is refused the same way.
//
// Server-authoritative (useItem on the server); no draw happens on a refusal, so a refused
// open never moves the rng sequence. The coffer is used from the bags and holds one to a
// slot, so consuming it frees the slot the piece lands in: the draw, the consume and the
// grant happen together, or (no coffer held, nothing in the table) not at all.

import {
  SMITH_HEART_CHEST_ITEM,
  SMITH_HEART_NORMAL_LOOT_ITEM_IDS,
} from './content/smith_heart_rewards';
import { ITEMS } from './data';
import { canEquipItem } from './equipment_rules';
import { grantFreshLoot } from './loot/fresh_quality_grant';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemInstancePayload, PlayerClass } from './types';

/** The table's items `cls` can equip, in table order: real items with an equip slot only
 *  (never a token or a recipe), each through the shared equip rule. */
export function smithHeartCofferPool(
  cls: PlayerClass,
  table: readonly string[] = SMITH_HEART_NORMAL_LOOT_ITEM_IDS,
): readonly string[] {
  const out: string[] = [];
  for (const id of table) {
    const def = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
    if (!def?.slot || out.includes(id)) continue;
    if (canEquipItem(cls, def)) out.push(id);
  }
  return out;
}

/** Open one coffer. Returns the item granted, or null when it was refused (nothing in the
 *  table for this class: the coffer is kept and nothing is drawn). */
export function openSmithHeartCoffer(
  ctx: SimContext,
  meta: PlayerMeta,
  consumeOneUnit: () => ItemInstancePayload | undefined,
  table: readonly string[] = SMITH_HEART_NORMAL_LOOT_ITEM_IDS,
): string | null {
  if (ctx.countItem(SMITH_HEART_CHEST_ITEM, meta.entityId) <= 0) return null;
  const pool = smithHeartCofferPool(meta.cls, table);
  if (pool.length === 0) {
    // English re-localized at the client (src/ui/sim_i18n.ts).
    ctx.error(meta.entityId, 'The coffer is sealed and holds nothing for you yet. Keep it.');
    return null;
  }
  const piece = ctx.rng.pick([...pool]);
  consumeOneUnit();
  grantFreshLoot(ctx, piece, 1, meta.entityId);
  return piece;
}
