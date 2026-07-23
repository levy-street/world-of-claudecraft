// Enchanting profession: disenchant an eligible weapon/armor piece into arcane
// materials, then spend those materials to apply a permanent stat bonus to a
// SPECIFIC held copy of an item (not the character, not the item id in the
// abstract). An enchanted piece is a fresh, non-stacking instanced copy
// (types.ts ItemInstancePayload.rolled.stats), so it survives equip/unequip
// (src/sim/items.ts) and stays a distinct good, separate from a plain copy of
// the same item id. sellItem/discardItem/trade's drop arm now prefer a
// fungible copy over this one (items.ts removePreferFungible), but market
// listing, mail, and trade do not yet carry the instance payload end to end
// (#1165-style gap): a fully "tradeable good" is a known follow-up, not yet
// true here.
//
// Layered on top of, not a replacement for, the existing everyone-can-salvage
// system (./salvage.ts, issue #1300): salvage still yields the same generic
// materials (bone_fragments/linen_scrap/spider_leg) for anyone, unconditionally.
// disenchantItem here is the Enchanting-specific action: dedicated arcane
// materials, scaling with the item's rarity (strictly better than plain
// salvage from `rare` up; near-identical vendor value at `common`), and is
// the intended reagent source for applyEnchant below.
//
// Scope (v1): no skill-gate beyond the free-floor rule every other common-tier
// craft action in this repo follows (crafting.ts, wheel.ts) - any player can
// disenchant or apply an enchant regardless of craftSkills.enchanting. Both
// actions DO gain flat 'enchanting' skill on success now (#1712 round-3
// review point 3), so the specialization recharge discount (professions/
// tools.ts) and the Enchanter archetype eventually engage; the archetype
// output-quality ceiling crafting.ts's craftItem enforces is NOT wired in
// here yet (this action has no rollable output quality to clamp), matching
// how salvage.ts also does not participate in that half of the wheel. Wired
// through the full stack in Professions 2.0: the disenchant_item /
// apply_enchant WS commands, the IWorldProfessions + ClientWorld
// disenchantItem / applyEnchant members, and the src/ui bag-item action menu
// plus Apply Enchant picker (bag_item_action_menu.ts), the way craft_item /
// harvest_node already are.
//
// This module is `src/sim`-pure: no DOM/browser/Three.js imports, no
// Math.random/Date.now (uses ctx.rng only), host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged.

import { ENCHANTS, type EnchantDef } from '../content/enchants';
import { ITEMS } from '../data';
import { requiredLevelFor } from '../item_level_req';
import type { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type ItemDef, type ItemInstancePayload } from '../types';
import { recordAction, withinActionThrottle } from './action_throttle';
import { enchantingGainMultiplier } from './archetype';
import { typedSecondaryFor } from './disenchant_reagents';
import { gainCraftSkill } from './wheel';

// #1712 round-3 review: neither action previously called gainCraftSkill, so
// craftSkills.enchanting stayed 0 forever, permanently locking the
// specialization recharge discount (professions/tools.ts) and the Enchanter
// archetype's own craft out of any progression. This is now the
// BASE gain, multiplied by enchantingGainMultiplier (archetype.ts): the
// input's quality tier, soft-clamped to the archetype ceiling, run through
// the four-state mastery curve, same shape as crafting.ts's
// CRAFT_SKILL_GAIN * craftSkillGainMultiplier.
export const ENCHANTING_SKILL_GAIN = 1;

// The gain tier each ItemQuality maps to (quality-tiered
// enchanting gains): the input's rarity IS its difficulty, on the same
// tier-index ladder the archetype ceilings use (common=0, uncommon=1,
// rare=2, epic=3, legendary=4; poor has nothing arcane about it and scores
// with common). Feeds enchantingGainMultiplier for both arms below: the
// disenchanted item's def quality on the disenchant arm, the applied
// enchant's reagent-derived tier (enchantGainTier) on the apply arm.
export const ENCHANTING_GAIN_TIER_BY_QUALITY: Readonly<
  Record<NonNullable<ItemDef['quality']>, number>
> = Object.freeze({
  poor: 0,
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
});

