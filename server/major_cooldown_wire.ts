// Encode half of the enemy cooldown row on nameplates: WHICH of a player's
// tracked cooldowns (src/sim/major_cooldowns.ts, the classifier both hosts share)
// are spent, under the `mcd` key, as a sorted array of cooldown keys. The decode
// is src/net/peer_major_cooldown_wire.ts; the pair is pinned together by
// tests/major_cooldown_wire.test.ts.
//
// Never WHEN they come back. A player sees that an enemy has burned a defensive,
// not how long until it is ready again: no remaining time or deadline is ever
// sent, and the set changes only when a tracked cooldown is used or comes back,
// so the wire carries no timing beyond what the plate shows. (A client that
// watched the use happen and knows the base cooldown can still estimate it; no
// encoding can hide that while the spent state is shown at all.)
//
// It rides the STABLE AURA CHANNEL, not the base dynamic record: game.ts
// wireCacheFor splices `mcd` beside `auras` and folds this cache's revision into
// the entity's aura version, so a peer receives it on first sight, on a full
// record, and on a lite record only when the auras or this set changed. A moving
// player's lite records (sent most ticks) therefore never repeat it, and the
// client keeps its held set when a lite record omits the channel. Legacy-wire
// sessions never get it (they predate the row).
//
// The PvP medallion shows only its factual successful-use timer, minted by
// useWornTrinket and aged in the ordinary cooldown Map. Equip/inherited gates
// never prove use, and a late first observer needs no earlier cache observation.
//
// Per tick per observed entity: a walk of the entity's own cooldown map (bounded
// by the classified roster, a few dozen keys at most) into a reused scratch list,
// compared key by key; the JSON is rebuilt only when the set changed.

import { majorCooldownGroup, majorCooldownRemaining } from '../src/sim/major_cooldowns';
import type { Entity } from '../src/sim/types';
import { jsonWithField } from './snapshot_timer_wire';

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class MajorCooldownWireCache {
  /** The `mcd` value as JSON: a sorted array of spent keys, or `null` for none. */
  json = 'null';
  /** Bumps whenever the paired aura revision or this set changes; the caller
   *  uses it as the entity's whole aura-channel version. */
  revision = 0;
  private current: string[] = [];
  private scratch: string[] = [];
  private auraRevision = -1;

  encode(e: Entity, auraRevision: number, _simTime: number): this {
    let changed = auraRevision !== this.auraRevision;
    this.auraRevision = auraRevision;
    const next = this.scratch;
    next.length = 0;
    if (e.kind === 'player' && e.cooldowns.size > 0) {
      for (const [key, heldRemaining] of e.cooldowns) {
        const remaining = majorCooldownRemaining(key, heldRemaining, e.cooldowns);
        if (!(remaining > 0) || majorCooldownGroup(key) === null) continue;
        next.push(key);
      }
      next.sort();
    }
    if (!sameKeys(next, this.current)) {
      this.scratch = this.current;
      this.current = next;
      this.json = next.length > 0 ? JSON.stringify(next) : 'null';
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
