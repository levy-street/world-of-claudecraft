// ---------------------------------------------------------------------------
// The Reliquary: sparse first-find meta, authored marks, capped recent finds,
// and pure completion reads for the SELF player. Ownership of item relics is
// NOT here: it reuses IWorldDeeds.deedStats.itemsDiscovered. This facet only
// exposes Reliquary-specific sparse state plus completion helpers that both
// hosts recompute from catalog + mirrors (no second full discovery set).
//
// Offline the Sim exposes live PlayerMeta.reliquary; online the ClientWorld
// mirrors the heavy-gated `reliq` self blob. The `reliquaryUnlock` event is
// presentation-only (toast / live UX) and must never invent membership.
// The sticky illuminatedPages record (Phase 18) is DELIBERATELY not a facet
// member: it is sim/server-authoritative anti-repeat state with no render/ui
// consumer (banner and marquee are event-driven); ClientWorld drops it on
// decode. Adding a consumer means adding the member here, in BOTH worlds,
// and in the parity pin, in one change.
// ---------------------------------------------------------------------------

/** Sparse first-obtain metadata for one catalogued relic item id. */
export interface ReliquaryFirstFindView {
  /** Clear count of the page source at first obtain. Absent when the page has
   *  no clear meter, when the meter had not turned over yet, and on a retro
   *  fill: all three mean the same thing, that no clear can be named. */
  clears?: number;
}

/** Page progress over relic ownership. */
export interface ReliquaryPageCompletion {
  owned: number;
  total: number;
  complete: boolean;
}

/** Catalog-wide unique item-relic progress. */
export interface ReliquaryCatalogCompletion {
  owned: number;
  total: number;
}

/**
 * The realm population-rarity aggregate: how many eligible characters have
 * found each catalogued relic id (item relics by first discovery, mark relics
 * by the kill-proof ledger) and how many have illuminated each page.
 * Zero-count ids are ABSENT from the maps, not zero-valued, and THREE relic
 * kinds are never counted: weapon skins (account-scoped), titles
 * (deed-scoped), and mounts (possession-based, and a mount cell's id is the
 * mount key rather than the reins item id), so absence always renders as
 * "no line". Percentages are computed by the consumer, never sent. Mirrors
 * DeedsRarity member for member.
 */
export interface ReliquaryRarity {
  totalEligible: number;
  found: Record<string, number>;
  illuminated: Record<string, number>;
}

export interface IWorldReliquary {
  /**
   * Sparse first-find meta for catalogued relic item ids only (live first
   * obtains). Empty object when none. Readonly across the seam.
   */
  reliquaryFirstFind: Readonly<Record<string, ReliquaryFirstFindView>>;
  /**
   * Authored non-item Reliquary marks the player has earned (profession
   * trophies, etc.). Empty set when none.
   */
  reliquaryMarks: ReadonlySet<string>;
  /**
   * Capped recent find ring (item or mark ids), oldest-first. Empty array
   * when none.
   */
  reliquaryRecent: readonly string[];
  /**
   * Per-relic obtain tally for catalogued relic ITEM ids, sparse: an absent id
   * has never been counted. Counts WORLD-SOURCED acquisitions only, so the
   * number reads as "the world handed you this many"; a trade, mail, market
   * purchase, vendor buyback, or re-mint never bumps one. A heroic-difficulty
   * drop credits the BASE relic, the same slot its discovery fills, so the
   * count agrees with the page. A CURRENCY vendor does count, and is meant to:
   * the delve Marks shops sell six catalogued relics (deacon_reliquary_helm,
   * varric_shadow_cowl, sister_nhalia_choir_plate, drowned_choir_fang, and
   * since the Phase 21 specimens growth the two Marks-priced top-tier rods
   * stormreel_fishing_rod and tidewrought_fishing_rod on the Litany board,
   * the non-crafter's route to what engineering also crafts),
   * Marks are earned in the world, and buying a second copy really is a
   * second thing the world handed you. Information, never a score: it feeds
   * no completion, rank, drop rate, or reward. Empty object when none.
   */
  reliquaryObtainCounts: Readonly<Record<string, number>>;
  /**
   * Page progress X/Y for a catalog page id, or null when the id is not a
   * live page. Owned counts come from itemsDiscovered, marks, ownedMounts,
   * account weapon skins, and deedsEarned (title relics).
   */
  reliquaryPageCompletion(pageId: string): ReliquaryPageCompletion | null;
  /**
   * Catalog-wide unique relic progress (items + marks + mounts + skins +
   * titles, de-duped across pages). Overview totals use this full set.
   */
  reliquaryCatalogCompletion(): ReliquaryCatalogCompletion;
  /**
   * Pure Curator rank index from character-durable catalogued fills (items,
   * marks, mounts, titles). Account weapon skins never score rank so grants
   * and display stay aligned. Cosmetic-only; rank 0 means none.
   */
  reliquaryCuratorRank(): number;
  /**
   * Lifetime clear count for a page's clear source, or undefined when the
   * page is unknown or has no clear meter.
   */
  reliquaryPageClearCount(pageId: string): number | undefined;
  /**
   * The realm population-rarity aggregate, or null when there is none to
   * report: the offline Sim always answers null (the sandbox has no
   * population; deterministic, no fetch, no clock, the deedsRarity stub
   * doctrine), and the online world answers null on any fetch or shape
   * failure. Null means the UI omits every rarity line, never renders an
   * empty or zero one.
   */
  reliquaryRarity(): Promise<ReliquaryRarity | null>;
}