const QUALITY_ORDER: readonly NonNullable<ItemDef['quality']>[] = [
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

// Which arcane material a disenchant yields, keyed by the disenchanted
// item's rarity: a dedicated Enchanting material rather than a shared junk
// item, feeding the same three tiers applyEnchant's reagents draw from. Only
// strictly better than plain salvage.ts's generic yield from `rare` up
// (arcane_dust and bone_fragments vendor near-identically at `common`; see
// #1712 round-3 review point 12).
export const DISENCHANT_MATERIAL_BY_QUALITY: Readonly<Record<string, string>> = {
  common: 'arcane_dust',
  uncommon: 'arcane_dust',
  rare: 'arcane_essence',
  epic: 'arcane_shard',
  legendary: 'arcane_shard',
};

/** The authoritative already-enchanted read for one instance payload: the
 *  explicit `enchant` marker (written by resolveApplyEnchant below), or, for
 *  legacy enchanted copies that predate the marker, bare rolled.stats WITHOUT
 *  rolled.masterwork (before the masterwork model, applyEnchant was
 *  the ONLY writer of rolled.stats, so bare stats meant enchanted; a
 *  masterwork copy carries rolled.stats without being enchanted and must stay
 *  enchantable exactly like a plain copy). This is what the
 *  countEnchantableItem/removeEnchantableItem guards (sim.ts) key on, so
 *  double-enchant prevention holds for both legacy and marker-carrying
 *  copies. */
export function isEnchantedInstance(instance: ItemInstancePayload): boolean {
  return (
    instance.enchant !== undefined || (!!instance.rolled?.stats && !instance.rolled.masterwork)
  );
}

/** Eligible for disenchant: same eligibility as plain salvage (an equippable
 *  weapon or armor piece, at least `common` quality). */
export function isDisenchantable(def: ItemDef | undefined): boolean {
  return (
    !!def &&
    (def.kind === 'weapon' || def.kind === 'armor') &&
    !!def.quality &&
    def.quality !== 'poor'
  );
}

/** The arcane material yield for one disenchant of `def`: scales with rarity
 *  and tier the same way salvage.ts's salvageYield does, plus one rng-rolled
 *  bonus unit, but the material itself is the dedicated, more valuable
 *  Enchanting tier (see DISENCHANT_MATERIAL_BY_QUALITY), not a generic junk
 *  item. Pure aside from the rng draw. */
export function disenchantYield(def: ItemDef, rng: Rng): number {
  const qualityIdx = Math.max(0, QUALITY_ORDER.indexOf(def.quality ?? 'common'));
  const tierBonus = Math.floor(requiredLevelFor(def) / 10);
  const bonus = rng.next() < 0.5 ? 0 : 1;
  return qualityIdx + tierBonus + 1 + bonus;
}

/** The gain tier of one enchant for the apply arm: EnchantDef carries no
 *  tier/quality field of its own, so the existing tier notion is the
 *  reagent ladder the two-layer table is built on (arcane_dust base,
 *  arcane_essence mid, arcane_shard Greater): the MAX reagent item-def
 *  quality, mapped through ENCHANTING_GAIN_TIER_BY_QUALITY (same
 *  max-over-reagents convention as material_tier.ts). Today that reads
 *  dust-only enchants as tier 0, essence-consuming ones as tier 1, and the
 *  shard-consuming Greater tier as tier 2. */
export function enchantGainTier(enchant: EnchantDef): number {
  let tier = 0;
  for (const reagent of enchant.reagents) {
    const quality = ITEMS[reagent.itemId]?.quality;
    if (quality) tier = Math.max(tier, ENCHANTING_GAIN_TIER_BY_QUALITY[quality]);
  }
  return tier;
}

export interface DisenchantResult {
  ok: boolean;
  itemId: string;
  materialItemId?: string;
  count?: number;
  /** The typed, bind-on-trade secondary material a rare-or-better disenchant
   *  also yields (disenchant_reagents.ts typedSecondaryFor). Set only on a
   *  rare+ success whose piece has a typed material; absent on every sub-rare
   *  success and on a rare+ piece with no typed material (jewelry). */
  secondaryItemId?: string;
  /** How many copies of secondaryItemId were granted: exactly 1 for a rare
   *  piece, 1 or 2 (one rng draw) for an epic/legendary piece. Set iff
   *  secondaryItemId is. */
  secondaryCount?: number;
  reason?: 'unknown_item' | 'not_disenchantable' | 'not_held' | 'throttled';
}

/** Resolve one disenchant attempt: denies (no side effect) if the item id is
 *  unknown, ineligible, or the player does not hold an eligible copy (a plain
 *  fungible copy, OR an instanced copy that has NOT itself been enchanted -
 *  e.g. crafting.ts's single-copy rare+ craft grant, which instances every
 *  rare-or-better craft for its signer/rolled-quality payload without
 *  applying an enchant; see countEnchantableItem). Consumes exactly one such
 *  copy on success (never an already-enchanted copy, via removeEnchantableItem)
 *  and grants the rolled arcane material yield. */
export function resolveDisenchant(ctx: SimContext, pid: number, itemId: string): DisenchantResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isDisenchantable(def)) return { ok: false, itemId, reason: 'not_disenchantable' };
  if (ctx.countEnchantableItem(itemId, pid) < 1) return { ok: false, itemId, reason: 'not_held' };
  const meta = ctx.players.get(pid);
  // Shared action throttle (action_throttle.ts): disenchant draws
  // from the same 10-per-60s budget as crafting, checked (no side effect
  // beyond the window's own natural rollover) before anything is consumed.
  if (meta && !withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, reason: 'throttled' };
  }
  ctx.removeEnchantableItem(itemId, 1, pid);
  const quality = def.quality ?? 'common';
  const materialItemId = DISENCHANT_MATERIAL_BY_QUALITY[quality] ?? 'arcane_dust';
  // Yield model: sub-rare (common/uncommon) stays byte-identical to
  // today, a single rng draw (disenchantYield's +0/+1 bonus) over a rolled
  // count of the universal ladder material, and NO secondary. Rare+ shifts to a
  // FIXED single primary plus a typed, bind-on-trade secondary
  // (disenchant_reagents.ts typedSecondaryFor): rare grants exactly one
  // secondary with NO rng draw; epic/legendary grants one or two via ONE draw
  // (the existing next() < 0.5 ? bonus idiom). The secondary rides
  // ctx.addItemInstance with a { bindOnTrade: true } payload so a disenchant
  // windfall cannot be freely resold; the universal primary stays a plain
  // ctx.addItem (dust/essence/shard never bind). A rare+ piece with no typed
  // material (jewelry: no armor class) yields only the primary and draws no rng.
  const isRarePlus = quality === 'rare' || quality === 'epic' || quality === 'legendary';
  const secondaryItemId = typedSecondaryFor(def);
  let count: number;
  let secondaryCount: number | undefined;
  if (isRarePlus) {
    count = 1;
    if (secondaryItemId) {
      secondaryCount = quality === 'rare' ? 1 : ctx.rng.next() < 0.5 ? 1 : 2;
    }
  } else {
    count = disenchantYield(def, ctx.rng);
  }
  ctx.addItem(materialItemId, count, pid);
  if (secondaryItemId && secondaryCount) {
    for (let i = 0; i < secondaryCount; i++) {
      ctx.addItemInstance(secondaryItemId, { bindOnTrade: true }, pid);
    }
  }
  if (meta) {
    // Quality-tiered gain: the disenchanted item's def quality is
    // the input tier, soft-clamped to the archetype ceiling and run through
    // the four-state curve. A zero (gray) gain never blocks the action.
    const inputTier = ENCHANTING_GAIN_TIER_BY_QUALITY[quality];
    gainCraftSkill(
      meta.craftSkills,
      'enchanting',
      ENCHANTING_SKILL_GAIN *
        enchantingGainMultiplier(
          meta.craftSkills,
          meta.archetype.activeArchetype,
          meta.archetype.pairedMajor,
          meta.archetype.hobbyCraft,
          inputTier,
        ),
    );
    recordAction(meta);
    // The skill gain feeds the craftSkill deed triggers, so the site marks
    // the player dirty itself (the crafting.ts craftItem contract).
    ctx.markDeedsDirty(meta.entityId);
  }
  const result: DisenchantResult = { ok: true, itemId, materialItemId, count };
  if (secondaryItemId && secondaryCount) {
    result.secondaryItemId = secondaryItemId;
    result.secondaryCount = secondaryCount;
  }
  return result;
}

