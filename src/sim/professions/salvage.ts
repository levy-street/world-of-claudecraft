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
import { ENCHANT_FAMILY_CAST_DURATION_SEC } from '../content/professions';
import { RIFT_ESSENCE_ITEM_ID } from '../content/rift/items';
import { ITEMS } from '../data';
import { consumeSelectedInventorySlot, itemCopyPin } from '../item_copy_ref';
import { requiredLevelFor } from '../item_level_req';
import { removePreferFungible } from '../items';
import { forceDismount } from '../mounts';
import { riftSalvageYield } from '../rift/progression';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  type Entity,
  type ItemDef,
  type ItemInstancePayload,
  isConsuming,
  SALVAGE_CAST_ID,
} from '../types';

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
  /** True when the command admitted and started a SALVAGE_CAST_ID cast
   *  (no materials granted yet). Absent on complete resolves and denials. */
  casting?: boolean;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled' | 'no_bag_space' | 'busy';
}

/**
 * Resolve one salvage attempt: denies (no side effect) if the item id is
 * unknown, ineligible, or the player does not hold a copy. On success
 * consumes exactly one copy of the item and grants the rolled material yield.
 * Craft Cast System Phase 4: no shared action throttle; the cast paces.
 */
export function resolveSalvage(
  ctx: SimContext,
  pid: number,
  itemId: string,
  slotIndex?: number,
): SalvageResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isSalvageable(def)) return { ok: false, itemId, reason: 'not_salvageable' };
  if (ctx.countItem(itemId, pid) < 1) return { ok: false, itemId, reason: 'not_held' };
  const meta = ctx.players.get(pid);
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
    // The predicted victim must be the copy this call will ACTUALLY consume, or
    // the capacity gate pre-fits the wrong payout (a rift copy pays essence, a
    // plain one pays the quality material). With a selection that is the named
    // slot; without one it stays the legacy preferred-victim walk.
    const selectedVictim = consumeSelectedInventorySlot(scratch, itemId, slotIndex);
    if (selectedVictim === null) return { ok: false, itemId, reason: 'not_held' };
    const victim =
      selectedVictim === undefined
        ? consumeOneScratch(scratch, itemId)
        : (selectedVictim.instance ?? undefined);
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
  // A named slot consumes exactly that copy; an id-only call keeps the legacy
  // prefer-plain walk untouched (the parity goldens drive that arm).
  let consumedInstance: ItemInstancePayload | undefined;
  if (slotIndex === undefined) {
    [consumedInstance] = removePreferFungible(ctx, itemId, 1, pid);
  } else {
    const owner = ctx.players.get(pid);
    const taken = owner ? consumeSelectedInventorySlot(owner.inventory, itemId, slotIndex) : null;
    if (!owner || !taken) return { ok: false, itemId, reason: 'not_held' };
    consumedInstance = taken.instance;
    ctx.onInventoryChangedForQuests?.(owner);
  }
  const riftInstance = consumedInstance?.rift ? consumedInstance : null;
  if (riftInstance) {
    const count = riftSalvageYield(riftInstance);
    // silent + callerLogs, exactly like the material branch below: this arm
    // returns a salvageResult too, so the salvage cue and the yield-naming
    // salvage line already own both halves of the feedback (#2430). Without
    // the flags a rift salvage stacked the generic loot ding and the hub's
    // "You receive:" line on top of its own.
    ctx.addItem(RIFT_ESSENCE_ITEM_ID, count, pid, { silent: true, callerLogs: true });
    // A rift salvage is still a salvage: it feeds the lifetime counter,
    // drawing zero rng on this branch. Phase 4: no throttle stamp.
    if (meta) {
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
    // The lifetime salvage counter (soc_first_salvage /
    // soc_salvage_50). Bumped strictly AFTER the single salvageYield rng
    // draw above; the bump itself draws nothing.
    ctx.bumpDeedStat(meta, 'salvagesPerformed', 1);
  }
  return { ok: true, itemId, materialItemId, count };
}

/** Pre-consume admission for a salvage cast start. No side effects, no rng. */
export function evaluateSalvageAdmission(
  ctx: SimContext,
  pid: number,
  itemId: string,
  slotIndex?: number,
): SalvageResult | null {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isSalvageable(def)) return { ok: false, itemId, reason: 'not_salvageable' };
  if (ctx.countItem(itemId, pid) < 1) return { ok: false, itemId, reason: 'not_held' };
  const meta = ctx.players.get(pid);
  if (!meta) return null;
  const materialItemId = SALVAGE_MATERIAL_BY_QUALITY[def.quality ?? 'common'] ?? 'bone_fragments';
  const scratch = meta.inventory.map((s) => ({ ...s }));
  // Predict the SELECTED victim, not the legacy one. A rift copy pays essence and a
  // plain copy pays material, so modelling the wrong victim let a cast start that
  // could only refuse at completion (the two payouts fit differently).
  const selected = consumeSelectedInventorySlot(scratch, itemId, slotIndex);
  if (selected === null) return { ok: false, itemId, reason: 'not_held' };
  const victim = selected === undefined ? consumeOneScratch(scratch, itemId) : selected.instance;
  const fitItemId = victim?.rift ? RIFT_ESSENCE_ITEM_ID : materialItemId;
  const fitCount = victim?.rift ? riftSalvageYield(victim) : maxSalvageYield(def);
  if (!canAddItem(scratch, bagCapacity(meta.bags), fitItemId, fitCount)) {
    return { ok: false, itemId, reason: 'no_bag_space' };
  }
  return null;
}

