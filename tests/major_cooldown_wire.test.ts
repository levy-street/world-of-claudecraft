// The enemy cooldown row on the peer wire: the server encode
// (server/major_cooldown_wire.ts, spliced beside `auras` by game.ts wireCacheFor)
// and the client decode (src/net/peer_major_cooldown_wire.ts, called from
// online.ts on the aura channel), round-tripped here so the `mcd` key and its
// shape cannot drift on one side only. The real broadcast path is pinned end to
// end by tests/major_cooldown_broadcast.test.ts.
//
// The load-bearing rule: the wire names WHICH tracked cooldowns are spent, never
// WHEN they come back, so no client (modified or not) can read another player's
// remaining defensive time.
import { describe, expect, it } from 'vitest';
import { MajorCooldownWireCache } from '../server/major_cooldown_wire';
import { blankEntity } from '../src/net/blank_entity';
import {
  applyPeerMajorCooldownWire,
  SPENT_COOLDOWN_UNKNOWN_REMAINING,
} from '../src/net/peer_major_cooldown_wire';
import type { Entity } from '../src/sim/types';

function serverPlayer(cooldowns: Record<string, number>): Entity {
  const e = blankEntity(7);
  e.kind = 'player';
  e.cooldowns = new Map(Object.entries(cooldowns));
  return e;
}

const mcdOf = (cache: MajorCooldownWireCache) => JSON.parse(cache.json);

describe('major cooldown wire (server encode)', () => {
  it('ships only which tracked cooldowns are spent, sorted, with no time at all', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(
      serverPlayer({
        recklessness: 140,
        barkskin: 40,
        'trinket:medallion_of_defiance': 90,
        system_medallion_use: 90,
        mortal_strike: 4, // a rotation button: never rides
        system_unstuck: 300, // not an ability at all
      }),
      0,
      0,
    );
    expect(mcdOf(cache)).toEqual(['barkskin', 'recklessness', 'trinket:medallion_of_defiance']);
    // No number of any kind leaks: not a deadline, not a remaining time.
    expect(cache.json).not.toMatch(/\d/);
  });

  it('does not change while cooldowns count down, and changes only when one is used or ends', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ recklessness: 180 });
    const r0 = cache.encode(e, 3, 0).revision;
    const json0 = cache.json;
    e.cooldowns.set('recklessness', 12.5);
    expect(cache.encode(e, 3, 0).revision).toBe(r0);
    expect(cache.json).toBe(json0);
    // A changed paired aura revision bumps it: the channel is one version.
    expect(cache.encode(e, 4, 0).revision).toBe(r0 + 1);
    // A newly used cooldown bumps it.
    e.cooldowns.set('avatar', 180);
    expect(cache.encode(e, 4, 0).revision).toBe(r0 + 2);
    // One coming back bumps it.
    e.cooldowns.delete('recklessness');
    expect(cache.encode(e, 4, 0).revision).toBe(r0 + 3);
    expect(mcdOf(cache)).toEqual(['avatar']);
  });

  it('never infers medallion use from an inherited gate and honors a late factual use', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ 'trinket:medallion_of_defiance': 180 });
    cache.encode(e, 0, 100);
    expect(cache.json).toBe('null');
    e.cooldowns.set('system_medallion_use', 20);
    cache.encode(e, 0, 100);
    expect(mcdOf(cache)).toEqual(['trinket:medallion_of_defiance']);
    e.cooldowns.delete('system_medallion_use');
    cache.encode(e, 0, 121);
    expect(cache.json).toBe('null');
  });

  it('splices mcd beside the auras of a record', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(serverPlayer({ evasion: 100 }), 0, 0);
    expect(JSON.parse(cache.splice('{"x":1,"auras":[]}'))).toEqual({
      x: 1,
      auras: [],
      mcd: ['evasion'],
    });
  });

  it('ships null for no spent tracked cooldown, and nothing for a mob', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(serverPlayer({ mortal_strike: 4 }), 0, 0);
    expect(cache.json).toBe('null');
    const mob = serverPlayer({ barkskin: 30 });
    mob.kind = 'mob';
    cache.encode(mob, 0, 0);
    expect(cache.json).toBe('null');
  });

  it('never reads an equip lockout as a used medallion', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ 'trinket:medallion_of_defiance': 30 });
    cache.encode(e, 0, 0);
    expect(cache.json).toBe('null');
    // Once the lockout ran out, a real use (the full 2 min) shows...
    e.cooldowns.delete('trinket:medallion_of_defiance');
    cache.encode(e, 0, 0);
    e.cooldowns.set('trinket:medallion_of_defiance', 120);
    e.cooldowns.set('system_medallion_use', 120);
    cache.encode(e, 0, 0);
    expect(mcdOf(cache)).toEqual(['trinket:medallion_of_defiance']);
    // ...and keeps showing down to the last seconds of that cooldown.
    e.cooldowns.set('trinket:medallion_of_defiance', 5);
    e.cooldowns.set('system_medallion_use', 5);
    cache.encode(e, 0, 0);
    expect(mcdOf(cache)).toEqual(['trinket:medallion_of_defiance']);
  });
});

