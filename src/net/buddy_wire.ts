// The client-side mirror of the buddy collection (IWorldBuddies): the two
// delta-guarded self-snapshot keys the server emits (server/buddy_wire.ts
// emitBuddySelfKeys), decoded through the active catalog so archived keys
// never reach the HUD. A key omitted from a snapshot keeps
// the prior mirror, exactly like mntOwn. Pure: no DOM, no world state.

import { type BuddyKey, normalizeBuddyKey } from '../sim/content/buddies';

export interface BuddySelfMirror {
  owned: BuddyKey[];
  pending: BuddyKey[];
}

export function emptyBuddySelfMirror(): BuddySelfMirror {
  return { owned: [], pending: [] };
}

function keyList(value: unknown): BuddyKey[] | null {
  if (!Array.isArray(value)) return null;
  return (value as unknown[])
    .map((k) => normalizeBuddyKey(typeof k === 'string' ? k : ''))
    .filter((k): k is BuddyKey => k !== '');
}

/** Fold one self snapshot into the mirror. Returns the same object when the
 *  snapshot carried neither active key, so a caller can keep identity. */
export function decodeBuddySelf(
  s: Record<string, unknown>,
  prev: BuddySelfMirror,
): BuddySelfMirror {
  const owned = keyList(s.budOwn);
  const pending = keyList(s.budPend);
  if (!owned && !pending) return prev;
  return {
    owned: owned ?? prev.owned,
    pending: pending ?? prev.pending,
  };
}
