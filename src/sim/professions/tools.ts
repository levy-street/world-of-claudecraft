// Gathering tool tier gating (#1123, extended by #1135). A base gathering
// tool has a tier; the tool's tier gates which node tiers AND which monster
// material tiers it can gather/harvest, via one shared comparator. This
// module is a pure leaf: no SimContext state, just the comparison +
// item-shape helpers, so it is Vitest-importable directly (like
// threat.ts/spatial.ts).
//
// This repo has no durability mechanic anywhere in ItemDef (see types.ts):
// a base gathering tool never carries a durability field, so it can never
// become unusable from durability loss. That is a property of the item shape,
// not something this module enforces at runtime.

import {
  type GatheringProfessionId,
  TOOL_EFFECTS,
  type ToolEffectId,
} from '../content/professions';
import type { Rng } from '../rng';
import type { ItemDef, ItemUse } from '../types';
import type { MaterialRarity } from './gathering';
import { type CraftSkillState, rechargeDiscountMultiplier } from './wheel';

export interface GatherToolUse {
  type: 'gatherTool';
  professionId: GatheringProfessionId;
  tier: number;
}

export function isGatherToolUse(use: ItemUse | undefined): use is GatherToolUse {
  return !!use && use.type === 'gatherTool';
}

// Returns the tool's gathering tier, or undefined if the item is not a
// gathering tool for the given profession.
export function gatherToolTier(
  item: ItemDef | undefined,
  professionId: GatheringProfessionId,
): number | undefined {
  if (!item?.use || !isGatherToolUse(item.use)) return undefined;
  if (item.use.professionId !== professionId) return undefined;
  return item.use.tier;
}

// Shared pure comparator (#1135): a tool of a given tier covers its own tier and
// every tier below it, never above. Both node gating and monster-material
// gating reuse this single comparison so the semantics can never drift apart.
function toolTierCovers(toolTier: number, targetTier: number): boolean {
  return toolTier >= targetTier;
}

// True only when the player's tool tier is at least the node/material tier:
// a tier-1 tool cannot gather a tier-2+ node, a tier-2 tool can gather tier 1
// and tier 2, and so on. A tool's rarity (ItemDef `quality`) never enters this
// check: rarity is cosmetic/value only (#1135), gating is tier-only.
export function canGatherTier(playerToolTier: number, nodeTier: number): boolean {
  return toolTierCovers(playerToolTier, nodeTier);
}

// True only when the player's tool tier is at least the monster material's
// tier (#1135): e.g. skinning/harvesting a material off a slain monster. Same
// semantics as `canGatherTier`, reusing the one shared comparator so node
// gating and monster-material gating can never fall out of sync.
export function canHarvestMonsterMaterial(toolTier: number, materialTier: number): boolean {
  return toolTierCovers(toolTier, materialTier);
}

// Tool effect slotting (#1136). Durability is modeled as a standalone counter
// on a `ToolEffectSlot`, NOT as an `ItemDef`/item-instance field: this repo has
// no per-instance item payload merged anywhere near this branch (the closest
// candidate, #1165's item-instance charges, lives on a history that diverged
// long before this base and would drag in an unrelated inventory model for a
// bonus this module can track on its own). A slot is plain data the caller
// (a future per-tool-instance record, e.g. keyed by playerId+professionId, or
// a per-node harvest call site) owns and passes in; this module never stores
// slot state itself, keeping it a pure leaf like the rest of the file.
// Always-or-prompt-on-use configuration (#1138): a high-value slotted effect
// spends a charge every use it fires. 'always' preserves #1136's original
// baseline (fires and spends every use, no gate). 'prompt' means the player
// must explicitly confirm each use before it is allowed to fire and spend a
// charge; an unconfirmed use skips the effect entirely (no bonus, no charge
// spent) while the underlying harvest/craft action still proceeds.
export type ToolEffectConfirmMode = 'always' | 'prompt';

export interface ToolEffectSlot {
  effectId: ToolEffectId;
  /** Remaining charges. Reaches 0 when the effect is fully depleted. */
  durability: number;
  /**
   * Player id of whoever produced this effect via the production craft that
   * made it (#1137). Additive and optional: undefined means either no
   * identity was recorded, or the slot predates this field. Recharging
   * (below) reads this only to decide the original-crafter discount; it
   * never gates the base tool or the bonus itself.
   */
  craftedBy?: string;
  /** How this slot's effect fires. Defaults to 'always' (see slotEffect). */
  confirmMode: ToolEffectConfirmMode;
}