function beginSalvageCast(
  ctx: SimContext,
  p: Entity,
  itemId: string,
  slotIndex: number | undefined,
  meta: PlayerMeta,
): void {
  if (p.sitting) ctx.standUp(p);
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  const duration = ENCHANT_FAMILY_CAST_DURATION_SEC;
  p.castingAbility = SALVAGE_CAST_ID;
  p.castTotal = duration;
  p.castRemaining = duration;
  p.castTargetId = null;
  p.channeling = false;
  p.enchantCastItemId = itemId;
  // Stored 1-based (slotIndex + 1, 0 = not pin-selected), mirroring the enchant
  // family verbatim: the resting value must be 0 so the parity sampler's
  // default-omission drops it. A -1 rest value re-hashes every golden.
  p.enchantCastBagSlot = slotIndex === undefined ? 0 : slotIndex + 1;
  p.enchantCastEnchantId = '';
  p.enchantCastEquipSlot = '';
  p.enchantCastConfirmReplace = false;
  p.enchantCastTargetPin = slotIndex === undefined ? '' : itemCopyPin(meta.inventory[slotIndex]);
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: SALVAGE_CAST_ID,
    time: duration,
  });
}

/** Command entry point (issue #1300): validates and STARTS a SALVAGE_CAST_ID
 *  cast. Materials resolve only on completeSalvageCast. */
export function salvageItem(
  ctx: SimContext,
  itemId: string,
  pid?: number,
  slotIndex?: number,
): SalvageResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, reason: 'unknown_item' };
  const { meta, e: p } = r;
  if (p.castingAbility || isConsuming(p)) {
    return { ok: false, itemId, reason: 'busy' };
  }
  const denial = evaluateSalvageAdmission(ctx, meta.entityId, itemId, slotIndex);
  if (denial) return denial;
  beginSalvageCast(ctx, p, itemId, slotIndex, meta);
  return { ok: true, itemId, casting: true };
}

/** Completion of a running salvage cast. Re-validates and applies
 *  resolveSalvage; emits salvageResult. */
export function completeSalvageCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  // Shared enchant-family session bag (enchantCast*): safe because only one
  // non-spell cast runs at a time and updateCasting dispatches on the cast id,
  // so this reader always pairs with beginSalvageCast's write. A future
  // direct-assigned castingAbility (the parity-harness drive style) must
  // write the session fields too or the empty-session guard below no-ops.
  const itemId = p.enchantCastItemId;
  const sessionBagSlot = p.enchantCastBagSlot;
  const sessionPin = p.enchantCastTargetPin;
  p.enchantCastItemId = '';
  p.enchantCastBagSlot = 0;
  p.enchantCastEnchantId = '';
  p.enchantCastEquipSlot = '';
  p.enchantCastConfirmReplace = false;
  p.enchantCastTargetPin = '';
  // Empty session: silent no-op (completeRechargeCast precedent).
  if (itemId === '') return;
  const slotIndex = sessionBagSlot <= 0 ? undefined : sessionBagSlot - 1;
  // Pin re-check, mirroring the enchant family: the bag can move during the
  // cast (a loot, a sort, a stack merge), and an index alone would then point at
  // whatever slid into that slot. Refusing is the only safe answer, because the
  // player aimed at a specific copy and silently hitting a different one is
  // worse than the old guess.
  if (slotIndex !== undefined && itemCopyPin(meta.inventory[slotIndex]) !== sessionPin) {
    const moved: SalvageResult = { ok: false, itemId, reason: 'not_held' };
    meta.lastSalvageResult = moved;
    ctx.emit({
      type: 'salvageResult',
      ok: false,
      itemId,
      materialItemId: moved.materialItemId,
      count: moved.count,
      reason: moved.reason,
      pid: meta.entityId,
    });
    return;
  }
  const result = resolveSalvage(ctx, meta.entityId, itemId, slotIndex);
  meta.lastSalvageResult = result;
  ctx.emit({
    type: 'salvageResult',
    ok: result.ok,
    itemId: result.itemId,
    materialItemId: result.materialItemId,
    count: result.count,
    reason: result.reason,
    pid: meta.entityId,
  });
}
