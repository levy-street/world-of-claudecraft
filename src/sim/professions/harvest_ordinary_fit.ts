// The one ordinary-yield capacity check shared by the corpse-harvest
// admission preview (`corpse_harvest_inspection.ts`), the live cast recheck
// and completion (`corpse_harvest_session.ts`): does `meta`'s bag pool have
// room for the frozen `CorpseHarvestGrantInputs`' reserved ordinary yields
// (`corpse_harvest_grant.ts` `corpseHarvestOrdinaryYields`)? Pure leaf, no
// SimContext, no rng.

import { bagPools, fitsAll } from '../bags';
import type { PlayerMeta } from '../sim';
import { type CorpseHarvestGrantInputs, corpseHarvestOrdinaryYields } from './corpse_harvest_grant';

export function ordinaryYieldFitsFor(meta: PlayerMeta, inputs: CorpseHarvestGrantInputs): boolean {
  const wanted = corpseHarvestOrdinaryYields(inputs);
  return wanted.length === 0 || fitsAll(meta.inventory, bagPools(meta.bags), wanted);
}
