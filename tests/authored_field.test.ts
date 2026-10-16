// The authored open-air field system (src/sim/instances/authored_field): the
// shared height function, path blending, the generated cliffs and colliders,
// and the one generic groundHeight arm that now carries the Wildheart Basin
// too (its bespoke height function retired for a field record of its own).

import { describe, expect, it } from 'vitest';
import { HOLLOW_CRYPT_FIELD, HOLLOW_CRYPT_RING } from '../src/sim/content/hollow_crypt_layout';
import { WILDHEART_BASIN_FIELD } from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { MORTHEN_SPOT } from '../src/sim/encounters/hollow_crypt/ids';
import {
  type AuthoredFieldDef,
  authoredFieldCliffRuns,
  authoredFieldColliders,
  authoredFieldFor,
  authoredFieldHeight,
  instancedFieldHeight,
} from '../src/sim/instances/authored_field';
import { pathHeightAt, pathHeightUnbounded } from '../src/sim/instances/authored_field/height';
import { groundHeight } from '../src/sim/world';

const MINI: AuthoredFieldDef = {
  key: 'mini',
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 40 },
  voidHeight: -10,
  cliffStep: 1,
  surfaces: [
    {
      kind: 'poly',
      id: 'low',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
      h: 0,
    },
    { kind: 'circle', id: 'high', x: 0, z: 30, r: 8, h: 6 },
    {
      kind: 'path',
      id: 'ramp',
      points: [
        [0, 5, 0],
        [0, 10, 0],
        [0, 22, 6],
        [0, 27, 6],
      ],
      halfWidth: 3,
    },
  ],
  walls: [],
  props: [{ kind: 'post', x: 5, z: 0, rot: 0, r: 0.5, h: 3 }],
  lightZones: [],
};

describe('authored field height', () => {
  it('answers each surface, the void, and the last-surface-wins order', () => {
    expect(authoredFieldHeight(MINI, 0, 0)).toBe(0);
    expect(authoredFieldHeight(MINI, 0, 34)).toBe(6);
    expect(authoredFieldHeight(MINI, 15, 15)).toBe(-10);
    // The ramp overrides the low square where they overlap (z 5 to 10: flat 0).
    expect(authoredFieldHeight(MINI, 0, 7)).toBe(0);
  });

  it('blends a path linearly and continuously along its centreline', () => {
    expect(authoredFieldHeight(MINI, 0, 16)).toBeCloseTo(3, 5);
    let prev = authoredFieldHeight(MINI, 0, 4);
    for (let z = 4; z <= 30; z += 0.25) {
      const h = authoredFieldHeight(MINI, 0, z);
      expect(Math.abs(h - prev)).toBeLessThan(0.2);
      prev = h;
    }
  });

  it('derives cliffs where the ground drops, none along a continuous join', () => {
    const runs = authoredFieldCliffRuns(MINI);
    expect(runs.length).toBeGreaterThan(4);
    for (const run of runs) expect(run.high - run.low).toBeGreaterThan(MINI.cliffStep);
    // The ramp sides over the void carry walls; its ends inside the terraces do not.
    const nearRampEnd = runs.some(
      (r) => Math.abs((r.az + r.bz) / 2 - 5) < 0.6 && Math.abs((r.ax + r.bx) / 2) < 2,
    );
    expect(nearRampEnd).toBe(false);
  });

  it('turns cliffs, walls and prop footprints into colliders', () => {
    const colliders = authoredFieldColliders(MINI, 0);
    expect(colliders.length).toBe(authoredFieldCliffRuns(MINI).length + 1);
    expect(colliders.some((c) => c.type === 'circle' && c.x === 5 && c.r === 0.5)).toBe(true);
  });
});

