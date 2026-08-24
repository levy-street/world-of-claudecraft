// The player item-lock predicate, extracted to a dependency-free leaf so a
// module that only needs to READ the flag (exchange_eligibility.ts, the shared
// exchange lock predicate) stays a SimContext-free leaf that never imports the
// lock SYSTEM module (the set command and the removal walks), whatever
// item_lock.ts happens to import at the time. That system stays in
// item_lock.ts and re-exports this. Precedent: the same extraction
// transfer_lock.ts performs for isTransferLockedInstance.
//
// `src/sim`-pure: no imports beyond the type, no rng, no clock.

import type { ItemInstancePayload } from './types';

/** True when this copy is locked by its owner against salvage, profession
 *  craft consumption, and vendor sell. A plain (no payload) copy, or one
 *  whose payload never had the flag set, is never locked. */
export function isItemLocked(instance: ItemInstancePayload | undefined): boolean {
  return instance?.locked === true;
}
