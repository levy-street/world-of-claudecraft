import { describe, expect, it } from 'vitest';
import {
  decodeVarkhulCinderFires,
  decodeVarkhulCinderOrbProjectiles,
} from '../src/net/varkhul_cinder_orb_wire';

describe('Varkhul Cinder Orbs snapshot decoders', () => {
  it('decodes permanent fires and drops malformed rows', () => {
    expect(
      decodeVarkhulCinderFires([
        { id: '5:cinder-fire:2:0', sourceId: 5, x: 3, z: 4, r: 2.4 },
        { id: 'bad', sourceId: 5, x: 0, z: 0, r: 0 },
        { id: 7, sourceId: 5, x: 0, z: 0, r: 2.4 },
      ]),
    ).toEqual([{ id: '5:cinder-fire:2:0', sourceId: 5, x: 3, z: 4, radius: 2.4 }]);
  });

  it('clamps valid projectiles and drops malformed rows', () => {
    expect(
      decodeVarkhulCinderOrbProjectiles([
        {
          id: '5:cinder-orbs:2:0:0',
          sourceId: 5,
          x: 3,
          z: 4,
          dx: 1,
          dz: 0,
          r: 1.1,
          dur: 5.5,
          rem: 8,
        },
        { id: 'bad', sourceId: 5, x: 0, z: 0, dx: 1, dz: 0, r: 0, dur: 1, rem: 1 },
      ]),
    ).toEqual([
      {
        id: '5:cinder-orbs:2:0:0',
        sourceId: 5,
        x: 3,
        z: 4,
        dirX: 1,
        dirZ: 0,
        radius: 1.1,
        duration: 5.5,
        remaining: 5.5,
      },
    ]);
  });

  it.each([
    ['sourceId', { sourceId: -1 }],
    ['x', { x: Number.NaN }],
    ['z', { z: Number.POSITIVE_INFINITY }],
    ['direction x', { dx: Number.NaN }],
    ['direction z', { dz: Number.NEGATIVE_INFINITY }],
    ['radius', { r: 0 }],
    ['duration', { dur: 0 }],
    ['remaining', { rem: 0 }],
  ])('drops a projectile with an invalid %s', (_label, override) => {
    expect(
      decodeVarkhulCinderOrbProjectiles([
        {
          id: '5:cinder-orbs:2:0:0',
          sourceId: 5,
          x: 3,
          z: 4,
          dx: 1,
          dz: 0,
          r: 1.1,
          dur: 5.5,
          rem: 4,
          ...override,
        },
      ]),
    ).toEqual([]);
  });
});
