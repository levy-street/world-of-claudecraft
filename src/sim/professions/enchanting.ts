// Enchanting profession: disenchant an eligible weapon/armor piece into arcane
// materials, then spend those materials to apply a permanent stat bonus to a
// SPECIFIC copy of an item (not the character, not the item id in the
// abstract): a bagged copy, or, with a slot named, the copy WORN in that
// equipment slot, enchanted in place. An enchanted piece is a non-stacking
// instanced copy
// (types.ts ItemInstancePayload.rolled.stats), so it survives equip/unequip
// (src/sim/items.ts) and stays a distinct good, separate from a plain copy of
// the same item id. sellItem/discardItem/trade's drop arm now prefer a
// fungible copy over this one (items.ts removePreferFungible), and trade
// carries the payload end to end (#2049); market listing and mail still do
// not (#1165-style gap): a fully "tradeable good" there is a known follow-up,
// not yet true here.
//
// Replacing an enchant (#2415): an already-enchanted copy is never silently
// overwritten, but it is not locked forever either. The apply command carries
// an explicit confirmReplace flag; with it set, the one-step replace arm
// destroys the old enchant outright (no material refund: disenchanting is the
// material faucet and enchanting the sink) and applies the new one
// surgically: only the enchant layer changes, the signer, masterwork stats,
// and boundTo/bindOnTrade flags carry through byte-identical
// (replacedEnchantPayloadFor below). Without the flag the deny is the
// dedicated already_enchanted reason, on both the bagged and the worn arm.
// WITH the flag, re-applying the identical enchant id denies as same_enchant
// on both arms, because its accept would be pure reagent loss with zero state
// change. The order matters and is deliberate: the flag check precedes the id
// compare, so an unconfirmed same-id apply reads already_enchanted, not
// same_enchant. Replacement is just an apply: same shared action throttle, no
// extra fee or skill gate.
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

import { bagCapacity, consumeOneScratch, countFit, fitsAll, removeStacked } from '../bags';
import { ENCHANTS, type EnchantDef } from '../content/enchants';
import { ITEMS } from '../data';
import { recalcPlayerStats } from '../entity';
import { requiredLevelFor } from '../item_level_req';
import type { Rng } from '../rng';
// Type-only import (the crafting.ts/commission.ts idiom): PlayerMeta is a
// shape, never the Sim class, so this module stays host-agnostic.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  cloneItemInstancePayload,
  type EquipSlot,
  type InvSlot,
  type ItemDef,
  type ItemInstancePayload,
} from '../types';
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

/** The pinned replace-victim choice (#2415): the HIGHEST-index bagged copy of
 *  `itemId` that is already enchanted, matching the end-first walk every other
 *  remover in this repo uses (removeItem, removeEnchantableItem, and the
 *  #2340 disenchant fallback). The apply command is item-id-keyed, so when two
 *  enchanted copies of one item id carry different enchants, this pin is what
 *  decides the victim; the UI confirm dialog names the enchant of exactly this
 *  copy (src/ui/enchant_apply_view.ts enchantTargets builds its replace rows
 *  from this same function), so what the player confirms is what the sim
 *  destroys. The pin re-resolves when the command lands, which is the accepted
 *  trade of an id-keyed command with no per-copy token: an enchanted copy of
 *  the same item id ARRIVING at a higher index between dialog and accept
 *  moves the pin onto the newcomer. The loss stays the actor's own (no dupe,
 *  no cross-player reach) and the window is one confirm click; carrying a
 *  confirmed-enchant token on the wire was ruled out as not worth the surface.
 *  Returns -1 when no enchanted copy is held. */
export function replaceVictimIndex(inventory: readonly InvSlot[], itemId: string): number {
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId === itemId && s.instance && isEnchantedInstance(s.instance)) return i;
  }
  return -1;
}

/** Remove ONE unit of the pinned replace victim from `inventory` and return
 *  its payload. ONE walk shared by the live removal and the #2350 scratch
 *  capacity model (both call this exact function on their own slot array), so
 *  the modeled victim can never drift from the consumed one (the #2139 rule).
 *  Clone-on-survival, same contract as removeEnchantableItem: the caller
 *  transforms the returned payload, so a surviving stack's shared payload is
 *  never aliased out (gear is stack-cap 1 today, so the slot never survives in
 *  practice; the rule is kept for the contract, not the current content).
 *  Returns undefined when no enchanted copy is held. */
