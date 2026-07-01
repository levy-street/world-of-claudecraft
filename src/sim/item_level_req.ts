// The level a character must reach before a gear piece can be equipped.
//
// Classic-era MMOs gate higher-tier gear behind a required level so a low-level
// character cannot equip a lucky drop (or a twink hand-up) far above their own
// level. The requirement is DERIVED, never hand-authored per item: for rare and
// above, from `itemSourceLevel` (item_level.ts), the level of the content the
// piece actually drops or is quested from. That keeps a level-6 rare gating at
// level 6 (it is at-level loot, not a twink item) instead of a flat quality band
// that both strands at-level drops above their source and under-gates higher-
// level rares below where they actually drop. Items with no derivable source
// (vendor stock, starter gear, synthetic/test items) fall back to a per-quality
// band.
//
// An item may still pin an explicit `requiredLevel` to override the derived
// value. The result is always clamped to [1, MAX_LEVEL] so the highest-quality
// gear stays reachable at the level cap (a bare source level, or a fallback
// band, above the cap would be unequippable forever).
//
// Pure leaf: no DOM/Three/render-ui-game-net imports, no rng/clock. Imported by
// the sim equip path (src/sim/items.ts) AND the HUD item tooltip, so it stays
// host-agnostic and is unit-tested directly.

import { itemSourceLevel } from './item_level';
import type { ItemDef } from './types';
import { MAX_LEVEL } from './types';

type Quality = NonNullable<ItemDef['quality']>;

// Per-quality fallback required level, used only when an item has no derivable
// `itemSourceLevel` (no drop/quest source). The leveling tiers (poor/common/
// uncommon) are the greens that quests and vendors hand you AS you level, so
// they stay ungated: a flat band there would strand an early quest reward you
// just earned but are a level or two short of. The gate begins at `rare` and
// up: dungeon/raid-grade loot a low-level character could otherwise be twinked
// into. Tune the feature HERE, not at the equip site.
const QUALITY_REQUIRED_LEVEL: Record<Quality, number> = {
  poor: 1,
  common: 1,
  uncommon: 1,
  rare: 12,
  epic: 18,
  legendary: MAX_LEVEL,
};

// Qualities below `rare` stay ungated regardless of source level: they are the
// leveling greens a quest or vendor hands you as you go.
const GATED_QUALITIES = new Set<Quality>(['rare', 'epic', 'legendary']);

// The minimum character level required to equip `item`. An explicit, finite
// `requiredLevel` always wins. Otherwise: qualities below `rare` are ungated
// (level 1); `rare` and above derive from where the item actually drops
// (`itemSourceLevel`), falling back to the per-quality band when the item has
// no derivable source. Always clamped to [1, MAX_LEVEL].
export function requiredLevelFor(item: ItemDef): number {
  if (Number.isFinite(item.requiredLevel)) {
    return clampLevel(item.requiredLevel as number);
  }
  const quality = item.quality ?? 'common';
  if (!GATED_QUALITIES.has(quality)) return 1;
  const source = itemSourceLevel(item.id);
  return clampLevel(source ?? QUALITY_REQUIRED_LEVEL[quality]);
}

function clampLevel(raw: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(raw)));
}

// Whether a character of `level` meets `item`'s level requirement.
export function meetsLevelRequirement(level: number, item: ItemDef): boolean {
  return level >= requiredLevelFor(item);
}
