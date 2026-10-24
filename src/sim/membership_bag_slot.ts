// The optional member bag is stored separately from its active capacity view.
// Membership authority is never read from the character save.
import type { CharacterState } from './character_state';
import { ITEMS } from './data';
import type { PlayerMeta } from './sim';

export const BAG_SOCKETS = 4;
export const MEMBERSHIP_BAG_SOCKET = BAG_SOCKETS;

export function restoreMembershipBag(meta: PlayerMeta, saved: CharacterState): void {
  const id = saved.membershipBag;
  // Preserve an unknown future bag as dormant data, without granting capacity.
  if (typeof id === 'string' && id && (!ITEMS[id] || ITEMS[id].kind === 'bag')) {
    meta.membershipBag = id;
  }
}

/** A constant-sized view consumed by every existing carried capacity gate. */
export function syncMembershipBag(meta: PlayerMeta, active: boolean): void {
  meta.bags.length = active ? BAG_SOCKETS + 1 : BAG_SOCKETS;
  if (active) meta.bags[MEMBERSHIP_BAG_SOCKET] = meta.membershipBag ?? null;
}

/** Called only after the host has verified membership for a bank transaction. */
export function savedMembershipBags(
  saved: Pick<CharacterState, 'bags' | 'membershipBag'>,
): (string | null)[] {
  const bags = (saved.bags ?? []).slice(0, BAG_SOCKETS);
  while (bags.length < BAG_SOCKETS) bags.push(null);
  bags.push(saved.membershipBag ?? null);
  return bags;
}
