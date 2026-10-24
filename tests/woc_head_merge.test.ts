// The three.js half of the merged WOC head (src/render/characters/woc_head_merge.ts) on
// real three objects, no WebGL: the fold itself (each piece's vertices posed by its
// morph influences, moved into the head bone's space, its normals with them, its uv or
// the atlas's white cell, its slot, its winding, every triangle folded exactly once),
// the leased geometry cache (one build per head, idle entries kept and the oldest
// dropped past a cap, every idle one dropped on a profile change), the merged
// material's two sided source, the fold rule read off the meshes (which drawn pieces
// one merged material can draw, and which of their slots are one sided: the shader
// drops those backs, woc_head_tint.ts), and one character's stand-in: planned by sync,
// mounted hidden under the head bone when its owner says so, standing in for its pieces
// only once its reveal settled prepared, and taken down with every piece drawing again
// exactly as before.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geometryLodOf, setGeometryLod } from '../src/render/assets/geometry_lod';
import { buildLedgerLane } from '../src/render/build_ledger_core';
import { setBuildSpanSink } from '../src/render/build_spans';
import type { WocHeadType } from '../src/render/characters/woc_head_catalog';
import {
  clearIdleWocHeadMerges,
  mergeWocHeadGeometry,
  retainWocHeadMerge,
  WOC_HEAD_MERGED_KEY,
  WocHeadGeometryFold,
  type WocHeadMergeCandidate,
  type WocHeadMergeHost,
  type WocHeadMergePiece,
  WocHeadMergeRig,
  wocHeadMergeBuilt,
  wocHeadMergedSource,
  wocHeadMergeFold,
  wocHeadMergeInternalsForTest,
  wocHeadMergeSurfaceOf,
} from '../src/render/characters/woc_head_merge';
import {
  WOC_HEAD_MERGE_BAND_INDICES,
  WOC_HEAD_MERGE_BAND_VERTICES,
  WOC_HEAD_MERGE_MAX_SLOTS,
  wocHeadMergeFoldUnits,
} from '../src/render/characters/woc_head_merge_core';
import { gfxInternalsForTest } from '../src/render/gfx';

/** The idle merged heads the cache keeps on an unconstrained profile
 *  (woc_idle_cache_core.ts wocIdleCacheCaps). Re-pin it here when that cap moves. */
const MAX_IDLE = 12;

/** The clock a mount's build span reads. */
let now = 1000;

beforeEach(() => {
  wocHeadMergeInternalsForTest.reset();
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  setBuildSpanSink(null);
  vi.restoreAllMocks();
  wocHeadMergeInternalsForTest.reset();
});

interface GeoSpec {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  index?: number[];
  /** Position deltas, one list per morph target (relative, as glTF ships them). */
  morphs?: number[][];
  /** Normal deltas, one list per morph target. */
  morphNormals?: number[][];
}

function geometry(spec: GeoSpec): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(spec.positions, 3));
  if (spec.normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(spec.normals, 3));
  if (spec.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(spec.uvs, 2));
  if (spec.index) g.setIndex(spec.index);
  if (spec.morphs) {
    g.morphAttributes.position = spec.morphs.map((d) => new THREE.Float32BufferAttribute(d, 3));
  }
  if (spec.morphNormals) {
    g.morphAttributes.normal = spec.morphNormals.map((d) => new THREE.Float32BufferAttribute(d, 3));
  }
  g.morphTargetsRelative = true;
  return g;
}

/** One triangle in the XY plane facing +Z, shifted along X so pieces are told apart. */
function triangle(x = 0, spec: Partial<GeoSpec> = {}): THREE.BufferGeometry {
  return geometry({
    positions: [x, 0, 0, x + 1, 0, 0, x, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75],
    index: [0, 1, 2],
    ...spec,
  });
}

const IDENTITY = new THREE.Matrix4();

/** A mesh as a merge piece (slot 0, its own uv, no transform unless told otherwise). */
function piece(
  geo: THREE.BufferGeometry,
  over: Partial<Omit<WocHeadMergePiece, 'mesh'>> & { influences?: number[] } = {},
): WocHeadMergePiece {
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  if (over.influences) mesh.morphTargetInfluences = [...over.influences];
  return {
    mesh,
    toRoot: over.toRoot ?? IDENTITY,
    slot: over.slot ?? 0,
    flatUv: over.flatUv ?? null,
  };
}

const values = (geo: THREE.BufferGeometry, name: string): number[] =>
  Array.from(geo.getAttribute(name).array);
const indices = (geo: THREE.BufferGeometry): number[] => Array.from(geo.index?.array ?? []);

describe('mergeWocHeadGeometry: positions', () => {
  it('bakes each vertex with its morph influences applied, then moves it by toRoot', () => {
    const geo = geometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      morphs: [
        // lifts the first vertex by 1 and the second by 2
        [0, 0, 1, 0, 0, 2, 0, 0, 0],
        // slides every vertex along +x
        [1, 0, 0, 1, 0, 0, 1, 0, 0],
      ],
    });
    const toRoot = new THREE.Matrix4().compose(
      new THREE.Vector3(10, 20, 30),
      new THREE.Quaternion(),
      new THREE.Vector3(2, 2, 2),
    );
    // posed: (0.25, 0, 0.5), (1.25, 0, 1), (0.25, 1, 0); then doubled and moved
    const posed = mergeWocHeadGeometry([piece(geo, { toRoot, influences: [0.5, 0.25] })]);
    expect(values(posed, 'position')).toEqual([10.5, 20, 31, 12.5, 20, 32, 10.5, 22, 30]);
    // at rest the same piece bakes its authored vertices
    const rest = mergeWocHeadGeometry([piece(geo, { toRoot, influences: [0, 0] })]);
    expect(values(rest, 'position')).toEqual([10, 20, 30, 12, 20, 30, 10, 22, 30]);
    // the shared geometry is read, never written
    expect(values(geo, 'position')).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('moves a piece by toRoot alone, whatever transform the mesh itself carries', () => {
    const p = piece(triangle(), { toRoot: new THREE.Matrix4().makeTranslation(0, 0, 5) });
    p.mesh.position.set(100, 100, 100);
    p.mesh.scale.setScalar(7);
    p.mesh.updateMatrix();
    p.mesh.updateMatrixWorld(true);
    expect(values(mergeWocHeadGeometry([p]), 'position')).toEqual([0, 0, 5, 1, 0, 5, 0, 1, 5]);
  });

  it('reads quantized positions, morph deltas, normals and uvs as the values they encode', () => {
    // the shipped pieces are KHR_mesh_quantization buffers: normalized integers the node
    // transform (toRoot here) scales back out
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true),
    );
    geo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Int8Array([0, 0, 127, 0, 127, 0, 127, 0, 0]), 3, true),
    );
    geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Uint16Array([0, 65535, 65535, 0, 65535, 65535]), 2, true),
    );
    geo.morphAttributes.position = [
      new THREE.BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 0, 0, 0, 0]), 3, true),
    ];
    geo.morphTargetsRelative = true;
    const out = mergeWocHeadGeometry([
      piece(geo, { toRoot: new THREE.Matrix4().makeScale(8, 8, 8), influences: [0.5] }),
    ]);
    expect(values(out, 'position')).toEqual([0, 0, 4, 8, 0, 0, 0, 8, 0]);
    expect(values(out, 'normal')).toEqual([0, 0, 32767, 0, 32767, 0, 32767, 0, 0]);
    expect(values(out, 'uv')).toEqual([0, 1, 1, 0, 1, 1]);
  });
});

describe('mergeWocHeadGeometry: normals', () => {
  it('carries normals through the normal matrix and stores them as normalized Int16', () => {
    const s = Math.SQRT1_2;
    const geo = triangle(0, { normals: [0, s, s, 0, 0, 1, 1, 0, 0] });
    // a non-uniform scale: the normal matrix is the inverse transpose, never the matrix
    const out = mergeWocHeadGeometry([
      piece(geo, { toRoot: new THREE.Matrix4().makeScale(1, 2, 4) }),
    ]);
    const normal = out.getAttribute('normal') as THREE.BufferAttribute;
    expect(normal.array).toBeInstanceOf(Int16Array);
    expect(normal.normalized).toBe(true);
    expect(normal.itemSize).toBe(3);
    // (0, s, s) scales to (0, s/2, s/4), the unit vector (0, 2, 1) / sqrt(5); the plain
    // matrix would have tipped it the other way, to (0, 1, 2) / sqrt(5)
    expect(Array.from(normal.array)).toEqual([0, 29308, 14654, 0, 0, 32767, 32767, 0, 0]);
    // read back the way three reads a normalized attribute: unit vectors
    expect(normal.getY(0)).toBeCloseTo(2 / Math.sqrt(5), 4);
    expect(normal.getZ(0)).toBeCloseTo(1 / Math.sqrt(5), 4);
  });

  it('turns positions and normals together under a rotation', () => {
    const quarterTurnZ = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const out = mergeWocHeadGeometry([
      piece(triangle(0, { normals: [1, 0, 0, 0, 1, 0, 0, 0, 1] }), { toRoot: quarterTurnZ }),
    ]);
    // +x turns onto +y, +y onto -x, z stays
    const position = values(out, 'position').map((v) => Math.round(v * 1e6) / 1e6 || 0);
    expect(position).toEqual([0, 0, 0, 0, 1, 0, -1, 0, 0]);
    expect(values(out, 'normal')).toEqual([0, 32767, 0, -32767, 0, 0, 0, 0, 32767]);
  });

  it('poses the normals with the relative morph normals of the face', () => {
    const geo = triangle(0, {
      morphs: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
      ],
      morphNormals: [
        // tips the first vertex's normal toward +x
        [1, 0, 0, 0, 0, 0, 0, 0, 0],
        // tips the second vertex's normal toward +y
        [0, 0, 0, 0, 1, 0, 0, 0, 0],
      ],
    });
    const rest = mergeWocHeadGeometry([piece(geo, { influences: [0, 0] })]);
    expect(values(rest, 'normal')).toEqual([0, 0, 32767, 0, 0, 32767, 0, 0, 32767]);
    // (0, 0, 1) + 1 * (1, 0, 0) and (0, 0, 1) + 1 * (0, 1, 0), each renormalized
    const posed = mergeWocHeadGeometry([piece(geo, { influences: [1, 1] })]);
    expect(values(posed, 'normal')).toEqual([23170, 0, 23170, 0, 23170, 23170, 0, 0, 32767]);
    // the two targets sum, each by its own influence: (0, 0, 1) + 0.5 * (1, 0, 0)
    const half = mergeWocHeadGeometry([piece(geo, { influences: [0.5, 0] })]);
    expect(values(half, 'normal').slice(0, 3)).toEqual([14654, 0, 29308]);
  });

  it('poses one absolute morph normal as a blend from the base normal', () => {
    const geo = triangle(0, {
      morphs: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
      morphNormals: [[1, 0, 0, 1, 0, 0, 1, 0, 0]],
    });
    geo.morphTargetsRelative = false;
    // base (0, 0, 1) half way to the target (1, 0, 0)
    const out = mergeWocHeadGeometry([piece(geo, { influences: [0.5] })]);
    expect(values(out, 'normal')).toEqual([23170, 0, 23170, 23170, 0, 23170, 23170, 0, 23170]);
  });

  it('sums two absolute morph normals against the BASE normal, as three draws them', () => {
    // three's morph chunk for absolute targets: base * (1 - sum(w)) + sum(w_i * target_i),
    // which is base + sum(w_i * (target_i - base)). Each delta is taken against the base
    // normal, never against the normal an earlier target already moved.
    const geo = triangle(0, {
      morphs: [
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
      ],
      morphNormals: [
        [1, 0, 0, 1, 0, 0, 1, 0, 0],
        [0, 1, 0, 0, 1, 0, 0, 1, 0],
      ],
    });
    geo.morphTargetsRelative = false;
    // (0, 0, 1) * 0 + 0.5 * (1, 0, 0) + 0.5 * (0, 1, 0) = (0.5, 0.5, 0)
    const out = mergeWocHeadGeometry([piece(geo, { influences: [0.5, 0.5] })]);
    expect(values(out, 'normal').slice(0, 3)).toEqual([23170, 23170, 0]);
  });

  it('gives a piece without normals a forward one, untouched by toRoot', () => {
    const geo = geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1] });
    const out = mergeWocHeadGeometry([
      piece(geo, { toRoot: new THREE.Matrix4().makeRotationX(Math.PI / 2) }),
    ]);
    expect(values(out, 'normal')).toEqual([0, 0, 32767, 0, 0, 32767, 0, 0, 32767]);
  });
});

describe('mergeWocHeadGeometry: slots and uvs', () => {
  it('stamps every vertex with the slot of the piece it came from', () => {
    const quad = geometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      index: [0, 1, 2, 2, 1, 3],
    });
    const out = mergeWocHeadGeometry([
      piece(triangle(), { slot: 3 }),
      piece(quad, { slot: 19 }),
      piece(triangle(5), { slot: 0 }),
    ]);
    const slot = out.getAttribute('aWocHmSlot') as THREE.BufferAttribute;
    expect(slot.array).toBeInstanceOf(Uint8Array);
    expect(slot.itemSize).toBe(1);
    // the vertex stage reads the byte as the float it is (never 0..1)
    expect(slot.normalized).toBe(false);
    expect(Array.from(slot.array)).toEqual([3, 3, 3, 19, 19, 19, 19, 0, 0, 0]);
  });

  it("keeps a textured piece's own uv and gives a flat piece its uv on every vertex", () => {
    const out = mergeWocHeadGeometry([
      piece(triangle()),
      // a flat-coloured piece takes the white cell even when it carries a uv of its own
      piece(triangle(2), { flatUv: [0.5, 0.875] }),
      // ...and when it carries none
      piece(geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }), { flatUv: [0.25, 0.75] }),
      // a piece with neither samples the origin
      piece(geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })),
    ]);
    const uv = out.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.itemSize).toBe(2);
    expect(Array.from(uv.array)).toEqual([
      ...[0.125, 0.25, 0.375, 0.5, 0.625, 0.75],
      ...[0.5, 0.875, 0.5, 0.875, 0.5, 0.875],
      ...[0.25, 0.75, 0.25, 0.75, 0.25, 0.75],
      ...[0, 0, 0, 0, 0, 0],
    ]);
  });
});

/** The geometric normal of merged triangle `t` (counter clockwise is front). */
function faceNormal(geo: THREE.BufferGeometry, t: number): THREE.Vector3 {
  const pos = geo.getAttribute('position');
  const [a, b, c] = [0, 1, 2].map((k) =>
    new THREE.Vector3().fromBufferAttribute(pos, geo.index?.getX(t * 3 + k) ?? 0),
  );
  return b.sub(a).cross(c.sub(a)).normalize();
}

/** The stored normal of the first vertex of merged triangle `t`. */
function vertexNormal(geo: THREE.BufferGeometry, t: number): THREE.Vector3 {
  return new THREE.Vector3().fromBufferAttribute(
    geo.getAttribute('normal'),
    geo.index?.getX(t * 3) ?? 0,
  );
}

