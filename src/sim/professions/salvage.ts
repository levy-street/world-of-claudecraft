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
import { RIFT_ESSENCE_ITEM_ID } from '../content/rift/items';
import { ITEMS } from '../data';
import { requiredLevelFor } from '../item_level_req';
import { removePreferFungible } from '../items';
import { riftSalvageYield } from '../rift/progression';
import type { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { ItemDef } from '../types';
import { recordAction, withinActionThrottle } from './action_throttle';

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

/** The rarity/tier-scaled base yield the rng bonus rides on: the shared term
 *  of salvageYield and maxSalvageYield, so the #2350 capacity gate's worst
 *  case can never drift from the rolled grant. */
function baseSalvageYield(def: ItemDef): number {
  const qualityIdx = Math.max(0, QUALITY_ORDER.indexOf(def.quality ?? 'common'));
  const tierBonus = Math.floor(requiredLevelFor(def) / 10);
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
export function salvageYield(def: ItemDef, rng: Rng): number {
  const bonus = rng.next() < 0.5 ? 0 : 1;
  return baseSalvageYield(def) + bonus;
}

/** The largest yield salvageYield can roll (the +1 bonus arm): the count the
 *  #2350 capacity gate pre-fits, so a denial never draws rng and a granted
 *  roll can never exceed what was checked. */
export function maxSalvageYield(def: ItemDef): number {
  return baseSalvageYield(def) + 1;
}

export interface SalvageResult {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled' | 'no_bag_space';
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
  const meta = ctx.players.get(pid);
  // Shared action throttle (action_throttle.ts): salvage draws
  // from the same 10-per-60s budget as crafting, checked (no side effect
  // beyond the window's own natural rollover) before anything is consumed.
  if (meta && !withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, reason: 'throttled' };
  }
  const materialItemId = SALVAGE_MATERIAL_BY_QUALITY[def.quality ?? 'common'] ?? 'bone_fragments';
  // #2350 capacity gate: the materials must fit AFTER the salvaged copy
  // leaves, so consume it on a scratch copy (consumeOneScratch mirrors
  // removePreferFungible's victim order, and its returned payload predicts
  // the actual victim) and pre-fit the payout that victim yields: a
  // rift-upgraded copy pays rift essence at its deterministic count, any
  // other copy the quality material at the WORST-CASE yield (the +1 rng
  // bonus arm): the denial draws nothing, and a granted roll can never
  // exceed what was checked. Denies with no side effect, like every other
  // arm above.
  if (meta) {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    const victim = consumeOneScratch(scratch, itemId);
    const fitItemId = victim?.rift ? RIFT_ESSENCE_ITEM_ID : materialItemId;
    const fitCount = victim?.rift ? riftSalvageYield(victim) : maxSalvageYield(def);
    if (!canAddItem(scratch, bagCapacity(meta.bags), fitItemId, fitCount)) {
      return { ok: false, itemId, reason: 'no_bag_space' };
    }
  }
  // Prefer consuming a plain (fungible) copy so an enchanted or rift-upgraded
  // instance is never salvaged while an interchangeable shell exists. When only
  // instanced copies remain, removePreferFungible consumes one and returns the
  // payload it ACTUALLY consumed: a rift-upgraded copy pays out rift essence.
  const [consumedInstance] = removePreferFungible(ctx, itemId, 1, pid);
  const riftInstance = consumedInstance?.rift ? consumedInstance : null;
  if (riftInstance) {
    const count = riftSalvageYield(riftInstance);
    // silent + callerLogs, exactly like the material branch below: this arm
    // returns a salvageResult too, so the salvage cue and the yield-naming
    // salvage line already own both halves of the feedback (#2430). Without
    // the flags a rift salvage stacked the generic loot ding and the hub's
    // "You receive:" line on top of its own.
    ctx.addItem(RIFT_ESSENCE_ITEM_ID, count, pid, { silent: true, callerLogs: true });
    // A rift salvage is still a salvage: it spends the same throttle budget
    // and feeds the lifetime counter, drawing zero rng on this branch.
    if (meta) {
      recordAction(meta);
      ctx.bumpDeedStat(meta, 'salvagesPerformed', 1);
    }
    return { ok: true, itemId, materialItemId: RIFT_ESSENCE_ITEM_ID, count };
  }
  const count = salvageYield(def, ctx.rng);
  // silent + callerLogs: the salvageResult event owns BOTH halves of the
  // player feedback. It fires its own dedicated cue (audio.salvage in
  // src/game/audio.ts), so the generic loot ding would stack on top of it,
  // and it logs the yield-naming, item-linked salvage line off
  // materialItemId/count, so the hub's "You receive:" line would repeat what
  // that line already says (#2430).
  ctx.addItem(materialItemId, count, pid, { silent: true, callerLogs: true });
  if (meta) {
    recordAction(meta);
    // The lifetime salvage counter (soc_first_salvage /
    // soc_salvage_50). Bumped strictly AFTER the single salvageYield rng
    // draw above; the bump itself draws nothing.
    ctx.bumpDeedStat(meta, 'salvagesPerformed', 1);
  }
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
