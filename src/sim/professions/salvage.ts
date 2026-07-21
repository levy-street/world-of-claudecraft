// Salvage/disenchant (issue #1300): break an eligible equipped-item-kind
// piece back into raw materials, an off-wheel gathering-style action per the
// doc's framing (additive, usable by everyone, no craft gate) rather than a
// craft-gated action. Feeds the material economy and the recharge/craft
// loops per the doc's binding section ("off to a salvager once its owner is
// done with it").
//
// Behind the SimContext seam (see src/sim/CLAUDE.md): a new self-contained
// system, its own sibling module, no state of its own (the resolved
// materials go straight through ctx.addItem/ctx.removeItem, same inventory
// hub every other item action uses).
//
// This module is `src/sim`-pure: no DOM/render/ui/game/net imports, no
// Math.random/Date.now, host-agnostic so it runs offline, on the server, and
// in the headless RL env unchanged.

import { ITEMS } from '../data';
import { requiredLevelFor } from '../item_level_req';
import { removePreferFungible } from '../items';
import type { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { ItemDef } from '../types';

const QUALITY_ORDER: readonly NonNullable<ItemDef['quality']>[] = [
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

// Materials returned per rarity tier (issue #1300 scope: "which items are
// salvageable and their yield tables"). Reuses existing harvested-material
// item ids (bone_fragments/linen_scrap/spider_leg) rather than introducing
// new item ids, same rationale content/recipes.ts documents for the same
// reason (avoids expanding the positional item-name arrays in
// src/ui/i18n.catalog/items.ts for this issue).
const SALVAGE_MATERIAL_BY_QUALITY: Readonly<Record<string, string>> = {
  common: 'bone_fragments',
  uncommon: 'linen_scrap',
  rare: 'spider_leg',
  epic: 'spider_leg',
  legendary: 'spider_leg',
};

/** Eligible for salvage: an equippable weapon or armor piece, at least
 *  `common` quality (a `poor`/undefined-quality piece has nothing worth
 *  reclaiming). Ineligible items (consumables, quest items, poor-quality
 *  junk, unknown ids) are never salvageable. */
export function isSalvageable(def: ItemDef | undefined): boolean {
  return (
    !!def &&
    (def.kind === 'weapon' || def.kind === 'armor') &&
    !!def.quality &&
    def.quality !== 'poor'
  );
}

/**
 * The material yield for one salvage of `def`: scales with rarity (the
 * `QUALITY_ORDER` index) and tier (`requiredLevelFor`, the derived level for
 * items whose gate isn't explicit, bucketed one point per 10 levels), plus
 * one rng-rolled bonus unit (issue #1300 acceptance: "the roll
 * uses Rng"), so identical salvages of the same item are not perfectly
 * deterministic. Pure aside from the rng draw.
 */
export function salvageYield(def: ItemDef, rng: Rng): number {
  const qualityIdx = Math.max(0, QUALITY_ORDER.indexOf(def.quality ?? 'common'));
  const tierBonus = Math.floor(requiredLevelFor(def) / 10);
  const bonus = rng.next() < 0.5 ? 0 : 1;
  return qualityIdx + tierBonus + 1 + bonus;
}

export interface SalvageResult {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held';
}

/**
 * Resolve one salvage attempt: denies (no side effect) if the item id is
 * unknown, ineligible, or the player does not hold a copy. On success
 * consumes exactly one copy of the item and grants the rolled material yield.
 */
export function resolveSalvage(ctx: SimContext, pid: number, itemId: string): SalvageResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isSalvageable(def)) return { ok: false, itemId, reason: 'not_salvageable' };
  if (ctx.countItem(itemId, pid) < 1) return { ok: false, itemId, reason: 'not_held' };
  removePreferFungible(ctx, itemId, 1, pid);
  const materialItemId = SALVAGE_MATERIAL_BY_QUALITY[def.quality ?? 'common'] ?? 'bone_fragments';
  const count = salvageYield(def, ctx.rng);
  ctx.addItem(materialItemId, count, pid);
  return { ok: true, itemId, materialItemId, count };
}

/** Command entry point (issue #1300), mirroring professions/crafting.ts
 *  craftItem's shape exactly: resolves the caller's own player entity via
 *  ctx.resolve, then delegates to resolveSalvage. Runs on the deterministic
 *  tick the command arrives on, never off-tick. */
export function salvageItem(ctx: SimContext, itemId: string, pid?: number): SalvageResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, reason: 'unknown_item' };
  return resolveSalvage(ctx, r.meta.entityId, itemId);
}
