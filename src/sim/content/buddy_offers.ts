// Collection unlocks are services, never inventory item definitions.
import type { BuddyKey } from './buddies';

export interface BuddyVendorOffer {
  id: string;
  kind: 'companion';
  buddy: BuddyKey;
  priceHonor: number;
  slot?: never;
}

export const TUG_HONOR_OFFER: Readonly<BuddyVendorOffer> = Object.freeze({
  id: 'companion_horse',
  kind: 'companion',
  buddy: 'horse',
  priceHonor: 10_000,
});

export function buddyVendorOffer(id: string): Readonly<BuddyVendorOffer> | undefined {
  return id === TUG_HONOR_OFFER.id ? TUG_HONOR_OFFER : undefined;
}
