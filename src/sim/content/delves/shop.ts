// ---------------------------------------------------------------------------
// Delve Marks vendor stock, Collapsed Reliquary (Brother Halven)
// ---------------------------------------------------------------------------
//
// Gate semantics:
//   'available'     , purchasable from the first time Brother Halven opens
//                      the vendor (no run requirement).
//   'clears:N'      , unlocks after the player has completed N runs of this
//                      delve (any difficulty; counts Normal + Heroic clears).
//   'heroicClear'   , unlocks after the player completes at least one Heroic
//                      (difficulty ≥ 2) run.
//
// Pricing intent (the Collapsed Reliquary is the ENTRY-tier delve):
//   Marks income is ~3 Marks/day for a Normal-only player and ~6-8 for a
//   dedicated Heroic runner (see `delveMarkPayout` in sim.ts). Prices here are
//   deliberately STEEP relative to that income, the reward gear is a clear
//   upgrade over the silver-vendor armor of the same tier (Smith Haldren's
//   commons: chainmail vest 60 armor, leather jerkin 40, robe 22, trousers 24),
//   so each piece is uncommon-or-rare quality with stat bonuses on top. A casual
//   player kits out over ~2-3 weeks; the Heroic signature rares are a multi-week
//   goal each.
//
//   FORWARD DESIGN: later delves are tuned to cost FAR more Marks (and reward
//   far more Marks per clear), so this tier's prices are the floor of a long
//   currency curve, not the ceiling. Keep new shops keyed under DELVE_SHOPS.
// ---------------------------------------------------------------------------

export type DelveShopGate = 'available' | 'heroicClear' | `clears:${number}`;

export interface DelveShopEntry {
  itemId: string;
  marks: number;
  gate: DelveShopGate;
}

const COLLAPSED_RELIQUARY_SHOP: DelveShopEntry[] = [
  // -- immediately available utility pieces (class-neutral / off-set) --
  { itemId: 'reliquary_legs', marks: 8, gate: 'available' },
  { itemId: 'reliquary_shoulder', marks: 8, gate: 'available' },
  { itemId: 'reliquary_gloves_rog', marks: 8, gate: 'available' },
  // -- immediately available class-specific chests (the staple upgrade) --
  { itemId: 'reliquary_cloth_chest', marks: 10, gate: 'available' },
  { itemId: 'reliquary_leather_chest', marks: 10, gate: 'available' },
  { itemId: 'reliquary_plate_chest', marks: 10, gate: 'available' },
  // -- helm unlocks after 3 clears (rewards commitment to the delve) --
  { itemId: 'reliquary_helm', marks: 12, gate: 'clears:3' },
  // -- signature rares require a Heroic completion (multi-week goals) --
  { itemId: 'deacon_reliquary_helm', marks: 28, gate: 'heroicClear' },
  { itemId: 'varric_shadow_cowl', marks: 28, gate: 'heroicClear' },
];

