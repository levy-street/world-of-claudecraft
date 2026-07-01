import type { GatheringProfessionId, InvSlot, ItemDef } from '../types';

export type GatheringToolGateReason = 'invalid-tier' | 'missing-tool' | 'insufficient-tier';

export interface GatheringToolGateResult {
  canGather: boolean;
  profession: GatheringProfessionId;
  requiredTier: number;
  toolTier: number;
  reason?: GatheringToolGateReason;
}

function normalizedTier(tier: number): number {
  return Number.isFinite(tier) ? Math.floor(tier) : 0;
}

export function gatheringToolTier(
  item: ItemDef | undefined,
  profession: GatheringProfessionId,
): number {
  const tool = item?.gatheringTool;
  if (item?.kind !== 'tool' || !tool || tool.profession !== profession) return 0;
  return Math.max(0, normalizedTier(tool.tier));
}

export function gatheringToolDurabilityCost(item: ItemDef | undefined): number {
  const tool = item?.gatheringTool;
  if (item?.kind !== 'tool' || !tool) return 0;
  return tool.infiniteDurability ? 0 : 1;
}

export function bestGatheringToolTier(
  inventory: readonly InvSlot[],
  items: Readonly<Record<string, ItemDef>>,
  profession: GatheringProfessionId,
): number {
  let best = 0;
  for (const slot of inventory) {
    if (slot.count <= 0) continue;
    best = Math.max(best, gatheringToolTier(items[slot.itemId], profession));
  }
  return best;
}

export function canGatherMaterialTier(
  inventory: readonly InvSlot[],
  items: Readonly<Record<string, ItemDef>>,
  profession: GatheringProfessionId,
  materialTier: number,
): GatheringToolGateResult {
  const requiredTier = normalizedTier(materialTier);
  const toolTier = bestGatheringToolTier(inventory, items, profession);
  if (requiredTier <= 0) {
    return { canGather: false, profession, requiredTier, toolTier, reason: 'invalid-tier' };
  }
  if (toolTier <= 0) {
    return { canGather: false, profession, requiredTier, toolTier, reason: 'missing-tool' };
  }
  if (toolTier < requiredTier) {
    return { canGather: false, profession, requiredTier, toolTier, reason: 'insufficient-tier' };
  }
  return { canGather: true, profession, requiredTier, toolTier };
}
