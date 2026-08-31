import { describe, expect, it } from 'vitest';
import {
  decodeConsecrations,
  decodeFrostRings,
  decodeIgnivarMeteors,
  decodeTemporalHourglasses,
  decodeVarkhulForgestormWarnings,
} from '../src/net/ground_telegraph_wire';

describe('ground telegraph snapshot decoders', () => {
  it('returns empty arrays for a non-array payload', () => {
    expect(decodeFrostRings(undefined)).toEqual([]);
    expect(decodeIgnivarMeteors(null)).toEqual([]);
    expect(decodeVarkhulForgestormWarnings({})).toEqual([]);
    expect(decodeTemporalHourglasses('rows')).toEqual([]);
    expect(decodeConsecrations(7)).toEqual([]);
  });

  it('decodes a frost ring, clamps remaining to duration, and drops malformed rows', () => {
    expect(
      decodeFrostRings([
        { id: 'ring:1', x: 3, z: 4, r: 6, i: 2, dur: 5, rem: 9 },
        { id: 'ring:2', x: 3, z: 4, r: 6, i: 6, dur: 5, rem: 2 },
        { id: 3, x: 3, z: 4, r: 6, i: 2, dur: 5, rem: 2 },
        'junk',
      ]),
    ).toEqual([{ id: 'ring:1', x: 3, z: 4, radius: 6, innerRadius: 2, duration: 5, remaining: 5 }]);
  });

  it('decodes an Ignivar meteor warning and clamps remaining to duration', () => {
    expect(
      decodeIgnivarMeteors([{ id: '77:912:0', x: 3, z: 5, r: 2.4, dur: 2.5, rem: 9, lead: 0.75 }]),
    ).toEqual([
      {
        id: '77:912:0',
        x: 3,
        z: 5,
        radius: 2.4,
        duration: 2.5,
        remaining: 2.5,
        warningLead: 0.75,
      },
    ]);
  });

  it.each([
    ['id', { id: 912 }],
    ['x', { x: Number.NaN }],
    ['radius', { r: 0 }],
    ['duration', { dur: 0 }],
    ['remaining', { rem: 0 }],
    ['negative lead', { lead: -0.1 }],
    ['lead at or past duration', { lead: 2.5 }],
  ])('drops an Ignivar meteor with an invalid %s', (_label, override) => {
    expect(
      decodeIgnivarMeteors([
        { id: '77:912:0', x: 3, z: 5, r: 2.4, dur: 2.5, rem: 1.4, lead: 0.75, ...override },
      ]),
    ).toEqual([]);
  });

  it('decodes a Varkhul Forgestorm warning and clamps remaining to duration', () => {
    expect(
      decodeVarkhulForgestormWarnings([
        {
          id: 'varkhul-forgestorm:9:1:0:0',
          sourceId: 9,
          x: 1,
          z: 2,
          r: 3,
          dur: 6,
          rem: 8,
          lead: 0,
        },
      ]),
    ).toEqual([
      {
        id: 'varkhul-forgestorm:9:1:0:0',
        sourceId: 9,
        x: 1,
        z: 2,
        radius: 3,
        duration: 6,
        remaining: 6,
        warningLead: 0,
      },
    ]);
  });

  it.each([
    ['id', { id: 4 }],
    ['sourceId', { sourceId: -1 }],
    ['z', { z: Number.POSITIVE_INFINITY }],
    ['radius', { r: 0 }],
    ['duration', { dur: 0 }],
    ['remaining', { rem: 0 }],
    ['negative lead', { lead: -0.1 }],
    ['lead at or past duration', { lead: 6 }],
  ])('drops a Forgestorm warning with an invalid %s', (_label, override) => {
    expect(
      decodeVarkhulForgestormWarnings([
        {
          id: 'varkhul-forgestorm:9:1:0:0',
          sourceId: 9,
          x: 1,
          z: 2,
          r: 3,
          dur: 6,
          rem: 4,
          lead: 0,
          ...override,
        },
      ]),
    ).toEqual([]);
  });

  it('decodes a temporal hourglass and drops malformed rows', () => {
    expect(
      decodeTemporalHourglasses([
        { id: 'hg:1', x: 1, z: 2, r: 4, dur: 8, rem: 10 },
        { id: 'hg:2', x: 1, z: 2, r: 0, dur: 8, rem: 4 },
      ]),
    ).toEqual([{ id: 'hg:1', x: 1, z: 2, radius: 4, duration: 8, remaining: 8 }]);
  });

  it('decodes a consecration and drops malformed rows', () => {
    expect(
      decodeConsecrations([
        { id: 'con:1', x: 5, z: 6, r: 4, dur: 8, rem: 3 },
        { id: 'con:2', x: 5, z: 6, r: 4, dur: 0, rem: 3 },
      ]),
    ).toEqual([{ id: 'con:1', x: 5, z: 6, radius: 4, duration: 8, remaining: 3 }]);
  });
});
