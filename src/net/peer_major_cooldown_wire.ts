// Decode half of the enemy cooldown row on nameplates: the `mcd` deadlines a
// peer player's record carries (server/major_cooldown_wire.ts) become remaining
// seconds in that entity's own `cooldowns` map, the same field the offline Sim
// fills for its bots, so the nameplate row reads one shape on both hosts and
// never asks which world it is in.
//
// `mcd` rides the stable aura channel: online.ts applies it only on a record
// that carries `auras` (snapshotCarriesAuras), where it is the whole truth. A
// lite record without the channel leaves the held deadlines alone, and so does
// a bare `keep` id; both age from the held deadlines on every snapshot clock
// (agePeerMajorCooldowns) instead.
//
// Never applied to the viewer's own record: the self cooldowns ride their own
// exact channel (selfWireJson `cds`). A peer that BECOMES the self (a spectate
// rebinding the player id) has its held deadlines dropped, never aged into the
// map `cds` now owns.

import { majorCooldownBaseSec } from '../sim/major_cooldowns';
import type { Entity } from '../sim/types';

const held = new WeakMap<Entity, Map<string, number>>();

// A held countdown longer than this many base cooldowns is stale: a realm
// restart rewound the sim clock under it. Talents only ever shorten a cooldown.
const STALE_BASE_MULTIPLE = 2;

function setRemaining(e: Entity, deadlines: Map<string, number>, now: number): void {
  for (const [key, deadline] of deadlines) {
    const remaining = deadline - now;
    if (remaining > 0 && remaining <= majorCooldownBaseSec(key) * STALE_BASE_MULTIPLE) {
      e.cooldowns.set(key, remaining);
    } else {
      deadlines.delete(key);
      e.cooldowns.delete(key);
    }
  }
}

/** Apply one record's `mcd` field (a record that carries the aura channel). An
 *  absent or null field clears every deadline the entity held. `isSelf` drops
 *  the held deadlines without touching the map the self channel owns. */
export function applyPeerMajorCooldownWire(
  e: Entity,
  raw: unknown,
  now: number,
  isSelf = false,
): void {
  const prior = held.get(e);
  if (isSelf) {
    held.delete(e);
    return;
  }
  if (prior) for (const key of prior.keys()) e.cooldowns.delete(key);
  if (raw === null || typeof raw !== 'object' || !Number.isFinite(now)) {
    held.delete(e);
    return;
  }
  const deadlines = new Map<string, number>();
  for (const [key, deadline] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof deadline === 'number' && Number.isFinite(deadline)) deadlines.set(key, deadline);
  }
  setRemaining(e, deadlines, now);
  if (deadlines.size > 0) held.set(e, deadlines);
  else held.delete(e);
}

/** Age every held peer countdown to the snapshot clock `now`. The viewer's own
 *  entity (`selfId`) is skipped and forgotten: its cooldowns are the self wire's. */
export function agePeerMajorCooldowns(entities: Iterable<Entity>, now: number, selfId = -1): void {
  if (!Number.isFinite(now)) return;
  for (const e of entities) {
    const deadlines = held.get(e);
    if (!deadlines) continue;
    if (e.id === selfId) {
      held.delete(e);
      continue;
    }
    setRemaining(e, deadlines, now);
    if (deadlines.size === 0) held.delete(e);
  }
}
