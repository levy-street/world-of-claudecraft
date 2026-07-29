// Pure, host-agnostic view model for the WARFARE quartermaster's shop window.
//
// The pure-core half of the pure-core + thin-consumer split (reference
// heroic_vendor_view.ts): it decides how the honor stock DIVIDES into sections,
// which offers the viewer already owns, which set bonus tiers are live, and how
// many more pieces the next unmet tier still wants. The DOM/i18n side lives in
// warfare_vendor_window.ts. DOM-free and i18n-free so
// tests/warfare_vendor_view.test.ts can drive it directly.
//
// Why this window exists at all: the ordinary vendor grid renders the whole stock
// as one flat list, with no indication that five of the families are sets and no
// grouping to buy a family from. The SECTIONING is the point of the window; the
// bonus text lives in the item tooltip, where every raid tier set already shows
// it (see the header of warfare_vendor_window.ts for what this deliberately does
// not paint, and why the tiers / ownedPieces / nextTier fields below survive
// anyway).

import type { ItemDef, ItemSet } from '../../../sim/types';
import type { IWorld } from '../../../world_api';

/** The five WARFARE armor families, in the order the shop lists them. Any set
 *  the stock carries that is NOT named here still gets a section, appended in
 *  first-seen order, so a sixth family cannot silently vanish from the shop. */
export const WARFARE_SHOP_SET_ORDER: readonly string[] = [
  'warfare_furyforged',
  'warfare_stormbound',
  'warfare_ashstalker',
  'warfare_cinderweave',
  'warfare_thornhide',
];

/** Section keys for the two non-set sections. Set sections key on their set id,
 *  so every key in one view is unique and safe to build a focus key from. */
export const WARFARE_SHOP_JEWELRY_KEY = 'jewelry';
export const WARFARE_SHOP_WEAPONS_KEY = 'weapons';

/** The NpcDef shape this window gates on. A FLAG, never a hard-coded npc id:
 *  the Heroic Quartermaster is keyed to a single id and a second one would have
 *  to widen that constant, which is the mistake this avoids. `id` is required so
 *  the parameter is not a weak type (an all-optional target refuses a source
 *  that shares no property with it), which also keeps the call sites honest. */
export interface WarfareVendorNpcFlags {
  id: string;
  warfareVendor?: boolean;
}

/** Whether talking to this NPC opens the sectioned WARFARE shop rather than the
 *  ordinary vendor grid. */
export function isWarfareVendorNpc(def: WarfareVendorNpcFlags | undefined): boolean {
  return !!def?.warfareVendor;
}

export interface WarfareShopOffer {
  itemId: string;
  item: ItemDef;
  /** Price in Honor for one purchase (Honor is never stack-multiplied). */
  honor: number;
  /** Advisory only: the purchase resolves server-side against the server's own
   *  stock and balance, and this window decides nothing. */
  affordable: boolean;
  /** True when the viewer already wears this piece or carries it in a bag, so
   *  the tile can mark it and a mis-tap re-buy is at least visible first. */
  owned: boolean;
}

export interface WarfareShopTier {
  pieces: number;
  /** True when the viewer has this many pieces EQUIPPED, which is the same
   *  claim the item tooltip's set block makes (itemSetTooltipModel): a bonus is
   *  live because it is WORN, never because it is owned. */
  met: boolean;
}

export interface WarfareShopNextTier {
  pieces: number;
  /** How many more pieces the viewer must OWN to reach this tier. Always >= 1. */
  remaining: number;
}

export interface WarfareShopSetSection {
  kind: 'set';
  /** The set id, which is also this section's unique key. */
  key: string;
  setId: string;
  offers: WarfareShopOffer[];
  /** Every authored tier the set can actually reach, ascending. Piece-count
   *  agnostic: no 2/3/4 literal anywhere, so the 2/4/7 breakpoints render. */
  tiers: WarfareShopTier[];
  /** Distinct SLOTS of this family the viewer owns (worn or bagged). Slots, not
   *  item ids, so a duplicate copy of one piece cannot inflate the progress. */
  ownedPieces: number;
  /** Distinct equipped pieces, the number the tiers above are decided on. */
  equippedPieces: number;
  totalPieces: number;
  /** The lowest tier the viewer does not yet own enough pieces for, and how many
   *  more to buy. Null once every tier is owned: the shop has nothing left to
   *  sell this family. */
  nextTier: WarfareShopNextTier | null;
}

export interface WarfareShopPlainSection {
  kind: 'jewelry' | 'weapons';
  key: string;
  offers: WarfareShopOffer[];
}

export type WarfareShopSection = WarfareShopSetSection | WarfareShopPlainSection;

export interface WarfareShopView {
  sections: WarfareShopSection[];
  /** The viewer's current Honor balance. */
  balance: number;
}

export interface WarfareShopViewer {
  honor: number;
  /** Item ids the viewer wears OR carries in a bag. See warfareShopViewer below
   *  for what "owns" deliberately does NOT cover (the bank). */
  ownedItemIds: ReadonlySet<string>;
  /** Item ids the viewer currently wears. */
  equippedItemIds: ReadonlySet<string>;
  /** Distinct-slot member count per set id (itemSetMemberCounts). A set with no
   *  row here falls back to the distinct slots this shop actually sells, so the
   *  denominator is never zero and never invented. */
  setMemberCounts?: Readonly<Record<string, number>>;
}

/** The `IWorld` reads the viewer derivation needs, as a Pick rather than the
 *  whole seam: the derivation stays drivable from a Sim-shaped and a
 *  ClientWorld-mirror-shaped stub alike, which is the exact place those two
 *  could quietly diverge. */