describe('major cooldown wire (medallion while unobserved)', () => {
  const MEDALLION = 'trinket:medallion_of_defiance';

  it('judges a re-armed medallion afresh: an equip lockout after an unseen end stays hidden', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ [MEDALLION]: 120, system_medallion_use: 120 });
    cache.encode(e, 0, 100); // used while observed: ends at 220
    expect(mcdOf(cache)).toEqual([MEDALLION]);
    // Out of everyone's interest: the cooldown ran out, then the trinket was
    // re-equipped (a 30 s lockout). First seen again at t=400, ending at 430.
    e.cooldowns.set(MEDALLION, 30);
    e.cooldowns.delete('system_medallion_use');
    cache.encode(e, 0, 400);
    expect(cache.json).toBe('null');
  });

  it('judges a fresh use after an unseen end as a use', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ [MEDALLION]: 120, system_medallion_use: 120 });
    cache.encode(e, 0, 100);
    e.cooldowns.set('system_medallion_use', 110);
    e.cooldowns.set(MEDALLION, 110); // a second use, seen at t=300
    cache.encode(e, 0, 300);
    expect(mcdOf(cache)).toEqual([MEDALLION]);
  });

  it('keeps a judged use shown as it counts down across ticks', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ [MEDALLION]: 120, system_medallion_use: 120 });
    for (let t = 0; t < 119; t += 0.05) {
      e.cooldowns.set(MEDALLION, 120 - t);
      e.cooldowns.set('system_medallion_use', 120 - t);
      cache.encode(e, 0, t);
      if (cache.json === 'null') throw new Error(`hidden at t=${t}`);
    }
  });
});

describe('major cooldown wire (client decode)', () => {
  it('mirrors the spent keys into the peer cooldown map with their time withheld', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, ['barkskin', 'recklessness']);
    expect(peer.cooldowns.get('barkskin')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
    expect(peer.cooldowns.get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
  });

  it('treats each record carrying the channel as the whole truth', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, ['barkskin', 'avatar']);
    applyPeerMajorCooldownWire(peer, ['avatar']);
    expect([...peer.cooldowns.keys()]).toEqual(['avatar']);
    applyPeerMajorCooldownWire(peer, null);
    expect(peer.cooldowns.size).toBe(0);
  });

  it('round-trips the server encode through JSON to the client decode', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(
      serverPlayer({ evasion: 120, 'trinket:medallion_of_defiance': 45, system_medallion_use: 45 }),
      0,
      0,
    );
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, JSON.parse(cache.json));
    expect([...peer.cooldowns.keys()].sort()).toEqual([
      'evasion',
      'system_medallion_use',
      'trinket:medallion_of_defiance',
    ]);
  });

  it('never writes into the self entity, and forgets a peer that became the self', () => {
    const e = blankEntity(7);
    applyPeerMajorCooldownWire(e, ['avatar']);
    // A spectate rebinds the player id: the self channel now owns this map.
    e.cooldowns.set('avatar', 42);
    applyPeerMajorCooldownWire(e, ['avatar', 'evasion'], true);
    expect(Object.fromEntries(e.cooldowns)).toEqual({ avatar: 42 });
    // Back to peer ownership: a whole channel clears the former self values,
    // even though the peer-held set was forgotten during the self phase.
    e.cooldowns.set('system_unstuck', 10);
    applyPeerMajorCooldownWire(e, null);
    expect(Object.fromEntries(e.cooldowns)).toEqual({ system_unstuck: 10 });
  });

  it('clears medallion provenance on a channel reset and self-to-peer handoff', () => {
    const e = blankEntity(7);
    const key = 'trinket:medallion_of_defiance';
    const fact = 'system_medallion_use';
    applyPeerMajorCooldownWire(e, [key]);
    expect(e.cooldowns.get(fact)).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
    applyPeerMajorCooldownWire(e, null);
    expect(e.cooldowns.has(fact)).toBe(false);
    applyPeerMajorCooldownWire(e, [key]);
    e.cooldowns.set(fact, 12);
    e.cooldowns.set(key, 12);
    applyPeerMajorCooldownWire(e, null, true);
    expect(e.cooldowns.get(fact)).toBe(12);
    applyPeerMajorCooldownWire(e, null);
    expect(e.cooldowns.has(fact)).toBe(false);
    expect(e.cooldowns.has(key)).toBe(false);
  });

  it('drops malformed rows instead of painting garbage', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, ['avatar', 'raised_guard', 'unknown', 42, null, { key: 'x' }]);
    expect([...peer.cooldowns.keys()]).toEqual(['avatar']);
    applyPeerMajorCooldownWire(peer, { avatar: 1100 });
    expect(peer.cooldowns.size).toBe(0);
  });
});