export function consumeEnchantedVictim(
  inventory: InvSlot[],
  itemId: string,
): ItemInstancePayload | undefined {
  const i = replaceVictimIndex(inventory, itemId);
  if (i < 0) return undefined;
  const s = inventory[i];
  const survives = s.count > 1;
  const payload = survives && s.instance ? cloneItemInstancePayload(s.instance) : s.instance;
  s.count -= 1;
  if (s.count <= 0) inventory.splice(i, 1);
  return payload;
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

/** The rarity/tier-scaled base yield the rng bonus rides on: the shared term
 *  of disenchantYield and maxDisenchantYield, so the #2350 capacity gate's
 *  worst case can never drift from the rolled grant. Exported so the UI's
 *  disenchant-confirm yield preview (src/ui/disenchant_yield_view.ts) reads the
 *  LOW end of the sub-rare range from this same term instead of restating it. */
export function baseDisenchantYield(def: ItemDef): number {
  const qualityIdx = Math.max(0, QUALITY_ORDER.indexOf(def.quality ?? 'common'));
  const tierBonus = Math.floor(requiredLevelFor(def) / 10);
  return qualityIdx + tierBonus + 1;
}

/** The arcane material yield for one disenchant of `def`: scales with rarity
 *  and tier the same way salvage.ts's salvageYield does, plus one rng-rolled
 *  bonus unit, but the material itself is the dedicated, more valuable
 *  Enchanting tier (see DISENCHANT_MATERIAL_BY_QUALITY), not a generic junk
 *  item. Pure aside from the rng draw. */
export function disenchantYield(def: ItemDef, rng: Rng): number {
  const bonus = rng.next() < 0.5 ? 0 : 1;
  return baseDisenchantYield(def) + bonus;
}

/** The largest yield disenchantYield can roll (the +1 bonus arm): the count
 *  the #2350 capacity gate pre-fits on the sub-rare arm, so a denial never
 *  draws rng and a granted roll can never exceed what was checked. */
export function maxDisenchantYield(def: ItemDef): number {
  return baseDisenchantYield(def) + 1;
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

/** The shared post-success bookkeeping every enchanting action performs, in one
 *  place because all three arms (disenchant, apply-to-bagged, apply-to-worn) do
 *  exactly this and only the input tier differs: the quality-tiered
 *  'enchanting' skill gain (soft-clamped to the archetype ceiling and run
 *  through the four-state mastery curve; a zero gray gain never blocks the
 *  action), the shared action-throttle stamp, and the deed re-check the skill
 *  gain's craftSkill triggers need (the crafting.ts craftItem contract: the
 *  gaining site marks the player dirty itself). */
function grantEnchantingSkill(ctx: SimContext, meta: PlayerMeta, inputTier: number): void {
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
  ctx.markDeedsDirty(meta.entityId);
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
  reason?: 'unknown_item' | 'not_disenchantable' | 'not_held' | 'throttled' | 'no_bag_space';
}

/** Resolve one disenchant attempt: denies (no side effect) if the item id is
 *  unknown, ineligible, or the player holds no copy of it at all. Consumes
 *  exactly one held copy on success, preferring the least special first: a
 *  plain fungible copy, then an instanced copy that has NOT itself been
 *  enchanted (e.g. crafting.ts's single-copy rare+ craft grant; see
 *  removeEnchantableItem), and only when every held copy is already enchanted
 *  one of those, destroying the piece enchant and all (issue #2340: the
 *  enchanted-copy exclusion protects apply-enchant from silently overwriting
 *  an enchant, but disenchant destroys the item anyway, so gating on it here
 *  only denied a held item with a wrong "not held" message). Grants the
 *  rolled arcane material yield. */
export function resolveDisenchant(ctx: SimContext, pid: number, itemId: string): DisenchantResult {
  const def = ITEMS[itemId];
  if (!def) return { ok: false, itemId, reason: 'unknown_item' };
  if (!isDisenchantable(def)) return { ok: false, itemId, reason: 'not_disenchantable' };
  if (ctx.countItem(itemId, pid) < 1) return { ok: false, itemId, reason: 'not_held' };
  const meta = ctx.players.get(pid);
  // Shared action throttle (action_throttle.ts): disenchant draws
  // from the same 10-per-60s budget as crafting, checked (no side effect
  // beyond the window's own natural rollover) before anything is consumed.
  if (meta && !withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, reason: 'throttled' };
  }
  // The yield plan (pure def lookups, no rng): hoisted above the capacity
  // gate so the gate can model the exact grants the success path mints below.
  const quality = def.quality ?? 'common';
  const materialItemId = DISENCHANT_MATERIAL_BY_QUALITY[quality] ?? 'arcane_dust';
  const isRarePlus = quality === 'rare' || quality === 'epic' || quality === 'legendary';
  const secondaryItemId = typedSecondaryFor(def);
  // #2350 capacity gate: the materials must fit AFTER the disenchanted copy
  // leaves, so consume it on a scratch copy (consumeOneScratch with the
  // isEnchantedInstance exclusion mirrors the countEnchantableItem-split
  // victim order below) and pre-fit the WORST-CASE grants: the +1 rng bonus
  // arm on the sub-rare yield, and two secondaries on an epic/legendary
  // piece. The denial draws nothing and has no side effect, like every other
  // arm above; a granted roll can never exceed what was checked.
  if (meta) {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    consumeOneScratch(scratch, itemId, isEnchantedInstance);
    const adds: InvSlot[] = isRarePlus
      ? [{ itemId: materialItemId, count: 1 }]
      : [{ itemId: materialItemId, count: maxDisenchantYield(def) }];
    if (isRarePlus && secondaryItemId) {
      adds.push({
        itemId: secondaryItemId,
        count: quality === 'rare' ? 1 : 2,
        instance: { bindOnTrade: true },
      });
    }
    if (!fitsAll(scratch, bagCapacity(meta.bags), adds)) {
      return { ok: false, itemId, reason: 'no_bag_space' };
    }
  }
  // Preference order unchanged from before: plain fungible first, then an
  // unenchanted instanced copy (removeEnchantableItem). The fallback arm is
  // the #2340 fix: with only enchanted copies left, take the highest-index
  // one (removeItem order; the UI confirm predicate in
  // src/ui/bag_item_context_menu.ts mirrors this victim choice).
  if (ctx.countEnchantableItem(itemId, pid) >= 1) ctx.removeEnchantableItem(itemId, 1, pid);
  else ctx.removeItem(itemId, 1, pid);
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
  // silent + callerLogs on both grants below: the disenchantResult event owns
  // BOTH halves of the player feedback. It fires its own dedicated cue
  // (audio.disenchant in src/game/audio.ts), so the generic loot ding would
  // stack on top of it, and it logs the yield-naming, item-linked disenchant
  // line off materialItemId/count (plus secondaryItemId/secondaryCount), so
  // the hub's "You receive:" lines would repeat what that line already says
  // (#2430: an epic yield used to print FOUR lines for one action).
  ctx.addItem(materialItemId, count, pid, { silent: true, callerLogs: true });
  if (secondaryItemId && secondaryCount) {
    // Still one grant call per unit (the shipped payload-aliasing contract):
    // the per-unit loot events are elided by callerLogs, and the client
    // renders ONE secondary line off disenchantResult.secondaryCount, so
    // batching the grant would buy nothing player-visible and would move the
    // per-grant discovery/quest hook cadence.
    for (let i = 0; i < secondaryCount; i++) {
      ctx.addItemInstance(secondaryItemId, { bindOnTrade: true }, pid, 1, {
        silent: true,
        callerLogs: true,
      });
    }
  }
  // Quality-tiered gain: the disenchanted item's def quality is the input tier.
  if (meta) grantEnchantingSkill(ctx, meta, ENCHANTING_GAIN_TIER_BY_QUALITY[quality]);
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
    | 'throttled'
    | 'no_bag_space'
    // #2415: the target copy is already enchanted and the command carried no
    // confirmReplace flag (the honest deny that replaced the misleading
    // not_held), and the identical-enchant-id re-apply, denied on every arm
    // because its accept would be pure reagent loss with zero state change.
    | 'already_enchanted'
    | 'same_enchant';
}

/** The exact instance payload an apply-enchant mints from the copy it
 *  consumed: the consumed payload cloned (empty for a plain fungible copy),
 *  the enchant's stat bonus summed ADDITIVELY into any existing rolled.stats
 *  (a masterwork copy's baked bonus and the enchant's bonus must BOTH survive;
 *  signer, rolled.masterwork, and legacy rolled.quality ride through the clone
 *  untouched), and the explicit already-enchanted marker set (keyed on the
 *  enchant itself rather than bare stats presence, so masterwork copies stay
 *  enchantable while double-enchant stays blocked; see isEnchantedInstance).
 *  A consumed copy is never already enchanted (removeEnchantableItem guards
 *  on isEnchantedInstance), so this never stacks one enchant onto another.
 *  Shared by resolveApplyEnchant's success path and its #2350 capacity gate,
 *  so the modeled grant can never drift from the minted one. */
export function enchantedPayloadFor(
  consumed: ItemInstancePayload | undefined,
  enchant: EnchantDef,
): ItemInstancePayload {
  const merged: ItemInstancePayload = consumed
    ? cloneItemInstancePayload(consumed)
    : ({} as ItemInstancePayload);
  const mergedStats: Record<string, number> = { ...merged.rolled?.stats };
  for (const [stat, value] of Object.entries(enchant.statBonus)) {
    if (value === undefined) continue;
    mergedStats[stat] = (mergedStats[stat] ?? 0) + value;
  }
  merged.rolled = { ...merged.rolled, stats: mergedStats };
  merged.enchant = enchant.id;
  return merged;
}

/** The exact payload the #2415 replace arm mints from an already-enchanted
 *  victim: the victim cloned, the OLD enchant peeled off surgically, and the
 *  new one applied on top, so only the enchant layer changes: the signer,
 *  rolled.masterwork, legacy rolled.quality, boundTo, and bindOnTrade all ride
 *  through the clone byte-identical.
 *
 *  Marker copies (victim.enchant set): the old bonus is SUBTRACTED per stat,
 *  exact because enchant magnitudes are frozen post-launch
 *  (content/enchants.ts), and a key that reaches zero is DELETED rather than
 *  kept at 0: item_instance_merge.ts's structural equality treats a present
 *  zero-valued key as distinct from an absent one, so residue would stop the
 *  replaced copy comparing equal to a fresh same-enchant peer. The <= 0 arm
 *  also swallows a corrupt over-large baked value gracefully instead of
 *  minting a negative stat.
 *
 *  One accepted asymmetry in that prune: a masterwork bake can itself contain
 *  a ZERO-valued key (item_budget.ts normalizePrimaryStats writes out[k] =
 *  base, and base floors to 0 when the exact share rounds down and the
 *  leftover pass does not reach that axis). Bake {str:1, agi:0} plus an
 *  agility enchant is {str:1, agi:2}; replacing it with a strength enchant
 *  subtracts agi to 0 and PRUNES the key, giving {str:3}, while a fresh peer
 *  off the same bake keeps {str:3, agi:0}. Stat-identical (a zero contributes
 *  nothing to recalcPlayerStats), but structurallyEqual counts present-0 as
 *  distinct from absent, so those two copies would not stack. Accepted: gear
 *  is stack-cap 1, so no stack exists to lose, and preserving the zero would
 *  cost the far more common zero-residue case its clean peer equality.
 *  Legacy pre-marker copies (bare rolled.stats, no
 *  masterwork): rolled.stats is replaced WHOLESALE, exact because applyEnchant
 *  was the only writer of rolled.stats before the masterwork model, so on
 *  such a copy the whole map IS the old enchant. Standing caution: that
 *  sole-writer premise is what keeps the wipe safe, so any future system that
 *  writes rolled.stats WITHOUT setting rolled.masterwork would hand its stats
 *  to this arm for deletion (and to isEnchantedInstance for misclassification)
 *  and must use the masterwork flag or a new marker instead.
 *
 *  Callers must resolve and validate the old enchant id BEFORE calling (the
 *  same_enchant deny, and the defensive unknown-old-id deny): this function
 *  assumes a marker id resolves. Shared by both replace arms' success paths
 *  and the bagged arm's #2350 capacity gate, so the modeled grant never
 *  drifts from the minted one. */
export function replacedEnchantPayloadFor(
  victim: ItemInstancePayload,
  next: EnchantDef,
): ItemInstancePayload {
  const merged = cloneItemInstancePayload(victim);
  const old = victim.enchant !== undefined ? ENCHANTS[victim.enchant] : undefined;
  // Legacy arm: no marker means the whole stats map is the old enchant.
  const stats: Record<string, number> =
    victim.enchant !== undefined ? { ...merged.rolled?.stats } : {};
  if (old) {
    for (const [stat, value] of Object.entries(old.statBonus)) {
      if (value === undefined) continue;
      const remain = (stats[stat] ?? 0) - value;
      if (remain > 0) stats[stat] = remain;
      else delete stats[stat];
    }
  }
  for (const [stat, value] of Object.entries(next.statBonus)) {
    if (value === undefined) continue;
    stats[stat] = (stats[stat] ?? 0) + value;
  }
  merged.rolled = { ...merged.rolled, stats };
  merged.enchant = next.id;
  return merged;
}

/** Resolve one apply-enchant attempt against the copy WORN in `slot`, enchanting
 *  it in place (the classic behavior: no unequip / enchant / re-equip dance).
 *  Every gate mirrors the bagged arm below one for one: the enchant must target
 *  this item's slot (checked by the shared caller), the named slot must actually
 *  be wearing this exact item id, the worn copy must NOT already be enchanted,
 *  every reagent must be held IN THE BAGS (all-or-nothing), and the shared
 *  action throttle applies. On success the merged payload (the SAME
 *  enchantedPayloadFor the bagged arm mints, so signer / masterwork / legacy
 *  rolled.quality survival is one contract, not two) is written straight onto
 *  PlayerMeta.equipmentInstance[slot] and the stats are re-baked.
 *
 *  The discriminator is a SLOT, deliberately, and not an item id: ring1/ring2
 *  and mainhand/offhand can each be wearing an identical copy of one item id,
 *  and only the slot says which of the two the player aimed at. */
function resolveApplyEnchantWorn(
  ctx: SimContext,
  pid: number,
  itemId: string,
  enchant: EnchantDef,
  slot: EquipSlot,
  confirmReplace?: boolean,
): ApplyEnchantResult {
  const enchantId = enchant.id;
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, enchantId, reason: 'not_held' };
  const { meta, e: p } = r;
  // An empty slot, or a slot wearing something else, denies with the same
  // not_held answer the bagged arm gives when no eligible copy is held.
  // Untrusted input: the client names a slot, the sim decides what is in it.
  if (meta.equipment[slot] !== itemId) {
    return { ok: false, itemId, enchantId, reason: 'not_held' };
  }
  // An ABSENT payload is a plain worn copy, which is enchantable (exactly like
  // a plain fungible bagged copy). A payload that isEnchantedInstance reads as
  // already enchanted: without the explicit confirmReplace flag that denies
  // with the dedicated already_enchanted reason (#2415: the honest message,
  // not the old misleading not_held), and WITH it the worn copy is replaced in
  // place. A signed or masterwork payload is neither, and stays eligible for
  // the plain arm; the slot discriminator means the player named this exact
  // copy, so the flag never has to pick a victim here.
  const worn = meta.equipmentInstance?.[slot];
  const replacing = worn !== undefined && isEnchantedInstance(worn);
  if (replacing) {
    // Strict boolean-true, the same house rule the dispatch and the bagged
    // arm apply: the resolver is the authoritative re-validation layer, so a
    // truthy non-boolean from any future non-WS caller must read as
    // unconfirmed here too, never as consent to destroy.
    if (confirmReplace !== true) {
      return { ok: false, itemId, enchantId, reason: 'already_enchanted' };
    }
    // Re-applying the identical enchant id is denied outright rather than
    // confirmed: its accept would be pure reagent loss with zero state change.
    if (worn.enchant === enchantId) {
      return { ok: false, itemId, enchantId, reason: 'same_enchant' };
    }
    // Defensive, unreachable on honest data (enchant ids are frozen
    // content-as-code): a marker id that no longer resolves cannot be
    // subtracted exactly, so the copy stays refused instead of stacking the
    // old bonus under the new one. Only a hand-edited save can get here.
    if (worn.enchant !== undefined && !ENCHANTS[worn.enchant]) {
      return { ok: false, itemId, enchantId, reason: 'already_enchanted' };
    }
  }
  for (const reagent of enchant.reagents) {
    if (ctx.countItem(reagent.itemId, pid) < reagent.count) {
      return { ok: false, itemId, enchantId, reason: 'insufficient_materials' };
    }
  }
  // Shared action throttle (action_throttle.ts), the same 10-per-60s budget the
  // bagged arm and crafting draw from, checked before anything is consumed.
  if (!withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, enchantId, reason: 'throttled' };
  }
  // NO #2350 bag-capacity gate on this arm, deliberately: nothing enters the
  // bags. The enchanted copy is rewritten in place on the worn slot and the
  // reagents only leave, so this action can never need a free bag slot. The
  // capacity gate belongs to the bagged arm alone, where the mint really does
  // land in the inventory.
  for (const reagent of enchant.reagents) ctx.removeItem(reagent.itemId, reagent.count, pid);
  meta.equipmentInstance ??= {};
  meta.equipmentInstance[slot] = replacing
    ? // The replace mint: old enchant peeled off exactly, new one applied,
      // every other payload layer byte-identical. The old enchant is destroyed
      // outright, no material refund (#2415 ruling).
      replacedEnchantPayloadFor(worn, enchant)
    : enchantedPayloadFor(worn, enchant);
  // Make the stat pipeline see it: recalcPlayerStats reads the per-slot
  // rolled.stats off equipmentInstance (entity.ts), which is the same read
  // items.ts equipItem re-bakes after moving a payload into that map, so an
  // in-place enchant has to re-bake exactly the same way. That call also rebuilds
  // the render mirror e.equippedInstances, which is what the server's `eqi`
  // identity-diff (server/game.ts identityFields + the cache.idJson compare)
  // picks up on the next snapshot: no extra dirty-marking is needed.
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  // Same skill gain as the bagged arm: the applied enchant's reagent-derived tier.
  grantEnchantingSkill(ctx, meta, enchantGainTier(enchant));
  return { ok: true, itemId, enchantId };
}

