// The `corpseHarvestInfo` reply decoder (src/net/corpse_harvest_info_wire.ts):
// every field is re-validated, and anything malformed fails the WHOLE frame
// closed to null rather than resolving with a partial or guessed shape.

import { describe, expect, it } from 'vitest';
import { decodeCorpseHarvestInfoReply } from '../src/net/corpse_harvest_info_wire';

// `over` is a RAW, untyped override bag on purpose: this fixture builds
// intentionally malformed wire frames to prove the decoder's untrusted-input
// boundary (`decodeCorpseHarvestInfoReply(raw: unknown)`) fails closed on
// every one of them. Typing it against the real `CorpseHarvestInfo` shape
// would make the malformed cases themselves fail to compile; the decoder
// under test is what re-validates the shape, so the fixture must not.
function validInfo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    corpseId: 42,
    componentTags: ['hide', 'fang'],
    preference: { kind: 'material', itemId: 'rough_hide' },
    denial: null,
    reservation: null,
    tierBonus: 1,
    ...over,
  };
}

function frame(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: 'corpseHarvestInfo', id: 42, rid: 1, info: validInfo(), ...over };
}

describe('decodeCorpseHarvestInfoReply', () => {
  it('decodes a well-formed reply with a real info object', () => {
    const decoded = decodeCorpseHarvestInfoReply(frame());
    expect(decoded).toEqual({
      id: 42,
      rid: 1,
      info: {
        corpseId: 42,
        componentTags: ['hide', 'fang'],
        preference: { kind: 'material', itemId: 'rough_hide' },
        denial: null,
        reservation: null,
        tierBonus: 1,
      },
    });
  });

  it('decodes a null info as a valid "no usable current answer"', () => {
    expect(decodeCorpseHarvestInfoReply(frame({ info: null }))).toEqual({
      id: 42,
      rid: 1,
      info: null,
    });
  });

  it('decodes an All preference', () => {
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ preference: { kind: 'all' } }) }),
    );
    expect(decoded?.info?.preference).toEqual({ kind: 'all' });
  });

  it('keeps a retired, bounded material preference id verbatim', () => {
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ preference: { kind: 'material', itemId: 'retired_material' } }) }),
    );
    expect(decoded?.info?.preference).toEqual({ kind: 'material', itemId: 'retired_material' });
    const atBound = 'm'.repeat(64);
    const decodedBound = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ preference: { kind: 'material', itemId: atBound } }) }),
    );
    expect(decodedBound?.info?.preference).toEqual({ kind: 'material', itemId: atBound });
  });

  it('decodes every real HarvestAdmissionReason denial', () => {
    const reasons = [
      'malformed_input',
      'actor_dead',
      'actor_in_combat',
      'actor_busy',
      'corpse_invalid',
      'wrong_world',
      'out_of_range',
      'no_field_kit',
      'already_harvested',
      'reserved',
      'priority_protected',
      'corpse_expiring',
      'preference_malformed',
      'nothing_to_harvest',
      'material_unavailable',
      'bags_full',
    ];
    for (const reason of reasons) {
      const decoded = decodeCorpseHarvestInfoReply(frame({ info: validInfo({ denial: reason }) }));
      expect(decoded?.info?.denial, reason).toBe(reason);
    }
  });

  it('decodes a real reservation', () => {
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ reservation: { name: 'Aldric', self: true } }) }),
    );
    expect(decoded?.info?.reservation).toEqual({ name: 'Aldric', self: true });
  });

  it('fails the whole frame closed on an unknown denial word', () => {
    expect(
      decodeCorpseHarvestInfoReply(frame({ info: validInfo({ denial: 'nonsense' }) })),
    ).toBeNull();
  });

  it('fails closed on a malformed preference object', () => {
    for (const preference of [
      { kind: 'material' }, // missing itemId
      { kind: 'material', itemId: 42 },
      { kind: 'material', itemId: 'a'.repeat(65) },
      { kind: 'material', itemId: 'has space' },
      { kind: 'unknown' },
      'all', // string, not the object shape
      42,
    ]) {
      expect(
        decodeCorpseHarvestInfoReply(frame({ info: validInfo({ preference }) })),
        JSON.stringify(preference),
      ).toBeNull();
    }
  });

  it('fails closed on a malformed reservation object', () => {
    for (const reservation of [
      { name: '', self: true },
      { name: 'ab'.repeat(20), self: true }, // overlong
      { name: 'Bob', self: 'yes' }, // self not a strict boolean
      { name: 42, self: false },
      { self: true }, // missing name
      'Aldric',
    ]) {
      expect(
        decodeCorpseHarvestInfoReply(frame({ info: validInfo({ reservation }) })),
        JSON.stringify(reservation),
      ).toBeNull();
    }
  });

  it('fails closed on a malformed componentTags array', () => {
    for (const componentTags of [
      'hide', // not an array
      [1, 2],
      ['hide', ''],
      ['hide', 'a'.repeat(33)], // overlong tag
      Array.from({ length: 13 }, (_, i) => `tag${i}`), // over the count bound
      [{ toString: () => 'hide' }],
    ]) {
      expect(
        decodeCorpseHarvestInfoReply(frame({ info: validInfo({ componentTags }) })),
        JSON.stringify(componentTags),
      ).toBeNull();
    }
  });

  it('never aliases the input componentTags array', () => {
    const raw = ['hide', 'fang'];
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ componentTags: raw }) }),
    );
    expect(decoded?.info?.componentTags).toEqual(raw);
    expect(decoded?.info?.componentTags).not.toBe(raw);
  });

  it('fails closed on a non-finite, negative, or fractional tierBonus', () => {
    for (const tierBonus of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, '2', null]) {
      expect(
        decodeCorpseHarvestInfoReply(frame({ info: validInfo({ tierBonus }) })),
        String(tierBonus),
      ).toBeNull();
    }
  });

  it('fails closed on a tierBonus above the shared HARVEST_TIERS cap', async () => {
    const { HARVEST_TIERS } = await import('../src/sim/professions/gathering');
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ tierBonus: HARVEST_TIERS.length }) }),
    );
    expect(decoded).toBeNull();
    const atCap = decodeCorpseHarvestInfoReply(
      frame({ info: validInfo({ tierBonus: HARVEST_TIERS.length - 1 }) }),
    );
    expect(atCap?.info?.tierBonus).toBe(HARVEST_TIERS.length - 1);
  });

  it('rejects a corpseId that is not a positive safe integer', () => {
    for (const corpseId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '42', null]) {
      expect(
        decodeCorpseHarvestInfoReply(frame({ info: validInfo({ corpseId }) })),
        String(corpseId),
      ).toBeNull();
    }
  });

  it('rejects the whole frame when the nested info.corpseId differs from the envelope id', () => {
    // A matching rid/subject must never deliver another body's status; the
    // decoder must reject outright, never rewrite info.corpseId to hide it.
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ id: 7, info: validInfo({ corpseId: 8 }) }),
    );
    expect(decoded).toBeNull();
  });

  it('accepts a matching nested info.corpseId', () => {
    const decoded = decodeCorpseHarvestInfoReply(
      frame({ id: 7, info: validInfo({ corpseId: 7 }) }),
    );
    expect(decoded?.info?.corpseId).toBe(7);
  });

  it('rejects a wrong or missing frame discriminator', () => {
    expect(decodeCorpseHarvestInfoReply(frame({ t: 'somethingElse' }))).toBeNull();
    expect(decodeCorpseHarvestInfoReply({ id: 1, rid: 1, info: null })).toBeNull();
  });

  it('rejects a non-positive-safe-integer id or rid', () => {
    for (const id of [0, -1, 1.5, '1', null]) {
      expect(decodeCorpseHarvestInfoReply(frame({ id })), String(id)).toBeNull();
    }
    for (const rid of [0, -1, 1.5, '1', null]) {
      expect(decodeCorpseHarvestInfoReply(frame({ rid })), String(rid)).toBeNull();
    }
  });

  it('rejects entirely malformed input without throwing', () => {
    for (const raw of [null, undefined, 42, 'x', [], true, () => {}]) {
      expect(() => decodeCorpseHarvestInfoReply(raw)).not.toThrow();
      expect(decodeCorpseHarvestInfoReply(raw)).toBeNull();
    }
  });

  it('rejects an inherited/prototype-polluted info object', () => {
    class Fake {
      corpseId = 42;
      componentTags = ['hide'];
      preference = null;
      denial = null;
      reservation = null;
      tierBonus = 0;
    }
    expect(decodeCorpseHarvestInfoReply(frame({ info: new Fake() }))).toBeNull();

    const proto = { corpseId: 42 };
    const viaProto = Object.create(proto);
    viaProto.componentTags = [];
    viaProto.preference = null;
    viaProto.denial = null;
    viaProto.reservation = null;
    viaProto.tierBonus = 0;
    expect(decodeCorpseHarvestInfoReply(frame({ info: viaProto }))).toBeNull();
  });
});