/** Command entry point, mirroring professions/salvage.ts's salvageItem shape
 *  exactly: resolves the caller's own player entity via ctx.resolve, then
 *  delegates to resolveDisenchant. Runs on the deterministic tick the
 *  command arrives on, never off-tick. */
export function disenchantItem(ctx: SimContext, itemId: string, pid?: number): DisenchantResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, reason: 'unknown_item' };
  return resolveDisenchant(ctx, r.meta.entityId, itemId);
}

export interface ApplyEnchantResult {
  ok: boolean;
  itemId: string;
  enchantId: string;
  reason?:
    | 'unknown_item'
    | 'unknown_enchant'
    | 'wrong_slot'
    | 'not_held'
    | 'insufficient_materials'
    | 'throttled';
}

/** Resolve one apply-enchant attempt against a HELD (bagged, not currently
 *  equipped) eligible copy of `itemId`: a plain fungible copy, or an
 *  instanced copy that has NOT itself been enchanted yet (crafted rare+ gear;
 *  see countEnchantableItem). Denies (no side effect) if the item or enchant
 *  id is unknown, the enchant does not target this item's slot, the player
 *  holds no eligible copy, or any reagent is short (all-or-nothing, same
 *  reagent-availability discipline crafting.ts's craftItem uses).
 *  On success: consumes exactly one eligible copy (removeEnchantableItem, so
 *  an already-enchanted copy of the same item is never silently overwritten)
 *  and every reagent, then grants a freshly-instanced copy carrying the
 *  enchant's stat bonus (ctx.addItemInstance): equipping THAT copy is what
 *  carries the bonus into recalcPlayerStats (see items.ts equipItem). If the
 *  consumed copy was itself instanced (a crafted rare+ piece carrying a
 *  signer payload, a masterwork copy carrying baked bonus stats, or a
 *  legacy rolled.quality copy), that payload is merged into the new instance
 *  rather than dropped (stats sum ADDITIVELY), so enchanting a crafted or
 *  masterwork item does not erase its crafter attribution
 *  (battlefield_xp.ts), its masterwork bonus, or legacy rolled.quality
 *  (#1712 round-3 review). */