/** The #2415 bagged replace arm: resolve one CONFIRMED apply onto the pinned
 *  already-enchanted victim copy of `itemId` (replaceVictimIndex: the
 *  highest-index enchanted copy, the same end-first order every remover in
 *  this repo walks). Reached only from resolveApplyEnchant below, which has
 *  already cleared the shared unknown_item/unknown_enchant/wrong_slot gates,
 *  proven an enchanted copy is held, and seen the explicit confirmReplace
 *  flag. Gate order mirrors the plain arm one for one: target validity
 *  (same_enchant, plus the defensive unknown-old-marker refuse), reagents
 *  all-or-nothing, the shared action throttle, then the #2350 capacity gate,
 *  every deny side-effect-free. The gate and the live removal share ONE
 *  victim walk (consumeEnchantedVictim) and ONE mint transform
 *  (replacedEnchantPayloadFor), so neither can drift from what is actually
 *  consumed and granted (#2139). The old enchant is destroyed outright, no
 *  material refund; signer, masterwork stats, and boundTo/bindOnTrade carry
 *  through byte-identical; the skill gain and throttle stamp are exactly the
 *  plain apply's (replacement is just an apply: off-wheel, no fee ladder). */
function resolveReplaceEnchantBagged(
  ctx: SimContext,
  pid: number,
  itemId: string,
  enchant: EnchantDef,
): ApplyEnchantResult {
  const enchantId = enchant.id;
  // ctx.resolve, NOT ctx.players.get: this arm splices meta.inventory directly
  // (consumeEnchantedVictim) but mints through ctx.addItemInstance, which
  // no-ops unless resolve finds BOTH the meta and the entity. Guarding on the
  // meta alone would let a meta-without-entity state destroy the victim and
  // mint nothing. The plain arm cannot lose that way (its removal and its mint
  // both fail through the same resolve), and the worn arm already resolves;
  // this makes the third arm match. Unreachable on the shipped path, but
  // resolveApplyEnchant is exported and called with a raw pid by tests and any
  // future host.
  const meta = ctx.resolve(pid)?.meta;
  const victimIdx = meta ? replaceVictimIndex(meta.inventory, itemId) : -1;
  const victim = meta && victimIdx >= 0 ? meta.inventory[victimIdx].instance : undefined;
  // Unreachable (the caller proved an enchanted copy is held), kept as the
  // honest deny for a torn intermediate state rather than a crash.
  if (!meta || !victim) return { ok: false, itemId, enchantId, reason: 'not_held' };
  // Re-applying the identical enchant id is denied outright rather than
  // confirmed: its accept would be pure reagent loss with zero state change.
  // A legacy pre-marker victim has no id to compare, so it never denies here.
  if (victim.enchant === enchantId) {
    return { ok: false, itemId, enchantId, reason: 'same_enchant' };
  }
  // Defensive, unreachable on honest data (enchant ids are frozen
  // content-as-code): a marker id that no longer resolves cannot be
  // subtracted exactly, so the copy stays refused instead of stacking the old
  // bonus under the new one. Only a hand-edited save can get here.
  if (victim.enchant !== undefined && !ENCHANTS[victim.enchant]) {
    return { ok: false, itemId, enchantId, reason: 'already_enchanted' };
  }
  for (const reagent of enchant.reagents) {
    if (ctx.countItem(reagent.itemId, pid) < reagent.count) {
      return { ok: false, itemId, enchantId, reason: 'insufficient_materials' };
    }
  }
  // Shared action throttle (action_throttle.ts): the same 10-per-60s budget
  // every enchanting arm draws from, checked before anything is consumed.
  if (!withinActionThrottle(meta, ctx.time)) {
    return { ok: false, itemId, enchantId, reason: 'throttled' };
  }
  // #2350 capacity gate. Replacement is nearly always net-neutral (one copy
  // out, one copy in, reagents only leave), but not provably: the victim can
  // sit in a surviving multi-unit stack (identical enchanted copies merged),
  // in which case the replaced copy needs its own home. Model the removals
  // with the SAME walks the live path runs below and pre-fit the SAME mint.
  const scratch = meta.inventory.map((s) => ({ ...s }));
  // The `?? victim` arm is unreachable (scratch is a content-identical copy of
  // the array the peek above found the victim in) and deliberately kept as the
  // safe direction: were it ever taken, the gate would model the mint without
  // modeling the removal, which under-counts free space and denies MORE.
  const scratchVictim = consumeEnchantedVictim(scratch, itemId) ?? victim;
  for (const reagent of enchant.reagents) removeStacked(scratch, reagent.itemId, reagent.count);
  if (
    countFit(
      scratch,
      bagCapacity(meta.bags),
      itemId,
      1,
      replacedEnchantPayloadFor(scratchVictim, enchant),
    ) < 1
  ) {
    return { ok: false, itemId, enchantId, reason: 'no_bag_space' };
  }
  const consumed = consumeEnchantedVictim(meta.inventory, itemId);
  // Deny rather than mint when nothing was consumed. Note what this does and
  // does NOT cover: consumeEnchantedVictim returns undefined ONLY from its
  // no-victim-found arm, which is before it touches the array, so today this
  // is a clean pre-mutation bail. It is NOT a guard against a future helper
  // that mutates and then returns undefined: that shape would already have
  // destroyed the copy by the time we get here, and this return would skip the
  // mint, losing the item rather than duping it. Any such change has to keep
  // the removal and the mint atomic here, not lean on this line.
  if (!consumed) return { ok: false, itemId, enchantId, reason: 'not_held' };
  ctx.onInventoryChangedForQuests(meta);
  for (const reagent of enchant.reagents) ctx.removeItem(reagent.itemId, reagent.count, pid);
  // silent + callerLogs, exactly like the plain apply mint below: the
  // enchantResult event fires its own dedicated cue (audio.enchant in
  // src/game/audio.ts) and logs the one enchant line. This mint re-grants the
  // player's OWN copy, so the hub's "You receive:" line told them they had
  // received an item that never left their bags (#2430).
  ctx.addItemInstance(itemId, replacedEnchantPayloadFor(consumed, enchant), pid, 1, {
    silent: true,
    callerLogs: true,
  });
  // Quality-tiered gain: the applied enchant's reagent-derived tier, exactly
  // like the plain arms (also stamps the shared throttle).
  grantEnchantingSkill(ctx, meta, enchantGainTier(enchant));
  return { ok: true, itemId, enchantId };
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
 *  (#1712 round-3 review).
 *
 *  `slot` selects the WORN arm instead (resolveApplyEnchantWorn above): the copy
 *  equipped in that exact equipment slot is enchanted in place, so worn gear
 *  needs no unequip / enchant / re-equip round trip. Omitted, this resolves
 *  against the bags exactly as before.
 *
 *  `confirmReplace` (#2415) is the explicit consent that unlocks replacing an
 *  EXISTING enchant: with it set and an already-enchanted copy held (worn, or
 *  the pinned bagged victim), the old enchant is destroyed and the new one
 *  applied surgically (resolveReplaceEnchantBagged / the worn replace arm).
 *  Without it, an enchanted-only target denies with the dedicated
 *  already_enchanted reason, never a silent overwrite. The flag is inert when
 *  an unenchanted eligible copy exists and no enchanted one does: consent to
 *  destroy is meaningless when nothing would be destroyed, so the plain arm
 *  proceeds (this also keeps a confirmed command race-safe when the enchanted
 *  copy left the bags between dialog and accept: it falls back to a deny or a
 *  destroy-nothing apply, never a surprise overwrite of a different copy).
 *  The converse is NOT symmetric and is deliberate: when BOTH an enchanted and
 *  an unenchanted copy of the item id are held, the flag still routes to the
 *  replace arm, so a confirmed command destroys the enchant rather than
 *  quietly spending the free copy. The player asked for this specific copy in
 *  the picker (the replace row is the only sender of the flag), and silently
 *  redirecting a confirmed destroy onto a different copy would be the bigger
 *  surprise. */
export function resolveApplyEnchant(
  ctx: SimContext,
  pid: number,
  itemId: string,
  enchantId: string,
  slot?: EquipSlot,
  confirmReplace?: boolean,
): ApplyEnchantResult {
  const itemDef = ITEMS[itemId];
  if (!itemDef) return { ok: false, itemId, enchantId, reason: 'unknown_item' };
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return { ok: false, itemId, enchantId, reason: 'unknown_enchant' };
  // The slot-kind gate is shared by both arms: an item declares its slot KIND
  // ('ring' for either finger, 'mainhand' for a one-hand weapon worn in either
  // hand), which is what an enchant's itemSlot names.
  if (itemDef.slot !== enchant.itemSlot) {
    return { ok: false, itemId, enchantId, reason: 'wrong_slot' };
  }
  if (slot) return resolveApplyEnchantWorn(ctx, pid, itemId, enchant, slot, confirmReplace);
  // The bagged eligibility split (#2415): countItem sees every bagged copy,
  // countEnchantableItem only the not-yet-enchanted ones, so the difference
  // is the enchanted holding. Confirmed replace targets that holding; the
  // no-flag deny names the real cause (already_enchanted vs not_held) instead
  // of collapsing both into the old misleading not_held.
  const enchantableHeld = ctx.countEnchantableItem(itemId, pid);
  const enchantedHeld = ctx.countItem(itemId, pid) - enchantableHeld;
  if (confirmReplace === true && enchantedHeld >= 1) {
    return resolveReplaceEnchantBagged(ctx, pid, itemId, enchant);
  }
  if (enchantableHeld < 1) {
    return {
      ok: false,
      itemId,
      enchantId,
      reason: enchantedHeld >= 1 ? 'already_enchanted' : 'not_held',
    };
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
  // #2350 capacity gate: the freshly-enchanted instance must fit AFTER the
  // consumed copy and every reagent leave, so model all of it on a scratch
  // copy: the victim via consumeOneScratch (the isEnchantedInstance exclusion
  // mirrors removeEnchantableItem's victim order, and the not_held gate above
  // already proved an eligible copy exists), the reagents via removeStacked
  // (the removeItem walk), and the grant via the SAME enchantedPayloadFor the
  // success path mints below, so a byte-equal enchanted stack with room still
  // counts as fitting. Denies with no side effect and draws nothing.
  if (meta) {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    const victim = consumeOneScratch(scratch, itemId, isEnchantedInstance);
    for (const reagent of enchant.reagents) removeStacked(scratch, reagent.itemId, reagent.count);
    if (
      countFit(scratch, bagCapacity(meta.bags), itemId, 1, enchantedPayloadFor(victim, enchant)) < 1
    ) {
      return { ok: false, itemId, enchantId, reason: 'no_bag_space' };
    }
  }
  const [consumed] = ctx.removeEnchantableItem(itemId, 1, pid);
  for (const reagent of enchant.reagents) ctx.removeItem(reagent.itemId, reagent.count, pid);
  // The minted payload: the consumed copy's markers plus the enchant's
  // additive bonus and marker (enchantedPayloadFor above, shared with the
  // capacity gate).
  const merged = enchantedPayloadFor(consumed, enchant);
  // silent + callerLogs: the enchantResult event fires its own dedicated cue
  // (audio.enchant in src/game/audio.ts) and logs the one enchant line. This
  // mint re-grants the player's OWN copy, so the hub's "You receive:" line
  // told them they had received an item that never left their bags (#2430).
  ctx.addItemInstance(itemId, merged, pid, 1, { silent: true, callerLogs: true });
  // Quality-tiered gain: the applied enchant's reagent-derived tier.
  if (meta) grantEnchantingSkill(ctx, meta, enchantGainTier(enchant));
  return { ok: true, itemId, enchantId };
}

/** Command entry point, same shape as disenchantItem/salvageItem above.
 *  `slot`, when present, names the WORN equipment slot to enchant in place;
 *  `confirmReplace` is the #2415 explicit consent to replace an existing
 *  enchant (see resolveApplyEnchant). */
export function applyEnchant(
  ctx: SimContext,
  itemId: string,
  enchantId: string,
  pid?: number,
  slot?: EquipSlot,
  confirmReplace?: boolean,
): ApplyEnchantResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, enchantId, reason: 'unknown_item' };
  return resolveApplyEnchant(ctx, r.meta.entityId, itemId, enchantId, slot, confirmReplace);
}
