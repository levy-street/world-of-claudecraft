// The skin-quality metrics behind the manual-rig lane's deformation gate. These
// readings are the only mechanical check in the pipeline that looks at a POSED
// frame: the rest pose looks perfect no matter how bad the weights are, which is
// how the Sundered Horror shipped with its arms driving the face and the horns.
import { describe, expect, it } from 'vitest';
import {
  edgesFromIndices,
  poseSkeletonAt,
  sampleChannel,
  skinPositions,
  weightStats,
  worstEdgeStretch,
} from '../scripts/asset_pipeline/lib/skin_metrics.mjs';

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TRANS_NEG_X = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1];
const SQRT_HALF = Math.SQRT1_2;

/** Two bones: `a` at the origin, `b` one unit along +X. Bind equals rest, so the
 *  inverse bind matrices are just the inverses of those translations. */
const SKELETON = {
  nodes: [
    {
      name: 'a',
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      children: [1],
    },
    {
      name: 'b',
      translation: [1, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      children: [],
    },
  ],
  roots: [0],
};

/** `b` swings 90 degrees about Z over one second. */
const SWING = {
  name: 'Swing',
  duration: 1,
  channels: [
    {
      node: 'b',
      path: 'rotation',
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, SQRT_HALF, SQRT_HALF],
      stride: 4,
      interpolation: 'LINEAR',
    },
  ],
};

const prim = (verts: { p: number[]; j: number[]; w: number[] }[], edges: number[][]) => ({
  jointNames: ['a', 'b'],
  ibms: [IDENT, TRANS_NEG_X],
  dequant: null,
  verts,
  edges,
});

describe('edgesFromIndices', () => {
  it('returns each undirected edge once, however many triangles share it', () => {
    // Two triangles across a shared diagonal: 5 unique edges, not 6.
    const edges = edgesFromIndices([0, 1, 2, 2, 1, 3]);
    expect(edges).toHaveLength(5);
    const keys = edges.map(([a, b]) => `${a},${b}`).sort();
    expect(keys).toEqual(['0,1', '0,2', '1,2', '1,3', '2,3']);
  });

  it('ignores a trailing partial triangle rather than reading past the end', () => {
    expect(edgesFromIndices([0, 1, 2, 3, 4])).toHaveLength(3);
  });
});

describe('sampleChannel', () => {
  const linear = {
    node: 'b',
    path: 'translation',
    times: [0, 1],
    values: [0, 0, 0, 10, 0, 0],
    stride: 3,
    interpolation: 'LINEAR',
  };

  it('holds the endpoints outside the keyed range', () => {
    expect(sampleChannel(linear, -5)).toEqual([0, 0, 0]);
    expect(sampleChannel(linear, 99)).toEqual([10, 0, 0]);
  });

  it('interpolates linearly inside the range', () => {
    expect(sampleChannel(linear, 0.25)[0]).toBeCloseTo(2.5, 6);
  });

  it('holds the previous key for STEP', () => {
    expect(sampleChannel({ ...linear, interpolation: 'STEP' }, 0.9)).toEqual([0, 0, 0]);
  });

  it('takes the SHORT way round on a rotation channel', () => {
    // Plain component lerp on a quaternion pair whose dot product is negative
    // takes the 270-degree path, which invents deformation the runtime never
    // shows. Halfway between q and (nearly) -q must stay near q, not near zero.
    const spin = {
      node: 'b',
      path: 'rotation',
      times: [0, 1],
      // 170 degrees about Z, then -170 degrees: 20 degrees apart the short way.
      values: [0, 0, Math.sin(1.4835), Math.cos(1.4835), 0, 0, -Math.sin(1.4835), Math.cos(1.4835)],
      stride: 4,
      interpolation: 'LINEAR',
    };
    const mid = sampleChannel(spin, 0.5);
    // The short arc passes through +/-180 degrees, so |z| stays near 1 and w near 0.
    expect(Math.abs(mid[2])).toBeGreaterThan(0.99);
    // And the result stays a unit quaternion, which a naive lerp would not.
    expect(Math.hypot(...mid)).toBeCloseTo(1, 6);
  });
});

