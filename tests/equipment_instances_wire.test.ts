import { describe, expect, it } from 'vitest';
import { bareClient } from './helpers/bare_client';

// The self-snapshot einst decode (src/net/online.ts applySnapshot): the worn
// per-copy payload mirror the paperdoll drop pre-check reads. Three contract
// arms: an explicit wire null clears to an EMPTY MAP (never null, the mirror's
// type says plain map and every instances?.[slot] consumer assumes one), an
// absent field keeps the prior mirror (the delta invariant), and a real map
// replaces it wholesale.

function makeSelf(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 7,
    k: 'player',
    tid: 'warrior',
    nm: 'Wire',
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 100,
    rtype: 'mana',
    xp: 0,
    copper: 0,
    inv: [],
    equip: {},
    qlog: [],
    qdone: [],
    cds: {},
    gcd: 0,
    stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    ...overrides,
  };
}

function apply(c: unknown, tick: number, self: Record<string, unknown>): void {
  (c as { applySnapshot(snap: unknown): void }).applySnapshot({
    t: 'snap',
    tick,
    time: tick * 0.05,
    self,
    ents: [],
  });
}

describe('equipment instance payloads over the wire (einst)', () => {
  it('an explicit null einst clears the mirror to an empty map, never to null', () => {
    // The server's maybe() encoder stringifies `value ?? null`, so a null CAN
    // ride the wire if a future encoder change ever produces one. Seed a
    // non-empty mirror first so "cleared to {}" is distinguishable from
    // "kept the prior value".
    const c = bareClient(7);
    c.equipmentInstances = { ring1: { rolled: { quality: 'legendary' } } };
    apply(c, 1, makeSelf({ einst: null }));
    expect(c.equipmentInstances).toEqual({});
    expect(c.equipmentInstances).not.toBeNull();
  });

  it('an absent einst keeps the prior mirror (the delta invariant)', () => {
    const c = bareClient(7);
    c.equipmentInstances = { ring1: { rolled: { quality: 'legendary' } } };
    apply(c, 1, makeSelf({}));
    expect(c.equipmentInstances).toEqual({ ring1: { rolled: { quality: 'legendary' } } });
  });

  it('a real einst map replaces the mirror wholesale', () => {
    const c = bareClient(7);
    c.equipmentInstances = { ring1: { rolled: { quality: 'legendary' } } };
    apply(c, 1, makeSelf({ einst: { neck: { rolled: { quality: 'epic' } } } }));
    expect(c.equipmentInstances).toEqual({ neck: { rolled: { quality: 'epic' } } });
  });
});