describe('mergeWocHeadGeometry: triangles', () => {
  it('offsets every piece by the vertices before it, indexed or not', () => {
    const quad = geometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      index: [0, 1, 2, 2, 1, 3],
    });
    // two loose triangles, no index
    const soup = geometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0],
    });
    const out = mergeWocHeadGeometry([piece(quad), piece(soup), piece(triangle(9))]);
    expect(out.getAttribute('position').count).toBe(4 + 6 + 3);
    expect(indices(out)).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(out.index?.array).toBeInstanceOf(Uint16Array);
    // the loose triangles keep their own vertices
    expect(values(out, 'position').slice(4 * 3, 10 * 3)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0,
    ]);
  });

  it('flips the winding of a mirrored piece and of no other', () => {
    const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
    const grown = new THREE.Matrix4().makeScale(2, 3, 4);
    const soup = geometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    });
    const out = mergeWocHeadGeometry([
      piece(triangle(), { toRoot: mirror }),
      piece(triangle(), { toRoot: grown }),
      piece(soup, { toRoot: mirror }),
      // two mirrored axes are a rotation: no flip
      piece(triangle(), { toRoot: new THREE.Matrix4().makeScale(-1, -1, 1) }),
    ]);
    expect(indices(out)).toEqual([
      ...[0, 2, 1],
      ...[3, 4, 5],
      ...[6, 8, 7, 9, 11, 10],
      ...[12, 13, 14],
    ]);
    // what the flip is for: every triangle still faces the way its normals point
    for (let t = 0; t < 5; t++) {
      expect(faceNormal(out, t).dot(vertexNormal(out, t)), `triangle ${t}`).toBeGreaterThan(0.99);
    }
  });

  it('drops a trailing partial triangle, and never shifts the pieces after it', () => {
    // a non-indexed piece of four vertices (a triangle and a stray vertex), an indexed
    // one of seven indices (two triangles and a stray index), then a whole piece
    const stray = geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9] });
    const ragged = geometry({
      positions: [10, 0, 0, 11, 0, 0, 11, 1, 0, 10, 1, 0],
      index: [0, 1, 2, 0, 2, 3, 1],
    });
    const geo = mergeWocHeadGeometry([piece(stray), piece(ragged), piece(triangle(20))]);
    // every vertex is carried (a stray one is simply never drawn)...
    expect(geo.getAttribute('position').count).toBe(11);
    // ...and the index holds whole triangles only, each piece's right after the last:
    // the piece after a ragged one is intact
    expect(indices(geo)).toEqual([0, 1, 2, 4, 5, 6, 4, 6, 7, 8, 9, 10]);
    expect(geo.index?.count).toBe(12);
    // a ragged list of fewer than three indices draws nothing, and shifts nothing
    const sliver = triangle(30, { index: [0, 1] });
    expect(indices(mergeWocHeadGeometry([piece(sliver), piece(triangle(40))]))).toEqual([3, 4, 5]);
  });

  it('switches to 32 bit indices past 65535 vertices, and keeps them intact', () => {
    const big = geometry({ positions: new Array<number>(65535 * 3).fill(0) });
    const out = mergeWocHeadGeometry([piece(big), piece(triangle(), { slot: 2 })]);
    expect(out.getAttribute('position').count).toBe(65538);
    expect(out.index?.array).toBeInstanceOf(Uint32Array);
    expect(indices(out).slice(-3)).toEqual([65535, 65536, 65537]);
    expect(Array.from(out.getAttribute('aWocHmSlot').array).slice(-4)).toEqual([0, 2, 2, 2]);
  });

  it('bounds the merged head for the frustum test', () => {
    const out = mergeWocHeadGeometry([
      piece(triangle(), { toRoot: new THREE.Matrix4().makeTranslation(-4, 0, 0) }),
      piece(triangle(), { toRoot: new THREE.Matrix4().makeTranslation(3, 2, 6) }),
    ]);
    expect(out.boundingBox?.min.toArray()).toEqual([-4, 0, 0]);
    expect(out.boundingBox?.max.toArray()).toEqual([4, 3, 6]);
    const sphere = out.boundingSphere;
    expect(sphere).not.toBeNull();
    expect(sphere?.radius).toBeGreaterThan(0);
    const pos = out.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i);
      expect(p.distanceTo(sphere?.center ?? p), `vertex ${i}`).toBeLessThanOrEqual(
        (sphere?.radius ?? 0) + 1e-6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The fold, a band at a time
// ---------------------------------------------------------------------------

/** A strip of `quads` quads along x from `x0` (four vertices and two triangles each, no
 *  vertex shared), every position, normal and uv its own so a value folded into the wrong
 *  place shows. `morphs` relative targets (positions and normals), and coarser levels
 *  (mid: every other quad, far: every fourth) when asked. */
function strip(
  quads: number,
  x0: number,
  opts: { morphs?: number; lod?: boolean; indexed?: boolean } = {},
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let q = 0; q < quads; q++) {
    const z = q * 0.03125;
    positions.push(x0 + q, 0, z, x0 + q + 1, 0, z, x0 + q + 1, 1, z, x0 + q, 1, z);
    for (let k = 0; k < 4; k++) {
      const n = new THREE.Vector3(0.25 * k, 0.5 + q * 0.125, 1).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push((q * 4 + k) / 1024, (x0 + k) / 64);
    }
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  }
  const count = quads * 4;
  const deltas = (scale: number): number[][] =>
    Array.from({ length: opts.morphs ?? 0 }, (_m, t) =>
      Array.from({ length: count * 3 }, (_c, i) => ((i % 7) - 3) * 0.015625 * (t + 1) * scale),
    );
  const g = geometry({
    positions,
    normals,
    uvs,
    index: opts.indexed === false ? undefined : index,
    morphs: opts.morphs ? deltas(1) : undefined,
    morphNormals: opts.morphs ? deltas(0.5) : undefined,
  });
  if (opts.lod) {
    const level = (every: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(
        new Uint16Array(index.filter((_v, i) => Math.floor(i / 6) % every === 0)),
        1,
      );
    setGeometryLod(g, { mid: level(2), far: level(4) });
  }
  return g;
}

/** Everything a merged head's geometry is: each attribute, the index, the coarser levels
 *  and the bounds. */
function wholeOf(geo: THREE.BufferGeometry) {
  const lod = geometryLodOf(geo);
  const list = (a: THREE.BufferAttribute | null | undefined): number[] | null =>
    a ? Array.from(a.array) : null;
  return {
    attributes: Object.keys(geo.attributes).sort(),
    position: values(geo, 'position'),
    normal: values(geo, 'normal'),
    normalNormalized: geo.getAttribute('normal').normalized,
    uv: values(geo, 'uv'),
    slot: values(geo, 'aWocHmSlot'),
    index: indices(geo),
    indexType: geo.index?.array.constructor.name,
    mid: list(lod?.mid),
    far: list(lod?.far),
    box: [geo.boundingBox?.min.toArray(), geo.boundingBox?.max.toArray()],
    sphere: [geo.boundingSphere?.center.toArray(), geo.boundingSphere?.radius],
  };
}

/** A head of every kind of piece the fold meets: a posed one with coarser levels, a
 *  mirrored one, a flat-coloured one with neither normal nor uv, one drawn without an
 *  index, and one whose index ends on a partial triangle. */
function mixedHead(): WocHeadMergePiece[] {
  const flat = geometry({ positions: strip(3, 40).getAttribute('position').array as never });
  flat.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  const ragged = strip(2, 60);
  ragged.setIndex([...Array.from(ragged.index?.array ?? []), 1]);
  return [
    piece(strip(9, 0, { morphs: 3, lod: true }), {
      toRoot: new THREE.Matrix4().compose(
        new THREE.Vector3(1, 2, 3),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5),
        new THREE.Vector3(2, 2, 2),
      ),
      influences: [0.25, 0, -0.5],
    }),
    piece(strip(4, 20, { lod: true }), {
      toRoot: new THREE.Matrix4().makeScale(-1, 1, 1),
      slot: 1,
    }),
    piece(flat, { slot: 2, flatUv: [0.75, 0.25] }),
    piece(strip(5, 50, { indexed: false, morphs: 1 }), { slot: 3, influences: [1] }),
    piece(ragged, { slot: 4 }),
  ];
}

/** Run a fold to its end at the bands given; answers the geometry and what each call
 *  folded. */
function foldInBands(pieces: readonly WocHeadMergePiece[], vertices?: number, indices?: number) {
  const fold = new WocHeadGeometryFold(pieces);
  const calls: { vertices: number; indices: number }[] = [];
  let out: THREE.BufferGeometry | null = null;
  while (!out) {
    const before = { vertices: fold.foldedVertices, indices: fold.foldedIndices };
    out = fold.step(vertices, indices);
    calls.push({
      vertices: fold.foldedVertices - before.vertices,
      indices: fold.foldedIndices - before.indices,
    });
    if (calls.length > 100000) throw new Error('the fold never ends');
  }
  return { fold, out, calls };
}

describe('WocHeadGeometryFold: the fold a band at a time', () => {
  it.each([
    [1, 3],
    [2, 3],
    [5, 6],
    [7, 9],
    [36, 30],
    [100000, 3],
    [1, 100000],
  ])(
    'folds the very geometry the one-shot fold does at %i vertices and %i index entries a band',
    (bandVertices, bandIndices) => {
      const whole = wholeOf(mergeWocHeadGeometry(mixedHead()));
      // the fixture is what it says: every level, a 16 bit index, a flat piece, a flip
      expect(whole.mid?.length).toBeGreaterThan(0);
      expect(whole.far?.length).toBeGreaterThan(0);
      expect(whole.position).toHaveLength(92 * 3);
      const { out, calls } = foldInBands(mixedHead(), bandVertices, bandIndices);
      expect(wholeOf(out)).toEqual(whole);
      // ...in more than one call: the bands really cut it
      expect(calls.length).toBeGreaterThan(1);
      for (const call of calls) {
        expect(call.vertices).toBeLessThanOrEqual(bandVertices);
        expect(call.indices).toBeLessThanOrEqual(bandIndices);
        expect(call.indices % 3).toBe(0);
      }
    },
  );

  it('folds no more than its band a call, in exactly the calls the core counts', () => {
    // a head of the library's size: four pieces, 13,600 vertices and 40,800 index entries
    const head = (): WocHeadMergePiece[] => [
      piece(strip(1500, 0, { morphs: 2, lod: true }), { influences: [0.5, 0.25] }),
      piece(strip(1300, 2000, { lod: true }), { slot: 1 }),
      piece(strip(550, 4000), { slot: 2 }),
      piece(strip(50, 5000), { slot: 3 }),
    ];
    // literal: the bands (index entries in whole triangles)
    expect(WOC_HEAD_MERGE_BAND_VERTICES).toBe(512);
    expect(WOC_HEAD_MERGE_BAND_INDICES).toBe(12288);
    expect(WOC_HEAD_MERGE_BAND_INDICES % 3).toBe(0);
    const { fold, out, calls } = foldInBands(head());
    expect(fold.vertices).toBe(13600);
    expect(fold.indices).toBe(20400);
    expect(fold.foldedVertices).toBe(13600);
    expect(fold.foldedIndices).toBe(20400);
    // 27 bands of vertices, the last going on to the first of two bands of triangles
    expect(calls).toHaveLength(28);
    expect(wocHeadMergeFoldUnits(fold.vertices, fold.indices)).toBe(28);
    for (const call of calls) {
      expect(call.vertices).toBeLessThanOrEqual(WOC_HEAD_MERGE_BAND_VERTICES);
      expect(call.indices).toBeLessThanOrEqual(WOC_HEAD_MERGE_BAND_INDICES);
    }
    // every band but the last of each kind is full: nothing is folded in dribbles
    expect(calls.slice(0, 26).map((call) => call.vertices)).toEqual(
      new Array<number>(26).fill(WOC_HEAD_MERGE_BAND_VERTICES),
    );
    expect(calls[26]).toEqual({ vertices: 13600 - 26 * 512, indices: 12288 });
    expect(calls[27]).toEqual({ vertices: 0, indices: 20400 - 12288 });
    expect(wholeOf(out)).toEqual(wholeOf(mergeWocHeadGeometry(head())));
  });

  it('is whole after one call when the head fits one band', () => {
    const { calls } = foldInBands([piece(triangle()), piece(triangle(10), { slot: 1 })]);
    expect(calls).toEqual([{ vertices: 6, indices: 6 }]);
    expect(wocHeadMergeFoldUnits(6, 6)).toBe(1);
    // an empty head is one call too, and an empty geometry
    const empty = foldInBands([]);
    expect(empty.calls).toEqual([{ vertices: 0, indices: 0 }]);
    expect(empty.out.getAttribute('position').count).toBe(0);
    expect(empty.out.index?.count).toBe(0);
  });

  it('ends on a full band without a call that folds nothing', () => {
    // guards: a band that ended exactly on the last vertex (or the last triangle) handed
    // the rest to another call, one unit more than the head needs
    // the mixed head is 92 vertices and 126 index entries: two bands of 46, two of 63
    const { calls } = foldInBands(mixedHead(), 46, 63);
    expect(calls).toEqual([
      { vertices: 46, indices: 0 },
      { vertices: 46, indices: 63 },
      { vertices: 0, indices: 63 },
    ]);
    // at the real bands: 8192 vertices are sixteen bands exactly, their 12288 index
    // entries one band exactly, folded by the call that folds the last vertices
    const even = foldInBands([piece(strip(2048, 0))]);
    expect(even.fold.vertices).toBe(16 * WOC_HEAD_MERGE_BAND_VERTICES);
    expect(even.fold.indices).toBe(WOC_HEAD_MERGE_BAND_INDICES);
    expect(even.calls).toHaveLength(16);
    expect(even.calls).toHaveLength(wocHeadMergeFoldUnits(even.fold.vertices, even.fold.indices));
    expect(even.calls[15]).toEqual({
      vertices: WOC_HEAD_MERGE_BAND_VERTICES,
      indices: WOC_HEAD_MERGE_BAND_INDICES,
    });
    for (const call of even.calls) expect(call.vertices + call.indices).toBeGreaterThan(0);
  });

  it('hands back the one geometry from every call once it is whole', () => {
    const fold = new WocHeadGeometryFold(mixedHead());
    expect(fold.done).toBe(false);
    let out: THREE.BufferGeometry | null = null;
    while (!out) out = fold.step(40, 60);
    expect(fold.done).toBe(true);
    expect(fold.step()).toBe(out);
    expect(fold.step(1, 3)).toBe(out);
    expect(fold.foldedVertices).toBe(fold.vertices);
  });

  it('folds the face it was started with: a slider moved mid-fold changes nothing', () => {
    // guards: a band read the mesh's live morph influences, so a face written between two
    // units folded half of one face and half of another under the first one's key
    const pieces = mixedHead();
    const before = wholeOf(mergeWocHeadGeometry(pieces));
    const fold = new WocHeadGeometryFold(pieces);
    expect(fold.step(10, 3)).toBeNull();
    (pieces[0].mesh.morphTargetInfluences as number[])[0] = 1;
    (pieces[3].mesh.morphTargetInfluences as number[])[0] = 0;
    let out: THREE.BufferGeometry | null = null;
    while (!out) out = fold.step(10, 3);
    expect(wholeOf(out)).toEqual(before);
    // and that write does move the vertices of a fold started after it
    expect(wholeOf(mergeWocHeadGeometry(pieces)).position).not.toEqual(before.position);
  });

  it("bounds the head exactly as three's own two passes over the finished attribute do", () => {
    const { out } = foldInBands(mixedHead(), 7, 9);
    const check = new THREE.BufferGeometry();
    check.setAttribute('position', out.getAttribute('position'));
    check.computeBoundingBox();
    check.computeBoundingSphere();
    expect(out.boundingBox?.min.toArray()).toEqual(check.boundingBox?.min.toArray());
    expect(out.boundingBox?.max.toArray()).toEqual(check.boundingBox?.max.toArray());
    expect(out.boundingSphere?.center.toArray()).toEqual(check.boundingSphere?.center.toArray());
    expect(out.boundingSphere?.radius).toBe(check.boundingSphere?.radius);
    expect(out.boundingSphere?.radius).toBeGreaterThan(10);
  });
});

describe('the merged geometry cache', () => {
  const built = (): THREE.BufferGeometry => new THREE.BufferGeometry();
  const refs = (key: string): number | undefined =>
    wocHeadMergeInternalsForTest.cache.get(key)?.refs;

  /** Build `key`, lease it and let the lease go: an idle entry, with a dispose spy. */
  function idle(key: string) {
    const lease = retainWocHeadMerge(key, built);
    const dispose = vi.spyOn(lease.geometry, 'dispose');
    lease.release();
    return dispose;
  }

  it('builds once per key and shares the geometry between leases', () => {
    const build = vi.fn(built);
    expect(wocHeadMergeBuilt('head')).toBe(false);
    const a = retainWocHeadMerge('head', build);
    expect(wocHeadMergeBuilt('head')).toBe(true);
    const b = retainWocHeadMerge('head', build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(b.geometry).toBe(a.geometry);
    expect(a.geometry).toBe(build.mock.results[0].value);
    expect(refs('head')).toBe(2);
    // another head is another build
    const other = retainWocHeadMerge('other', build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(other.geometry).not.toBe(a.geometry);
    expect(wocHeadMergeBuilt('never')).toBe(false);
  });

  it('records no build span of its own: the mount that asked for the build times all of it', () => {
    const spans: string[] = [];
    setBuildSpanSink((kind) => {
      spans.push(kind);
    });
    retainWocHeadMerge('head', () => {
      now += 3;
      return built();
    }).release();
    retainWocHeadMerge('head', built).release();
    expect(spans).toEqual([]);
  });

  it('releases a lease once, however often it is asked', () => {
    const a = retainWocHeadMerge('head', built);
    const b = retainWocHeadMerge('head', built);
    const dispose = vi.spyOn(a.geometry, 'dispose');
    a.release();
    a.release();
    a.release();
    // the other lease still holds it
    expect(refs('head')).toBe(1);
    // ...so no flood of idle heads can take it from under that lease
    for (let i = 0; i <= MAX_IDLE; i++) idle(`flood${i}`);
    expect(dispose).not.toHaveBeenCalled();
    expect(wocHeadMergeBuilt('head')).toBe(true);
    b.release();
    b.release();
    expect(refs('head')).toBe(0);
  });

  it('keeps an idle entry and hands it back with no second build', () => {
    const first = retainWocHeadMerge('head', built);
    const geo = first.geometry;
    const dispose = vi.spyOn(geo, 'dispose');
    first.release();
    expect(wocHeadMergeBuilt('head')).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    const again = vi.fn(built);
    const second = retainWocHeadMerge('head', again);
    expect(again).not.toHaveBeenCalled();
    expect(second.geometry).toBe(geo);
    expect(refs('head')).toBe(1);
  });

  it('keeps only a few idle heads on a constrained profile (a phone near its memory ceiling)', () => {
    // PR 4360 review, N20: what a crowd leaves behind is trimmed to the phone's cap
    const restore = gfxInternalsForTest.overrideSettings({ constrainedMemory: true });
    try {
      const disposes = Array.from({ length: 6 }, (_x, i) => idle(`phone${i}`));
      // six looks came and went: the four newest are kept, the two oldest are freed
      expect(wocHeadMergeInternalsForTest.cache.size).toBe(4);
      expect(disposes.map((dispose) => dispose.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0]);
      // a head somebody still draws is never trimmed, whatever the cap
      const drawn = retainWocHeadMerge('drawn', built);
      const drawnDispose = vi.spyOn(drawn.geometry, 'dispose');
      for (let i = 0; i < 6; i++) idle(`after${i}`);
      expect(drawnDispose).not.toHaveBeenCalled();
      expect(wocHeadMergeBuilt('drawn')).toBe(true);
      drawn.release();
    } finally {
      restore();
    }
  });

  it('keeps as many idle heads as its cap, and past it disposes the OLDEST idle one', () => {
    const disposes = Array.from({ length: MAX_IDLE }, (_x, i) => idle(`k${i}`));
    // at the cap: every one of them is still built
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(MAX_IDLE);
    for (const dispose of disposes) expect(dispose).not.toHaveBeenCalled();
    // one more idle head: the first released goes, and only that one
    const newest = idle('newest');
    expect(disposes[0]).toHaveBeenCalledTimes(1);
    expect(wocHeadMergeBuilt('k0')).toBe(false);
    for (let i = 1; i < MAX_IDLE; i++) {
      expect(disposes[i], `k${i}`).not.toHaveBeenCalled();
      expect(wocHeadMergeBuilt(`k${i}`), `k${i}`).toBe(true);
    }
    expect(newest).not.toHaveBeenCalled();
    expect(wocHeadMergeBuilt('newest')).toBe(true);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(MAX_IDLE);
    // a head disposed is built again when it comes back
    const rebuild = vi.fn(built);
    retainWocHeadMerge('k0', rebuild);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('orders idle heads by RELEASE: one leased again and let go is the newest', () => {
    const disposes = Array.from({ length: MAX_IDLE }, (_x, i) => idle(`k${i}`));
    // the oldest comes back into view, then leaves again
    retainWocHeadMerge('k0', built).release();
    idle('newest');
    // k1 was the least recently released
    expect(disposes[1]).toHaveBeenCalledTimes(1);
    expect(wocHeadMergeBuilt('k1')).toBe(false);
    expect(disposes[0]).not.toHaveBeenCalled();
    expect(wocHeadMergeBuilt('k0')).toBe(true);
  });

  it('never trims a leased entry, however old', () => {
    const held = retainWocHeadMerge('held', built);
    const heldDispose = vi.spyOn(held.geometry, 'dispose');
    const disposes = Array.from({ length: MAX_IDLE + 3 }, (_x, i) => idle(`k${i}`));
    // the three oldest IDLE heads went, the leased one (older than all of them) stayed
    expect(heldDispose).not.toHaveBeenCalled();
    expect(wocHeadMergeBuilt('held')).toBe(true);
    expect(disposes.map((d) => d.mock.calls.length)).toEqual([
      1,
      1,
      1,
      ...new Array<number>(MAX_IDLE).fill(0),
    ]);
    // let go at last, it is one idle head too many and the oldest of them goes
    held.release();
    expect(heldDispose).not.toHaveBeenCalled();
    expect(disposes[3]).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on a test reset, disposing what it held', () => {
    const lease = retainWocHeadMerge('head', built);
    const dispose = vi.spyOn(lease.geometry, 'dispose');
    wocHeadMergeInternalsForTest.reset();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(wocHeadMergeBuilt('head')).toBe(false);
    // a lease from before the reset lets go without bringing its entry back
    lease.release();
    expect(wocHeadMergeBuilt('head')).toBe(false);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
  });

  it('clearIdleWocHeadMerges disposes every head nobody draws, and leaves the leased ones', () => {
    const held = retainWocHeadMerge('held', built);
    const heldDispose = vi.spyOn(held.geometry, 'dispose');
    // leased twice, let go once: still somebody's
    const shared = retainWocHeadMerge('shared', built);
    const sharedDispose = vi.spyOn(shared.geometry, 'dispose');
    retainWocHeadMerge('shared', built).release();
    const idles = ['a', 'b', 'c'].map(idle);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(5);

    clearIdleWocHeadMerges();
    for (const dispose of idles) expect(dispose).toHaveBeenCalledTimes(1);
    expect(['a', 'b', 'c'].map(wocHeadMergeBuilt)).toEqual([false, false, false]);
    expect(heldDispose).not.toHaveBeenCalled();
    expect(sharedDispose).not.toHaveBeenCalled();
    expect([...wocHeadMergeInternalsForTest.cache.keys()]).toEqual(['held', 'shared']);
    expect([refs('held'), refs('shared')]).toEqual([1, 1]);
    // ...and their holders still draw the very geometry they leased
    expect(wocHeadMergeInternalsForTest.cache.get('held')?.geometry).toBe(held.geometry);

    // let go later, a leased head is an ordinary idle entry again, kept for its look
    held.release();
    expect(wocHeadMergeBuilt('held')).toBe(true);
    expect(heldDispose).not.toHaveBeenCalled();
    // ...until the next clear
    clearIdleWocHeadMerges();
    expect(heldDispose).toHaveBeenCalledTimes(1);
    expect([...wocHeadMergeInternalsForTest.cache.keys()]).toEqual(['shared']);
    // nothing idle: nothing to do, and nothing disposed twice
    clearIdleWocHeadMerges();
    expect([...wocHeadMergeInternalsForTest.cache.keys()]).toEqual(['shared']);
    for (const dispose of idles) expect(dispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
    // a cleared head is built again when it comes back
    const rebuild = vi.fn(built);
    retainWocHeadMerge('a', rebuild);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
});

describe('wocHeadMergedSource', () => {
  it('is one two sided clone per base material, on the same atlas', () => {
    const atlas = new THREE.Texture();
    const base = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6 });
    base.name = 'skin_head';
    base.color.setRGB(0.5, 0.25, 0.125);
    base.userData.wocHeadAtlas = { white: [0.5, 0.5] };
    const source = wocHeadMergedSource(base) as THREE.MeshStandardMaterial;
    expect(source).not.toBe(base);
    expect(source.name).toBe('woc_head_merged');
    // two sided whatever the base: the shader drops the back of a one sided slot
    expect(source.side).toBe(THREE.DoubleSide);
    expect(source.map).toBe(atlas);
    // the base's own surface comes along
    expect(source.roughness).toBe(0.6);
    expect(source.color.toArray()).toEqual([0.5, 0.25, 0.125]);
    // one per base: every merged head of a type shares it (and its tier derivation)
    expect(wocHeadMergedSource(base)).toBe(source);
    // the file material itself is left as it was
    expect(base.name).toBe('skin_head');
    expect(base.side).toBe(THREE.FrontSide);
    // another head file is another source
    const other = new THREE.MeshStandardMaterial({ map: atlas });
    expect(wocHeadMergedSource(other)).not.toBe(source);
    // a name that takes no worn surface layer from the tier derivation
    expect(wocHeadMergedSource(other).name).toBe('woc_head_merged');
  });
});

describe('wocHeadMergeSurfaceOf', () => {
  it('reads the colour, the emissive at its intensity, the roughness and the metalness', () => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.5 });
    m.color.setRGB(0.5, 0.25, 0.125);
    m.emissive.setRGB(0.5, 1, 0.25);
    m.emissiveIntensity = 0.5;
    expect(wocHeadMergeSurfaceOf(m)).toEqual({
      color: [0.5, 0.25, 0.125],
      emissive: [0.25, 0.5, 0.125],
      roughness: 0.75,
      metalness: 0.5,
    });
    // a material array reads its first
    expect(wocHeadMergeSurfaceOf([m, new THREE.MeshStandardMaterial()])).toEqual(
      wocHeadMergeSurfaceOf(m),
    );
  });

  it("reads the low tier's Lambert as fully rough and not metal", () => {
    const m = new THREE.MeshLambertMaterial();
    m.color.setRGB(0.25, 0.5, 1);
    expect(wocHeadMergeSurfaceOf(m)).toEqual({
      color: [0.25, 0.5, 1],
      emissive: [0, 0, 0],
      roughness: 1,
      metalness: 0,
    });
    // a material with no emissive at all is not lit from within
    expect(wocHeadMergeSurfaceOf(new THREE.MeshBasicMaterial()).emissive).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// One character's merged head
// ---------------------------------------------------------------------------

const SKIN_REF = [0.2346, 0.1195, 0.0865] as const;
const BROW_REF = [0.023, 0.023, 0.023] as const;
const HAIR_REF = [0.0184, 0.0184, 0.0184] as const;
const BEARD_REF = [0.0603, 0.0603, 0.0603] as const;

function fileMaterial(name: string, map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map });
  m.name = name;
  return m;
}

/** What every character of a head type shares: the files' geometries, materials and
 *  textures (one atlas for the core pieces, the hairstyle's and the beard's own). */
function library() {
  const atlas = new THREE.Texture();
  const hairTex = new THREE.Texture();
  const beardTex = new THREE.Texture();
  const base = fileMaterial('skin_head', atlas);
  base.userData.wocHeadAtlas = { white: [0.5, 0.5] };
  // plain standard materials, as a pack ships them (a case swaps one for another class)
  const mats: Record<'base' | 'brow' | 'hair' | 'beard', THREE.Material> = {
    base,
    brow: fileMaterial('brow_L', atlas),
    hair: fileMaterial('hair_swept', hairTex),
    beard: fileMaterial('hair_beard_full', beardTex),
  };
  return {
    atlas,
    hairTex,
    beardTex,
    mats,
    geos: {
      // the base carries one face control: it lifts every vertex along +z
      base: triangle(0, { morphs: [[0, 0, 1, 0, 0, 1, 0, 0, 1]] }),
      brow: triangle(10),
      hair: triangle(20),
      beard: triangle(30),
    },
  };
}
type Library = ReturnType<typeof library>;

/** One character's hung head: a wrapper per file on its `head` bone, each piece a mesh
 *  drawing with ITS OWN mounted material (a visual's tier clone), never the file's. */
function hang(lib: Library = library()) {
  const bone = new THREE.Bone();
  bone.name = 'head';
  // the bone's own pose is the merged mesh's parent space: it never enters a merge
  bone.position.set(5, 5, 5);
  bone.scale.setScalar(3);
  const wrapper = (name: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    bone.add(g);
    return g;
  };
  const core = wrapper('woc_head_core_head');
  const mesh = (
    parent: THREE.Object3D,
    name: string,
    geo: THREE.BufferGeometry,
    file: THREE.Material,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, file.clone());
    m.name = name;
    parent.add(m);
    return m;
  };
  const meshes = {
    base: mesh(core, 'WocHead_A_base', lib.geos.base, lib.mats.base),
    brow: mesh(core, 'WocHead_A_brows_L', lib.geos.brow, lib.mats.brow),
    hair: mesh(wrapper('woc_head_hair_head'), 'WocHead_A_hair_swept', lib.geos.hair, lib.mats.hair),
    beard: mesh(
      wrapper('woc_head_beards_head'),
      'WocHead_A_beard_full',
      lib.geos.beard,
      lib.mats.beard,
    ),
  };
  // the brow rides its own node transform (the pack's dequantization lives there)
  meshes.brow.position.set(0, 0, 2);
  meshes.brow.scale.setScalar(0.5);
  const drawn: WocHeadMergeCandidate[] = [
    {
      mesh: meshes.base,
      piece: 'WocHead_A_base',
      material: lib.mats.base,
      role: 'skin',
      ref: SKIN_REF,
    },
    {
      mesh: meshes.brow,
      piece: 'WocHead_A_brows_L',
      material: lib.mats.brow,
      role: 'brow',
      ref: BROW_REF,
    },
    {
      mesh: meshes.hair,
      piece: 'WocHead_A_hair_swept',
      material: lib.mats.hair,
      role: 'hair',
      ref: HAIR_REF,
    },
    {
      mesh: meshes.beard,
      piece: 'WocHead_A_beard_full',
      material: lib.mats.beard,
      role: 'hair',
      ref: BEARD_REF,
    },
  ];
  return { lib, bone, core, meshes, drawn };
}
type Hung = ReturnType<typeof hang>;

/** One more drawn core piece on `h` (a mesh under the core wrapper, drawn with a clone
 *  of its file material), added to its drawn list. */
function addPiece(
  h: Hung,
  name: string,
  file: THREE.Material,
  geo: THREE.BufferGeometry = triangle(40),
  parent: THREE.Object3D = h.core,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, file.clone());
  m.name = name;
  parent.add(m);
  h.drawn.push({ mesh: m, piece: name, material: file, role: null, ref: null });
  return m;
}

interface RigOptions {
  type?: WocHeadType;
  /** Runs inside the host's adoption, after the dressing's retint pass. */
  onAdopt?: (node: THREE.Object3D) => void;
}

/** A rig on a fake host and a fake reveal: the reveal waits for `link` (gated: the
 *  compile gate in flight) or settles prepared at once. Everything handed over is
 *  recorded. */
function rigOn(gated: boolean, options: RigOptions = {}) {
  const reveals: ((prepared: boolean) => void)[] = [];
  const calls: string[] = [];
  const adopted: THREE.Object3D[] = [];
  const forgotten: THREE.Object3D[] = [];
  const revealed: THREE.Object3D[] = [];
  const retint = vi.fn();
  const host: WocHeadMergeHost = {
    adopt: (node, pass) => {
      calls.push('adopt');
      adopted.push(node);
      pass();
      options.onAdopt?.(node);
    },
    forget: (node) => {
      calls.push('forget');
      forgotten.push(node);
    },
  };
  const rig = new WocHeadMergeRig(host, options.type ?? 'a', retint, (node, live) => {
    calls.push('reveal');
    revealed.push(node);
    if (gated) reveals.push(live);
    else live(true);
  });
  /** Settle every reveal in flight: the gate linked, or gave up (prepared false). */
  const link = (prepared = true): void => {
    for (const live of reveals.splice(0)) live(prepared);
  };
  return { rig, host, retint, reveals, calls, adopted, forgotten, revealed, link };
}

/** What the rig's owner does with it: reconcile with the drawn head, then mount what
 *  waits (the when is the owner's). Answers whether that mounted a head (false when the
 *  head wanted already stands: nothing waited). */
function stand(
  rig: WocHeadMergeRig,
  bone: THREE.Object3D,
  drawn: readonly WocHeadMergeCandidate[],
): boolean {
  rig.sync(bone, drawn);
  return rig.mountPending();
}

const masksOf = (h: Hung): number[] => h.drawn.map((c) => c.mesh.layers.mask);
const mergedWrappers = (bone: THREE.Object3D): THREE.Object3D[] =>
  bone.children.filter((c) => c.name === 'woc_head_merged');
/** The merged vertex positions of drawn piece `i` (three vertices each in this fixture). */
const piecePositions = (geo: THREE.BufferGeometry, i: number): number[] =>
  values(geo, 'position').slice(i * 9, i * 9 + 9);
/** The base head's one face control. */
const pose = (h: Hung, weight: number): void => {
  (h.meshes.base.morphTargetInfluences as number[])[0] = weight;
};
const cacheRefs = (): number[] =>
  [...wocHeadMergeInternalsForTest.cache.values()].map((e) => e.refs);

/** One way a file material cannot ride the merged material: mutate it (or its colour
 *  map), or answer the material that takes its place. */
type Spoil = (m: THREE.MeshStandardMaterial) => THREE.Material | undefined;

/** `file` spoiled: the same object mutated, or the material that replaces it. */
const spoiled = (file: THREE.Material, spoil: Spoil): THREE.Material =>
  spoil(file as THREE.MeshStandardMaterial) ?? file;

const set =
  (write: (m: THREE.MeshStandardMaterial) => void): Spoil =>
  (m) => {
    write(m);
    return undefined;
  };
const onMap =
  (write: (map: THREE.Texture) => void): Spoil =>
  (m) => {
    write(m.map as THREE.Texture);
    return undefined;
  };
/** A material of another class under the same name, on the same texture and with the
 *  same build record: only its class differs. */
const recast =
  (make: (map: THREE.Texture | null) => THREE.Material): Spoil =>
  (m) => {
    const out = make(m.map);
    out.name = m.name;
    out.userData = m.userData;
    return out;
  };

/** Every way a file material cannot ride the merged material, one at a time. */
const UNMERGEABLE: [string, Spoil][] = [
  // the tier derivation gives a material the worn surface layer by its NAME, and the
  // merged material carries none: the gold of a piercing
  [
    'worn by its name (metal_gold)',
    set((m) => {
      m.name = 'metal_gold';
    }),
  ],
  [
    'worn by its name (leather_strap)',
    set((m) => {
      m.name = 'leather_strap';
    }),
  ],
  // the merged material is a clone of a plain standard one: no other class rides it
  ['a physical material', recast((map) => new THREE.MeshPhysicalMaterial({ map }))],
  ['a Lambert material', recast((map) => new THREE.MeshLambertMaterial({ map }))],
  ['a basic (unlit) material', recast((map) => new THREE.MeshBasicMaterial({ map }))],
  [
    'back sided',
    set((m) => {
      m.side = THREE.BackSide;
    }),
  ],
  [
    'transparent',
    set((m) => {
      m.transparent = true;
    }),
  ],
  [
    'alpha tested',
    set((m) => {
      m.alphaTest = 0.5;
    }),
  ],
  [
    'not depth writing',
    set((m) => {
      m.depthWrite = false;
    }),
  ],
  [
    'polygon offset',
    set((m) => {
      m.polygonOffset = true;
    }),
  ],
  [
    'alpha mapped',
    set((m) => {
      m.alphaMap = new THREE.Texture();
    }),
  ],
  [
    'normal mapped',
    set((m) => {
      m.normalMap = new THREE.Texture();
    }),
  ],
  [
    'roughness mapped',
    set((m) => {
      m.roughnessMap = new THREE.Texture();
    }),
  ],
  [
    'metalness mapped',
    set((m) => {
      m.metalnessMap = new THREE.Texture();
    }),
  ],
  [
    'emissive mapped',
    set((m) => {
      m.emissiveMap = new THREE.Texture();
    }),
  ],
  [
    'occlusion mapped',
    set((m) => {
      m.aoMap = new THREE.Texture();
    }),
  ],
  [
    'vertex coloured',
    set((m) => {
      m.vertexColors = true;
    }),
  ],
  // the merged shader samples every texture untransformed, on the first uv set
  [
    'mapped on a second uv set',
    onMap((map) => {
      map.channel = 1;
    }),
  ],
  [
    'mapped with a shift along u',
    onMap((map) => {
      map.offset.x = 0.25;
    }),
  ],
  [
    'mapped with a shift along v',
    onMap((map) => {
      map.offset.y = 0.25;
    }),
  ],
  [
    'mapped with a tiling along u',
    onMap((map) => {
      map.repeat.x = 2;
    }),
  ],
  [
    'mapped with a tiling along v',
    onMap((map) => {
      map.repeat.y = 2;
    }),
  ],
  [
    'mapped with a rotation',
    onMap((map) => {
      map.rotation = 0.5;
    }),
  ],
];

describe('WocHeadMergeRig: planning and mounting', () => {
  it('sync only plans: the head waits, and nothing is built, hung or adopted', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig, calls } = rigOn(false);
    expect(rig.mesh).toBeNull();
    expect(rig.table).toBeNull();
    expect(rig.isWaiting).toBe(false);
    expect(rig.pendingBuilt).toBe(false);
    // nothing to mount yet
    expect(rig.mountPending()).toBe(false);
    // nothing was mounted, so nothing dropped
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.pendingBuilt).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(rig.table).toBeNull();
    expect(rig.standing).toBe(false);
    expect(calls).toEqual([]);
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(masksOf(h)).toEqual(before);
    // planned again (its owner reconciles on every pass): one head waiting, as before
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(calls).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
  });

  it('mountPending mounts one tagged mesh for the drawn pieces, in a wrapper on the head bone', () => {
    const h = hang();
    const { rig, retint, adopted, revealed, calls } = rigOn(true);
    rig.sync(h.bone, h.drawn);
    expect(rig.mountPending()).toBe(true);
    const mesh = rig.mesh as THREE.Mesh;
    expect(mesh.name).toBe('WocHead_A_merged');
    expect(mesh.parent?.name).toBe('woc_head_merged');
    expect(mesh.parent?.parent).toBe(h.bone);
    expect(mergedWrappers(h.bone)).toHaveLength(1);
    expect(mergedWrappers(h.bone)[0]).toBe(mesh.parent);
    // the tag the dressing finds it by, and the tags every hung head piece carries
    expect(WOC_HEAD_MERGED_KEY).toBe('wocHeadMerged');
    expect(mesh.userData).toEqual({ wocHeadMerged: true, wocHeadPart: true, wocArmorPart: true });
    // it draws with the base head's merged source: the atlas, two sided
    expect(mesh.material).toBe(wocHeadMergedSource(h.lib.mats.base));
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(h.lib.atlas);
    expect((mesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    // the host adopted the WRAPPER, ran the dressing's retint, then the reveal was asked
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBe(mesh.parent);
    expect(retint).toHaveBeenCalledTimes(1);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toBe(mesh.parent);
    expect(calls).toEqual(['adopt', 'reveal']);
    expect(rig.isWaiting).toBe(false);
    expect(rig.pendingBuilt).toBe(false);
    // nothing waits any more: asking again mounts nothing and leaves the head as it is.
    // The answer is THIS call's: false with nothing waiting, even while a head stands
    expect(rig.mountPending()).toBe(false);
    expect(rig.mesh).toBe(mesh);
    expect(calls).toEqual(['adopt', 'reveal']);
    expect(mergedWrappers(h.bone)).toHaveLength(1);
  });

  it('is in place, hidden and readable by the time the host adopts it', () => {
    // the retint pass run inside adopt wraps the merged material and writes its slot
    // rows, so the mesh must already hang on the bone with its table answered; and it
    // must not draw yet (its programs are not linked)
    const h = hang();
    const seen: Record<string, unknown>[] = [];
    const host: WocHeadMergeHost = {
      adopt: (node) => {
        seen.push({
          onBone: node.parent === h.bone,
          mesh: rig.mesh !== null && rig.mesh.parent === node,
          slots: rig.table?.slots.length ?? -1,
          sources: rig.table?.slotSources.length ?? -1,
          visible: node.visible,
          standing: rig.standing,
          masks: masksOf(h),
        });
      },
      forget: () => undefined,
    };
    const rig = new WocHeadMergeRig(
      host,
      'a',
      () => undefined,
      (_node, live) => live(true),
    );
    stand(rig, h.bone, h.drawn);
    expect(seen).toEqual([
      {
        onBone: true,
        mesh: true,
        slots: 4,
        sources: 4,
        visible: false,
        standing: false,
        masks: [1, 1, 1, 1],
      },
    ]);
  });

  it('names the mesh after its head type', () => {
    const h = hang();
    const { rig } = rigOn(false, { type: 'b' });
    stand(rig, h.bone, h.drawn);
    expect(rig.type).toBe('b');
    expect(rig.mesh?.name).toBe('WocHead_B_merged');
  });

  it('folds every piece through its own node transforms up to the bone, never the bone', () => {
    const h = hang();
    // a piece node with two meshes under it (an eye: the lid shell and the eyeball)
    const eye = new THREE.Group();
    eye.name = 'WocHead_A_eyes_default_L';
    eye.position.set(1, 0, 0);
    eye.scale.setScalar(2);
    h.core.add(eye);
    const lid = addPiece(
      h,
      'WocHead_A_eyes_default_L',
      fileMaterial('skin_eyelid_L', h.lib.atlas),
      triangle(0),
      eye,
    );
    lid.position.set(0, 0.5, 0);
    const { rig } = rigOn(false);
    // no matrix was ever updated: a body is dressed before its first matrix update
    stand(rig, h.bone, h.drawn);
    const geo = (rig.mesh as THREE.Mesh).geometry;
    expect(geo.getAttribute('position').count).toBe(15);
    // the base as authored; the brow halved then moved; the hair and beard as authored
    expect(piecePositions(geo, 0)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(piecePositions(geo, 1)).toEqual([5, 0, 2, 5.5, 0, 2, 5, 0.5, 2]);
    expect(piecePositions(geo, 2)).toEqual([20, 0, 0, 21, 0, 0, 20, 1, 0]);
    expect(piecePositions(geo, 3)).toEqual([30, 0, 0, 31, 0, 0, 30, 1, 0]);
    // the lid: its own offset, then its piece node's scale and offset
    expect(piecePositions(geo, 4)).toEqual([1, 1, 0, 3, 1, 0, 1, 3, 0]);
    // each vertex carries its piece's slot, each textured piece its own uv
    expect(values(geo, 'aWocHmSlot')).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(values(geo, 'uv').slice(0, 6)).toEqual([0.125, 0.25, 0.375, 0.5, 0.625, 0.75]);
    expect(indices(geo)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('places a node that keeps its own matrix by that matrix, never by its stale position', () => {
    const h = hang();
    // the brow's node is driven by its matrix: its position and scale say otherwise
    h.meshes.brow.matrixAutoUpdate = false;
    h.meshes.brow.matrix.makeTranslation(0, 0, 7);
    // ...and so is the hairstyle's file wrapper, above its mesh
    const wrapper = h.meshes.hair.parent as THREE.Object3D;
    wrapper.matrixAutoUpdate = false;
    wrapper.matrix.makeScale(2, 1, 1);
    wrapper.position.set(100, 100, 100);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    const geo = (rig.mesh as THREE.Mesh).geometry;
    // the brow: moved by its matrix alone (not halved, not at z 2)
    expect(piecePositions(geo, 1)).toEqual([10, 0, 7, 11, 0, 7, 10, 1, 7]);
    // the hair: as authored, then its wrapper's matrix
    expect(piecePositions(geo, 2)).toEqual([40, 0, 0, 42, 0, 0, 40, 1, 0]);
    // the others by their position, rotation and scale, as ever
    expect(piecePositions(geo, 3)).toEqual([30, 0, 0, 31, 0, 0, 30, 1, 0]);
  });

  it('draws on the layers its first piece draws on', () => {
    const h = hang();
    // a body somebody put on a layer of its own (a portrait camera, a preview)
    h.meshes.base.layers.set(3);
    h.meshes.hair.layers.enable(5);
    expect(masksOf(h)).toEqual([8, 1, 33, 1]);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(rig.mesh?.layers.mask).toBe(8);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    rig.drop();
    expect(masksOf(h)).toEqual([8, 1, 33, 1]);
    // the default layer for pieces nobody moved
    const plain = hang();
    const other = rigOn(false);
    stand(other.rig, plain.bone, plain.drawn);
    expect(other.rig.mesh?.layers.mask).toBe(1);
  });

  it('times each mount as ONE view-lane span: the build, the adoption and the wrap together', () => {
    const spans: { kind: string; ms: number; atMs: number }[] = [];
    setBuildSpanSink((kind, ms, atMs) => spans.push({ kind, ms, atMs }));
    const lib = library();
    const one = hang(lib);
    const two = hang(lib);
    const first = rigOn(false, {
      onAdopt: () => {
        now += 3;
      },
    });
    // planning costs nothing worth a span
    first.rig.sync(one.bone, one.drawn);
    expect(spans).toEqual([]);
    now = 1010;
    expect(first.rig.mountPending()).toBe(true);
    // one span for the whole mount, stamped with the frame that paid it: never a second
    // one for the geometry build inside it
    expect(spans).toEqual([{ kind: 'view:woc-head-merge', ms: 3, atMs: 1010 }]);
    expect(buildLedgerLane(spans[0].kind)).toBe('view');
    // a head somebody already built is a mount all the same
    const twin = rigOn(false, {
      onAdopt: () => {
        now += 1;
      },
    });
    expect(stand(twin.rig, two.bone, two.drawn)).toBe(true);
    expect(spans).toHaveLength(2);
    expect(spans[1]).toEqual({ kind: 'view:woc-head-merge', ms: 1, atMs: 1013 });
    // nothing waiting: nothing to time
    twin.rig.mountPending();
    expect(spans).toHaveLength(2);
  });
});

describe('WocHeadMergeRig: standing in for the pieces', () => {
  it('is mounted hidden: only its reveal shows it and takes the pieces out', () => {
    const h = hang();
    // a piece somebody put on layers of their own
    h.meshes.hair.layers.enable(5);
    const before = masksOf(h);
    expect(before).toEqual([1, 1, 33, 1]);
    const { rig, link } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    const wrapper = rig.mesh?.parent as THREE.Object3D;
    // mounted, still linking: it does not draw, nothing is hidden, nothing stands in
    expect(rig.mesh).not.toBeNull();
    expect(wrapper.visible).toBe(false);
    expect(rig.standing).toBe(false);
    expect(masksOf(h)).toEqual(before);
    link();
    // linked: one mesh draws, and every source is out of both render passes
    expect(wrapper.visible).toBe(true);
    expect(rig.standing).toBe(true);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    // what a piece IS stays untouched: its visibility is the dressing's
    for (const c of h.drawn) expect(c.mesh.visible, c.piece).toBe(true);
    // ...and the stand-in itself is in the render lists
    expect(rig.mesh?.layers.mask).toBe(1);
    expect(rig.mesh?.visible).toBe(true);
  });

  it('a reveal that comes back unprepared drops the head, and leaves it to be planned again', () => {
    const h = hang();
    const { rig, link, forgotten, adopted } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    const wrapper = rig.mesh?.parent as THREE.Object3D;
    // a piece changed its layers while the head linked: nothing may write over that
    h.meshes.hair.layers.enable(5);
    link(false);
    expect(rig.mesh).toBeNull();
    expect(rig.table).toBeNull();
    expect(rig.standing).toBe(false);
    // it never drew, its pieces never stopped
    expect(wrapper.visible).toBe(false);
    expect(wrapper.parent).toBeNull();
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toBe(wrapper);
    expect(masksOf(h)).toEqual([1, 1, 33, 1]);
    // its geometry is let go (idle, for whoever can draw it)
    expect(cacheRefs()).toEqual([0]);
    // nothing to do with an effect
    expect(rig.heldByEffect).toBe(false);

    // ONE miss is not a refusal (an effect edge during the link is the usual cause): the
    // same head waits again, and this time its reveal lands
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.pendingBuilt).toBe(true);
    expect(rig.mountPending()).toBe(true);
    expect(adopted).toHaveLength(2);
    link();
    expect(rig.standing).toBe(true);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
  });

  it('a head that comes back unprepared twice running is left in its pieces for good', () => {
    const h = hang();
    h.meshes.hair.layers.enable(5);
    const { rig, link, adopted } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    link(false);
    stand(rig, h.bone, h.drawn);
    link(false);
    expect(rig.mesh).toBeNull();
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(masksOf(h)).toEqual([1, 1, 33, 1]);
    expect(adopted).toHaveLength(2);
    // refused: nothing waits, nothing mounts
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(adopted).toHaveLength(2);

    // another face is another head: it mounts and stands
    pose(h, 0.5);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountPending()).toBe(true);
    link();
    expect(rig.standing).toBe(true);
    // back to the refused face: the standing head goes, and the refused one stays away
    pose(h, 0);
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.isWaiting).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(masksOf(h)).toEqual([1, 1, 33, 1]);

    // the refusal is this character's own: another one in the same face still merges
    const twin = hang(h.lib);
    const other = rigOn(false);
    expect(stand(other.rig, twin.bone, twin.drawn)).toBe(true);
    expect(other.rig.standing).toBe(true);
  });

  it('counts misses in a row on ONE head: a reveal that lands, or another head, starts again', () => {
    const h = hang();
    const { rig, link } = rigOn(true);
    // a miss, a reveal that lands, a miss: never two running
    stand(rig, h.bone, h.drawn);
    link(false);
    stand(rig, h.bone, h.drawn);
    link();
    expect(rig.standing).toBe(true);
    rig.drop();
    stand(rig, h.bone, h.drawn);
    link(false);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    // another face misses in between: it keeps a count of its own
    pose(h, 0.5);
    stand(rig, h.bone, h.drawn);
    link(false);
    pose(h, 0);
    stand(rig, h.bone, h.drawn);
    link(false);
    // each missed once since the other did: neither is refused
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    pose(h, 0.5);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    // ...until one of them misses twice with nothing in between
    stand(rig, h.bone, h.drawn);
    link(false);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    stand(rig, h.bone, h.drawn);
    link(false);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
  });

  it('drop restores every ORIGINAL mask, removes the wrapper, forgets it and lets the lease go', () => {
    const h = hang();
    h.meshes.hair.layers.enable(5);
    h.meshes.brow.layers.set(3);
    const before = masksOf(h);
    expect(before).toEqual([1, 8, 33, 1]);
    const { rig, forgotten, calls } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    const wrapper = rig.mesh?.parent as THREE.Object3D;
    expect(cacheRefs()).toEqual([1]);

    expect(rig.drop()).toBe(true);
    expect(masksOf(h)).toEqual(before);
    expect(wrapper.parent).toBeNull();
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toBe(wrapper);
    expect(calls).toEqual(['adopt', 'reveal', 'forget']);
    expect(rig.mesh).toBeNull();
    expect(rig.standing).toBe(false);
    expect(rig.table).toBeNull();
    // the geometry is idle, kept for the look coming back
    expect(cacheRefs()).toEqual([0]);
    // nothing left to take down
    expect(rig.drop()).toBe(false);
    expect(forgotten).toHaveLength(1);
  });

  it('drops a head that was still linking without touching a mask', () => {
    const h = hang();
    const { rig } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    // a piece changed its layers while the head linked
    h.meshes.hair.layers.enable(5);
    expect(rig.drop()).toBe(true);
    expect(masksOf(h)).toEqual([1, 1, 33, 1]);
  });

  it('a reveal that settles after the head was dropped shows and hides nothing', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig, link } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    const wrapper = rig.mesh?.parent as THREE.Object3D;
    rig.drop();
    link();
    expect(masksOf(h)).toEqual(before);
    expect(rig.standing).toBe(false);
    expect(wrapper.visible).toBe(false);
  });

  it('a reveal of a REPLACED head hides nothing: only the head that stands does', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig, reveals } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    const stale = rig.mesh?.parent as THREE.Object3D;
    // the face moves while the first head links: it is replaced
    pose(h, 0.5);
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.mountPending()).toBe(true);
    expect(reveals).toHaveLength(2);
    reveals[0](true);
    expect(masksOf(h)).toEqual(before);
    expect(rig.standing).toBe(false);
    expect(stale.visible).toBe(false);
    reveals[1](true);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    expect(rig.standing).toBe(true);
  });

  it('a failed reveal of a head already replaced neither drops nor refuses anything', () => {
    const h = hang();
    const { rig, reveals } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    pose(h, 0.5);
    stand(rig, h.bone, h.drawn);
    const current = rig.mesh;
    // the first head's gate gives up after it was replaced: the second is untouched
    reveals[0](false);
    expect(rig.mesh).toBe(current);
    expect(mergedWrappers(h.bone)).toHaveLength(1);
    reveals[1](true);
    expect(rig.standing).toBe(true);
    // ...and the first face is still welcome when it comes back
    pose(h, 0);
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountPending()).toBe(true);
  });

  it('dispose takes the head down and forgets a waiting one', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig, adopted } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    rig.dispose();
    expect(rig.mesh).toBeNull();
    expect(masksOf(h)).toEqual(before);
    expect(mergedWrappers(h.bone)).toEqual([]);
    // a head left waiting is not mounted afterwards
    rig.sync(h.bone, h.drawn);
    expect(rig.isWaiting).toBe(true);
    rig.dispose();
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(adopted).toHaveLength(1);
  });
});

