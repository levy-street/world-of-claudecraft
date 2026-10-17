// The enemy cooldown row on the peer wire: the server encode
// (server/major_cooldown_wire.ts, spliced beside `auras` by game.ts wireCacheFor)
// and the client decode (src/net/peer_major_cooldown_wire.ts, called from
// online.ts on the aura channel and the snapshot clock), round-tripped here so
// the `mcd` key and its deadline shape cannot drift on one side only. The real
// broadcast path is pinned end to end by tests/major_cooldown_broadcast.test.ts.
import { describe, expect, it } from 'vitest';
import { MajorCooldownWireCache } from '../server/major_cooldown_wire';
import { blankEntity } from '../src/net/blank_entity';
import {
  agePeerMajorCooldowns,
  applyPeerMajorCooldownWire,
} from '../src/net/peer_major_cooldown_wire';
import type { Aura, Entity } from '../src/sim/types';

function serverPlayer(cooldowns: Record<string, number>): Entity {
  const e = blankEntity(7);
  e.kind = 'player';
  e.cooldowns = new Map(Object.entries(cooldowns));
  return e;
}

const mcdOf = (cache: MajorCooldownWireCache) => JSON.parse(cache.json);

describe('major cooldown wire (server encode)', () => {
  it('ships only tracked cooldowns, as deadlines on the sim clock', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(
      serverPlayer({
        barkskin: 40,
        'trinket:medallion_of_defiance': 90,
        mortal_strike: 4, // a rotation button: never rides
        system_unstuck: 300, // not an ability at all
      }),
      1000,
      0,
    );
    expect(mcdOf(cache)).toEqual({ barkskin: 1040, 'trinket:medallion_of_defiance': 1090 });
  });

  it('holds its revision while the cooldown counts down, and bumps on any change', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ recklessness: 180 });
    const r0 = cache.encode(e, 500, 3).revision;
    e.cooldowns.set('recklessness', 179.95);
    expect(cache.encode(e, 500.05, 3).revision).toBe(r0);
    // A changed paired aura revision bumps it: the channel is one version.
    expect(cache.encode(e, 500.1, 4).revision).toBe(r0 + 1);
    // A newly armed cooldown bumps it.
    e.cooldowns.set('avatar', 180);
    expect(cache.encode(e, 500.15, 4).revision).toBe(r0 + 2);
  });

  it('splices mcd beside the auras of a record', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(serverPlayer({ evasion: 100 }), 10, 0);
    expect(JSON.parse(cache.splice('{"x":1,"auras":[]}'))).toEqual({
      x: 1,
      auras: [],
      mcd: { evasion: 110 },
    });
  });

  it('ships null for no running tracked cooldown, and nothing for a mob', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(serverPlayer({ mortal_strike: 4 }), 10, 0);
    expect(cache.json).toBe('null');
    const mob = serverPlayer({ barkskin: 30 });
    mob.kind = 'mob';
    cache.encode(mob, 10, 0);
    expect(cache.json).toBe('null');
  });

  it('never reads an equip lockout as a used medallion', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ 'trinket:medallion_of_defiance': 30 });
    cache.encode(e, 0, 0);
    expect(cache.json).toBe('null');
    // Once the lockout ran out, a real use (the full 2 min) shows.
    e.cooldowns.delete('trinket:medallion_of_defiance');
    cache.encode(e, 30, 0);
    e.cooldowns.set('trinket:medallion_of_defiance', 120);
    cache.encode(e, 40, 0);
    expect(mcdOf(cache)).toEqual({ 'trinket:medallion_of_defiance': 160 });
    // ...and keeps showing down to the last seconds of that cooldown.
    e.cooldowns.set('trinket:medallion_of_defiance', 5);
    cache.encode(e, 155, 0);
    expect(mcdOf(cache)).toEqual({ 'trinket:medallion_of_defiance': 160 });
  });

  it('projects the hourglass-accelerated deadline, which holds still while it runs', () => {
    const cache = new MajorCooldownWireCache();
    const e = serverPlayer({ recklessness: 100 });
    e.auras = [
      {
        id: 'temporal_hourglass',
        name: 'Temporal Hourglass',
        kind: 'stasis',
        remaining: 5,
        duration: 5,
        value: 2,
        sourceId: 7,
      } as Aura,
    ];
    cache.encode(e, 0, 0);
    // 5 sec at 2x does 10 sec of work, then 90 sec at 1x: ready at 95, not 100.
    expect(mcdOf(cache)).toEqual({ recklessness: 95 });
    const r0 = cache.revision;
    e.cooldowns.set('recklessness', 99.9);
    e.auras[0].remaining = 4.95;
    cache.encode(e, 0.05, 0);
    expect(cache.revision).toBe(r0);
  });
});

