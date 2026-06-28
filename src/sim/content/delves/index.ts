import type { NpcDef } from '../../types';

export { DELVE_AFFIXES } from './affixes';
export { COLLAPSED_RELIQUARY_DELVE, COLLAPSED_RELIQUARY_MODULES } from './collapsed_reliquary';
export { DROWNED_LITANY_DELVE, DROWNED_LITANY_MODULES } from './drowned_litany';
export { COMPANION_UPGRADE_COSTS, DELVE_COMPANIONS } from './companions';
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

// Board NPC for The Drowned Litany. Distinct id from zone1's `brother_aldric`
// (the Gravecaller quest giver) so the two never collide; display name is shared
// in-fiction but the delve board resolves by template id.
export const BROTHER_ALDRIC_WATCH: NpcDef = {
  id: 'brother_aldric_watch',
  name: 'Brother Aldric',
  title: 'Fenbridge Watch',
  // North causeway just outside Fenbridge, matching the delve doorPos.
  pos: { x: 8, z: 268 },
  // Faces +z (north up the causeway) to greet arrivals from Eastbrook.
  facing: 0,
  color: 0x3a4036,
  questIds: [],
  greeting:
    'Fenbridge hears bells under the water now. The Gravecallers are teaching the drowned to sing. Choose your tier, and I will hold the rope until you return.',
};
