// Decode half of the enemy cooldown row on nameplates: the `mcd` key list a peer
// player's record carries (server/major_cooldown_wire.ts) names which tracked
// cooldowns that player has SPENT. Each becomes an entry in the entity's own
// `cooldowns` map, the field the offline Sim fills for its bots, so the nameplate
// row reads one shape on both hosts.
//
// The server never sends when a cooldown comes back, so the mirrored entry
// carries no time: SPENT_COOLDOWN_UNKNOWN_REMAINING (Infinity) stands for "spent,
// time withheld" until a later record drops the key.
//
// `mcd` rides the stable aura channel: online.ts applies it only on a record that
// carries `auras` (snapshotCarriesAuras), where it is the whole truth. A lite
// record without the channel, or a bare `keep` id, leaves the held set alone.
//
// Never applied to the viewer's own record: the self cooldowns ride their own
// exact channel (selfWireJson `cds`). A peer that BECOMES the self (a spectate
// rebinding the player id) has its held keys forgotten, never written into the
// map `cds` now owns.

import { MEDALLION_USE_COOLDOWN_KEY } from '../sim/content/trinkets';
import { majorCooldownGroup, PVP_MEDALLION_COOLDOWN_KEY } from '../sim/major_cooldowns';
import type { Entity } from '../sim/types';

/** The remaining time a spent peer cooldown carries on the client: unknown. */
export const SPENT_COOLDOWN_UNKNOWN_REMAINING = Number.POSITIVE_INFINITY;

const held = new WeakMap<Entity, readonly string[]>();

/** Apply one record's `mcd` field (a record that carries the aura channel). An
 *  absent or null field clears every tracked key and medallion fact. `isSelf` forgets the
 *  held keys without touching the map the self channel owns. */
export function applyPeerMajorCooldownWire(e: Entity, raw: unknown, isSelf = false): void {
  const prior = held.get(e);
  if (isSelf) {
    held.delete(e);
    return;
  }
  // This whole channel owns tracked keys, including a previous self/spectated
  // map that has no held peer set. Unrelated timers remain untouched.
  for (const key of e.cooldowns.keys()) {
    if (
      key === MEDALLION_USE_COOLDOWN_KEY ||
      majorCooldownGroup(key) !== null ||
      prior?.includes(key)
    ) {
      e.cooldowns.delete(key);
    }
  }
  const keys = Array.isArray(raw)
    ? raw.filter(
        (key): key is string => typeof key === 'string' && majorCooldownGroup(key) !== null,
      )
    : [];
  for (const key of keys) {
    e.cooldowns.set(key, SPENT_COOLDOWN_UNKNOWN_REMAINING);
    if (key === PVP_MEDALLION_COOLDOWN_KEY) {
      e.cooldowns.set(MEDALLION_USE_COOLDOWN_KEY, SPENT_COOLDOWN_UNKNOWN_REMAINING);
    }
  }
  if (keys.length > 0) held.set(e, keys);
  else held.delete(e);
}
