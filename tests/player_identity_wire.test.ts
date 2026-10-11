// The player identity lines on the peer wire: the server encode
// (server/player_identity_wire.ts, called from identityFields) and the client
// decode (src/net/player_identity_wire.ts, called from the online.ts identity
// block), round-tripped here so a renamed key cannot drift on one side only.
import { describe, expect, it } from 'vitest';
import { writePlayerIdentityWire } from '../server/player_identity_wire';
import { decodePlayerIdentityWire } from '../src/net/player_identity_wire';
import type { Entity } from '../src/sim/types';

type IdentitySlice = Pick<
  Entity,
  'guild' | 'pledgeGuild' | 'guildTier' | 'title' | 'border' | 'specId'
>;

const encode = (slice: IdentitySlice): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  writePlayerIdentityWire(slice as Entity, out);
  // Through JSON, exactly as the per-tick identity stringify ships it.
  return JSON.parse(JSON.stringify(out));
};

const NONE: IdentitySlice = {
  guild: '',
  pledgeGuild: '',
  guildTier: 0,
  title: null,
  border: null,
  specId: null,
};

describe('player identity wire', () => {
  it('ships no bytes for an unguilded, untitled, unspecced player', () => {
    expect(encode(NONE)).toEqual({});
    expect(decodePlayerIdentityWire({})).toEqual(NONE);
  });

  it('keeps the terse keys the older clients already read, plus spc for the spec', () => {
    expect(
      encode({
        guild: 'Order of Dawn',
        pledgeGuild: '',
        guildTier: 2,
        title: 'deed_title',
        border: 'deed_border',
        specId: 'holy',
      }),
    ).toEqual({
      gd: 'Order of Dawn',
      gt: 2,
      title: 'deed_title',
      border: 'deed_border',
      spc: 'holy',
    });
    expect(encode({ ...NONE, pledgeGuild: 'Dawnwardens', guildTier: 1 })).toEqual({
      pg: 'Dawnwardens',
      gt: 1,
    });
  });

  it('round-trips every field through encode and decode', () => {
    const full: IdentitySlice = {
      guild: 'Order of Dawn',
      pledgeGuild: '',
      guildTier: 3,
      title: 'deed_title',
      border: 'deed_border',
      specId: 'restoration',
    };
    expect(decodePlayerIdentityWire(encode(full))).toEqual(full);
    const pledged: IdentitySlice = { ...NONE, pledgeGuild: 'Dawnwardens', guildTier: 1 };
    expect(decodePlayerIdentityWire(encode(pledged))).toEqual(pledged);
  });

  it('resets a cleared spec: a respec to none drops the key and the decode reads null', () => {
    const specced = decodePlayerIdentityWire(encode({ ...NONE, specId: 'arms' }));
    expect(specced.specId).toBe('arms');
    expect(decodePlayerIdentityWire(encode({ ...NONE, specId: null })).specId).toBeNull();
  });

  it('reads a malformed spec value as no spec rather than printing it', () => {
    for (const spc of [7, '', {}, ['holy'], true]) {
      expect(decodePlayerIdentityWire({ spc }).specId, JSON.stringify(spc)).toBeNull();
    }
  });
});
