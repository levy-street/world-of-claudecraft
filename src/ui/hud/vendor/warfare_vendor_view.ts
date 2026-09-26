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

import { SEASON2_SETS, SEASON2_STOCK } from '../../../sim/content/pvp_honor_season2';
import type { ItemDef, ItemSet } from '../../../sim/types';
import type { IWorld } from '../../../world_api';

/** Warfare Season 2 ("Vanguard", content/pvp_honor_season2.ts): the top tier,
 *  listed above the entry tier in its own group. */
const SEASON2_IDS: ReadonlySet<string> = new Set(SEASON2_STOCK);

/** Season 2 set id to the class and spec it is built for, so the painter can
 *  name the spec beside the set (Bladewake Battlegear, Arms). */
const SEASON2_SPEC_BY_SET: ReadonlyMap<string, WarfareShopSetSpec> = new Map(
  SEASON2_SETS.map((set) => [set.setId, { cls: set.cls, spec: set.spec }]),
);

/** The class and spec a Season 2 set is built for (ids; the painter translates). */
export interface WarfareShopSetSpec {
  cls: string;
  spec: string;
}

/** The two groups the shop lists, top tier first. */
export type WarfareShopGroup = 'season2' | 'entry';

/** The five WARFARE armor families, in the order the shop lists them. Any set
 *  the stock carries that is NOT named here still gets a section, appended in
 *  first-seen order, so a sixth family cannot silently vanish from the shop. */
export const WARFARE_SHOP_SET_ORDER: readonly string[] = [
  // Ordered by ARMOR CLASS, heaviest first, so the list reads mail -> leather ->
  // cloth and a player scans straight to the block they can wear. Thornhide sat
  // last, which put cloth (Cinderweave) between the two leather families.
  'warfare_furyforged', // mail, Strength
  'warfare_stormbound', // mail, caster
  'warfare_ashstalker', // leather, Agility
  'warfare_thornhide', // leather, caster
  'warfare_cinderweave', // cloth, caster
];

/** Section keys for the two non-set sections. Set sections key on their set id,
 *  so every key in one view is unique and safe to build a focus key from. */
export const WARFARE_SHOP_JEWELRY_KEY = 'jewelry';
export const WARFARE_SHOP_WEAPONS_KEY = 'weapons';
export const WARFARE_SHOP_SEASON2_WEAPONS_KEY = 'season2_weapons';

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
  group: WarfareShopGroup;
  /** The set id, which is also this section's unique key. */
  key: string;
  setId: string;
  /** The spec a Season 2 set is built for; absent on the entry tier, whose
   *  families serve every spec of an armor type. */
  spec?: WarfareShopSetSpec;
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
  group: WarfareShopGroup;
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
  /** The viewer's class. Season 2 sets and weapons are class-locked, so the
   *  shop lists only the ones this class can wear (three spec sets out of 27);
   *  absent, nothing is filtered. The entry tier is never filtered. */
  viewerClass?: string;
}

/** The `IWorld` reads the viewer derivation needs, as a Pick rather than the
 *  whole seam: the derivation stays drivable from a Sim-shaped and a
 *  ClientWorld-mirror-shaped stub alike, which is the exact place those two
 *  could quietly diverge. */
export type WarfareShopWorld = Pick<IWorld, 'honor' | 'inventory' | 'equipment' | 'cfg'>;

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
): Pick<WarfareShopViewer, 'honor' | 'ownedItemIds' | 'equippedItemIds' | 'viewerClass'> {
  const equippedItemIds = new Set(
    Object.values(world.equipment).filter((id): id is string => !!id),
  );
  const ownedItemIds = new Set([...equippedItemIds, ...world.inventory.map((slot) => slot.itemId)]);
  return {
    honor: world.honor,
    ownedItemIds,
    equippedItemIds,
    viewerClass: world.cfg.playerClass,
  };
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

function wearableBy(item: ItemDef, viewerClass: string | undefined): boolean {
  if (!viewerClass || !item.requiredClass) return true;
  return (item.requiredClass as readonly string[]).includes(viewerClass);
}

/**
 * Build the sectioned shop view: Warfare Season 2 first (the viewer's class
 * sets, then its weapons), then the entry tier's five set families, jewelry and
 * weapons, each offer resolved against the item table, the viewer's honor
 * balance, and what they already own.
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
  const seasonWeapons: WarfareShopOffer[] = [];
  for (const itemId of stock) {
    const item = items[itemId];
    if (!item) continue;
    const offer = offerFor(itemId, item, viewer);
    if (offer.honor <= 0) continue;
    // Season 2 is class-locked: list only what this viewer can wear.
    if (SEASON2_IDS.has(itemId) && !wearableBy(item, viewer.viewerClass)) continue;
    if (SEASON2_IDS.has(itemId) && item.kind === 'weapon') {
      seasonWeapons.push(offer);
    } else if (item.set) {
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

  // Season 2 sets first, in stock order (class, then spec). Then the entry
  // tier: authored order first, then any family the stock carries that the
  // order does not name, in first-seen order (Map preserves insertion).
  const seasonSetIds = [...bySet.keys()].filter((setId) =>
    SEASON2_IDS.has((bySet.get(setId) as WarfareShopOffer[])[0].itemId),
  );
  const entrySetIds = [...bySet.keys()].filter((setId) => !seasonSetIds.includes(setId));
  const orderedSetIds = [
    ...seasonSetIds,
    ...WARFARE_SHOP_SET_ORDER.filter((setId) => entrySetIds.includes(setId)),
    ...entrySetIds.filter((setId) => !WARFARE_SHOP_SET_ORDER.includes(setId)),
  ];

  const sections: WarfareShopSection[] = [];
  const pushSeasonWeapons = () => {
    if (seasonWeapons.length === 0) return;
    sections.push({
      kind: 'weapons',
      group: 'season2',
      key: WARFARE_SHOP_SEASON2_WEAPONS_KEY,
      offers: seasonWeapons,
    });
  };
  if (seasonSetIds.length === 0) pushSeasonWeapons();
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
      group: seasonSetIds.includes(setId) ? 'season2' : 'entry',
      spec: SEASON2_SPEC_BY_SET.get(setId),
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
    // Season 2 weapons close the Season 2 group, before the entry tier starts.
    if (setId === seasonSetIds[seasonSetIds.length - 1]) pushSeasonWeapons();
  }
  if (jewelry.length > 0) {
    sections.push({
      kind: 'jewelry',
      group: 'entry',
      key: WARFARE_SHOP_JEWELRY_KEY,
      offers: jewelry,
    });
  }
  if (weapons.length > 0) {
    sections.push({
      kind: 'weapons',
      group: 'entry',
      key: WARFARE_SHOP_WEAPONS_KEY,
      offers: weapons,
    });
  }
  return { sections, balance: Math.max(0, Math.floor(viewer.honor)) };
}
