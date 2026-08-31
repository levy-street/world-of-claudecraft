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
    // A set's piece count is its number of distinct SLOTS: the normal item, its
    // auto-generated heroic variant, and any bespoke heroic raid piece for the same
    // slot are all one collectible piece (you wear one helmet). Keying on slot keeps
    // the "X/N" denominator honest, not an inflated count from the parallel
    // heroic-variant ids.
    members.add(item.slot ?? item.id);
    membersBySet.set(item.set, members);
  }
  // Lineage families climb ONE cross-tier ladder (content/item_sets.ts), so
  // their denominator is the SLOT UNION across the whole lineage: every
  // member family reads the same X/7-style total the ladder can actually
  // reach, instead of its own four slots hiding the 6-piece capstone.
  const slotsByLineage = new Map<string, Set<string>>();
  for (const [setId, members] of membersBySet) {
    const lineage = ITEM_SETS[setId]?.lineage;
    if (lineage === undefined) continue;
    const union = slotsByLineage.get(lineage) ?? new Set<string>();
    for (const slot of members) union.add(slot);
    slotsByLineage.set(lineage, union);
  }
  return Object.fromEntries(
    [...membersBySet].map(([setId, members]) => {
      const lineage = ITEM_SETS[setId]?.lineage;
      const size =
        lineage === undefined ? members.size : (slotsByLineage.get(lineage)?.size ?? members.size);
      return [setId, size];
    }),
  );
}

/** Worn pieces for the tooltip's have-of-total header: the set's own worn
 *  count, or the summed count across its lineage (tier-1 and tier-2 pieces
 *  climb one ladder, so the header and the lit tiers must count them
 *  together, exactly like aggregateSetBonuses). */
export function equippedSetTooltipPieces(
  setId: string,
  equippedIds: Iterable<string | null | undefined>,
): number {
  const lineage = ITEM_SETS[setId]?.lineage;
  let n = 0;
  for (const id of equippedIds) {
    if (!id) continue;
    const wornSet = ITEMS[id]?.set;
    if (wornSet === undefined) continue;
    if (wornSet === setId || (lineage !== undefined && ITEM_SETS[wornSet]?.lineage === lineage)) {
      n += 1;
    }
  }
  return n;
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
