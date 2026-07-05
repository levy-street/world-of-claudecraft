import type { NpcDef } from '../../types';

export { DELVE_AFFIXES } from './affixes';
export { COLLAPSED_RELIQUARY_DELVE, COLLAPSED_RELIQUARY_MODULES } from './collapsed_reliquary';
export { COMPANION_UPGRADE_COSTS, DELVE_COMPANIONS } from './companions';
export { DROWNED_LITANY_DELVE, DROWNED_LITANY_MODULES } from './drowned_litany';
export { DELVE_MOBS } from './mobs';
export type { DelveShopEntry, DelveShopGate, DelveShopOffer } from './shop';
export { DELVE_SHOPS, delveShopGateUnlocked, resolveDelveShopOffers } from './shop';

export const BROTHER_HALVEN: NpcDef = {
  id: 'brother_halven',
  name: 'Brother Halven',
  title: 'Reliquary Keeper',
  pos: { x: -5, z: -52 },
  // Faces +z (north), toward the town/hub up the road, so he greets arrivals
  // with the glowing delve mouth framed behind him (was Math.PI, facing away).
  facing: 0,
  // Near-black charcoal: the hooded keeper reads dark/dirty under the 'entity'
  // tint of npc_reliquary_keeper (was 0xd4c5a0 light tan, too friendly).
  color: 0x2b2620,
  questIds: [],
  greeting: 'The reliquary below has shifted again.',
};

// Board NPC for The Drowned Litany: Brother Halven again, having followed the
// reliquary's trail north to the marsh. Distinct id from `brother_halven` (the
// Collapsed Reliquary board NPC) so the delve board's templateId lookup (one
// board NPC id per delve) resolves each to its own delve; display name and
// character are shared in-fiction.
export const BROTHER_HALVEN_MARSH: NpcDef = {
  id: 'brother_halven_marsh',
  name: 'Brother Halven',
  title: 'Reliquary Keeper',
  // A clearing north of the Troll Mounds, clear of the fen_troll/grubjaw camps
  // (which top out around z~488) and short of the steep rise toward Thornpeak
  // Heights (the ground climbs fast past z~510 here). Matches
  // DROWNED_LITANY_DELVE.doorPos.
  pos: { x: -95, z: 505 },
  // Faces -z (south), back down toward the Troll Mounds and the marsh.
  facing: Math.PI,
  color: 0x2b2620,
  questIds: [],
  greeting:
    "The trail led north. Another reliquary, another rite. Choose your tier, and I'll hold the rope until you return.",
};
