// The Emissary's Cache: the weekly quest's container item. Opening it hands
// the character one Normal-mode raid piece their class can wear, drawn from
// every raid's normal loot (the Nythraxis drops and the Crucible of the Last
// Flame tables) plus a small stack of Heroic Marks. Nythraxis tier pieces are in
// the pool; the Crucible tier sets stay a raid-only earn. Recipes are not gear,
// so they never come out of a cache. Server-authoritative:
// the pick draws ctx.rng once, and the item leaves the bag only when the
// contents have landed.
import { HEROIC_MARK_CURRENCY_ID } from './content/dungeon_difficulty';
import { DUNGEON_MOBS } from './content/dungeons';
import { NYTHRAXIS_RAID_BOSS_ID } from './content/heroic_loot';
import { IGNIVAR_LOOT_ITEM_IDS } from './content/ignivar_loot';
import { NYTHRAXIS_RELOCATED_ITEM_IDS } from './content/nythraxis_loot';
import { ITEMS } from './data';
import { assertHeroicMarksGrantsFit } from './heroic_marks';
import { grantFreshLoot } from './loot/fresh_quality_grant';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemDef, ItemInstancePayload, PlayerClass } from './types';

export const EMISSARY_CACHE_ITEM_ID = 'emissary_cache';
/** Marks tucked in beside the raid piece. */
export const EMISSARY_CACHE_MARKS = 3;

/** A wearable epic raid piece: it has an equip slot (never a token or a
 *  recipe), it is never a generated heroic copy, and it is a tier-set piece
 *  only where the caller allows one (the Crucible sets are earned in the raid
 *  itself). */
function isRaidGear(def: ItemDef | undefined, allowSet: boolean): def is ItemDef {
  return (
    !!def &&
    def.quality === 'epic' &&
    def.kind !== 'tool' &&
    !!def.slot &&
    !def.heroicOf &&
    (allowSet || !def.set)
  );
}

/** Every Normal raid piece the cache can hold, in a fixed order (Nythraxis
 *  drops first, then the Crucible tables), before the class filter. */
export function emissaryCacheRaidPool(): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string, allowSet: boolean) => {
    if (seen.has(id) || !isRaidGear(ITEMS[id], allowSet)) return;
    seen.add(id);
    out.push(id);
  };
  for (const entry of DUNGEON_MOBS[NYTHRAXIS_RAID_BOSS_ID]?.loot ?? []) {
    if (entry.itemId) push(entry.itemId, true);
  }
  // The raid pieces relocated off Nythraxis onto the dungeon bosses
  // (content/nythraxis_loot.ts) are still Normal raid pieces: the cache keeps them.
  for (const id of NYTHRAXIS_RELOCATED_ITEM_IDS) push(id, true);
  for (const id of IGNIVAR_LOOT_ITEM_IDS) push(id, false);
  return out;
}

/** The pieces a class can wear: class-locked to it, or open to every class. */
export function emissaryCachePoolForClass(cls: PlayerClass): readonly string[] {
  return emissaryCacheRaidPool().filter((id) => {
    const locked = ITEMS[id]?.requiredClass;
    return !locked || locked.includes(cls);
  });
}

/** Open one cache: one class piece (uniform draw) plus the marks. Returns
 *  false when the character holds none or the pool is empty. */
export function openEmissaryCache(
  ctx: SimContext,
  meta: PlayerMeta,
  consumeOneUnit: () => ItemInstancePayload | undefined,
): boolean {
  const pool = emissaryCachePoolForClass(meta.cls);
  if (pool.length === 0 || ctx.countItem(EMISSARY_CACHE_ITEM_ID, meta.entityId) <= 0) return false;
  assertHeroicMarksGrantsFit(meta, [
    { itemId: HEROIC_MARK_CURRENCY_ID, count: EMISSARY_CACHE_MARKS },
  ]);
  const piece = ctx.rng.pick([...pool]);
  consumeOneUnit();
  grantFreshLoot(ctx, piece, 1, meta.entityId);
  ctx.addItem(HEROIC_MARK_CURRENCY_ID, EMISSARY_CACHE_MARKS, meta.entityId);
  return true;
}