export function resolveApplyEnchant(
  ctx: SimContext,
  pid: number,
  itemId: string,
  enchantId: string,
): ApplyEnchantResult {
  const itemDef = ITEMS[itemId];
  if (!itemDef) return { ok: false, itemId, enchantId, reason: 'unknown_item' };
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return { ok: false, itemId, enchantId, reason: 'unknown_enchant' };
  if (itemDef.slot !== enchant.itemSlot) {
    return { ok: false, itemId, enchantId, reason: 'wrong_slot' };
  }
  if (ctx.countEnchantableItem(itemId, pid) < 1) {
    return { ok: false, itemId, enchantId, reason: 'not_held' };
  }
  for (const reagent of enchant.reagents) {
    if (ctx.countItem(reagent.itemId, pid) < reagent.count) {
      return { ok: false, itemId, enchantId, reason: 'insufficient_materials' };
    }
  }
  const meta = ctx.players.get(pid);
  // Shared action throttle (action_throttle.ts): enchant-apply
  // draws from the same 10-per-60s budget as crafting, checked (no side
  // effect beyond the window's own natural rollover) before anything is
  // consumed.
  if (meta && !withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, enchantId, reason: 'throttled' };
  }
  const [consumed] = ctx.removeEnchantableItem(itemId, 1, pid);
  for (const reagent of enchant.reagents) ctx.removeItem(reagent.itemId, reagent.count, pid);
  const merged: ItemInstancePayload = consumed
    ? cloneItemInstancePayload(consumed)
    : ({} as ItemInstancePayload);
  // ADDITIVE stat merge: a masterwork copy's baked bonus
  // (rolled.stats alongside rolled.masterwork) and the enchant's bonus must
  // BOTH survive on the enchanted copy, so the enchant sums into any existing
  // record instead of replacing it. signer, rolled.masterwork, and legacy
  // rolled.quality ride through the clone above untouched. A consumed copy is
  // never already enchanted (removeEnchantableItem guards on
  // isEnchantedInstance), so this never stacks one enchant onto another.
  const mergedStats: Record<string, number> = { ...merged.rolled?.stats };
  for (const [stat, value] of Object.entries(enchant.statBonus)) {
    if (value === undefined) continue;
    mergedStats[stat] = (mergedStats[stat] ?? 0) + value;
  }
  merged.rolled = { ...merged.rolled, stats: mergedStats };
  // The explicit already-enchanted marker (isEnchantedInstance above): keyed
  // on the enchant itself rather than bare stats presence, so masterwork
  // copies stay enchantable while double-enchant stays blocked.
  merged.enchant = enchant.id;
  ctx.addItemInstance(itemId, merged, pid);
  if (meta) {
    // Quality-tiered gain: the applied enchant's reagent-derived
    // tier (enchantGainTier above) is the input tier, soft-clamped to the
    // archetype ceiling and run through the four-state curve. A zero (gray)
    // gain never blocks the action.
    gainCraftSkill(
      meta.craftSkills,
      'enchanting',
      ENCHANTING_SKILL_GAIN *
        enchantingGainMultiplier(
          meta.craftSkills,
          meta.archetype.activeArchetype,
          meta.archetype.pairedMajor,
          meta.archetype.hobbyCraft,
          enchantGainTier(enchant),
        ),
    );
    recordAction(meta);
    // The skill gain feeds the craftSkill deed triggers, so the site marks
    // the player dirty itself (the crafting.ts craftItem contract).
    ctx.markDeedsDirty(meta.entityId);
  }
  return { ok: true, itemId, enchantId };
}

/** Command entry point, same shape as disenchantItem/salvageItem above. */
export function applyEnchant(
  ctx: SimContext,
  itemId: string,
  enchantId: string,
  pid?: number,
): ApplyEnchantResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, enchantId, reason: 'unknown_item' };
  return resolveApplyEnchant(ctx, r.meta.entityId, itemId, enchantId);
}
