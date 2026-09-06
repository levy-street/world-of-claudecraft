// Store-mount grant materialization: turns a verified Claudium store-mount
// purchase (server/claudium.ts, kind 'item' SKUs from
// src/sim/content/store_mounts.ts) into the soulbound reins item in the
// buyer's live character bags.
//
// The economy service's grant ledger is the rollback-safe entitlement record;
// the reins item is only its in-world materialization, so this must stay
// IDEMPOTENT per character: a character whose bags or bank already hold the
// mount is skipped (ownedMountsFor), and the store-open reconcile then
// re-materializes the reins onto any other character the account later plays.
// No live session on the account is fine: the buyer's next store open heals it.
import { ITEMS } from '../src/sim/data';

interface StoreMountGrantSim {
  ownedMountsFor(pid: number): readonly string[];
  addItem(itemId: string, count: number, pid: number): void;
}

/** Grant each purchased reins to every live session on the account that does
 *  not already own its mount. Injected into the Claudium routes through
 *  GameServer.grantStoreMountsToAccount (configureClaudiumRuntime). */
export function materializeStoreMountGrants(
  sessions: Iterable<{ accountId: number; pid: number }>,
  sim: StoreMountGrantSim,
  accountId: number,
  itemIds: string[],
): void {
  for (const live of sessions) {
    if (live.accountId !== accountId) continue;
    const owned = new Set<string>(sim.ownedMountsFor(live.pid));
    for (const itemId of itemIds) {
      const def = ITEMS[itemId];
      if (def?.kind !== 'mount' || !def.mount || owned.has(def.mount)) continue;
      sim.addItem(itemId, 1, live.pid);
    }
  }
}