describe('the Hollow Crypt field', () => {
  it('stands every named space at its authored height', () => {
    const f = HOLLOW_CRYPT_FIELD;
    expect(authoredFieldHeight(f, 0, -128)).toBe(20); // Lychgate Landing
    expect(authoredFieldHeight(f, 0, -30)).toBe(0); // Ossuary Cloister
    expect(authoredFieldHeight(f, -82, 46)).toBe(2); // Sexton's Yard
    expect(authoredFieldHeight(f, -82, 116)).toBe(8); // the Bell Yard
    expect(authoredFieldHeight(f, 76, 40)).toBe(-6); // Widow's Gallery
    expect(authoredFieldHeight(f, 105, 64)).toBe(0); // the rim walk
    expect(authoredFieldHeight(f, 0, 162)).toBe(5); // the choir loft
    // The Rite Ring: one level floor from the rim to the altar, Morthen's spot
    // included (no raised dais paved over the engraved circle's inner bands).
    expect(authoredFieldHeight(f, HOLLOW_CRYPT_RING.x, HOLLOW_CRYPT_RING.z - 15)).toBe(24);
    expect(authoredFieldHeight(f, HOLLOW_CRYPT_RING.x, HOLLOW_CRYPT_RING.z)).toBe(24);
    expect(authoredFieldHeight(f, MORTHEN_SPOT.x, MORTHEN_SPOT.z)).toBe(24);
    for (const [dx, dz] of [
      [0, 10],
      [9, 7],
      [-9, 7],
      [0, 17],
      [5, 2],
    ])
      expect(authoredFieldHeight(f, HOLLOW_CRYPT_RING.x + dx, HOLLOW_CRYPT_RING.z + dz)).toBe(24);
    expect(HOLLOW_CRYPT_FIELD.surfaces.some((s) => s.id === 'rite_dais')).toBe(false);
    expect(authoredFieldHeight(f, 60, -100)).toBe(-40); // the mist chasm
    // The Chapel Stair halfway down.
    expect(authoredFieldHeight(f, 0, -96)).toBeCloseTo(10, 5);
  });

  it('keeps the collider set modest (interior lists are scanned linearly)', () => {
    expect(authoredFieldColliders(HOLLOW_CRYPT_FIELD, 0).length).toBeLessThan(500);
  });

  it('is the live ground of every Hollow Crypt slot through groundHeight', () => {
    const d = DUNGEONS.hollow_crypt;
    expect(d.interior).toBe('hollow_crypt');
    expect(authoredFieldFor(d.interior)).toBe(HOLLOW_CRYPT_FIELD);
    for (const slot of [0, 5, 23]) {
      const o = instanceOrigin(d.index, slot);
      expect(groundHeight(o.x, o.z - 128, 1)).toBe(20);
      expect(groundHeight(o.x - 82, o.z + 116, 1)).toBe(8);
    }
  });

  it('serves the Wildheart Basin from its own field record on the same engine', () => {
    const d = DUNGEONS.wildheart_basin;
    expect(authoredFieldFor(d.interior)).toBe(WILDHEART_BASIN_FIELD);
    const o = instanceOrigin(d.index, 2);
    for (const [x, z] of [
      [0, -222],
      [-18, -109],
      [-86, 40],
      [12.5, 211.25],
      [60, 150],
    ]) {
      expect(groundHeight(o.x + x, o.z + z, 3)).toBe(
        authoredFieldHeight(WILDHEART_BASIN_FIELD, x, z),
      );
    }
    // The shared crypt nave lives on in the Abandoned Crypt (a flat floor);
    // the Sunken Bastion moved to its own open-air field in its rework.
    expect(DUNGEONS.nythraxis_crypt.interior).toBe('crypt');
    expect(instancedFieldHeight('crypt')).toBeNull();
    expect(DUNGEONS.sunken_bastion.interior).toBe('sunken_bastion');
    expect(instancedFieldHeight('sunken_bastion')).not.toBeNull();
  });
});

describe('path height across a turning stair', () => {
  // A stair rising round a bend: straight up the first leg, turning 30 degrees,
  // rising on up the second.
  const stair = {
    kind: 'path' as const,
    id: 'bend',
    points: [
      [0, 0, 0],
      [0, 4, 0],
      [0, 14, 5],
      [5, 22.66, 10],
      [7, 26.12, 10],
    ] as [number, number, number][],
    halfWidth: 3,
  };

  it('is the plain linear ramp along a straight path', () => {
    const ramp = {
      ...stair,
      points: [
        [0, 0, 0],
        [0, 4, 0],
        [0, 14, 5],
        [0, 18, 5],
      ] as [number, number, number][],
    };
    for (let z = 4; z <= 14; z += 0.5) {
      expect(pathHeightUnbounded(ramp, 0, z)).toBeCloseTo(((z - 4) / 10) * 5, 9);
      expect(pathHeightUnbounded(ramp, 2.5, z)).toBeCloseTo(((z - 4) / 10) * 5, 9);
    }
  });

  it('carries each vertex height on its whole cross-section, from both sides', () => {
    expect(pathHeightUnbounded(stair, 0, 14)).toBeCloseTo(5, 9);
    for (const t of [-2.8, -1.5, 0, 1.5, 2.8]) {
      // The cross-section at the bend runs across the band through the vertex.
      const nx = Math.cos(Math.PI / 12);
      const nz = -Math.sin(Math.PI / 12);
      expect(pathHeightAt(stair, nx * t, 14 + nz * t)).toBeCloseTo(5, 4);
    }
  });

  it('has no seam anywhere across the band (the old blend jumped at the inside of the bend)', () => {
    let worst = 0;
    for (let s = -2.9; s <= 2.9; s += 0.25) {
      let prev = Number.NaN;
      for (let z = 8; z <= 20; z += 0.05) {
        const x = s + Math.max(0, z - 14) * 0.58;
        const h = pathHeightAt(stair, x, z);
        if (Number.isNaN(h)) {
          prev = Number.NaN;
          continue;
        }
        if (!Number.isNaN(prev)) worst = Math.max(worst, Math.abs(h - prev));
        prev = h;
      }
    }
    // A 0.05 yd stride on a rise of 0.5 yd per yard climbs at most about 0.03.
    expect(worst).toBeLessThan(0.06);
  });
});
