// The WOC Store's grant-SKU spend controllers (the Armory's weapon skins and
// the Machine Stable's mounts) built over ONE set of window seams.
// DailyRewardsWindow states its balance / surface / prompt / repaint seams once
// here instead of once per controller; each controller adds only its own spend
// kind and row model. A third grant family lands here as a third field, not as
// another copy of the seam object in the window. (The Strongbox charters are
// not a grant family: a charter is repeatable and carries an intent key, so
// its flow stays its own thing in the window.)

import type { StoreSpendResult } from './claudium_purchase_bridge';
import { StoreArmoryPurchase, type StoreArmoryPurchaseDeps } from './store_armory_purchase';
import { StoreMountPurchase, type StoreSpendSeams } from './store_mount_purchase';

export type { StoreSpendSeams };

export interface StoreSpendControllerDeps extends StoreSpendSeams {
  /** The one service spend, keyed by the SKU family the controller owns. */
  spend(itemId: string, kind: 'skin' | 'item', cost: number): Promise<StoreSpendResult | undefined>;
  armoryRowById: StoreArmoryPurchaseDeps['rowById'];
  refreshInspector: StoreArmoryPurchaseDeps['refreshInspector'];
}

export interface StoreSpendControllers {
  armory: StoreArmoryPurchase;
  mounts: StoreMountPurchase;
}

export function storeSpendControllers(deps: StoreSpendControllerDeps): StoreSpendControllers {
  const { spend, armoryRowById, refreshInspector, ...seams } = deps;
  return {
    armory: new StoreArmoryPurchase({
      ...seams,
      spend: (itemId, cost) => spend(itemId, 'skin', cost),
      rowById: armoryRowById,
      refreshInspector,
    }),
    mounts: new StoreMountPurchase({
      ...seams,
      spend: (itemId, cost) => spend(itemId, 'item', cost),
    }),
  };
}
