// The built-in world's singleton keepers of its walk-in buildings, spawned at world init
// under their reserved ids (outside the sequential allocator, so no other entity's id
// moves): the Harbormaster's House keeper (wyrmwatch_harbor_house.ts), the Mirefen
// tavern's innkeeper (mirefen_tavern.ts) and its seated patrons (mirefen_tavern_patrons.ts),
// and the Highwatch manor's steward (highwatch_manor.ts). Each spawn is idempotent and
// draws no rng.

import { spawnHighwatchSteward } from './highwatch_manor';
import { spawnTavernKeeper } from './mirefen_tavern';
import { spawnTavernPatrons } from './mirefen_tavern_patrons';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';
import { spawnHarborHouseKeeper } from './wyrmwatch_harbor_house';

export function spawnBuiltWorldKeepers(ctx: SimContext, world: WorldContent): void {
  spawnHarborHouseKeeper(ctx, world);
  spawnTavernKeeper(ctx, world);
  spawnTavernPatrons(ctx, world);
  spawnHighwatchSteward(ctx, world);
}