describe('WocHeadMergeRig: a mount that fails', () => {
  /** Where the mount throws: every step after the geometry is leased. */
  const STAGES = ['the host adoption', 'the retint pass', 'the reveal'] as const;

  it.each(STAGES)(
    'a throw from %s is caught: the head keeps its pieces and is never tried again',
    (stage) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const spans: string[] = [];
      setBuildSpanSink((kind) => spans.push(kind));
      const h = hang();
      h.meshes.hair.layers.enable(5);
      const before = masksOf(h);
      const failure = new Error(`mount failed in ${stage}`);
      const adopted: THREE.Object3D[] = [];
      const forgotten: THREE.Object3D[] = [];
      let live = 0;
      const host: WocHeadMergeHost = {
        adopt: (node, retint) => {
          adopted.push(node);
          if (stage === 'the host adoption') throw failure;
          retint();
        },
        forget: (node) => {
          forgotten.push(node);
        },
      };
      const rig = new WocHeadMergeRig(
        host,
        'a',
        () => {
          if (stage === 'the retint pass') throw failure;
        },
        (_node, settle) => {
          if (stage === 'the reveal') throw failure;
          live++;
          settle(true);
        },
      );
      rig.sync(h.bone, h.drawn);
      let mounted = true;
      expect(() => {
        mounted = rig.mountPending();
      }).not.toThrow();
      expect(mounted).toBe(false);
      expect(rig.mesh).toBeNull();
      expect(rig.table).toBeNull();
      expect(rig.standing).toBe(false);
      expect(rig.isWaiting).toBe(false);
      // the half mounted wrapper is gone, the host told to forget it, the lease let go
      expect(adopted).toHaveLength(1);
      expect(adopted[0].parent).toBeNull();
      expect(mergedWrappers(h.bone)).toEqual([]);
      expect(forgotten).toHaveLength(1);
      expect(forgotten[0]).toBe(adopted[0]);
      expect(cacheRefs()).toEqual([0]);
      // the pieces never stopped drawing
      expect(masksOf(h)).toEqual(before);
      expect(live).toBe(0);
      // said once on the dev channel, with the error
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toBe(
        'WOC merged head could not mount, the head keeps drawing piece by piece:',
      );
      expect(error.mock.calls[0][1]).toBe(failure);
      // ...and nothing to do with an effect
      expect(rig.heldByEffect).toBe(false);
      // a mount that failed is not a mount the ledger timed
      expect(spans).toEqual([]);

      // refused: the same head never waits again (a per-frame throw would stall the frame)
      expect(rig.sync(h.bone, h.drawn)).toBe(false);
      expect(rig.isWaiting).toBe(false);
      expect(rig.mountPending()).toBe(false);
      expect(adopted).toHaveLength(1);
      expect(error).toHaveBeenCalledTimes(1);
    },
  );

  it('a throw from the geometry build is caught too: nothing was hung, nothing is cached', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = hang();
    const before = masksOf(h);
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    const failure = new Error('fold failed');
    vi.spyOn(THREE.Mesh.prototype, 'getVertexPosition').mockImplementation(() => {
      throw failure;
    });
    let mounted = true;
    expect(() => {
      mounted = rig.mountPending();
    }).not.toThrow();
    expect(mounted).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(calls).toEqual([]);
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(masksOf(h)).toEqual(before);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe(failure);
    // refused, even once the fold would work again
    vi.mocked(THREE.Mesh.prototype.getVertexPosition).mockRestore();
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
  });

  it.each([
    ['one material', (m: THREE.Material) => m],
    ['a material list', (m: THREE.Material) => [m]],
  ])(
    'a head adopted straight into a translucent effect (%s) goes back to its pieces, and is not refused',
    (_what, mounted) => {
      const h = hang();
      const before = masksOf(h);
      // the effect the body wears lands on a mesh adopted now
      let ghost = true;
      const { rig, adopted, forgotten, revealed, calls } = rigOn(false, {
        onAdopt: (node) => {
          if (!ghost) return;
          const overlay = new THREE.MeshStandardMaterial({ transparent: true });
          (node.children[0] as THREE.Mesh).material = mounted(overlay);
        },
      });
      expect(rig.heldByEffect).toBe(false);
      expect(stand(rig, h.bone, h.drawn)).toBe(false);
      // the rig says why: an effect holds the head in its pieces
      expect(rig.heldByEffect).toBe(true);
      expect(rig.mesh).toBeNull();
      expect(rig.standing).toBe(false);
      expect(mergedWrappers(h.bone)).toEqual([]);
      expect(forgotten).toHaveLength(1);
      expect(forgotten[0]).toBe(adopted[0]);
      // never asked to reveal: it draws nothing
      expect(revealed).toEqual([]);
      expect(calls).toEqual(['adopt', 'forget']);
      expect(masksOf(h)).toEqual(before);
      expect(cacheRefs()).toEqual([0]);
      // not refused: when the effect ends the same head is planned and mounted
      ghost = false;
      expect(rig.sync(h.bone, h.drawn)).toBe(false);
      expect(rig.isWaiting).toBe(true);
      expect(rig.pendingBuilt).toBe(true);
      // planning says nothing of the effect: the answer is the last MOUNT's
      expect(rig.heldByEffect).toBe(true);
      expect(rig.mountPending()).toBe(true);
      expect(rig.heldByEffect).toBe(false);
      expect(rig.standing).toBe(true);
      expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    },
  );
});

