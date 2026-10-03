// The World PvP trophy skull's identity, as a dependency-free leaf. The spoils
// system (world_pvp_spoils.ts) drops it and the material registry
// (material_ids.ts) tracks it, and the registry is evaluated before most of
// the sim loads, so the id cannot live behind a module with runtime imports.
//
// The skull is a PROVENANCE-TRACKED stack, the same machinery gathered
// materials use: every skull shares one stack, and each unit remembers whose
// skull it is as a material-source bucket (the victim rides the `gatherer`
// field, a stable character identity plus the name at the moment of the kill).
// The tooltip lists the buckets ("2 x Taken from Bet"), and the counts survive
// every bank, mail, trade and market hop because those paths already carry
// material sources.

/** The trophy a flagged killing blow takes from a flagged victim's body. */
export const WORLD_PVP_SKULL_ITEM_ID = 'pvp_trophy_skull';

/** Non-reagent items that still carry per-unit provenance like materials. */
export const WORLD_PVP_TROPHY_MATERIAL_ITEM_IDS: readonly string[] = [WORLD_PVP_SKULL_ITEM_ID];
