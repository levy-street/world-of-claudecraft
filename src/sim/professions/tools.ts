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
  /** How this slot's effect fires. Defaults to 'always' (see slotEffect). */
  confirmMode: ToolEffectConfirmMode;
}

// Attaches an effect from the catalog to a tool, at its full starting
// durability. Re-slotting (calling this again) always resets to full charges,
// same as installing a fresh effect. `confirmMode` defaults to 'always' so a
// caller that never touches the new config gets #1136's exact prior behavior.
export function slotEffect(
  effectId: ToolEffectId,
  confirmMode: ToolEffectConfirmMode = 'always',
): ToolEffectSlot {
  return { effectId, durability: TOOL_EFFECTS[effectId].startingDurability, confirmMode };
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

// Rolls whether this use depletes the slotted effect by one charge. Depletion
// is PROBABILISTIC (per the effect's `depletionChance`), not a flat -1 per
// use, so every decrement goes through `Rng.chance` (never Math.random): the
// draw always happens (even at durability 0, where it is a no-op) so calling
// this in a fixed order across a fixed rng seed always produces the same
// depletion sequence, independent of an effect's remaining charges. Mutates
// `slot.durability` in place and returns whether it decremented this call.
export function depleteEffect(slot: ToolEffectSlot | undefined, rng: Rng): boolean {
  if (!slot) return false;
  const def = TOOL_EFFECTS[slot.effectId];
  const rolled = rng.chance(def.depletionChance);
  if (rolled && slot.durability > 0) {
    slot.durability -= 1;
    return true;
  }
  return false;
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

// The always/prompt-on-use confirmation gate (#1138). This is the ONE call
// site a harvest/craft outcome path should use to apply a slotted effect: it
// wraps `applyEffectBonus` + `depleteEffect` behind the slot's `confirmMode`,
// so callers never need to hand-roll the gate.
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
export function resolveToolEffectUse(
  slot: ToolEffectSlot | undefined,
  outcome: HarvestOutcome,
  rng: Rng,
  confirmed: boolean,
): ToolEffectUseResult {
  if (!slot) return { outcome, depleted: false, applied: false };
  if (slot.confirmMode === 'prompt' && !confirmed) {
    return { outcome, depleted: false, applied: false };
  }
  const bonused = applyEffectBonus(slot, outcome);
  const depleted = depleteEffect(slot, rng);
  return { outcome: bonused, depleted, applied: true };
}

// INTEGRATION NOTE (#1136, extended by #1138): the node-harvest outcome path
// (#1121) and the recipe-crafting outcome path (#1127) are not present on
// this branch (this branch is stacked directly on #1135, the crafted-tool-
// tiers PR), so there is no live call site to wire `resolveToolEffectUse`
// into yet. Once either lands, its outcome-producing function should: build
// the base HarvestOutcome, then call `resolveToolEffectUse(slot, outcome,
// rng, confirmed)` using the SAME `Rng` the caller already draws from (never
// a fresh one) so the depletion roll (when it fires) takes its place in the
// one shared draw order. `confirmed` should come from the player's client
// request for a 'prompt' slot (see the tool/effect UI toggle); a caller with
// no confirmation flow yet can pass `true` unconditionally, which is
// equivalent to every slot behaving as 'always'.
