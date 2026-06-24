import type { NpcDef } from '../../types';

export { DELVE_AFFIXES } from './affixes';
export { COLLAPSED_RELIQUARY_DELVE, COLLAPSED_RELIQUARY_MODULES } from './collapsed_reliquary';
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
