// Pure, host-agnostic color for an item name across chat links, loot names,
// tooltips, and any other surface that paints a name by quality.
//
// Quest items are a PURPOSE class (kind === 'quest'), not a quality tier.
// Their name always uses quest gold (--color-quest, Phase 1 lineage) so chat
// links and loot rolls cannot drift from the bag / tooltip language. Every
// other kind keeps the shared QUALITY_COLOR map (with a tokenized fallback).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { QUALITY_COLOR } from './icons';

/** CSS color for quest-purpose item names. Same --color-quest token as bag rim
 *  / seal and the quest tooltip title (Phase 1 / Phase 2). */
export const QUEST_ITEM_NAME_COLOR = 'var(--color-quest)';

/** Fallback when quality is missing from the map. Matches --color-quality-default
 *  (#fff common white) used by bags / bank / market painters. */
const QUALITY_FALLBACK = 'var(--color-quality-default)';

/** Minimal input: only kind (purpose) and quality (rarity) drive the color. */
export interface ItemNameColorInput {
  kind?: string | null;
  quality?: string | null;
}

/**
 * Color for an item display name.
 * - kind === 'quest' -> quest gold (purpose class wins over quality)
 * - otherwise -> QUALITY_COLOR[quality ?? 'common'], or quality-default token
 *
 * Uses Object.hasOwn so a hostile wire quality string that collides with an
 * Object.prototype key cannot interpolate a function source into a style attr
 * (same R34 doctrine as loot_roll_controller's former qualityColor helper).
 */
export function itemNameColor(item: ItemNameColorInput): string {
  if (item.kind === 'quest') return QUEST_ITEM_NAME_COLOR;
  const quality = item.quality ?? 'common';
  if (Object.hasOwn(QUALITY_COLOR, quality)) return QUALITY_COLOR[quality];
  return QUALITY_FALLBACK;
}