describe('poseSkeletonAt', () => {
  it('composes a child through its parent', () => {
    const posed = poseSkeletonAt(
      SKELETON,
      {
        name: 'Shift',
        duration: 1,
        channels: [
          {
            node: 'a',
            path: 'translation',
            times: [0],
            values: [0, 5, 0],
            stride: 3,
            interpolation: 'LINEAR',
          },
        ],
      },
      0,
    );
    // b keeps its own +1 X offset and inherits the parent's +5 Y.
    expect(posed.get('b')?.slice(12, 15)).toEqual([1, 5, 0]);
  });

  it('falls back to the node pose for an unkeyed joint', () => {
    const posed = poseSkeletonAt(SKELETON, null, 0);
    expect(posed.get('a')?.slice(12, 15)).toEqual([0, 0, 0]);
    expect(posed.get('b')?.slice(12, 15)).toEqual([1, 0, 0]);
  });
});

describe('skinPositions', () => {
  it('carries a fully weighted vertex rigidly with its bone', () => {
    const p = prim([{ p: [2, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] }], []);
    const posed = poseSkeletonAt(SKELETON, SWING, 1);
    const [q] = skinPositions(p, posed);
    // One unit out along b, swung 90 degrees about Z: (1,1,0).
    expect(q[0]).toBeCloseTo(1, 5);
    expect(q[1]).toBeCloseTo(1, 5);
  });

  it('renormalizes an off-budget weight set instead of scaling the vertex', () => {
    // Weights summing to 0.5 must not halve the vertex towards the origin.
    const p = prim([{ p: [2, 0, 0], j: [1, 0, 0, 0], w: [0.5, 0, 0, 0] }], []);
    const posed = poseSkeletonAt(SKELETON, null, 0);
    const [q] = skinPositions(p, posed);
    expect(q[0]).toBeCloseTo(2, 5);
  });

  it('leaves a vertex with no weight at its own bind position', () => {
    const p = prim([{ p: [2, 0, 0], j: [0, 0, 0, 0], w: [0, 0, 0, 0] }], []);
    const [q] = skinPositions(p, poseSkeletonAt(SKELETON, SWING, 1));
    expect(q).toEqual([0, 0, 0]);
  });
});

describe('worstEdgeStretch', () => {
  const model = (verts: { p: number[]; j: number[]; w: number[] }[], edges: number[][]) => ({
    skeleton: SKELETON,
    prims: [prim(verts, edges)],
    clips: [SWING],
  });

  it('reads 1.0x when both ends ride the same bone', () => {
    // A rigid transform cannot change a length; anything else here is a bug in
    // the metric rather than in an asset.
    const r = worstEdgeStretch(
      model(
        [
          { p: [2, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] },
          { p: [2.5, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] },
        ],
        [[0, 1]],
      ),
    );
    expect(r.worst).toBeCloseTo(1, 4);
    expect(r.overRatio).toBe(0);
    expect(r.worstClip).toBe('Swing');
  });

  it('catches an edge whose two ends are driven by different bones', () => {
    // This is the tear the gate exists to find: neighbouring vertices with
    // different weight vectors pull apart as the joint swings.
    const r = worstEdgeStretch(
      model(
        [
          { p: [2, 0, 0], j: [0, 0, 0, 0], w: [1, 0, 0, 0] },
          { p: [2.05, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] },
        ],
        [[0, 1]],
      ),
      { reportRatio: 2 },
    );
    expect(r.worst).toBeGreaterThan(5);
    expect(r.overRatio).toBeGreaterThan(0);
  });

  it('ignores sliver edges below minRestLength', () => {
    // The absolute-gap half of the test. This mesh family carries edges a few
    // thousandths long that hit 5x while moving a distance nobody can see; with
    // no floor the reading is dominated by them (16.5x against 3.5x on the real
    // asset), and only the floored number tracks what the renders show.
    const torn = model(
      [
        { p: [2, 0, 0], j: [0, 0, 0, 0], w: [1, 0, 0, 0] },
        { p: [2.001, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] },
      ],
      [[0, 1]],
    );
    expect(worstEdgeStretch(torn).worst).toBeGreaterThan(2);
    const floored = worstEdgeStretch(torn, { minRestLength: 0.01 });
    expect(floored.worst).toBe(0);
    expect(floored.edgeSamples).toBe(0);
  });

  it('reports the worst clip across several, sorted worst first', () => {
    const still = { name: 'Still', duration: 1, channels: [] };
    const r = worstEdgeStretch({
      skeleton: SKELETON,
      prims: [
        prim(
          [
            { p: [2, 0, 0], j: [0, 0, 0, 0], w: [1, 0, 0, 0] },
            { p: [2.5, 0, 0], j: [1, 0, 0, 0], w: [1, 0, 0, 0] },
          ],
          [[0, 1]],
        ),
      ],
      clips: [still, SWING],
    });
    expect(r.worstClip).toBe('Swing');
    expect(r.perClip[0].clip).toBe('Swing');
    expect(r.perClip[1].worst).toBeCloseTo(1, 4);
  });
});