describe('WocHeadMergeRig: keeping in step with the drawn head', () => {
  it('a second sync with the same pieces is a no-op', () => {
    const h = hang();
    const { rig, adopted, retint } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    const mesh = rig.mesh;
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    // an equal list built anew (the dressing rebuilds it per apply) is the same head
    expect(
      rig.sync(
        h.bone,
        h.drawn.map((c) => ({ ...c })),
      ),
    ).toBe(false);
    expect(rig.mesh).toBe(mesh);
    expect(rig.standing).toBe(true);
    // the head that stands is the head wanted: nothing waits
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(adopted).toHaveLength(1);
    expect(retint).toHaveBeenCalledTimes(1);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
  });

  it('a face slider drops the head at once, and its mount bakes the new pose', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig, link, forgotten, adopted } = rigOn(true);
    stand(rig, h.bone, h.drawn);
    link();
    const first = rig.mesh as THREE.Mesh;
    expect(piecePositions(first.geometry, 0)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);

    pose(h, 0.5);
    // reconciled inside the caller's own pass: the stand-in goes, its pieces draw again
    // on this frame, and the new face only WAITS (never a mount in here)
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.mesh).toBeNull();
    expect(masksOf(h)).toEqual(before);
    expect(first.parent?.parent).toBeNull();
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toBe(first.parent);
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(adopted).toHaveLength(1);
    expect(rig.isWaiting).toBe(true);
    expect(rig.pendingBuilt).toBe(false);

    expect(rig.mountPending()).toBe(true);
    const second = rig.mesh as THREE.Mesh;
    expect(second).not.toBe(first);
    expect(second.geometry).not.toBe(first.geometry);
    expect(mergedWrappers(h.bone)).toHaveLength(1);
    expect(mergedWrappers(h.bone)[0]).toBe(second.parent);
    expect(rig.standing).toBe(false);
    expect(masksOf(h)).toEqual(before);
    // it draws where the restored pieces draw, never on the mask they were hidden with
    expect(second.layers.mask).toBe(1);
    // the new buffer holds the posed face
    expect(piecePositions(second.geometry, 0)).toEqual([0, 0, 0.5, 1, 0, 0.5, 0, 1, 0.5]);
    link();
    expect(rig.standing).toBe(true);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    // the old head is idle in the cache, the new one leased
    expect(cacheRefs()).toEqual([0, 1]);

    // the slider moves back: that face is still built, so its mount builds nothing
    pose(h, 0);
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.pendingBuilt).toBe(true);
    expect(rig.mountPending()).toBe(true);
    // the very same buffer, never built again
    expect(rig.mesh?.geometry).toBe(first.geometry);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(2);
  });

  it('a piece shown or hidden is another head', () => {
    const h = hang();
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    const withBeard = rig.mesh?.geometry;
    expect(rig.table?.beardMap).toBe(h.lib.beardTex);
    // clean shaven now: the beard is no longer drawn
    const shaven = h.drawn.filter((c) => c.piece !== 'WocHead_A_beard_full');
    expect(rig.sync(h.bone, shaven)).toBe(true);
    // the beard, no longer wanted, draws again like everything else until the mount
    expect(masksOf(h)).toEqual([1, 1, 1, 1]);
    expect(rig.mountPending()).toBe(true);
    expect(rig.mesh?.geometry).not.toBe(withBeard);
    expect(rig.mesh?.geometry.getAttribute('position').count).toBe(9);
    // the beard is not a source of this head: its mask stays its own
    expect(masksOf(h)).toEqual([0, 0, 0, 1]);
    expect(rig.table?.beardMap).toBeNull();
  });

  it('nothing to stand in for takes the head down', () => {
    const h = hang();
    const before = masksOf(h);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(rig.sync(h.bone, null)).toBe(true);
    expect(rig.mesh).toBeNull();
    expect(masksOf(h)).toEqual(before);
    expect(rig.isWaiting).toBe(false);
    // already down: no change to report, and nothing waits
    expect(rig.sync(h.bone, null)).toBe(false);
    expect(rig.sync(null, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.sync(h.bone, [])).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(mergedWrappers(h.bone)).toEqual([]);
    // a head with no bone to hang on drops one that stands, too
    stand(rig, h.bone, h.drawn);
    expect(rig.sync(null, h.drawn)).toBe(true);
    expect(rig.mesh).toBeNull();
    expect(masksOf(h)).toEqual(before);
  });

  it('a waiting head that is no longer wanted is not mounted', () => {
    const h = hang();
    const { rig, adopted } = rigOn(false);
    for (const [bone, drawn] of [
      [h.bone, null],
      [null, null],
      [null, h.drawn],
      [h.bone, h.drawn.slice(0, 1)],
    ] as const) {
      rig.sync(h.bone, h.drawn);
      expect(rig.isWaiting).toBe(true);
      expect(rig.sync(bone, drawn)).toBe(false);
      expect(rig.isWaiting).toBe(false);
      expect(rig.mountPending()).toBe(false);
    }
    expect(rig.mesh).toBeNull();
    expect(adopted).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
  });

  it('a head that changes while it waits is mounted as it is now, never as it was', () => {
    const h = hang();
    const { rig, adopted } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    // the face moves and the caller reconciles again before any mount
    pose(h, 0.75);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.mountPending()).toBe(true);
    expect(piecePositions((rig.mesh as THREE.Mesh).geometry, 0)).toEqual([
      0, 0, 0.75, 1, 0, 0.75, 0, 1, 0.75,
    ]);
    // one head was ever built and mounted
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    expect(adopted).toHaveLength(1);
  });
});

