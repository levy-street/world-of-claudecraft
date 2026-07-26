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

import { bagCapacity, canAddItem, consumeOneScratch } from '../bags';
import { ITEMS } from '../data';
import { removePreferFungible } from '../items';
import type { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { ItemDef } from '../types';
import { recordAction, withinActionThrottle } from './action_throttle';
import {
  consumeInventoryUnitAt,
  exactInventoryIndex,
  professionItemLevel,
  professionItemQuality,
} from './item_instance';

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
export const SALVAGE_MATERIAL_BY_QUALITY: Readonly<Record<string, string>> = {
  common: 'bone_fragments',
  uncommon: 'linen_scrap',
  rare: 'spider_leg',
  epic: 'spider_leg',
  legendary: 'spider_leg',
};

/** Eligible for salvage: an equippable weapon, armor, or held off-hand piece,
 *  at least `common` quality (a `poor`/undefined-quality piece has nothing
 *  worth reclaiming). Consumables, quest items, junk, and unknown ids remain
 *  ineligible. */
export function isSalvageable(def: ItemDef | undefined): boolean {
  return (
    !!def &&
    (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'held_offhand') &&
    !!def.quality &&
    def.quality !== 'poor'
  );
}

/** The rarity/tier-scaled base yield the rng bonus rides on: the shared term
 *  of salvageYield and maxSalvageYield, so the #2350 capacity gate's worst
 *  case can never drift from the rolled grant. */
function baseSalvageYield(def: ItemDef, instance?: import('../types').ItemInstancePayload): number {
  const qualityIdx = Math.max(0, QUALITY_ORDER.indexOf(professionItemQuality(def, instance)));
  const tierBonus = Math.floor(professionItemLevel(def, instance) / 10);
  return qualityIdx + tierBonus + 1;
}

/**
 * The material yield for one salvage of `def`: scales with rarity (the
 * `QUALITY_ORDER` index) and tier (`requiredLevelFor`, the derived level for
 * items whose gate isn't explicit, bucketed one point per 10 levels), plus
 * one rng-rolled bonus unit (issue #1300 acceptance: "the roll
 * uses Rng"), so identical salvages of the same item are not perfectly
 * deterministic. Pure aside from the rng draw.
 */
export function salvageYield(
  def: ItemDef,
  rng: Rng,
  instance?: import('../types').ItemInstancePayload,
): number {
  const bonus = rng.next() < 0.5 ? 0 : 1;
  return baseSalvageYield(def, instance) + bonus;
}

/** The largest yield salvageYield can roll (the +1 bonus arm): the count the
 *  #2350 capacity gate pre-fits, so a denial never draws rng and a granted
 *  roll can never exceed what was checked. */
export function maxSalvageYield(
  def: ItemDef,
  instance?: import('../types').ItemInstancePayload,
): number {
  return baseSalvageYield(def, instance) + 1;
}

export interface SalvageResult {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled' | 'no_bag_space';
}

/**
 * Resolve one salvage attempt. A supplied server-issued UID is re-resolved
 * against live inventory, and that exact copy's rarity and level determine
 * the yield; stale or forged selectors deny without side effects. Legacy
 * callers without a UID retain the established fungible-first behavior.
 */
export function resolveSalvage(
  ctx: SimContext,
  pid: number,
  itemId: string,
  instanceUid?: string,
): SalvageResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isSalvageable(def)) return { ok: false, itemId, reason: 'not_salvageable' };
  const meta = ctx.players.get(pid);
  const exactIndex =
    instanceUid !== undefined && meta
      ? exactInventoryIndex(meta.inventory, itemId, instanceUid)
      : -1;
  if (
    (instanceUid !== undefined && exactIndex < 0) ||
    (instanceUid === undefined && ctx.countItem(itemId, pid) < 1)
  ) {
    return { ok: false, itemId, reason: 'not_held' };
  }
  const victim = exactIndex >= 0 ? meta?.inventory[exactIndex]?.instance : undefined;
  if (meta && !withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, reason: 'throttled' };
  }
  const quality = professionItemQuality(def, victim);
  const materialItemId = SALVAGE_MATERIAL_BY_QUALITY[quality] ?? 'bone_fragments';
  if (meta) {
    const scratch = meta.inventory.map((slot) => ({ ...slot }));
    if (instanceUid !== undefined) {
      const scratchIndex = exactInventoryIndex(scratch, itemId, instanceUid);
      consumeInventoryUnitAt(scratch, scratchIndex);
    } else {
      consumeOneScratch(scratch, itemId);
    }
    if (
      !canAddItem(scratch, bagCapacity(meta.bags), materialItemId, maxSalvageYield(def, victim))
    ) {
      return { ok: false, itemId, reason: 'no_bag_space' };
    }
  }
  if (instanceUid !== undefined && meta) {
    consumeInventoryUnitAt(meta.inventory, exactIndex);
    ctx.onInventoryChangedForQuests(meta);
  } else {
    removePreferFungible(ctx, itemId, 1, pid);
  }
  const count = salvageYield(def, ctx.rng, victim);
  ctx.addItem(materialItemId, count, pid, { silent: true });
  if (meta) {
    recordAction(meta);
    ctx.bumpDeedStat(meta, 'salvagesPerformed', 1);
  }
  return { ok: true, itemId, materialItemId, count };
}

/** Command entry point (issue #1300), mirroring professions/crafting.ts
 *  craftItem's shape exactly: resolves the caller's own player entity via
 *  ctx.resolve, then delegates to resolveSalvage. Runs on the deterministic
 *  tick the command arrives on, never off-tick. */
export function salvageItem(
  ctx: SimContext,
  itemId: string,
  pid?: number,
  instanceUid?: string,
): SalvageResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, reason: 'unknown_item' };
  return resolveSalvage(ctx, r.meta.entityId, itemId, instanceUid);
}