export type WarfareShopWorld = Pick<IWorld, 'honor' | 'inventory' | 'equipment'>;

/**
 * Derive the shop viewer from the world seam: the honor balance, the item ids
 * currently WORN (what the set bonuses key on), and the ids worn or carried
 * (what "already bought this" means for the owned marks). Both reads go through
 * `IWorld`, so the numbers resolve identically offline and online.
 *
 * KNOWN LIMITATION, and deliberate: "owned" covers equipment plus the CARRIED
 * inventory only. A piece parked in the BANK therefore reads as unowned and
 * loses its Owned marker, which can invite
 * a duplicate purchase of an unrefundable honor item. This is a platform
 * constraint rather than a fixable read: `IWorldBank.bankInfo` is null away
 * from a banker, so bank contents are simply not observable from the shop.
 * Pinned by tests/warfare_vendor_view.test.ts so the next reader does not
 * assume bank coverage.
 */
export function warfareShopViewer(
  world: WarfareShopWorld,
): Pick<WarfareShopViewer, 'honor' | 'ownedItemIds' | 'equippedItemIds'> {
  const equippedItemIds = new Set(
    Object.values(world.equipment).filter((id): id is string => !!id),
  );
  const ownedItemIds = new Set([...equippedItemIds, ...world.inventory.map((slot) => slot.itemId)]);
  return { honor: world.honor, ownedItemIds, equippedItemIds };
}

function offerFor(itemId: string, item: ItemDef, viewer: WarfareShopViewer): WarfareShopOffer {
  const honor = Math.max(0, Math.floor(item.priceHonor ?? 0));
  return {
    itemId,
    item,
    honor,
    affordable: viewer.honor >= honor,
    owned: viewer.ownedItemIds.has(itemId),
  };
}

function distinctSlots(offers: readonly WarfareShopOffer[], ids: ReadonlySet<string>): number {
  const slots = new Set<string>();
  for (const offer of offers) {
    if (!ids.has(offer.itemId)) continue;
    slots.add(offer.item.slot ?? offer.itemId);
  }
  return slots.size;
}

/**
 * Build the sectioned shop view: the honor stock split into its five set
 * families plus jewelry and weapons, each offer resolved against the item table,
 * the viewer's honor balance, and what they already own.
 *
 * Unknown item ids and priceless rows are dropped (never render a row the sim
 * would refuse to sell), matching buildVendorView's own two drop rules.
 */
export function buildWarfareVendorView(
  stock: readonly string[],
  items: Readonly<Record<string, ItemDef>>,
  sets: Readonly<Record<string, ItemSet>>,
  viewer: WarfareShopViewer,
): WarfareShopView {
  const bySet = new Map<string, WarfareShopOffer[]>();
  const jewelry: WarfareShopOffer[] = [];
  const weapons: WarfareShopOffer[] = [];
  for (const itemId of stock) {
    const item = items[itemId];
    if (!item) continue;
    const offer = offerFor(itemId, item, viewer);
    if (offer.honor <= 0) continue;
    if (item.set) {
      const existing = bySet.get(item.set);
      if (existing) existing.push(offer);
      else bySet.set(item.set, [offer]);
    } else if (item.kind === 'weapon') {
      weapons.push(offer);
    } else {
      // Neck and rings: shared across role profiles, so they carry no set tag
      // and the only coherent grouping left is "jewelry".
      jewelry.push(offer);
    }
  }

  // Authored order first, then any family the stock carries that the order does
  // not name, in first-seen order (Map preserves insertion).
  const orderedSetIds = [
    ...WARFARE_SHOP_SET_ORDER.filter((setId) => bySet.has(setId)),
    ...[...bySet.keys()].filter((setId) => !WARFARE_SHOP_SET_ORDER.includes(setId)),
  ];

  const sections: WarfareShopSection[] = [];
  for (const setId of orderedSetIds) {
    const offers = bySet.get(setId) as WarfareShopOffer[];
    const ownedPieces = distinctSlots(offers, viewer.ownedItemIds);
    const equippedPieces = distinctSlots(offers, viewer.equippedItemIds);
    const soldSlots = distinctSlots(offers, new Set(offers.map((offer) => offer.itemId)));
    const totalPieces = viewer.setMemberCounts?.[setId] ?? soldSlots;
    // Mirrors itemSetTooltipModel: filter on the reachable piece count with no
    // literal breakpoints, so a 7-of-7 capstone is reachable and renders.
    const authored = [...(sets[setId]?.bonuses ?? [])].sort((a, b) => a.pieces - b.pieces);
    const tiers: WarfareShopTier[] = authored
      .filter((tier) => tier.pieces <= totalPieces)
      .map((tier) => ({ pieces: tier.pieces, met: equippedPieces >= tier.pieces }));
    // Against the NEXT unmet tier, never against the full set: a player at five
    // pieces is told "2 more for the 7-piece bonus", not a bare fraction.
    const pending = tiers.find((tier) => ownedPieces < tier.pieces);
    sections.push({
      kind: 'set',
      key: setId,
      setId,
      offers,
      tiers,
      ownedPieces,
      equippedPieces,
      totalPieces,
      nextTier: pending
        ? { pieces: pending.pieces, remaining: pending.pieces - ownedPieces }
        : null,
    });
  }
  if (jewelry.length > 0) {
    sections.push({ kind: 'jewelry', key: WARFARE_SHOP_JEWELRY_KEY, offers: jewelry });
  }
  if (weapons.length > 0) {
    sections.push({ kind: 'weapons', key: WARFARE_SHOP_WEAPONS_KEY, offers: weapons });
  }
  return { sections, balance: Math.max(0, Math.floor(viewer.honor)) };
}