// Attaches an effect from the catalog to a tool, at its full starting
// durability. Re-slotting (calling this again) always resets to full charges,
// same as installing a fresh effect. `craftedBy` (#1137) records the player
// id of the production craft that made this effect, if known; omit it when no
// identity is available (the slot is then never eligible for the
// original-crafter recharge discount). `confirmMode` (#1138) defaults to
// 'always' so a caller that never touches the new config gets #1136's exact
// prior behavior. Keyword options (not positional) so a future third option
// can't silently rebind an existing one.
export function slotEffect(
  effectId: ToolEffectId,
  options: { craftedBy?: string; confirmMode?: ToolEffectConfirmMode } = {},
): ToolEffectSlot {
  const { craftedBy, confirmMode = 'always' } = options;
  return {
    effectId,
    durability: TOOL_EFFECTS[effectId].startingDurability,
    craftedBy,
    confirmMode,
  };
}

// The outcome shape a harvest/craft action produces. `quantity`/`quality` are
// plain counts; `respawnTicks` is how many ticks until the node/resource can
// be harvested again (lower is faster). Kept minimal and host-agnostic so
// this module has no dependency on the node/harvest system that eventually
// calls it (see the integration note below).
export interface HarvestOutcome {
  quantity: number;
  quality: number;
  respawnTicks: number;
}

// Pure: returns a NEW outcome with the slotted effect's bonus applied, or the
// SAME outcome (by value, unchanged) when there is no slot or its durability
// has reached 0. The base tool's own tier/gating (canGatherTier /
// canHarvestMonsterMaterial above) is untouched either way: a depleted effect
// never blocks the base tool, it just stops contributing its bonus.
export function applyEffectBonus(
  slot: ToolEffectSlot | undefined,
  outcome: HarvestOutcome,
): HarvestOutcome {
  if (!slot || slot.durability <= 0) return outcome;
  const def = TOOL_EFFECTS[slot.effectId];
  switch (def.kind) {
    case 'quantity':
      return { ...outcome, quantity: outcome.quantity + def.bonus };
    case 'quality':
      return { ...outcome, quality: outcome.quality + def.bonus };
    case 'respawnSpeed':
      return { ...outcome, respawnTicks: Math.max(1, outcome.respawnTicks - def.bonus) };
  }
}

