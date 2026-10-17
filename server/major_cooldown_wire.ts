// Encode half of the enemy cooldown row on nameplates: a player's tracked
// cooldowns (src/sim/major_cooldowns.ts, the classifier both hosts share) as
// absolute deadlines on the sim clock, under the `mcd` key. The decode is
// src/net/peer_major_cooldown_wire.ts; the pair is pinned together by
// tests/major_cooldown_wire.test.ts.
//
// It rides the STABLE AURA CHANNEL, not the base dynamic record: game.ts
// wireCacheFor splices `mcd` beside `auras` and folds this cache's revision into
// the entity's aura version, so a peer receives it on first sight, on a full
// record, and on a lite record only when the auras or these deadlines changed.
// A moving player's lite records (sent most ticks) therefore never repeat it,
// and the client keeps its held deadlines when a lite record omits the channel.
// Legacy-wire sessions never get it (they predate the row).
//
// Deadlines, not remaining seconds: a deadline holds still while the cooldown
// counts down, so nothing changes tick to tick. Under a protective Temporal
// Hourglass the cooldown runs faster, and the deadline is the self wire's own
// projection (cooldownDeadline), which also holds still.
//
// The PvP medallion shows only once USED: equipping a trinket arms a lockout of
// TRINKET_EQUIP_LOCKOUT on its key (src/sim/combat/trinkets.ts), which must not
// read as a spent medallion. A key first seen above that lockout is a use; one
// first seen at or under it is the equip lockout and stays off the wire.
//
// Per tick per observed entity: a walk of the entity's own cooldown map (bounded
// by the classified roster, a few dozen keys at most) into a reused scratch map,
// compared entry by entry; the JSON is rebuilt only when a deadline changed.

import { TRINKET_EQUIP_LOCKOUT } from '../src/sim/combat/trinkets';
import { majorCooldownGroup, PVP_MEDALLION_COOLDOWN_KEY } from '../src/sim/major_cooldowns';
import type { Entity } from '../src/sim/types';
import { cooldownDeadline, findProtectiveHourglass, jsonWithField } from './snapshot_timer_wire';

function sameDeadlines(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, deadline] of a) if (b.get(key) !== deadline) return false;
  return true;
}

export class MajorCooldownWireCache {
  /** The `mcd` value as JSON: an object of key to deadline, or `null` for none. */
  json = 'null';
  /** Bumps whenever the paired aura revision or these deadlines change; the
   *  caller uses it as the entity's whole aura-channel version. */
  revision = 0;
  private current = new Map<string, number>();
  private scratch = new Map<string, number>();
  private auraRevision = -1;
  private medallionUsed = false;

  encode(e: Entity, simTime: number, auraRevision: number): this {
    let changed = auraRevision !== this.auraRevision;
    this.auraRevision = auraRevision;
    const next = this.scratch;
    next.clear();
    if (e.kind === 'player' && e.cooldowns.size > 0) {
      const hourglass = findProtectiveHourglass(e.auras);
      for (const [key, remaining] of e.cooldowns) {
        if (!(remaining > 0) || majorCooldownGroup(key) === null) continue;
        if (key === PVP_MEDALLION_COOLDOWN_KEY) {
          if (!this.medallionUsed && remaining <= TRINKET_EQUIP_LOCKOUT) continue;
          this.medallionUsed = true;
        }
        const deadline = cooldownDeadline(key, remaining, simTime, hourglass, e.dead);
        next.set(key, Array.isArray(deadline) ? deadline[0] : deadline);
      }
    }
    if (!next.has(PVP_MEDALLION_COOLDOWN_KEY)) {
      this.medallionUsed =
        (e.cooldowns.get(PVP_MEDALLION_COOLDOWN_KEY) ?? 0) > 0 && this.medallionUsed;
    }
    if (!sameDeadlines(next, this.current)) {
      this.scratch = this.current;
      this.current = next;
      this.json = next.size > 0 ? JSON.stringify(Object.fromEntries(next)) : 'null';
      changed = true;
    }
    if (changed) this.revision++;
    return this;
  }

  /** Splice `mcd` into an entity record already carrying its `auras`. */
  splice(recordJson: string): string {
    return jsonWithField(recordJson, 'mcd', this.json);
  }
}