describe('WocHeadMergeRig: a plan gone stale', () => {
  it('is not baked: a face written since the plan, with no word to the rig, mounts nothing', () => {
    const spans: string[] = [];
    setBuildSpanSink((kind) => {
      spans.push(kind);
    });
    const h = hang();
    const before = masksOf(h);
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    expect(rig.isWaiting).toBe(true);
    // a writer that is not the rig's owner moves the face: the plan is keyed on the old one
    pose(h, 0.5);
    expect(rig.mountPending()).toBe(false);
    // nothing mounted, hung, adopted or revealed...
    expect(rig.mesh).toBeNull();
    expect(rig.table).toBeNull();
    expect(calls).toEqual([]);
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(masksOf(h)).toEqual(before);
    // ...and nothing BUILT: the new face is never cached under the old face's key
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(spans).toEqual([]);
    // the stale plan is gone, not waiting
    expect(rig.isWaiting).toBe(false);
    expect(rig.pendingBuilt).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(rig.heldByEffect).toBe(false);

    // planned afresh, the face as it is now mounts, baked as it is
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountPending()).toBe(true);
    expect(piecePositions((rig.mesh as THREE.Mesh).geometry, 0)).toEqual([
      0, 0, 0.5, 1, 0, 0.5, 0, 1, 0.5,
    ]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    expect(calls).toEqual(['adopt', 'reveal']);
    // ...and the face the stale plan was for is not refused: it comes back like any other
    pose(h, 0);
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountPending()).toBe(true);
    expect(piecePositions((rig.mesh as THREE.Mesh).geometry, 0)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(2);
  });

  it('never takes the buffer its old key names, even one somebody already built', () => {
    const lib = library();
    const one = hang(lib);
    const two = hang(lib);
    const first = rigOn(false);
    const twin = rigOn(false);
    stand(first.rig, one.bone, one.drawn);
    // the twin plans the same face (built: the first character leases it)...
    twin.rig.sync(two.bone, two.drawn);
    expect(twin.rig.pendingBuilt).toBe(true);
    // ...and its face moves before the mount: the cached buffer is another face now
    pose(two, 0.5);
    expect(twin.rig.mountPending()).toBe(false);
    expect(twin.rig.mesh).toBeNull();
    expect(twin.calls).toEqual([]);
    expect(masksOf(two)).toEqual([1, 1, 1, 1]);
    expect(cacheRefs()).toEqual([1]);
  });

  it('is stale by a piece whose geometry was swapped, too', () => {
    const h = hang();
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    h.meshes.brow.geometry = triangle(11);
    expect(rig.mountPending()).toBe(false);
    expect(calls).toEqual([]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect(piecePositions((rig.mesh as THREE.Mesh).geometry, 1)).toEqual([
      5.5, 0, 2, 6, 0, 2, 5.5, 0.5, 2,
    ]);
  });

  it('reads a pose as the key does: a change inside one slider step is the same face', () => {
    const h = hang();
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    // the key reads a pose at 1e-4 steps: 0.00004 rounds to the planned face
    pose(h, 0.00004);
    expect(rig.mountPending()).toBe(true);
    expect(rig.standing).toBe(true);
    // ...and a step over is another face
    const other = hang();
    const second = rigOn(false);
    second.rig.sync(other.bone, other.drawn);
    pose(other, 0.00006);
    expect(second.rig.mountPending()).toBe(false);
    expect(second.rig.mesh).toBeNull();
  });
});

describe('WocHeadMergeRig: folding the waiting head a band a call', () => {
  /** A library whose base head is 2800 vertices (and carries the one face control): with
   *  the three small pieces 2809 vertices and 4209 index entries, six bands of the fold. */
  const big = (): Library => {
    const lib = library();
    lib.geos.base = strip(700, 0, { morphs: 1 });
    return lib;
  };
  const VERTICES = 2809;
  const UNITS = 6;
  const folds = wocHeadMergeInternalsForTest.folds;
  const cache = wocHeadMergeInternalsForTest.cache;
  /** Call foldPending until it answers that nothing is left to fold; how many calls. */
  const foldAll = (rig: WocHeadMergeRig): number => {
    for (let calls = 1; calls < 1000; calls++) if (rig.foldPending()) return calls;
    throw new Error('the fold never ends');
  };
  /** The geometry a whole fold builds for a fresh hang of `lib` posed at `weight`. */
  const wholeHead = (weight = 0) => {
    const h = hang(big());
    pose(h, weight);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    return wholeOf((rig.mesh as THREE.Mesh).geometry);
  };

  it('folds one band a call, hands the cache the geometry on the last, and leaves mountPending only the mount', () => {
    expect(wocHeadMergeFoldUnits(VERTICES, 4209)).toBe(UNITS);
    const h = hang(big());
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    for (let call = 1; call < UNITS; call++) {
      expect(rig.foldPending(), `call ${call}`).toBe(false);
      // in flight: one fold, this rig its one driver, a band further each call
      expect(folds.size).toBe(1);
      const [shared] = folds.values();
      expect(shared.drivers).toBe(1);
      expect(shared.fold.foldedVertices).toBe(call * WOC_HEAD_MERGE_BAND_VERTICES);
      // ...and nothing built, hung or adopted yet: the head still waits
      expect(cache.size).toBe(0);
      expect(rig.isWaiting).toBe(true);
      expect(rig.pendingBuilt).toBe(false);
      expect(calls).toEqual([]);
      expect(mergedWrappers(h.bone)).toEqual([]);
    }
    expect(rig.foldPending()).toBe(true);
    // whole: the cache's, idle until the mount, and the fold is gone
    expect(folds.size).toBe(0);
    expect(cacheRefs()).toEqual([0]);
    expect(rig.pendingBuilt).toBe(true);
    expect(rig.isWaiting).toBe(true);
    expect(calls).toEqual([]);
    // nothing is left to fold: another call folds nothing
    expect(rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    const [built] = [...cache.values()].map((entry) => entry.geometry);
    expect(rig.mountPending()).toBe(true);
    expect((rig.mesh as THREE.Mesh).geometry).toBe(built);
    expect(cacheRefs()).toEqual([1]);
    expect(calls).toEqual(['adopt', 'reveal']);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
    // the very head a whole fold of the same pieces builds
    expect(wholeOf(built)).toEqual(wholeHead());
    expect(built.getAttribute('position').count).toBe(VERTICES);
  });

  it('times each band as one view-lane span of its own kind, beside the mount', () => {
    const spans: { kind: string; ms: number; atMs: number }[] = [];
    setBuildSpanSink((kind, ms, atMs) => spans.push({ kind, ms, atMs }));
    const h = hang(big());
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    now = 2000;
    expect(foldAll(rig)).toBe(UNITS);
    expect(spans.map((span) => span.kind)).toEqual(new Array(UNITS).fill('view:woc-head-fold'));
    expect(buildLedgerLane('view:woc-head-fold')).toBe('view');
    expect(spans.every((span) => span.atMs === 2000)).toBe(true);
    rig.mountPending();
    expect(spans.map((span) => span.kind).slice(UNITS)).toEqual(['view:woc-head-merge']);
    // a head already built folds nothing, and times nothing
    const twin = hang(h.lib);
    const other = rigOn(false);
    other.rig.sync(twin.bone, twin.drawn);
    expect(other.rig.foldPending()).toBe(true);
    expect(spans).toHaveLength(UNITS + 1);
  });

  it('two rigs in one face drive ONE fold, whichever of them folds a band', () => {
    const lib = big();
    const one = hang(lib);
    const two = hang(lib);
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    // turn about: each call folds the next band of the same fold
    const answers: boolean[] = [];
    for (let call = 0; call < UNITS; call++) {
      const rig = call % 2 === 0 ? a.rig : b.rig;
      answers.push(rig.foldPending());
      if (call === 1) {
        expect(folds.size).toBe(1);
        expect([...folds.values()][0].drivers).toBe(2);
        expect([...folds.values()][0].fold.foldedVertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
      }
    }
    // six bands between them, never six each: the sixth call ended it
    expect(answers).toEqual([false, false, false, false, false, true]);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(1);
    // the rig that did not fold the last band finds the head built: nothing more to fold
    expect(a.rig.foldPending()).toBe(true);
    expect(cache.size).toBe(1);
    expect(a.rig.mountPending()).toBe(true);
    expect(b.rig.mountPending()).toBe(true);
    expect(a.rig.mesh?.geometry).toBe(b.rig.mesh?.geometry);
    expect(cacheRefs()).toEqual([2]);
    expect(wholeOf((a.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('a head planned again for another face mid-fold lets its fold go and folds the new face from its first band', () => {
    const h = hang(big());
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    expect(rig.foldPending()).toBe(false);
    expect(rig.foldPending()).toBe(false);
    const [old] = folds.keys();
    // the slider moves and the owner plans again: the half folded head is nobody's
    pose(h, 1);
    rig.sync(h.bone, h.drawn);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    expect(rig.isWaiting).toBe(true);
    // the new face, from its first band
    expect(rig.foldPending()).toBe(false);
    expect([...folds.keys()]).not.toEqual([old]);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(foldAll(rig)).toBe(UNITS - 1);
    expect(rig.mountPending()).toBe(true);
    // only the face that draws was ever built, and it IS that face
    expect(cache.size).toBe(1);
    expect(cache.has(old)).toBe(false);
    const geo = (rig.mesh as THREE.Mesh).geometry;
    expect(wholeOf(geo)).toEqual(wholeHead(1));
    expect(wholeOf(geo).position).not.toEqual(wholeHead(0).position);
  });

  it('drops a fold its last driver lets go of: not wanted, nothing drawn, disposed, or mounted whole', () => {
    const leave: [string, (rig: WocHeadMergeRig) => void][] = [
      ['its owner no longer wants it', (rig) => expect(rig.foldPending(false)).toBe(true)],
      ['nothing to stand in for', (rig) => rig.sync(null, null)],
      ['disposed', (rig) => rig.dispose()],
    ];
    for (const [why, letGo] of leave) {
      const h = hang(big());
      const { rig, calls } = rigOn(false);
      rig.sync(h.bone, h.drawn);
      expect(rig.foldPending(), why).toBe(false);
      expect(rig.foldPending(), why).toBe(false);
      expect(folds.size, why).toBe(1);
      letGo(rig);
      // gone where it stood: no geometry was ever made of it
      expect(folds.size, why).toBe(0);
      expect(cache.size, why).toBe(0);
      expect(calls, why).toEqual([]);
      expect(masksOf(h), why).toEqual([1, 1, 1, 1]);
    }
    // not wanted is not refused: asked again, the head folds from its first band
    const h = hang(big());
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    rig.foldPending();
    rig.foldPending();
    rig.foldPending(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.foldPending()).toBe(false);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    // a mount on the spot (no queue behind the owner) builds the head whole instead
    expect(rig.mountPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(cacheRefs()).toEqual([1]);
    expect(wholeOf((rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('keeps a fold one driver left for the driver that stays', () => {
    const lib = big();
    const one = hang(lib);
    const two = hang(lib);
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    expect(b.rig.foldPending()).toBe(false);
    // the first body leaves (its head changed): the fold is the second one's now
    a.rig.dispose();
    expect(folds.size).toBe(1);
    expect([...folds.values()][0].drivers).toBe(1);
    expect([...folds.values()][0].fold.foldedVertices).toBe(2 * WOC_HEAD_MERGE_BAND_VERTICES);
    // ...which goes on from where the two of them got to
    expect(foldAll(b.rig)).toBe(UNITS - 2);
    expect(b.rig.mountPending()).toBe(true);
    expect(wholeOf((b.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('a head somebody built whole meanwhile ends the fold: the built one is mounted', () => {
    const lib = big();
    const one = hang(lib);
    const two = hang(lib);
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    expect(a.rig.foldPending()).toBe(false);
    // a body with no queue behind it mounts the same face on the spot
    expect(stand(b.rig, two.bone, two.drawn)).toBe(true);
    expect(cacheRefs()).toEqual([1]);
    // the chained one finds it built: no further band, its half fold dropped
    expect(a.rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(a.rig.mountPending()).toBe(true);
    expect(a.rig.mesh?.geometry).toBe(b.rig.mesh?.geometry);
    expect(cacheRefs()).toEqual([2]);
  });

  it('does not fold a plan gone stale: a face written since, with no word to the rig', () => {
    const h = hang(big());
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    pose(h, 0.5);
    // nothing to fold for this rig: the head it planned is not the head drawn
    expect(rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(calls).toEqual([]);
    // planned again, it folds and mounts the face as it is
    rig.sync(h.bone, h.drawn);
    expect(foldAll(rig)).toBe(UNITS);
    expect(rig.mountPending()).toBe(true);
    expect(wholeOf((rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead(0.5));
  });

  it('a band that throws leaves the head in its pieces for good, said once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    const h = hang(big());
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    expect(rig.foldPending()).toBe(false);
    // (a message of its own: the dev channel says each one once)
    const failure = new Error('a band failed');
    vi.spyOn(THREE.Mesh.prototype, 'getVertexPosition').mockImplementation(() => {
      throw failure;
    });
    let folded = false;
    expect(() => {
      folded = rig.foldPending();
    }).not.toThrow();
    // nothing left to fold for this rig: the head is refused, never built
    expect(folded).toBe(true);
    expect(rig.isWaiting).toBe(false);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    expect(calls).toEqual([]);
    expect(masksOf(h)).toEqual([1, 1, 1, 1]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe(failure);
    // the band that threw is not a band the ledger timed
    expect(spans).toEqual(['view:woc-head-fold']);
    // refused, even once the fold would work again
    vi.mocked(THREE.Mesh.prototype.getVertexPosition).mockRestore();
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('holds heads folded whole and let go of unmounted to the idle cap: the oldest goes, never the newest', () => {
    // each owner looked away at its last band: folded, handed to the cache, let go of,
    // never leased
    const built: { key: string; dispose: ReturnType<typeof vi.spyOn> }[] = [];
    for (let n = 0; n <= MAX_IDLE; n++) {
      const h = hang(library());
      const { rig } = rigOn(false);
      rig.sync(h.bone, h.drawn);
      expect(foldAll(rig)).toBe(1);
      const [key, entry] = [...cache].at(-1) as [string, { geometry: THREE.BufferGeometry }];
      built.push({ key, dispose: vi.spyOn(entry.geometry, 'dispose') });
      expect(rig.foldPending(false)).toBe(true);
      // never more idle heads than a look let go of leaves behind
      expect(cache.size).toBe(Math.min(n + 1, MAX_IDLE));
    }
    expect(new Set(built.map((head) => head.key)).size).toBe(MAX_IDLE + 1);
    expect(cacheRefs()).toEqual(new Array(MAX_IDLE).fill(0));
    // the first one folded is the one dropped, its buffers with it, and only that one
    expect(cache.has(built[0].key)).toBe(false);
    expect(built.map((head) => head.dispose.mock.calls.length)).toEqual([
      1,
      ...new Array<number>(MAX_IDLE).fill(0),
    ]);
    expect(cache.has(built[MAX_IDLE].key)).toBe(true);
  });

  it('keeps a head its owner still waits to mount, however many heads go idle meanwhile', () => {
    // guards: a head folded whole sat idle until its owner's mount unit came round, and a
    // crowd of new faces handed the cache heads faster than that: the idle cap dropped
    // it first, its owner folded it all over again, and past a certain crowd nothing
    // ever mounted
    const h = hang(big());
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    expect(foldAll(rig)).toBe(UNITS);
    const [waited] = cache.keys();
    const built = cache.get(waited)?.geometry as THREE.BufferGeometry;
    const dispose = vi.spyOn(built, 'dispose');
    // more heads than the cap keeps, each folded whole and let go of by its owner
    for (let n = 0; n <= MAX_IDLE; n++) {
      const other = hang(library());
      const o = rigOn(false);
      o.rig.sync(other.bone, other.drawn);
      expect(foldAll(o.rig)).toBe(1);
      o.rig.foldPending(false);
    }
    // the cap holds for the idle ones, and the head still waited for is not one of them
    expect(cache.size).toBe(MAX_IDLE + 1);
    expect(cache.get(waited)?.geometry).toBe(built);
    expect(dispose).not.toHaveBeenCalled();
    // its owner mounts the very head it folded: no second fold, no build
    expect(rig.pendingBuilt).toBe(true);
    expect(rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(rig.mountPending()).toBe(true);
    expect(rig.mesh?.geometry).toBe(built);
    // leased before its wait ends, so the mount costs no idle head its place: the cap
    // never sees one head too many
    expect(cache.size).toBe(MAX_IDLE + 1);
    expect(cacheRefs().filter((refs) => refs === 0)).toHaveLength(MAX_IDLE);
    // ...and taken down later it is an idle head like any other, the newest of them: the
    // oldest goes
    rig.dispose();
    expect(cache.size).toBe(MAX_IDLE);
    expect(cache.has(waited)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('a profile change drops a head still waited for too: its owner folds it again', () => {
    const h = hang(big());
    const { rig } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    expect(foldAll(rig)).toBe(UNITS);
    const [built] = [...cache.values()].map((entry) => entry.geometry);
    const dispose = vi.spyOn(built, 'dispose');
    clearIdleWocHeadMerges();
    expect(cache.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    // nothing mounts a disposed head: the owner's next unit starts the fold over
    expect(rig.pendingBuilt).toBe(false);
    expect(rig.foldPending()).toBe(false);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(foldAll(rig)).toBe(UNITS - 1);
    expect(rig.mountPending()).toBe(true);
    expect(rig.mesh?.geometry).not.toBe(built);
    expect(wholeOf((rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('folds the head that has waited longest, whoever asks: the heads of a crowd finish one after another', () => {
    // guards: a band each in turn (the order the bodies' units leave the queue in) folds
    // every head of an arriving crowd side by side, so all of them stand in together at
    // the very end and each body draws its pieces until then
    const hung = [hang(big()), hang(big()), hang(big())];
    const rigs = hung.map(() => rigOn(false).rig);
    for (const [i, h] of hung.entries()) rigs[i].sync(h.bone, h.drawn);
    // the three bodies' units, turn about: nobody's head is whole after six bands of its own
    for (let call = 0; call < UNITS; call++) {
      expect(rigs[call % 3].foldPending(), `call ${call}`).toBe(false);
    }
    // ...because all six were the FIRST head's. It is whole, and the two behind it, in
    // the order they asked, have not folded a vertex
    const [first] = cache.keys();
    expect(cache.size).toBe(1);
    expect(folds.size).toBe(2);
    expect([...folds.values()].map((shared) => shared.fold.foldedVertices)).toEqual([0, 0]);
    expect([...folds.values()].map((shared) => shared.drivers)).toEqual([1, 1]);
    // the first body stands in while the others still fold
    expect(rigs[0].pendingBuilt).toBe(true);
    expect(rigs[0].foldPending()).toBe(true);
    expect(rigs[0].mountPending()).toBe(true);
    expect(masksOf(hung[0])).toEqual([0, 0, 0, 0]);
    expect(masksOf(hung[1])).toEqual([1, 1, 1, 1]);
    expect(masksOf(hung[2])).toEqual([1, 1, 1, 1]);
    // then the second head, whichever of the two left runs a band of it
    for (let call = 0; call < UNITS; call++) {
      expect(rigs[1 + (call % 2)].foldPending(), `call ${call}`).toBe(false);
    }
    expect(cache.size).toBe(2);
    expect(rigs[1].pendingBuilt).toBe(true);
    expect(rigs[2].pendingBuilt).toBe(false);
    expect([...folds.values()].map((shared) => shared.fold.foldedVertices)).toEqual([0]);
    expect(rigs[1].foldPending()).toBe(true);
    expect(rigs[1].mountPending()).toBe(true);
    // and the third: eighteen bands in all, never a band more than the three heads have
    expect(foldAll(rigs[2])).toBe(UNITS);
    expect(rigs[2].mountPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(cacheRefs()).toEqual([1, 1, 1]);
    expect(cache.has(first)).toBe(true);
    // each its own head, the very one a whole fold builds
    const built = rigs.map((rig) => (rig.mesh as THREE.Mesh).geometry);
    expect(new Set(built).size).toBe(3);
    for (const geometry of built) expect(wholeOf(geometry)).toEqual(wholeHead());
  });

  it('finishes a head whose owner stopped asking, and leaves it idle in the cache for it', () => {
    const one = hang(big());
    const two = hang(big());
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    // one band of the first head, and then its unit never runs again
    expect(a.rig.foldPending()).toBe(false);
    // the second body's units alone: the five bands left of the first head, then its own six
    expect(foldAll(b.rig)).toBe(UNITS - 1 + UNITS);
    expect(folds.size).toBe(0);
    expect(cacheRefs()).toEqual([0, 0]);
    expect(a.calls).toEqual([]);
    // the first body, whenever it looks again, only mounts
    expect(a.rig.pendingBuilt).toBe(true);
    expect(a.rig.foldPending()).toBe(true);
    expect(a.rig.mountPending()).toBe(true);
    expect(b.rig.mountPending()).toBe(true);
    expect(cacheRefs()).toEqual([1, 1]);
    expect(wholeOf((a.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('a leading head built whole meanwhile leaves the line: no band more of it, and the built one is never replaced', () => {
    // guards: a body with no queue behind it mounts the leading face on the spot, and the
    // bodies behind go on folding that fold to its end: a second geometry lands in the
    // cache under the key the first is leased from, which is then never disposed
    const one = hang(big());
    const two = hang(big());
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    expect(b.rig.foldPending()).toBe(false);
    const [leading, behind] = [...folds.keys()];
    expect([...folds.values()].map((shared) => shared.fold.foldedVertices)).toEqual([
      2 * WOC_HEAD_MERGE_BAND_VERTICES,
      0,
    ]);
    const twin = hang(one.lib);
    const whole = rigOn(false);
    expect(stand(whole.rig, twin.bone, twin.drawn)).toBe(true);
    const built = cache.get(leading)?.geometry;
    expect(built).toBe(whole.rig.mesh?.geometry);
    const dispose = vi.spyOn(built as THREE.BufferGeometry, 'dispose');
    // the second body's unit: the leading head is over, so the band is its own head's
    expect(b.rig.foldPending()).toBe(false);
    expect([...folds.keys()]).toEqual([behind]);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(foldAll(b.rig)).toBe(UNITS - 1);
    // the head somebody built is still the one the cache holds, leased as it was
    expect(cache.get(leading)?.geometry).toBe(built);
    expect(cache.get(leading)?.refs).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    // ...and the body that was folding it only mounts that one
    expect(a.rig.foldPending()).toBe(true);
    expect(a.rig.mountPending()).toBe(true);
    expect(a.rig.mesh?.geometry).toBe(built);
    expect(cache.get(leading)?.refs).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('a head that left the line and lost its built geometry starts over behind the others', () => {
    const one = hang(big());
    const two = hang(big());
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    const [leading] = folds.keys();
    // built whole by a body with no queue, which the second body's unit notices...
    const twin = hang(one.lib);
    const whole = rigOn(false);
    stand(whole.rig, twin.bone, twin.drawn);
    expect(b.rig.foldPending()).toBe(false);
    expect([...folds.keys()]).not.toContain(leading);
    // ...and gone again before the first body looks: that body left, a profile change
    whole.rig.dispose();
    clearIdleWocHeadMerges();
    expect(cache.size).toBe(0);
    // the first body's unit: its old fold is nobody's, so its head joins the line again,
    // behind the second, and this unit folds a band of that one
    expect(a.rig.foldPending()).toBe(false);
    expect([...folds.keys()].at(-1)).toBe(leading);
    expect([...folds.values()].map((shared) => shared.fold.foldedVertices)).toEqual([
      2 * WOC_HEAD_MERGE_BAND_VERTICES,
      0,
    ]);
    // both end whole
    expect(foldAll(b.rig)).toBe(UNITS - 2);
    expect(foldAll(a.rig)).toBe(UNITS);
    expect(a.rig.mountPending()).toBe(true);
    expect(b.rig.mountPending()).toBe(true);
    expect(wholeOf((a.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
    expect(wholeOf((b.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it("a band that throws under another body's unit refuses the head it belongs to, never the rig that ran it", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const one = hang(big());
    const two = hang(big());
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    // the leading head breaks (its own base geometry and no other), and it is the second
    // body's unit that runs the band
    const failure = new Error('a band of the leading head failed');
    const posed = THREE.Mesh.prototype.getVertexPosition;
    vi.spyOn(THREE.Mesh.prototype, 'getVertexPosition').mockImplementation(function (
      this: THREE.Mesh,
      index: number,
      target: THREE.Vector3,
    ) {
      if (this.geometry === one.lib.geos.base) throw failure;
      return posed.call(this, index, target);
    });
    let more = false;
    expect(() => {
      more = !b.rig.foldPending();
    }).not.toThrow();
    // the second body is not refused: it goes on waiting, and the broken head left the line
    expect(more).toBe(true);
    expect(b.rig.isWaiting).toBe(true);
    expect(folds.size).toBe(1);
    expect(cache.size).toBe(0);
    // its next band is its own head's first
    expect(b.rig.foldPending()).toBe(false);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(error).not.toHaveBeenCalled();
    // the first body finds out when its own unit next looks: refused for good, said once
    expect(a.rig.foldPending()).toBe(true);
    expect(a.rig.isWaiting).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe(failure);
    expect(a.calls).toEqual([]);
    expect(masksOf(one)).toEqual([1, 1, 1, 1]);
    expect(a.rig.sync(one.bone, one.drawn)).toBe(false);
    expect(a.rig.isWaiting).toBe(false);
    expect(folds.size).toBe(1);
    // and the second head ends whole
    expect(foldAll(b.rig)).toBe(UNITS - 1);
    expect(b.rig.mountPending()).toBe(true);
    vi.mocked(THREE.Mesh.prototype.getVertexPosition).mockRestore();
    expect(wholeOf((b.rig.mesh as THREE.Mesh).geometry)).toEqual(wholeHead());
  });

  it('a head another body finished, whose geometry the cache dropped before this one looked, is folded again from its first band', () => {
    // guards: the rig still held the finished fold, and handed the cache its geometry a
    // second time, the one the cache had just disposed
    const lib = big();
    const one = hang(lib);
    const two = hang(lib);
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    // the second body's units end the fold they share...
    expect(foldAll(b.rig)).toBe(UNITS - 1);
    const [finished] = [...cache.values()].map((entry) => entry.geometry);
    const dispose = vi.spyOn(finished, 'dispose');
    // ...and the cache drops it (nobody leased it yet: a profile change) before the first
    // body looks again
    clearIdleWocHeadMerges();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    expect(a.rig.foldPending()).toBe(false);
    expect(cache.size).toBe(0);
    expect(folds.size).toBe(1);
    expect([...folds.values()][0].drivers).toBe(1);
    expect([...folds.values()][0].fold.foldedVertices).toBe(WOC_HEAD_MERGE_BAND_VERTICES);
    expect(foldAll(a.rig)).toBe(UNITS - 1);
    const [again] = [...cache.values()].map((entry) => entry.geometry);
    expect(again).not.toBe(finished);
    expect(a.rig.mountPending()).toBe(true);
    expect(a.rig.mesh?.geometry).toBe(again);
    expect(wholeOf(again)).toEqual(wholeHead());
    // the second body, looking again, folds nothing: the head is built
    expect(b.rig.foldPending()).toBe(true);
    expect(b.rig.mountPending()).toBe(true);
    expect(b.rig.mesh?.geometry).toBe(again);
  });

  it('a band that throws refuses every body that drove that fold, and says so once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lib = big();
    const one = hang(lib);
    const two = hang(lib);
    const a = rigOn(false);
    const b = rigOn(false);
    a.rig.sync(one.bone, one.drawn);
    b.rig.sync(two.bone, two.drawn);
    expect(a.rig.foldPending()).toBe(false);
    expect(b.rig.foldPending()).toBe(false);
    expect([...folds.values()][0].drivers).toBe(2);
    const failure = new Error('a band of a shared head failed');
    vi.spyOn(THREE.Mesh.prototype, 'getVertexPosition').mockImplementation(() => {
      throw failure;
    });
    // under the second body's unit: that body is refused there and then
    expect(b.rig.foldPending()).toBe(true);
    expect(b.rig.isWaiting).toBe(false);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    // the first finds out from its own next unit, with no band folded for it again
    vi.mocked(THREE.Mesh.prototype.getVertexPosition).mockRestore();
    expect(a.rig.isWaiting).toBe(true);
    expect(a.rig.foldPending()).toBe(true);
    expect(a.rig.isWaiting).toBe(false);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe(failure);
    for (const h of [one, two]) expect(masksOf(h)).toEqual([1, 1, 1, 1]);
    // refused for good, both of them
    expect(a.rig.sync(one.bone, one.drawn)).toBe(false);
    expect(b.rig.sync(two.bone, two.drawn)).toBe(false);
    expect(a.rig.isWaiting || b.rig.isWaiting).toBe(false);
  });

  it('a head whose fold cannot even start is refused the same way, and nothing escapes the call', () => {
    // guards: a throw from reading the pieces (before the first band) left the unit by
    // the back door: no refusal, no word, and its owner waiting on that unit for ever
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = hang(big());
    const { rig, calls } = rigOn(false);
    rig.sync(h.bone, h.drawn);
    const failure = new Error('a head that cannot start its fold');
    vi.spyOn(h.lib.geos.base, 'getAttribute').mockImplementation(() => {
      throw failure;
    });
    let done = false;
    expect(() => {
      done = rig.foldPending();
    }).not.toThrow();
    expect(done).toBe(true);
    expect(rig.isWaiting).toBe(false);
    expect(folds.size).toBe(0);
    expect(cache.size).toBe(0);
    expect(calls).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toBe(failure);
    vi.mocked(h.lib.geos.base.getAttribute).mockRestore();
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
  });

  it('answers that nothing is left to fold when nothing waits', () => {
    const h = hang(big());
    const { rig } = rigOn(false);
    expect(rig.foldPending()).toBe(true);
    stand(rig, h.bone, h.drawn);
    // mounted: nothing waits
    expect(rig.foldPending()).toBe(true);
    expect(folds.size).toBe(0);
    expect(cacheRefs()).toEqual([1]);
  });
});

describe('WocHeadMergeRig: the shared buffer', () => {
  it('says whether the waiting head is already built: leased by another, idle, or not at all', () => {
    const lib = library();
    const one = hang(lib);
    const two = hang(lib);
    const first = rigOn(false);
    const twin = rigOn(false);
    twin.rig.sync(two.bone, two.drawn);
    // nobody built this face yet
    expect(twin.rig.pendingBuilt).toBe(false);
    stand(first.rig, one.bone, one.drawn);
    // the same face, leased by the first character
    expect(twin.rig.pendingBuilt).toBe(true);
    first.rig.drop();
    // ...and idle in the cache
    expect(twin.rig.pendingBuilt).toBe(true);
    clearIdleWocHeadMerges();
    expect(twin.rig.pendingBuilt).toBe(false);
    // once mounted nothing waits, built or not
    expect(twin.rig.mountPending()).toBe(true);
    expect(twin.rig.isWaiting).toBe(false);
    expect(twin.rig.pendingBuilt).toBe(false);
  });

  it('two characters in one face share ONE buffer and one source material', () => {
    const lib = library();
    const one = hang(lib);
    const two = hang(lib);
    // the bone's own pose is no part of a head: another stance is the same face
    two.bone.position.set(-9, 2, 4);
    two.bone.rotation.set(0.3, 0.2, 0.1);
    two.bone.scale.setScalar(1.5);
    const first = rigOn(false);
    const twin = rigOn(false);
    stand(first.rig, one.bone, one.drawn);
    const build = vi.spyOn(THREE.Mesh.prototype, 'getVertexPosition');
    expect(stand(twin.rig, two.bone, two.drawn)).toBe(true);
    // not one vertex was folded for the second character
    expect(build).not.toHaveBeenCalled();
    expect(twin.rig.mesh?.geometry).toBe(first.rig.mesh?.geometry);
    expect(twin.rig.mesh).not.toBe(first.rig.mesh);
    expect(twin.rig.mesh?.material).toBe(first.rig.mesh?.material);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(1);
    expect(cacheRefs()).toEqual([2]);

    // one of the two leaves: the buffer stays for the other
    const dispose = vi.spyOn(first.rig.mesh?.geometry as THREE.BufferGeometry, 'dispose');
    first.rig.drop();
    expect(cacheRefs()).toEqual([1]);
    expect(dispose).not.toHaveBeenCalled();
    expect(twin.rig.standing).toBe(true);
    expect(masksOf(one)).toEqual([1, 1, 1, 1]);
    expect(masksOf(two)).toEqual([0, 0, 0, 0]);
    // ...and takes it again when it comes back
    expect(stand(first.rig, one.bone, one.drawn)).toBe(true);
    expect(cacheRefs()).toEqual([2]);
    expect(build).not.toHaveBeenCalled();
  });

  it('the same files in another pose are another buffer', () => {
    const lib = library();
    const one = hang(lib);
    const two = hang(lib);
    pose(two, 1);
    const first = rigOn(false);
    const second = rigOn(false);
    stand(first.rig, one.bone, one.drawn);
    stand(second.rig, two.bone, two.drawn);
    expect(second.rig.mesh?.geometry).not.toBe(first.rig.mesh?.geometry);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(2);
  });

  it('the same files hung another way are another buffer: each bakes its own placement', () => {
    const lib = library();
    const one = hang(lib);
    // a piece node a thousandth off (another body's dequantization, a per-character fit)
    const nudged = hang(lib);
    nudged.meshes.brow.position.x += 1e-3;
    // a file wrapper scaled on its bone
    const scaled = hang(lib);
    scaled.core.scale.set(1, 2, 1);
    const rigs = [one, nudged, scaled].map((h) => {
      const r = rigOn(false);
      stand(r.rig, h.bone, h.drawn);
      return r.rig.mesh as THREE.Mesh;
    });
    expect(new Set(rigs.map((m) => m.geometry)).size).toBe(3);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(3);
    // and each buffer holds ITS character's brow
    expect(piecePositions(rigs[0].geometry, 1)).toEqual([5, 0, 2, 5.5, 0, 2, 5, 0.5, 2]);
    expect(piecePositions(rigs[1].geometry, 1)[0]).toBeCloseTo(5.001, 5);
    expect(piecePositions(rigs[2].geometry, 1)).toEqual([5, 0, 2, 5.5, 0, 2, 5, 1, 2]);
  });
});

describe('WocHeadMergeRig: what makes two heads two buffers', () => {
  it('another geometry on one piece is another buffer, each baking its own', () => {
    const lib = library();
    const one = hang(lib);
    // the same files but for the hairstyle's mesh
    const other = hang({ ...lib, geos: { ...lib.geos, hair: triangle(25) } });
    const first = rigOn(false);
    const second = rigOn(false);
    stand(first.rig, one.bone, one.drawn);
    stand(second.rig, other.bone, other.drawn);
    const a = (first.rig.mesh as THREE.Mesh).geometry;
    const b = (second.rig.mesh as THREE.Mesh).geometry;
    expect(b).not.toBe(a);
    expect(piecePositions(a, 2)).toEqual([20, 0, 0, 21, 0, 0, 20, 1, 0]);
    expect(piecePositions(b, 2)).toEqual([25, 0, 0, 26, 0, 0, 25, 1, 0]);
  });

  it('another material on one piece is another buffer: its vertices carry another slot', () => {
    const lib = library();
    const shared = triangle(40);
    // a second brow on the first one's material shares its slot...
    const one = hang(lib);
    addPiece(one, 'WocHead_A_brows_R', lib.mats.brow, shared);
    // ...and on a material of its own takes the next slot: the same meshes otherwise
    const other = hang(lib);
    addPiece(other, 'WocHead_A_brows_R', fileMaterial('brow_R', lib.atlas), shared);
    const first = rigOn(false);
    const second = rigOn(false);
    stand(first.rig, one.bone, one.drawn);
    stand(second.rig, other.bone, other.drawn);
    expect(values((first.rig.mesh as THREE.Mesh).geometry, 'aWocHmSlot')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 1, 1, 1,
    ]);
    expect(values((second.rig.mesh as THREE.Mesh).geometry, 'aWocHmSlot')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4,
    ]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(2);
  });

  it('another texture layer on one piece is another buffer: one material, two layers, two slots', () => {
    const lib = library();
    const strands = fileMaterial('hair_shared', new THREE.Texture());
    const cut = triangle(50);
    const tuft = triangle(60);
    /** The base head, the cut, and the tuft drawn as `piece`: the slot of every vertex. */
    const slots = (piece: string): number[] => {
      const h = hang(lib);
      h.drawn.length = 1;
      addPiece(h, 'WocHead_A_hair_swept', strands, cut);
      addPiece(h, piece, strands, tuft);
      const { rig } = rigOn(false);
      expect(stand(rig, h.bone, h.drawn)).toBe(true);
      return values((rig.mesh as THREE.Mesh).geometry, 'aWocHmSlot');
    };
    // both meshes on the hairstyle's layer: one material, one slot
    expect(slots('WocHead_A_hair_swept')).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1]);
    // the tuft as facial hair: the same meshes and material, on the beard's layer too
    expect(slots('WocHead_A_beard_full')).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(2);
  });
});

describe('WocHeadMergeRig: sidedness', () => {
  /** Each slot's one sided flag, by the name of the file material it stands for. */
  const sides = (rig: WocHeadMergeRig, h: Hung): Record<string, boolean> => {
    const names = new Map(h.drawn.map((c) => [c.material.uuid, c.material.name]));
    return Object.fromEntries(
      (rig.table?.slots ?? []).map((s) => [names.get(s.material) ?? s.material, s.oneSided]),
    );
  };

  it('a mixed head is ONE mesh on the two sided source, each slot remembering its side', () => {
    // Type A: a one sided head under two sided brows and hair
    const lib = library();
    lib.mats.brow.side = THREE.DoubleSide;
    lib.mats.hair.side = THREE.DoubleSide;
    const h = hang(lib);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    const mesh = rig.mesh as THREE.Mesh;
    expect(mergedWrappers(h.bone)).toHaveLength(1);
    expect(mesh.material).toBe(wocHeadMergedSource(lib.mats.base));
    expect((mesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    expect(sides(rig, h)).toEqual({
      skin_head: true,
      brow_L: false,
      hair_swept: false,
      hair_beard_full: true,
    });
    // every triangle is folded exactly once, whatever its side: the plain sums
    expect(mesh.geometry.getAttribute('position').count).toBe(12);
    expect(indices(mesh.geometry)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(masksOf(h)).toEqual([0, 0, 0, 0]);
  });

  it('reads the side off the FILE material, never the clone mounted on the mesh', () => {
    // two sided files under clones that were cut one sided
    const h = hang();
    for (const m of Object.values(h.lib.mats)) m.side = THREE.DoubleSide;
    expect(h.drawn.map((c) => (c.mesh.material as THREE.Material).side)).toEqual([0, 0, 0, 0]);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(sides(rig, h)).toEqual({
      skin_head: false,
      brow_L: false,
      hair_swept: false,
      hair_beard_full: false,
    });
    expect((rig.mesh as THREE.Mesh).geometry.getAttribute('position').count).toBe(12);
    // ...and one sided files under clones an effect made two sided
    const other = hang();
    for (const c of other.drawn) (c.mesh.material as THREE.Material).side = THREE.DoubleSide;
    const second = rigOn(false);
    stand(second.rig, other.bone, other.drawn);
    expect(sides(second.rig, other)).toEqual({
      skin_head: true,
      brow_L: true,
      hair_swept: true,
      hair_beard_full: true,
    });
  });

  it('a back sided piece is left out, its mask untouched', () => {
    const h = hang();
    h.lib.mats.brow.side = THREE.BackSide;
    h.meshes.brow.layers.enable(3);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(rig.mesh?.geometry.getAttribute('position').count).toBe(9);
    expect(masksOf(h)).toEqual([0, 9, 0, 0]);
    expect(Object.keys(sides(rig, h))).toEqual(['skin_head', 'hair_swept', 'hair_beard_full']);
  });
});

describe('WocHeadMergeRig: a material that takes a worn surface layer by its name', () => {
  it('a gold piercing keeps drawing by itself, its mask untouched', () => {
    // the tier derivation gives `metal_gold` the worn metal layer (worn_stone.ts
    // riggedWornFamilyFor), which the merged material does not carry
    const h = hang();
    const gold = fileMaterial('metal_gold', null);
    const stud = addPiece(h, 'WocHead_A_piercing_lip', gold);
    stud.layers.enable(2);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(rig.mesh?.geometry.getAttribute('position').count).toBe(12);
    expect(stud.layers.mask).toBe(5);
    expect(masksOf(h)).toEqual([0, 0, 0, 0, 5]);
    expect(rig.table?.slots.map((s) => s.material)).not.toContain(gold.uuid);
    rig.drop();
    expect(stud.layers.mask).toBe(5);
    // the same flat piece under a name that takes no layer folds onto the white cell
    const plain = hang();
    const liner = addPiece(plain, 'WocHead_A_eyes_default_L', fileMaterial('liner_L', null));
    const other = rigOn(false);
    stand(other.rig, plain.bone, plain.drawn);
    expect(other.rig.mesh?.geometry.getAttribute('position').count).toBe(15);
    expect(liner.layers.mask).toBe(0);
  });
});

describe('WocHeadMergeRig: which pieces fold', () => {
  /** Vertices folded, three per piece of this fixture. */
  const folded = (rig: WocHeadMergeRig): number =>
    (rig.mesh?.geometry.getAttribute('position').count ?? 0) / 3;

  it('folds a flat-coloured core piece onto the white cell the base carries', () => {
    const h = hang();
    // Type B's eyeliner: a flat colour, no map, and no uv of its own
    const liner = fileMaterial('liner_L', null);
    const stud = addPiece(
      h,
      'WocHead_A_eyes_default_L',
      liner,
      geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2] }),
    );
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(5);
    const uv = values((rig.mesh as THREE.Mesh).geometry, 'uv');
    expect(uv.slice(4 * 6)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    // the textured pieces keep theirs
    expect(uv.slice(0, 6)).toEqual([0.125, 0.25, 0.375, 0.5, 0.625, 0.75]);
    expect(stud.layers.mask).toBe(0);
    expect(rig.table?.slots[4]).toEqual({
      material: liner.uuid,
      roleCode: 0,
      ref: [0, 0, 0],
      layer: 0,
      oneSided: true,
    });
  });

  it('leaves a flat-coloured piece drawing by itself when the base has no white cell', () => {
    // a core built before the atlas: nothing for a flat piece to sample
    const lib = library();
    lib.mats.base.userData = {};
    const h = hang(lib);
    const stud = addPiece(h, 'WocHead_A_eyes_default_L', fileMaterial('liner_L', null));
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(4);
    expect(stud.layers.mask).toBe(1);
    expect(masksOf(h)).toEqual([0, 0, 0, 0, 1]);
    expect(rig.table?.slots).toHaveLength(4);
  });

  it('leaves a core piece on another texture drawing by itself', () => {
    const h = hang();
    // a nose still on a texture of its own, not the atlas the base samples
    const nose = addPiece(
      h,
      'WocHead_A_nose_default',
      fileMaterial('skin_nose', new THREE.Texture()),
    );
    nose.layers.enable(4);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(4);
    expect(nose.layers.mask).toBe(17);
    expect(masksOf(h)).toEqual([0, 0, 0, 0, 17]);
    // and the drop leaves it exactly as it was too
    rig.drop();
    expect(nose.layers.mask).toBe(17);
  });

  it("gives a hairstyle's second texture the scalp layer, and leaves a third one out", () => {
    const h = hang();
    const capTex = new THREE.Texture();
    // the fitted scalp cap on a texture of its own, and a second mesh on that texture
    const cap = addPiece(h, 'WocHead_A_hair_swept', fileMaterial('hair_swept_scalp', capTex));
    const cap2 = addPiece(h, 'WocHead_A_hair_swept', fileMaterial('hair_swept_scalp_b', capTex));
    // a third hair texture, and an untextured strand card
    const third = addPiece(
      h,
      'WocHead_A_hair_swept',
      fileMaterial('hair_third', new THREE.Texture()),
    );
    const bare = addPiece(h, 'WocHead_A_hair_swept', fileMaterial('hair_bare', null));
    // a second mesh on the hairstyle's FIRST texture stays on the hair layer
    const strands = addPiece(
      h,
      'WocHead_A_hair_swept',
      fileMaterial('hair_swept_b', h.lib.hairTex),
    );
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(7);
    expect([cap, cap2, third, bare, strands].map((m) => m.layers.mask)).toEqual([0, 0, 1, 1, 0]);
    expect(rig.table?.hairMap).toBe(h.lib.hairTex);
    expect(rig.table?.scalpMap).toBe(capTex);
    expect(rig.table?.beardMap).toBe(h.lib.beardTex);
    // base, brow, hair, beard, then the two caps on the scalp layer and the strands
    expect(rig.table?.slots.map((s) => s.layer)).toEqual([0, 0, 1, 2, 3, 3, 1]);
    expect(values((rig.mesh as THREE.Mesh).geometry, 'aWocHmSlot')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
    ]);
  });

  it('folds one beard texture: a second stays out, and an untextured beard too', () => {
    const h = hang();
    const beard2 = addPiece(
      h,
      'WocHead_A_beard_full',
      fileMaterial('hair_beard_b', new THREE.Texture()),
    );
    const bare = addPiece(h, 'WocHead_A_beard_full', fileMaterial('hair_beard_bare', null));
    const same = addPiece(h, 'WocHead_A_beard_full', fileMaterial('hair_beard_c', h.lib.beardTex));
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(5);
    expect([beard2, bare, same].map((m) => m.layers.mask)).toEqual([1, 1, 0]);
    expect(rig.table?.beardMap).toBe(h.lib.beardTex);
    // a beard's second texture is never a scalp cap
    expect(rig.table?.scalpMap).toBeNull();
    expect(rig.table?.slots.map((s) => s.layer)).toEqual([0, 0, 1, 2, 2]);
  });

  it('never folds an untextured hairstyle or beard, even the only one of its kind', () => {
    // no texture to take as the hair layer's: the piece keeps drawing by itself, and
    // it never becomes "the hairstyle's texture" for the pieces after it
    const h = hang();
    const drawn = h.drawn.slice(0, 2);
    const add = (name: string, file: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(triangle(60), file.clone());
      m.name = name;
      h.core.add(m);
      drawn.push({ mesh: m, piece: name, material: file, role: 'hair', ref: HAIR_REF });
      return m;
    };
    const bareHair = add('WocHead_A_hair_swept', fileMaterial('hair_bare', null));
    const bareBeard = add('WocHead_A_beard_full', fileMaterial('hair_beard_bare', null));
    const { rig } = rigOn(false);
    stand(rig, h.bone, drawn);
    expect(folded(rig)).toBe(2);
    expect([bareHair, bareBeard].map((m) => m.layers.mask)).toEqual([1, 1]);
    expect(rig.table?.hairMap).toBeNull();
    expect(rig.table?.beardMap).toBeNull();
    expect(rig.table?.scalpMap).toBeNull();
    // a textured hairstyle after the bare one is still THE hairstyle's texture
    const strands = add('WocHead_A_hair_swept', h.lib.mats.hair);
    stand(rig, h.bone, drawn);
    expect(folded(rig)).toBe(3);
    expect(strands.layers.mask).toBe(0);
    expect(rig.table?.hairMap).toBe(h.lib.hairTex);
    expect(rig.table?.scalpMap).toBeNull();
    expect(rig.table?.slots.map((x) => x.layer)).toEqual([0, 0, 1]);
  });

  it('a head with no hair and no beard has neither texture', () => {
    const h = hang();
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn.slice(0, 2));
    expect(folded(rig)).toBe(2);
    expect(rig.table?.hairMap).toBeNull();
    expect(rig.table?.beardMap).toBeNull();
    expect(rig.table?.scalpMap).toBeNull();
  });

  it.each(UNMERGEABLE)('no merge at all under a base head that is %s', (_what, spoil) => {
    const lib = library();
    lib.mats.base = spoiled(lib.mats.base, spoil);
    const h = hang(lib);
    const before = masksOf(h);
    const { rig, calls } = rigOn(false);
    expect(rig.sync(h.bone, h.drawn)).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(calls).toEqual([]);
    expect(mergedWrappers(h.bone)).toEqual([]);
    expect(masksOf(h)).toEqual(before);
    expect(wocHeadMergeInternalsForTest.cache.size).toBe(0);
  });

  it.each(UNMERGEABLE)(
    'a piece that is %s keeps drawing by itself beside the merge',
    (_what, spoil) => {
      // the hairstyle: the one piece on a texture of its own, so a spoiled MAP is its alone
      const lib = library();
      lib.mats.hair = spoiled(lib.mats.hair, spoil);
      const h = hang(lib);
      const { rig } = rigOn(false);
      expect(stand(rig, h.bone, h.drawn)).toBe(true);
      expect(folded(rig)).toBe(3);
      expect(masksOf(h)).toEqual([0, 0, 1, 0]);
      expect(rig.table?.hairMap).toBeNull();
      expect(rig.table?.slots.map((s) => s.material)).toEqual([
        lib.mats.base.uuid,
        lib.mats.brow.uuid,
        lib.mats.beard.uuid,
      ]);
    },
  );

  it('reads what is mergeable off the FILE material, never the one mounted on the mesh', () => {
    const h = hang();
    // an effect overlay on the mounted clones (a ghost fade, a flat tint with no map):
    // the files are still opaque, and still on their textures
    for (const c of h.drawn) {
      const mounted = c.mesh.material as THREE.MeshStandardMaterial;
      mounted.transparent = true;
      mounted.map = null;
    }
    // ...and an overlay of another material class altogether
    h.meshes.brow.material = new THREE.MeshBasicMaterial({ transparent: true });
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect(folded(rig)).toBe(4);
    expect(rig.table?.hairMap).toBe(h.lib.hairTex);
    expect(rig.table?.beardMap).toBe(h.lib.beardTex);
    expect(rig.table?.slots.map((x) => x.layer)).toEqual([0, 0, 1, 2]);
  });

  it('fewer than two pieces to fold means no merge', () => {
    const h = hang();
    const { rig } = rigOn(false);
    // the base alone
    expect(stand(rig, h.bone, h.drawn.slice(0, 1))).toBe(false);
    expect(rig.mesh).toBeNull();
    // the base and a piece that cannot ride the merged material
    h.lib.mats.brow.transparent = true;
    expect(stand(rig, h.bone, h.drawn.slice(0, 2))).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(rig.isWaiting).toBe(false);
    expect(masksOf(h)).toEqual([1, 1, 1, 1]);
  });

  it('no base head among the drawn pieces means no merge', () => {
    const h = hang();
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn.slice(1))).toBe(false);
    expect(rig.mesh).toBeNull();
    expect(mergedWrappers(h.bone)).toEqual([]);
  });

  it('a base head that cannot itself be folded means no merge, whatever else could', () => {
    // hung where the head bone is not above it
    const away = hang();
    new THREE.Group().add(away.meshes.base);
    // textured, and no uv to sample it with
    const lib = library();
    lib.geos.base = geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2] });
    const noUv = hang(lib);
    // drawn with several materials
    const multi = hang();
    multi.meshes.base.material = [multi.meshes.base.material as THREE.Material];
    // nothing to draw at all
    const emptyLib = library();
    emptyLib.geos.base = new THREE.BufferGeometry();
    const empty = hang(emptyLib);
    for (const [what, h] of Object.entries({ away, noUv, multi, empty })) {
      const { rig, calls } = rigOn(false);
      expect(stand(rig, h.bone, h.drawn), what).toBe(false);
      expect(rig.mesh, what).toBeNull();
      expect(rig.isWaiting, what).toBe(false);
      expect(calls, what).toEqual([]);
      expect(masksOf(h), what).toEqual([1, 1, 1, 1]);
    }
  });

  it('skips a piece that cannot be folded: several materials, no uv, no vertices, another bone', () => {
    const h = hang();
    const multi = addPiece(h, 'WocHead_A_nose_default', fileMaterial('skin_nose', h.lib.atlas));
    multi.material = [multi.material as THREE.Material];
    const noUv = addPiece(
      h,
      'WocHead_A_mouth_default',
      fileMaterial('skin_mouth', h.lib.atlas),
      geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }),
    );
    const empty = addPiece(
      h,
      'WocHead_A_ears_default_R',
      fileMaterial('skin_ear_R', h.lib.atlas),
      new THREE.BufferGeometry(),
    );
    // a piece hung somewhere the head bone is not above
    const elsewhere = addPiece(
      h,
      'WocHead_A_ears_default_L',
      fileMaterial('skin_ear_L', h.lib.atlas),
      triangle(50),
      new THREE.Group(),
    );
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(folded(rig)).toBe(4);
    expect([multi, noUv, empty, elsewhere].map((m) => m.layers.mask)).toEqual([1, 1, 1, 1]);
  });

  it("folds as many materials as the shader's table holds, and not one more", () => {
    const h = hang();
    // the fixture's four slots, topped up to the table's size
    for (let i = 4; i < WOC_HEAD_MERGE_MAX_SLOTS; i++) {
      addPiece(h, 'WocHead_A_eyes_default_L', fileMaterial(`liner_${i}`, null));
    }
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect(rig.table?.slots).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(rig.table?.slotSources).toHaveLength(WOC_HEAD_MERGE_MAX_SLOTS);
    expect(folded(rig)).toBe(WOC_HEAD_MERGE_MAX_SLOTS);
    // one material more: the head keeps drawing piece by piece
    const before = h.drawn.map(() => 1);
    addPiece(h, 'WocHead_A_eyes_default_R', fileMaterial('liner_extra', null));
    expect(rig.sync(h.bone, h.drawn)).toBe(true);
    expect(rig.mesh).toBeNull();
    expect(rig.isWaiting).toBe(false);
    expect(masksOf(h)).toEqual([...before, 1]);
  });
});

describe('wocHeadMergeFold: the rule the near merge and the far bake both read', () => {
  it('answers each folded piece with its slot, its layer, its uv and what place said', () => {
    const h = hang();
    const liner = fileMaterial('liner_L', null);
    addPiece(h, 'WocHead_A_eyes_default_L', liner);
    addPiece(h, 'WocHead_A_brows_R', h.lib.mats.brow);
    const fold = wocHeadMergeFold(h.drawn, (c) => `placed:${c.mesh.name}`);
    expect(fold?.base).toBe(h.lib.mats.base);
    expect(
      fold?.folded.map((f) => ({
        piece: f.candidate.piece,
        layer: f.layer,
        slot: f.slot,
        flatUv: f.flatUv,
        placed: f.placed,
      })),
    ).toEqual([
      { piece: 'WocHead_A_base', layer: 0, slot: 0, flatUv: null, placed: 'placed:WocHead_A_base' },
      {
        piece: 'WocHead_A_brows_L',
        layer: 0,
        slot: 1,
        flatUv: null,
        placed: 'placed:WocHead_A_brows_L',
      },
      {
        piece: 'WocHead_A_hair_swept',
        layer: 1,
        slot: 2,
        flatUv: null,
        placed: 'placed:WocHead_A_hair_swept',
      },
      {
        piece: 'WocHead_A_beard_full',
        layer: 2,
        slot: 3,
        flatUv: null,
        placed: 'placed:WocHead_A_beard_full',
      },
      // the flat piece takes the white cell the base carries
      {
        piece: 'WocHead_A_eyes_default_L',
        layer: 0,
        slot: 4,
        flatUv: [0.5, 0.5],
        placed: 'placed:WocHead_A_eyes_default_L',
      },
      // a second mesh on a material already seen shares its slot
      {
        piece: 'WocHead_A_brows_R',
        layer: 0,
        slot: 1,
        flatUv: null,
        placed: 'placed:WocHead_A_brows_R',
      },
    ]);
    // the candidates themselves ride along, by identity
    expect(fold?.folded.every((f, i) => f.candidate === h.drawn[i])).toBe(true);
    expect(fold?.slots.map((s) => s.material)).toEqual([
      h.lib.mats.base.uuid,
      h.lib.mats.brow.uuid,
      h.lib.mats.hair.uuid,
      h.lib.mats.beard.uuid,
      liner.uuid,
    ]);
    expect(fold?.slots.map((s) => s.roleCode)).toEqual([1, 4, 3, 3, 0]);
    expect(fold?.hairMap).toBe(h.lib.hairTex);
    expect(fold?.beardMap).toBe(h.lib.beardTex);
    expect(fold?.scalpMap).toBeNull();
  });

  it("names a hairstyle's second texture the scalp: its own layer and slot", () => {
    const h = hang();
    const capTex = new THREE.Texture();
    const cap = fileMaterial('hair_swept_scalp', capTex);
    addPiece(h, 'WocHead_A_hair_swept', cap);
    addPiece(h, 'WocHead_A_hair_swept', fileMaterial('hair_third', new THREE.Texture()));
    const fold = wocHeadMergeFold(h.drawn, () => true);
    expect(fold?.folded.map((f) => [f.candidate.material.name, f.layer, f.slot])).toEqual([
      ['skin_head', 0, 0],
      ['brow_L', 0, 1],
      ['hair_swept', 1, 2],
      ['hair_beard_full', 2, 3],
      ['hair_swept_scalp', 3, 4],
    ]);
    expect(fold?.hairMap).toBe(h.lib.hairTex);
    expect(fold?.scalpMap).toBe(capTex);
    expect(fold?.slots[4]).toEqual({
      material: cap.uuid,
      roleCode: 0,
      ref: [0, 0, 0],
      layer: 3,
      oneSided: true,
    });
  });

  it("flags each slot one sided off its piece's FILE material", () => {
    const h = hang();
    h.lib.mats.brow.side = THREE.DoubleSide;
    h.lib.mats.beard.side = THREE.DoubleSide;
    const fold = wocHeadMergeFold(h.drawn, () => true);
    expect(fold?.slots.map((s) => s.oneSided)).toEqual([true, false, true, false]);
  });

  it('asks place only about a piece the rule accepts, and leaves out one it refuses', () => {
    const h = hang();
    h.lib.mats.beard.transparent = true;
    const asked: string[] = [];
    const fold = wocHeadMergeFold(h.drawn, (c) => {
      asked.push(c.piece);
      return c.piece === 'WocHead_A_brows_L' ? null : true;
    });
    // the transparent beard never reached the caller
    expect(asked).toEqual(['WocHead_A_base', 'WocHead_A_brows_L', 'WocHead_A_hair_swept']);
    expect(fold?.folded.map((f) => f.candidate.piece)).toEqual([
      'WocHead_A_base',
      'WocHead_A_hair_swept',
    ]);
    // a piece left out takes no slot
    expect(fold?.slots).toHaveLength(2);
    expect(fold?.folded.map((f) => f.slot)).toEqual([0, 1]);
    expect(fold?.beardMap).toBeNull();
  });

  it('answers null when place refuses the base, or leaves fewer than two pieces', () => {
    const h = hang();
    expect(
      wocHeadMergeFold(h.drawn, (c) => (c.piece === 'WocHead_A_base' ? null : true)),
    ).toBeNull();
    expect(
      wocHeadMergeFold(h.drawn, (c) => (c.piece === 'WocHead_A_base' ? true : null)),
    ).toBeNull();
    expect(wocHeadMergeFold(h.drawn, () => null)).toBeNull();
    expect(wocHeadMergeFold([], () => true)).toBeNull();
    // ...and a falsy answer that is not null still places the piece
    expect(wocHeadMergeFold(h.drawn, () => 0)?.folded).toHaveLength(4);
  });

  it('finds the base head by its name, wherever it sits among the drawn pieces', () => {
    const h = hang();
    const liner = addPiece(h, 'WocHead_A_eyes_default_L', fileMaterial('liner_L', null));
    // the brow first, the base head second
    const drawn = [h.drawn[1], h.drawn[0], ...h.drawn.slice(2)];
    const fold = wocHeadMergeFold(drawn, () => true);
    expect(fold?.base).toBe(h.lib.mats.base);
    // the white cell is the BASE material's record: the flat piece still folds onto it
    expect(fold?.folded.map((f) => [f.candidate.piece, f.flatUv])).toEqual([
      ['WocHead_A_brows_L', null],
      ['WocHead_A_base', null],
      ['WocHead_A_hair_swept', null],
      ['WocHead_A_beard_full', null],
      ['WocHead_A_eyes_default_L', [0.5, 0.5]],
    ]);
    // ...and the stand-in draws with the base head's source, never the first piece's
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, drawn)).toBe(true);
    expect(rig.mesh?.material).toBe(wocHeadMergedSource(h.lib.mats.base));
    expect(liner.layers.mask).toBe(0);
  });

  it('leaves out a piece drawn through a draw range: the fold would draw triangles the piece does not', () => {
    const h = hang();
    const quad = (x: number): THREE.BufferGeometry =>
      geometry({
        positions: [x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        index: [0, 1, 2, 0, 2, 3],
      });
    // two triangles in the buffer, the first of them drawn...
    const head = quad(70);
    head.setDrawRange(0, 3);
    // ...and the second of them drawn
    const tail = quad(80);
    tail.setDrawRange(3, Number.POSITIVE_INFINITY);
    const first = addPiece(
      h,
      'WocHead_A_nose_default',
      fileMaterial('skin_nose', h.lib.atlas),
      head,
    );
    const second = addPiece(
      h,
      'WocHead_A_mouth_default',
      fileMaterial('skin_mouth', h.lib.atlas),
      tail,
    );
    // the same quad drawn whole (the range every geometry is born with) folds
    const whole = quad(90);
    expect([whole.drawRange.start, whole.drawRange.count]).toEqual([0, Number.POSITIVE_INFINITY]);
    const third = addPiece(
      h,
      'WocHead_A_ears_default_L',
      fileMaterial('skin_ear_L', h.lib.atlas),
      whole,
    );
    const asked: string[] = [];
    const fold = wocHeadMergeFold(h.drawn, (c) => {
      asked.push(c.piece);
      return true;
    });
    expect(asked).toEqual([
      'WocHead_A_base',
      'WocHead_A_brows_L',
      'WocHead_A_hair_swept',
      'WocHead_A_beard_full',
      'WocHead_A_ears_default_L',
    ]);
    expect(fold?.folded.map((f) => f.candidate.piece)).toEqual(asked);
    // each ranged piece keeps drawing by itself, exactly the triangles it drew
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect([first, second, third].map((m) => m.layers.mask)).toEqual([1, 1, 0]);
    expect(rig.mesh?.geometry.getAttribute('position').count).toBe(16);
    expect(rig.mesh?.geometry.index?.count).toBe(18);
    // a base head drawn through a range folds nothing at all
    const lib = library();
    lib.geos.base.setDrawRange(0, 3);
    expect(wocHeadMergeFold(hang(lib).drawn, () => true)).toBeNull();
  });

  it('folds a geometry with material groups under its one material', () => {
    // three ignores a geometry's groups under a single material: the whole of it draws
    const h = hang();
    const box = new THREE.BoxGeometry(1, 1, 1);
    expect(box.groups).toHaveLength(6);
    const piece = addPiece(
      h,
      'WocHead_A_nose_default',
      fileMaterial('skin_nose', h.lib.atlas),
      box,
    );
    const fold = wocHeadMergeFold(h.drawn, () => true);
    expect(fold?.folded.map((f) => f.candidate.piece)).toContain('WocHead_A_nose_default');
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect(piece.layers.mask).toBe(0);
    // every face of the box: 24 vertices and 36 indices beside the fixture's four triangles
    expect(rig.mesh?.geometry.getAttribute('position').count).toBe(12 + 24);
    expect(rig.mesh?.geometry.index?.count).toBe(12 + 36);
    // ...but the same box drawn by a LIST of materials is left out, as ever
    const other = hang();
    const listed = addPiece(
      other,
      'WocHead_A_nose_default',
      fileMaterial('skin_nose', other.lib.atlas),
      new THREE.BoxGeometry(1, 1, 1),
    );
    listed.material = [listed.material as THREE.Material];
    const second = rigOn(false);
    stand(second.rig, other.bone, other.drawn);
    expect(listed.layers.mask).toBe(1);
    expect(second.rig.mesh?.geometry.getAttribute('position').count).toBe(12);
  });

  it('leaves out a piece with no vertices, even a flat one that needs no uv', () => {
    const h = hang();
    const empty = addPiece(
      h,
      'WocHead_A_eyes_default_L',
      fileMaterial('liner_L', null),
      new THREE.BufferGeometry(),
    );
    const asked: string[] = [];
    const fold = wocHeadMergeFold(h.drawn, (c) => {
      asked.push(c.piece);
      return true;
    });
    expect(asked).not.toContain('WocHead_A_eyes_default_L');
    expect(fold?.folded.map((f) => f.candidate.piece)).toEqual([
      'WocHead_A_base',
      'WocHead_A_brows_L',
      'WocHead_A_hair_swept',
      'WocHead_A_beard_full',
    ]);
    // so the head still merges, instead of failing its build on the empty piece
    const { rig } = rigOn(false);
    expect(stand(rig, h.bone, h.drawn)).toBe(true);
    expect(empty.layers.mask).toBe(1);
  });

  it.each(UNMERGEABLE)(
    'never folds a piece that is %s, nor asks place about it',
    (_what, spoil) => {
      const lib = library();
      lib.mats.hair = spoiled(lib.mats.hair, spoil);
      const h = hang(lib);
      const asked: string[] = [];
      const fold = wocHeadMergeFold(h.drawn, (c) => {
        asked.push(c.piece);
        return true;
      });
      expect(asked).toEqual(['WocHead_A_base', 'WocHead_A_brows_L', 'WocHead_A_beard_full']);
      expect(fold?.folded.map((f) => f.candidate.piece)).toEqual([
        'WocHead_A_base',
        'WocHead_A_brows_L',
        'WocHead_A_beard_full',
      ]);
      expect(fold?.hairMap).toBeNull();
    },
  );

  it.each(UNMERGEABLE)('folds nothing under a base head that is %s', (_what, spoil) => {
    const lib = library();
    lib.mats.base = spoiled(lib.mats.base, spoil);
    const h = hang(lib);
    expect(wocHeadMergeFold(h.drawn, () => true)).toBeNull();
  });

  it('folds the plain standard material every spoiled one was made from', () => {
    // the control for the two tables above: unspoiled, the same head folds whole
    const h = hang();
    const fold = wocHeadMergeFold(h.drawn, () => true);
    expect(fold?.folded).toHaveLength(4);
    // an alpha test of zero, a depth write left on and an untransformed map are the
    // defaults a pack material ships with
    const base = h.lib.mats.base as THREE.MeshStandardMaterial;
    expect([base.type, base.alphaTest, base.depthWrite, base.polygonOffset]).toEqual([
      'MeshStandardMaterial',
      0,
      true,
      false,
    ]);
    expect([h.lib.atlas.channel, h.lib.atlas.rotation]).toEqual([0, 0]);
    expect(h.lib.atlas.offset.toArray()).toEqual([0, 0]);
    expect(h.lib.atlas.repeat.toArray()).toEqual([1, 1]);
  });
});

describe('WocHeadMergeRig: the slot table', () => {
  it('answers each slot with its role, its reference, its layer, its source and the textures', () => {
    const h = hang();
    // two meshes on one file material share a slot
    const second = addPiece(h, 'WocHead_A_brows_R', h.lib.mats.brow);
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    const table = rig.table;
    expect(table?.slots).toEqual([
      {
        material: h.lib.mats.base.uuid,
        roleCode: 1,
        ref: [0.2346, 0.1195, 0.0865],
        layer: 0,
        oneSided: true,
      },
      {
        material: h.lib.mats.brow.uuid,
        roleCode: 4,
        ref: [0.023, 0.023, 0.023],
        layer: 0,
        oneSided: true,
      },
      {
        material: h.lib.mats.hair.uuid,
        roleCode: 3,
        ref: [0.0184, 0.0184, 0.0184],
        layer: 1,
        oneSided: true,
      },
      {
        material: h.lib.mats.beard.uuid,
        roleCode: 3,
        ref: [0.0603, 0.0603, 0.0603],
        layer: 2,
        oneSided: true,
      },
    ]);
    expect(table?.hairMap).toBe(h.lib.hairTex);
    expect(table?.beardMap).toBe(h.lib.beardTex);
    expect(table?.scalpMap).toBeNull();
    expect(values((rig.mesh as THREE.Mesh).geometry, 'aWocHmSlot')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 1, 1, 1,
    ]);
    expect(second.layers.mask).toBe(0);
    // one source mesh per slot, in slot order: the FIRST mesh folded on it (the dressing
    // reads the slot's surface off that mesh's material), never the second brow
    expect(table?.slotSources).toHaveLength(4);
    table?.slotSources.forEach((mesh, slot) => {
      expect(mesh, `slot ${slot}`).toBe(h.drawn[slot].mesh);
    });
    expect(table?.slotSources).not.toContain(second);
  });

  it('gives a slot the first mesh folded on it, whatever was left out before it', () => {
    const h = hang();
    // the brow cannot ride the merge: the slots close up, and so do their sources
    h.lib.mats.brow.transparent = true;
    const { rig } = rigOn(false);
    stand(rig, h.bone, h.drawn);
    expect(rig.table?.slotSources.map((m) => m.name)).toEqual([
      'WocHead_A_base',
      'WocHead_A_hair_swept',
      'WocHead_A_beard_full',
    ]);
  });
});
