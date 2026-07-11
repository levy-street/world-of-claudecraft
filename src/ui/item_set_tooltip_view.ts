import { ITEM_SETS, ITEMS } from '../sim/data';

export interface ItemSetTooltipTier {
  pieces: number;
  active: boolean;
}

export interface ItemSetTooltipModel {
  setId: string;
  equippedPieces: number;
  totalPieces: number;
  bonusTiers: ItemSetTooltipTier[];
}

export function itemSetMemberCounts(): Record<string, number> {
  const membersBySet = new Map<string, Set<string>>();
  for (const item of Object.values(ITEMS)) {
    if (!item.set) continue;
    const members = membersBySet.get(item.set) ?? new Set<string>();
    members.add(item.heroicOf ?? item.id);
    membersBySet.set(item.set, members);
  }
  return Object.fromEntries([...membersBySet].map(([setId, members]) => [setId, members.size]));
}

export function itemSetTooltipModel(args: {
  itemSetId: string;
  equippedPieces: number;
  itemSetMembers?: Record<string, number>;
}): ItemSetTooltipModel | null {
  const set = ITEM_SETS[args.itemSetId];
  if (!set) return null;
  const totalPieces = args.itemSetMembers?.[set.id] ?? 0;
  const reachablePieces =
    totalPieces > 0
      ? totalPieces
      : set.bonuses.reduce((max, tier) => Math.max(max, tier.pieces), 0);
  return {
    setId: set.id,
    equippedPieces: args.equippedPieces,
    totalPieces: reachablePieces,
    bonusTiers: set.bonuses
      .filter((tier) => tier.pieces <= reachablePieces)
      .map((tier) => ({ pieces: tier.pieces, active: args.equippedPieces >= tier.pieces })),
  };
}
