import type { ItemInstancePayload } from './types';

// Collapses market listings down to at most one per distinct GOODS: the lowest-priced
// listing for each thing a shopper would treat as interchangeable (issue #3103, the
// Browse "lowest price of each" toggle). Pure and host-agnostic (no SimContext), so a
// Vitest can drive it directly with plain objects instead of a live Market.
//
// What counts as "the same goods" (issue #3383): a plain fungible stack is its item id.
// An instanced copy folds with other copies that share the SAME item id AND the same
// enchant AND the same rolled/masterwork stats, because those are the facts that change
// what a buyer receives. It deliberately does NOT split on the SIGNER (the crafter's
// maker's mark): two identically-enchanted, identically-rolled swords are the same
// purchase whoever forged them, so the older buggy behavior (every payload-carrying row
// keyed by its unique listing id, so it never folded) showed five copies of one enchanted
// weapon as five rows. The crafter name still rides the row's tooltip; it just no longer
// forces a separate row.
//
// Deterministic tie-break: when two listings for the same goods share the lowest price,
// the one with the smaller `id` wins (ids are assigned in strictly increasing order by
// Market.nextListingId, so this always resolves to the OLDER listing, not whichever one
// happened to sort first in the caller's array).
//
// Output order: one row per identity, in the order that identity FIRST appears in
// `listings`. Feeding this the market's name-then-price sorted book (see Market.sortedBook)
// yields an alphabetically-ordered result, matching the uncollapsed Browse list; the
// function does not depend on that ordering to pick the winner. Relies on Map's
// insertion-order iteration (re-`set`ting an existing key does not move it), so the winners
// come out in first-seen order without a separate order-tracking array.

export interface CollapsibleListing {
  id: number;
  itemId: string;
  price: number;
  instance?: ItemInstancePayload;
}

/** The fold key for one listing: same string means "same goods, collapse together".
 *  A plain stack is just its item id. An instanced copy keys on the buyer-relevant facts
 *  (item id + enchant + rolled/masterwork stats), but never the signer, so identical gear
 *  from different crafters folds into one lowest-price row. The instanced key is a
 *  JSON-encoded array with a leading 'i' tag, so no field value (even one containing the
 *  delimiter characters) can be split or made to collide with another key, and a plain
 *  string item id can never equal the JSON-array form. */
export function collapseIdentity(listing: CollapsibleListing): string {
  const inst = listing.instance;
  if (!inst) return listing.itemId;
  const enchant = inst.enchant ?? '';
  // Only masterwork + rolled.stats go in the key. rolled.quality is deliberately
  // excluded: it is legacy-only (new crafts never write it), it does not affect stats,
  // and it is never rendered to a buyer in the market row or tooltip, so two copies
  // differing only in legacy quality are the same goods to a shopper.
  const rolled = inst.rolled
    ? `${inst.rolled.masterwork ? 'm' : ''}:${serializeStats(inst.rolled.stats)}`
    : '';
  // A copy with an instance payload that carries none of the buyer-relevant facts
  // (only a signer, a bind flag, etc.) folds with the plain fungible stack for the
  // same item: from the buyer's side it is the same goods.
  if (enchant === '' && rolled === '') return listing.itemId;
  return JSON.stringify(['i', listing.itemId, enchant, rolled]);
}

/** Stable, order-independent serialization of a rolled-stats bag so two copies with the
 *  same stats in a different key order still fold together. */
function serializeStats(stats: Record<string, number> | undefined): string {
  if (!stats) return '';
  return Object.keys(stats)
    .sort()
    .map((k) => `${k}=${stats[k]}`)
    .join(',');
}

export function collapseToLowestPerItem<T extends CollapsibleListing>(listings: readonly T[]): T[] {
  const bestByIdentity = new Map<string, T>();
  for (const listing of listings) {
    const identity = collapseIdentity(listing);
    const current = bestByIdentity.get(identity);
    if (
      !current ||
      listing.price < current.price ||
      (listing.price === current.price && listing.id < current.id)
    ) {
      bestByIdentity.set(identity, listing);
    }
  }
  return [...bestByIdentity.values()];
}