// The Drowned Litany (delve index 1) is the next currency-curve step: every
// price here is a straight 2x of the equivalent Collapsed Reliquary slot, to
// match the delve's doubled Marks payout (see grantDelveClearTo/grantRiteBonus).
const DROWNED_LITANY_SHOP: DelveShopEntry[] = [
  // -- immediately available utility pieces (class-neutral / off-set) --
  { itemId: 'litany_legs', marks: 16, gate: 'available' },
  { itemId: 'litany_shoulder', marks: 16, gate: 'available' },
  { itemId: 'litany_gloves_rog', marks: 16, gate: 'available' },
  // -- immediately available class-specific chests (the staple upgrade) --
  { itemId: 'litany_cloth_chest', marks: 20, gate: 'available' },
  { itemId: 'litany_leather_chest', marks: 20, gate: 'available' },
  { itemId: 'litany_plate_chest', marks: 20, gate: 'available' },
  // -- helm unlocks after 3 clears (rewards commitment to the delve) --
  { itemId: 'litany_helm', marks: 24, gate: 'clears:3' },
  // -- signature rares require a Heroic completion (multi-week goals) --
  { itemId: 'sister_nhalia_choir_plate', marks: 56, gate: 'heroicClear' },
  { itemId: 'drowned_choir_fang', marks: 56, gate: 'heroicClear' },
  // -- the crafted top-tier gathering tools, as a NON-CRAFTER's route to them --
  //
  // These eight are the tier-4 and tier-5 picks, axes, sickles and rods that
  // otherwise only an engineer at a toolworks can produce (recipes.ts
  // TOOL_RECIPES and ROD_RECIPES). A player who never took a crafting
  // profession had no path to the top of the tool ladder at all; this is that
  // path, priced in Marks rather than in a profession.
  //
  // NO NEW PRICE RUNGS AND NO NEW GATES. Both rows reuse this shop's existing
  // top two: tier 4 sits on the helm's rung (24 Marks behind three clears, the
  // "commitment" step) and tier 5 on the signature-rare rung (56 behind a
  // Heroic clear, the multi-week goal). That is deliberate rather than
  // convenient, because the Litany's whole price ladder is pinned as a straight
  // 2x of the Collapsed Reliquary's tiers (tests/delve_shop.test.ts), and a
  // bespoke tool price would either break that relationship or force an
  // invented mirror row into the entry delve where a top tool does not belong.
  //
  // They land HERE rather than on the Heroic Quartermaster's counter, which was
  // the other candidate: HEROIC_VENDOR_ITEMS (content/heroic_vendor.ts) is a
  // self-contained ItemDef registry that never reads ITEMS, so a tool row there
  // means a duplicate def of an item that already exists, and its stock is
  // budget-enforced level-20 jewelry (tests/item_level.test.ts) whose stated
  // identity is being the game's only source of necks and rings. A stat-less
  // tool fits neither. A DelveShopEntry's itemId resolves into ITEMS directly,
  // and delveShopGateUnlocked below is already shared by the authoritative buy
  // and the client's lock badge, so these rows need no new gate logic anywhere.
  //
  // This does NOT weaken the tools' never-sold rule, it sharpens it: the claim
  // is that no counter sells them FOR COPPER, and Marks are a delve currency
  // earned by running the delve. The guards in tests/professions_tools.test.ts
  // and tests/professions_rod_recipes.test.ts assert exactly that, and were
  // widened to sweep this table (and the heroic vendor's) rather than only
  // NPCS[*].vendorItems, which would have let these rows through in silence.
  //
  // These rows carry NO proficiency requirement, unlike the tier-2 and tier-3
  // copper rows on the ordinary counters (content/vendor_row_gates.ts). That is
  // not an oversight and not a decision made here: whether a tool's PURCHASE
  // should be gated on the same proficiency its USE is gated on is an open
  // question the maintainer holds. The clears gate is what paces these rows
  // today, and it is a content gate rather than a profession one, so nothing
  // here presumes an answer either way.
  { itemId: 'thorium_mining_pick', marks: 24, gate: 'clears:3' },
  { itemId: 'ashwood_axe', marks: 24, gate: 'clears:3' },
  { itemId: 'goldleaf_sickle', marks: 24, gate: 'clears:3' },
  { itemId: 'stormreel_fishing_rod', marks: 24, gate: 'clears:3' },
  { itemId: 'arcanite_mining_pick', marks: 56, gate: 'heroicClear' },
  { itemId: 'elderwood_axe', marks: 56, gate: 'heroicClear' },
  { itemId: 'sunpetal_sickle', marks: 56, gate: 'heroicClear' },
  { itemId: 'tidewrought_fishing_rod', marks: 56, gate: 'heroicClear' },
];

// Per-delve shop stock, keyed by DelveDef.id. New delves register their stock
// here; the Sim looks up the shop by the delve the player is buying from.
export const DELVE_SHOPS: Record<string, DelveShopEntry[]> = {
  collapsed_reliquary: COLLAPSED_RELIQUARY_SHOP,
  drowned_litany: DROWNED_LITANY_SHOP,
};

// Pure gate check, shared by the Sim (server-authoritative buy) and the client UI
// (ClientWorld, for the lock badge) so the lock state the player sees matches what
// the purchase will actually allow. `clears` is the player's persisted
// `delveClears` map (key `${delveId}:${tierId}`); same answer everywhere.
export function delveShopGateUnlocked(
  clears: Record<string, number>,
  delveId: string,
  gate: DelveShopGate,
): boolean {
  if (gate === 'available') return true;
  if (gate === 'heroicClear') return (clears[`${delveId}:heroic`] ?? 0) > 0;
  const need = Number(gate.slice('clears:'.length));
  if (!Number.isFinite(need)) return false;
  const total = Object.entries(clears)
    .filter(([key]) => key.startsWith(`${delveId}:`))
    .reduce((sum, [, count]) => sum + count, 0);
  return total >= need;
}

// A shop entry resolved against a player's clears: the static price/item plus the
// unlock state and a presentation-friendly breakdown of the gate (so the UI can
// show *why* a locked offer is locked without re-parsing the gate string). The
// shape is structurally the IWorld `DelveShopOfferView`; both worlds return this.
export interface DelveShopOffer {
  itemId: string;
  marks: number;
  unlocked: boolean;
  requiresHeroicClear: boolean;
  requiresClears: number; // >0 for a `clears:N` gate; 0 otherwise
}

export function resolveDelveShopOffers(
  delveId: string,
  clears: Record<string, number>,
): DelveShopOffer[] {
  return (DELVE_SHOPS[delveId] ?? []).map((e) => ({
    itemId: e.itemId,
    marks: e.marks,
    unlocked: delveShopGateUnlocked(clears, delveId, e.gate),
    requiresHeroicClear: e.gate === 'heroicClear',
    requiresClears: e.gate.startsWith('clears:') ? Number(e.gate.slice('clears:'.length)) : 0,
  }));
}
