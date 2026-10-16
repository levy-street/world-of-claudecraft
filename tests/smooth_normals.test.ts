// Creased smooth normals for a faceted rig (src/render/characters/
// smooth_normals_core.ts + smooth_normals.ts, VisualDef.smoothNormals): the
// Basin Raptor's 1,248-triangle velociraptor read as hard polygons at its
// drawn size; its normals blend across shallow facets, real edges stay crisp,
// and nothing but the normal attribute changes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { smoothedGeometry } from '../src/render/characters/smooth_normals';
import { creaseCosine, creasedNormals } from '../src/render/characters/smooth_normals_core';
import { wildheartPlaceholderLooks } from '../src/render/characters/wildheart_creature_looks';

/** Two facets meeting on the edge (0,0,0)-(1,0,0) at `deg` between their
 *  normals, as a flat-shaded asset ships them: every corner its own vertex. */
function hinge(deg: number): { pos: number[]; nrm: number[] } {
  const a = (deg * Math.PI) / 180;
  const n2 = [0, Math.cos(a), Math.sin(a)];
  const pos = [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -Math.sin(a), Math.cos(a)];
  const nrm = [0, 1, 0, 0, 1, 0, 0, 1, 0, ...n2, ...n2, ...n2];
  return { pos, nrm };
}

describe('creasedNormals', () => {
  it('blends a shallow fold: both corners on the shared edge take the mean normal', () => {
    const { pos, nrm } = hinge(30);
    const out = creasedNormals(pos, nrm, 60);
    // Corner 0 and corner 3 sit on (0,0,0): both now point between the facets.
    const mid = new THREE.Vector3(0, 1 + Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).normalize();
    for (const i of [0, 3]) {
      expect(out[i * 3]).toBeCloseTo(mid.x, 5);
      expect(out[i * 3 + 1]).toBeCloseTo(mid.y, 5);
      expect(out[i * 3 + 2]).toBeCloseTo(mid.z, 5);
    }
    // A corner nobody shares keeps its own flat normal.
    expect([...out.slice(6, 9)]).toEqual([0, 1, 0]);
  });

  it('keeps a sharp edge sharp: past the crease the facets keep their own normals', () => {
    const { pos, nrm } = hinge(90);
    const out = creasedNormals(pos, nrm, 60);
    expect([...out.slice(0, 3)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, 0]);
    expect(out[3 * 3 + 2]).toBeCloseTo(1, 5);
  });

  it('every output normal is unit length', () => {
    const { pos, nrm } = hinge(20);
    const out = creasedNormals(pos, nrm, 60);
    for (let i = 0; i < out.length; i += 3)
      expect(Math.hypot(out[i], out[i + 1], out[i + 2])).toBeCloseTo(1, 5);
  });

  it('the crease cosine clamps to [0, 180] degrees', () => {
    expect(creaseCosine(0)).toBe(1);
    expect(creaseCosine(90)).toBeCloseTo(0, 10);
    expect(creaseCosine(400)).toBe(-1);
  });
});

describe('smoothedGeometry', () => {
  it('a twin that shares every buffer but the normal, built once per source', () => {
    const { pos, nrm } = hinge(30);
    const src = new THREE.BufferGeometry();
    src.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    src.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    src.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array(24).fill(0), 4));
    src.setIndex([0, 1, 2, 3, 4, 5]);
    src.addGroup(0, 6, 0);
    const twin = smoothedGeometry(src, 60);
    expect(twin).not.toBe(src);
    expect(twin.getAttribute('position')).toBe(src.getAttribute('position'));
    expect(twin.getAttribute('skinIndex')).toBe(src.getAttribute('skinIndex'));
    expect(twin.index).toBe(src.index);
    expect(twin.groups).toEqual(src.groups);
    expect(twin.getAttribute('normal')).not.toBe(src.getAttribute('normal'));
    expect(twin.getAttribute('normal').getY(0)).toBeLessThan(1);
    expect(smoothedGeometry(src, 60)).toBe(twin);
  });
});

describe('the Basin Raptor', () => {
  it('wears the velociraptor shaded smooth; the Deepfen Spearjaw keeps its facets', () => {
    const looks = wildheartPlaceholderLooks(VISUALS);
    expect(looks.wildheart_basin_raptor.url).toBe(VISUALS.mob_spearjaw.url);
    expect(looks.wildheart_basin_raptor.smoothNormals).toBe(60);
    expect(VISUALS.mob_spearjaw.smoothNormals).toBeUndefined();
  });
});