describe('major cooldown wire (client decode)', () => {
  it('decodes deadlines into the peer cooldown map and ages them on the snapshot clock', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, { barkskin: 1040, recklessness: 1005 }, 1000);
    expect(peer.cooldowns.get('barkskin')).toBe(40);
    expect(peer.cooldowns.get('recklessness')).toBe(5);
    agePeerMajorCooldowns([peer], 1010);
    expect(peer.cooldowns.get('barkskin')).toBe(30);
    expect(peer.cooldowns.has('recklessness')).toBe(false);
  });

  it('treats each record carrying the channel as the whole truth', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, { barkskin: 1040, avatar: 1100 }, 1000);
    applyPeerMajorCooldownWire(peer, { avatar: 1100 }, 1001);
    expect(peer.cooldowns.has('barkskin')).toBe(false);
    expect(peer.cooldowns.get('avatar')).toBe(99);
    applyPeerMajorCooldownWire(peer, null, 1002);
    expect(peer.cooldowns.size).toBe(0);
    agePeerMajorCooldowns([peer], 1003);
    expect(peer.cooldowns.size).toBe(0);
  });

  it('round-trips the server encode through JSON to the client decode', () => {
    const cache = new MajorCooldownWireCache();
    cache.encode(serverPlayer({ evasion: 120, 'trinket:medallion_of_defiance': 45 }), 2000, 0);
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, JSON.parse(cache.json), 2000);
    expect(Object.fromEntries(peer.cooldowns)).toEqual({
      evasion: 120,
      'trinket:medallion_of_defiance': 45,
    });
  });

  it('never writes into the self entity, and forgets a peer that became the self', () => {
    const e = blankEntity(7);
    applyPeerMajorCooldownWire(e, { avatar: 1100 }, 1000);
    expect(e.cooldowns.get('avatar')).toBe(100);
    // A spectate rebinds the player id: the self channel now owns this map.
    e.cooldowns.set('avatar', 42);
    applyPeerMajorCooldownWire(e, { avatar: 1100 }, 1001, true);
    agePeerMajorCooldowns([e], 1002, 7);
    expect(e.cooldowns.get('avatar')).toBe(42);
    // Aging with the self id also forgets any held deadlines.
    const other = blankEntity(9);
    applyPeerMajorCooldownWire(other, { avatar: 1100 }, 1000);
    other.cooldowns.set('avatar', 7);
    agePeerMajorCooldowns([other], 1001, 9);
    expect(other.cooldowns.get('avatar')).toBe(7);
  });

  it('drops malformed rows, an unknown clock, and a deadline a clock reset made impossible', () => {
    const peer = blankEntity(7);
    applyPeerMajorCooldownWire(peer, { barkskin: 'soon', avatar: 1100 }, 1000);
    expect(Object.fromEntries(peer.cooldowns)).toEqual({ avatar: 100 });
    applyPeerMajorCooldownWire(peer, { avatar: 1100 }, Number.NaN);
    expect(peer.cooldowns.size).toBe(0);
    // A restarted realm's clock went back to 50: 1050 sec left on a 3 min cooldown is stale.
    applyPeerMajorCooldownWire(peer, { avatar: 1100 }, 1000);
    agePeerMajorCooldowns([peer], 50);
    expect(peer.cooldowns.has('avatar')).toBe(false);
  });
});
