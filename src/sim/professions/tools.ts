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

import type { GatheringProfessionId } from '../content/professions';
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