// Rarity-scaled effect durability consumption curve (#1139). The standard
// rarity ladder (MaterialRarity: common/uncommon/rare/epic/legendary, see
// gathering.ts) orders both a tool's own rarity (ItemDef `quality`) and the
// rarity of the target being worked (a harvested material's rolled rarity, a
// node's rarity, or any future rarity-bearing target). This fixed order is
// the only input to the consumption roll below.
const RARITY_ORDER: readonly MaterialRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function rarityTierIndex(rarity: MaterialRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

// Chance floor: even a tool many tiers above its target still spends a charge
// sometimes, so a high-end tool never becomes fully "free" against trash
// targets.
export const CONSUMPTION_CHANCE_FLOOR = 0.1;

// Chance lost per tier of gap between the tool's rarity and the (lower)
// target's rarity. Tuned to the issue's worked example for an epic tool:
//   epic vs epic   (tierGap 0, tool NOT above target): 100% (1 - 0.4*0, but
//                    clamped to 1 below since a non-positive gap always consumes)
//   epic vs rare   (tierGap 1): 1 - 0.4*1 = 0.6  (60%)
//   epic vs common (tierGap 3): 1 - 0.4*3 = -0.2, floored to 0.1 (10%)
// A two-tier gap (e.g. epic vs uncommon) lands at 1 - 0.4*2 = 0.2 (20%),
// interpolating smoothly between the worked example's anchor points.
const CONSUMPTION_CHANCE_STEP = 0.4;

// Pure: the chance a single use spends one durability charge, given the
// tool's rarity and the rarity of what it is being used on. Against an
// equal-or-higher-rarity target (tierGap <= 0) a charge is ALWAYS spent: the
// curve only ever discounts consumption when the tool outclasses its target,
// never the reverse. See the worked example above for the anchor values this
// formula was tuned against.
export function effectConsumptionChance(
  toolRarity: MaterialRarity,
  targetRarity: MaterialRarity,
): number {
  const tierGap = rarityTierIndex(toolRarity) - rarityTierIndex(targetRarity);
  if (tierGap <= 0) return 1;
  return Math.max(CONSUMPTION_CHANCE_FLOOR, 1 - CONSUMPTION_CHANCE_STEP * tierGap);
}

// Rolls whether this use depletes the slotted effect by one charge. Depletion
// is PROBABILISTIC (per `effectConsumptionChance(toolRarity, targetRarity)`),
// not a flat -1 per use, so every decrement goes through `Rng.chance` (never
// Math.random): the draw always happens (even at durability 0, where it is a
// no-op) so calling this in a fixed order across a fixed rng seed always
// produces the same depletion sequence, independent of an effect's remaining
// charges. Mutates `slot.durability` in place and returns whether it
// decremented this call.
export function depleteEffect(
  slot: ToolEffectSlot | undefined,
  toolRarity: MaterialRarity,
  targetRarity: MaterialRarity,
  rng: Rng,
): boolean {
  if (!slot) return false;
  const rolled = rng.chance(effectConsumptionChance(toolRarity, targetRarity));
  if (rolled && slot.durability > 0) {
    slot.durability -= 1;
    return true;
  }
  return false;
}

// Effect recharge (#1137). A depleted (or partially depleted) effect can be
// restored to full durability by recharging it through the production craft
// that made it, or through a generic Enchanter/Scribe. Recharging through the
// effect's ORIGINAL crafter (the `craftedBy` recorded on the slot at
// `slotEffect` time) is cheaper and faster than a generic recharge: this is
// the whole point of recording `craftedBy` on the slot. Both costs are fixed
// multiples of the same base cost, so the discount can never invert.
export interface RechargeCost {
  /** Crafting materials consumed by the recharge. */
  materials: number;
  /** Ticks (20 Hz) the recharge takes to complete. */
  ticks: number;
}

// Base cost for a generic Enchanter/Scribe recharge, before the
// original-crafter discount is considered.
const RECHARGE_BASE_MATERIALS = 4;
const RECHARGE_BASE_TICKS = 20 * 30; // 30 seconds

// The original crafter pays half the materials and half the time of a
// generic recharge. Kept as one named fraction so both halves of the
// discount can never drift apart.
const ORIGINAL_CRAFTER_DISCOUNT = 0.5;

// True only when the slot recorded who crafted the effect AND that identity
// matches the player attempting the recharge. A slot with no recorded
// `craftedBy` (an effect slotted before #1137, or with no known crafter) is
// never eligible for the discount, so it always costs the generic rate.
export function isOriginalCrafter(slot: ToolEffectSlot, rechargerId: string): boolean {
  return slot.craftedBy !== undefined && slot.craftedBy === rechargerId;
}

// Pure: the materials/time a recharge of this slot would cost `rechargerId`.
// Strictly less for the original crafter than for anyone else (a generic
// Enchanter/Scribe), on both dimensions.
//
// Specialization recharge discount (#1134): when `rechargerId` is also the
// original crafter AND `rechargerSkills` shows them specialized in the
// effect's craft (`TOOL_EFFECTS[slot.effectId].craftId`, per
// ../content/professions.ts), an ADDITIONAL discount from
// `rechargeDiscountMultiplier` (wheel.ts) composes with (multiplies into,
// never replaces) the existing original-crafter discount. A non-original
// recharger never sees this discount even if `rechargerSkills` shows them
// specialized: the perk is specifically for recharging one's OWN work.
// `rechargerSkills` is optional and defaults to empty (no specialization),
// so existing #1137 call sites that don't yet pass it behave unchanged.
export function rechargeCost(
  slot: ToolEffectSlot,
  rechargerId: string,
  rechargerSkills: CraftSkillState = {},
): RechargeCost {
  const isOriginal = isOriginalCrafter(slot, rechargerId);
  let discount = isOriginal ? ORIGINAL_CRAFTER_DISCOUNT : 1;
  if (isOriginal) {
    const craftId = TOOL_EFFECTS[slot.effectId].craftId;
    discount *= rechargeDiscountMultiplier(rechargerSkills, craftId);
  }
  return {
    materials: Math.ceil(RECHARGE_BASE_MATERIALS * discount),
    ticks: Math.ceil(RECHARGE_BASE_TICKS * discount),
  };
}

export interface RechargeResult {
  /** False when `materialsProvided` did not cover the computed cost. */
  success: boolean;
  cost: RechargeCost;
}

// Attempts to recharge `slot` for `rechargerId`, consuming
// `materialsProvided`. On success, durability is restored to the effect's
// full starting value (same as a fresh `slotEffect`) so `applyEffectBonus`
// resumes applying its bonus immediately; `craftedBy` is left untouched, so a
// recharge never changes who the slot's original crafter is. On failure
// (insufficient materials) the slot is not mutated at all. The caller is
// responsible for actually deducting `cost.materials` from the recharger's
// inventory and for gating `cost.ticks` as craft-time, same as any other
// production craft; this module only computes the cost and applies the
// durability restore.
export function rechargeEffect(
  slot: ToolEffectSlot,
  rechargerId: string,
  materialsProvided: number,
  rechargerSkills: CraftSkillState = {},
): RechargeResult {
  const cost = rechargeCost(slot, rechargerId, rechargerSkills);
  if (materialsProvided < cost.materials) {
    return { success: false, cost };
  }
  slot.durability = TOOL_EFFECTS[slot.effectId].startingDurability;
  return { success: true, cost };
}

// The outcome of attempting to use a slotted effect for one harvest/craft
// action, after the always/prompt-on-use gate (#1138) has been applied.
export interface ToolEffectUseResult {
  outcome: HarvestOutcome;
  /** True if depleteEffect actually decremented durability this call. */
  depleted: boolean;
  /** False only when a 'prompt' slot was not confirmed, so nothing fired. */
  applied: boolean;
}

// The always/prompt-on-use confirmation gate (#1138), extended for the
// rarity-scaled consumption curve (#1139). This is the ONE call site a
// harvest/craft outcome path should use to apply a slotted effect: it wraps
// `applyEffectBonus` + `depleteEffect` behind the slot's `confirmMode`, so
// callers never need to hand-roll the gate.
//
// - `confirmMode: 'always'` (the default from `slotEffect`): behaves EXACTLY
//   like #1136 before this issue existed. `confirmed` is ignored; the bonus
//   always applies and `depleteEffect` always rolls, in the same order as
//   before (`applyEffectBonus` first, then `depleteEffect` on the SAME rng).
// - `confirmMode: 'prompt'`: the caller must pass `confirmed: true`
//   (representing the player's explicit confirmation for this one use) or
//   nothing happens at all. No charge is spent AND no bonus is applied: the
//   base outcome passes through unchanged, and the base harvest/craft action
//   itself is unaffected either way (this function never touches it).
//
// `toolRarity`/`targetRarity` feed straight into `depleteEffect`'s rarity-gap
// consumption curve; `toolRarity` is the base tool's own `ItemDef.quality`,
// `targetRarity` is the rarity of whatever is being worked (e.g. the
// harvested material's `rollMaterialRarity` result).
export function resolveToolEffectUse(
  slot: ToolEffectSlot | undefined,
  outcome: HarvestOutcome,
  toolRarity: MaterialRarity,
  targetRarity: MaterialRarity,
  rng: Rng,
  confirmed: boolean,
): ToolEffectUseResult {
  if (!slot) return { outcome, depleted: false, applied: false };
  if (slot.confirmMode === 'prompt' && !confirmed) {
    return { outcome, depleted: false, applied: false };
  }
  const bonused = applyEffectBonus(slot, outcome);
  const depleted = depleteEffect(slot, toolRarity, targetRarity, rng);
  return { outcome: bonused, depleted, applied: true };
}

// INTEGRATION NOTE (#1136, extended by #1137 and #1138, consumption curve
// added by #1139): the node-harvest outcome path (#1121) is not present on
// this branch, so there is no live call site to wire
// `resolveToolEffectUse`/`rechargeEffect` into yet. Once it lands, its
// outcome-producing function should: build the
// base HarvestOutcome, then call `resolveToolEffectUse(slot, outcome,
// toolRarity, targetRarity, rng, confirmed)` using the SAME `Rng` the caller
// already draws from (never a fresh one) so the depletion roll (when it
// fires) takes its place in the one shared draw order. `confirmed` should
// come from the player's client request for a 'prompt' slot (see the
// tool/effect UI toggle); a caller with no confirmation flow yet can pass
// `true` unconditionally, which is equivalent to every slot behaving as
// 'always'. `rechargeEffect` (#1137) has the same no-live-call-site status:
// once a production/recharge UI action exists, it should deduct
// `cost.materials` from the recharger's inventory and gate `cost.ticks` as
// craft time before calling `rechargeEffect`.
