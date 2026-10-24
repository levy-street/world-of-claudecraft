// The per-entity display status bits (server/entity_status_wire.ts encodes,
// src/net/entity_status_wire.ts decodes): /afk (`ak`), the World PvP flag
// (`pvp`) and the World PvP bounty (`bty`). Each rides only while set, and the
// dynamic record is re-sent whole, so an absent key decodes to unset.
import { describe, expect, it } from 'vitest';
import { ENTITY_STATUS_KEYS, writeEntityStatusWire } from '../server/entity_status_wire';
import { applyEntityStatusWire } from '../src/net/entity_status_wire';
import type { Entity } from '../src/sim/types';

function encode(over: Partial<Entity>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  writeEntityStatusWire({ afk: false, ...over } as Entity, out);
  return out;
}

describe('the entity status wire bits', () => {
  it('pins the three keys byte for byte', () => {
    expect(ENTITY_STATUS_KEYS).toEqual(['ak', 'pvp', 'bty']);
  });

  it('writes nothing for an entity with no status, so its record is unchanged', () => {
    expect(encode({})).toEqual({});
  });

  it('writes each bit only while it is set', () => {
    expect(encode({ afk: true })).toEqual({ ak: 1 });
    expect(encode({ pvpFlag: true })).toEqual({ pvp: 1 });
    expect(encode({ bounty: true })).toEqual({ bty: 1 });
    expect(encode({ afk: true, pvpFlag: true, bounty: true })).toEqual({ ak: 1, pvp: 1, bty: 1 });
  });

  it('round-trips every bit, and an absent key clears a bit the mirror held', () => {
    const mirror = { afk: false, pvpFlag: false, bounty: false } as Entity;
    applyEntityStatusWire(mirror, encode({ afk: true, pvpFlag: true, bounty: true }));
    expect([mirror.afk, mirror.pvpFlag, mirror.bounty]).toEqual([true, true, true]);
    applyEntityStatusWire(mirror, encode({ pvpFlag: true }));
    expect([mirror.afk, mirror.pvpFlag, mirror.bounty]).toEqual([false, true, false]);
  });
});
