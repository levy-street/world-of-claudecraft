// Unit tests for emitSelfScalarKeys (server/self_scalar_wire.ts): the static
// combat-rating / progression scalar cohort of the self record plus the
// authoritative in-combat bit, emitted through the caller's delta-eliding
// closure. The delta contract itself (omit when unchanged, always on a fresh
// session) is the closure's and is pinned in tests/snapshots.test.ts; this file
// pins WHAT the emitter hands it.
import { describe, expect, it } from 'vitest';
import { emitSelfScalarKeys, SELF_SCALAR_KEYS } from '../../server/self_scalar_wire';
import type { PlayerMeta } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';

function collect(p: Partial<Entity>, meta: Partial<PlayerMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  emitSelfScalarKeys(
    (key, value) => {
      out[key] = value;
    },
    { xp: 10, lifetimeXp: 20, restedXp: 30.6, prestigeRank: 1, copper: 40, ...meta } as PlayerMeta,
    {
      attackPower: 1,
      spellPower: 2,
      healPower: 3,
      spellHaste: 4,
      critChance: 5,
      dodgeChance: 6,
      blockChance: 7,
      blockValue: 8,
      critRating: 9,
      hasteRating: 10,
      hitRating: 11,
      inCombat: false,
      ...p,
    } as Entity,
    'heroic',
  );
  return out;
}

describe('emitSelfScalarKeys', () => {
  it('emits every registered scalar key exactly once, from its named source', () => {
    const out = collect({}, {});
    expect(Object.keys(out).sort()).toEqual([...SELF_SCALAR_KEYS].sort());
    expect(out).toMatchObject({
      xp: 10,
      lxp: 20,
      rxp: 31, // rounded
      prk: 1,
      copper: 40,
      ap: 1,
      sp: 2,
      hpw: 3,
      sh: 4,
      crit: 5,
      dodge: 6,
      blk: 7,
      bval: 8,
      crat: 9,
      hrat: 10,
      hirat: 11,
      ddiff: 'heroic',
    });
  });

  it('cbt is the sim in-combat flag as a 0/1 bit, never a boolean or an omission', () => {
    expect(collect({ inCombat: true }, {}).cbt).toBe(1);
    expect(collect({ inCombat: false }, {}).cbt).toBe(0);
  });
});
