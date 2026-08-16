// The Stylist: the NPC (src/sim/content/zone1.ts's `stylist_verena` record,
// `stylist: true`) who sells character redesign credits for gold. A service desk,
// not a vendor: she carries no `vendorItems`, and the purchase resolves through
// src/sim/stylist.ts rather than the copper-vendor buy path, because what she
// sells is an entitlement on the character, never an item in the bags.
//
// The price ladder is its own module (redesign_pricing.ts) so the bands stay
// tunable and testable apart from both the NPC record and the purchase logic.

export const STYLIST_NPC_ID = 'stylist_verena';
