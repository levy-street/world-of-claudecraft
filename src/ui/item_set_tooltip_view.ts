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

export type ItemSetBonusField = 'bonus2' | 'bonus3' | 'bonus4' | 'bonus5';

export function itemSetBonusField(pieces: number): ItemSetBonusField | null {
  switch (pieces) {
    case 2:
      return 'bonus2';
    case 3:
      return 'bonus3';
    case 4:
      return 'bonus4';
    case 5:
      return 'bonus5';
    default:
      return null;
  }
}

export function itemSetMemberCounts(): Record<string, number> {
  const membersBySet = new Map<string, Set<string>>();
  for (const item of Object.values(ITEMS)) {
    if (!item.set) continue;
    const members = membersBySet.get(item.set) ?? new Set<string>();
    // A set's piece count is its number of distinct SLOTS: the normal item, its
    // auto-generated heroic variant, and any bespoke heroic raid piece for the same
    // slot are all one collectible piece (you wear one helmet). Keying on slot keeps
    // the "X/N" denominator honest (e.g. the 4-slot t2 sets read /4, not an inflated
    // count from the parallel heroic-variant ids).
    members.add(item.slot ?? item.id);
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