describe('weightStats', () => {
  it('separates a hand-authored-looking skin from a smeared one', () => {
    // The reading that actually caught the defect: the Horror sat at 0.507 mean
    // dominant weight with 57.9% of vertices owned by nobody, against the KayKit
    // knight's 0.816 and 2.7%.
    const owned = weightStats({
      skeleton: SKELETON,
      prims: [
        prim(
          [
            { p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.95, 0.05, 0, 0] },
            { p: [2, 0, 0], j: [1, 0, 0, 0], w: [0.9, 0.1, 0, 0] },
          ],
          [],
        ),
      ],
      clips: [],
    });
    expect(owned.meanDominant).toBeCloseTo(0.925, 3);
    expect(owned.unownedFrac).toBe(0);

    const smeared = weightStats({
      skeleton: SKELETON,
      prims: [
        prim(
          [
            { p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.26, 0.25, 0.25, 0.24] },
            { p: [2, 0, 0], j: [1, 0, 0, 0], w: [0.27, 0.25, 0.24, 0.24] },
          ],
          [],
        ),
      ],
      clips: [],
    });
    // Slots 2 and 3 name joint 0 again, so per-joint sums decide ownership.
    expect(smeared.meanDominant).toBeLessThan(owned.meanDominant);
  });

  it('sums repeated joint slots before deciding who owns a vertex', () => {
    // A vertex may list one joint twice; the PAIR is what deforms it, so the
    // per-slot value is not the ownership. Joint 0 holds 0.3+0.3 against
    // joint 1's 0.4 and must win.
    const s = weightStats({
      skeleton: SKELETON,
      prims: [prim([{ p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.3, 0.4, 0.3, 0] }], [])],
      clips: [],
    });
    expect(s.meanDominant).toBeCloseTo(0.6, 6);
    expect(s.bones[0].dominated).toBe(1);
    expect(s.bones[1].dominated).toBe(0);
  });

  it('names the bones that dominate nothing', () => {
    // A starved bone is the tell for a solver handicap: on the Horror `spine`
    // dominated 2 vertices and `upperleg.*` 9 while `chest` took 1833.
    const s = weightStats({
      skeleton: SKELETON,
      prims: [prim([{ p: [0, 0, 0], j: [0, 0, 0, 0], w: [1, 0, 0, 0] }], [])],
      clips: [],
    });
    expect(s.deadBones).toEqual(['b']);
    expect(s.bones.find((x) => x.bone === 'a')?.massFrac).toBeCloseTo(1, 6);
  });

  it('counts a vertex with no bone above 0.5 as unowned', () => {
    const s = weightStats({
      skeleton: SKELETON,
      prims: [prim([{ p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.45, 0.55, 0, 0] }], [])],
      clips: [],
    });
    expect(s.unownedFrac).toBe(0);
    const s2 = weightStats({
      skeleton: SKELETON,
      prims: [prim([{ p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.49, 0.51, 0, 0] }], [])],
      clips: [],
    });
    expect(s2.unownedFrac).toBe(0);
    const s3 = weightStats({
      skeleton: SKELETON,
      prims: [prim([{ p: [0, 0, 0], j: [0, 1, 0, 0], w: [0.4, 0.4, 0, 0] }], [])],
      clips: [],
    });
    expect(s3.unownedFrac).toBe(1);
  });
});
