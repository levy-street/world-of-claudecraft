// The weight solver behind the manual-rig lane. Each test pins one defect the
// Sundered Horror rig audit measured (docs/design/sundered-horror-rig-audit.md),
// so a regression reintroduces a named, understood failure rather than moving an
// opaque number.
import { describe, expect, it } from 'vitest';
import {
  buildAdjacency,
  connectedComponents,
  distToSegment,
  rigidifyShells,
  segmentRadii,
  smoothWeights,
  solveSkinWeights,
  weldPositions,
} from '../scripts/asset_pipeline/lib/skin_solver.mjs';

/** A two-link arm along +X plus a centre "chest" bone up the Y axis, which is
 *  the minimal shape that reproduces the audit's findings. */
const ARM: Parameters<typeof solveSkinWeights>[1] = [
  { joint: 0, side: 0, a: [0, 0, 0], b: [0, 1, 0] }, // chest, up the centreline
  { joint: 1, side: 1, a: [0.2, 1, 0], b: [1, 1, 0] }, // upperarm.l
  { joint: 2, side: 1, a: [1, 1, 0], b: [1.8, 1, 0] }, // lowerarm.l
];

/** Points filling a tube of radius `r` around a segment, so segmentRadii has a
 *  real surface to measure instead of a hand-picked number. */
function tube(a: number[], b: number[], r: number, n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let k = 0; k < 6; k++) {
      const th = (k / 6) * Math.PI * 2;
      // Offset in the two axes the segment does not run along, approximately.
      out.push([c[0], c[1] + Math.cos(th) * r, c[2] + Math.sin(th) * r]);
    }
  }
  return out;
}

const perJoint = (joints: Uint16Array, weights: Float32Array, v: number, K = 4) => {
  const m = new Map<number, number>();
  for (let k = 0; k < K; k++) {
    const w = weights[v * K + k];
    if (w > 0) m.set(joints[v * K + k], (m.get(joints[v * K + k]) ?? 0) + w);
  }
  return m;
};
const dominant = (m: Map<number, number>) =>
  [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];

describe('distToSegment', () => {
  it('clamps to the endpoints rather than treating the bone as an infinite line', () => {
    // A point beyond the far end must measure to that END, not perpendicular to
    // the line: otherwise every bone reaches infinitely far along its own axis.
    expect(distToSegment([5, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(4, 6);
    expect(distToSegment([-3, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(3, 6);
    expect(distToSegment([0.5, 2, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(2, 6);
  });

  it('treats a zero-length segment as a point', () => {
    expect(distToSegment([0, 3, 4], [0, 0, 0], [0, 0, 0])).toBeCloseTo(5, 6);
  });
});

describe('segmentRadii', () => {
  const THICK_THIN = [
    ...tube([0.2, 1, 0], [1, 1, 0], 0.3, 8), // fat upper arm
    ...tube([1, 1, 0], [1.8, 1, 0], 0.06, 8), // thin forearm
  ];

  it('measures a thick limb and a thin limb differently', () => {
    // One radius for a whole rig either cuts the thick limb loose or lets the
    // thin limb swallow its neighbours; the radius has to come from the mesh.
    // Band opened up here so this pins the MEASUREMENT, not the clamp below.
    const radii = segmentRadii(THICK_THIN, ARM, {
      radiusPercentile: 0.8,
      radiusBand: [0.01, 100],
    });
    expect(radii[1]).toBeGreaterThan(0.2);
    expect(radii[2]).toBeLessThan(0.12);
    expect(radii[1]).toBeGreaterThan(radii[2] * 2);
  });

  it('floors a starved radius into the band around the median', () => {
    // A short link sandwiched between two neighbours measures a tiny bucket, and
    // a tiny radius means its bump dies before it reaches its own geometry: on
    // the Horror `foot` ended up with peak weight 0.288 and dominating nothing.
    const wide = segmentRadii(THICK_THIN, ARM, {
      radiusPercentile: 0.8,
      radiusBand: [0.01, 100],
    });
    const banded = segmentRadii(THICK_THIN, ARM, {
      radiusPercentile: 0.8,
      radiusBand: [0.75, 2.5],
    });
    expect(banded[2]).toBeGreaterThan(wide[2]);
    // ...and the ceiling holds the fat bone back from reaching across the body.
    expect(Math.max(...banded) / Math.min(...banded)).toBeLessThanOrEqual(2.5 / 0.75 + 1e-9);
  });

  it('gives a segment nothing is nearest to the median radius, not zero', () => {
    // A zero radius would make the bone influence nothing at all and silently
    // drop it out of the rig.
    const points = tube([1, 1, 0], [1.8, 1, 0], 0.1, 8);
    const radii = segmentRadii(points, ARM, { radiusPercentile: 0.8 });
    expect(radii.every((r) => r > 0)).toBe(true);
  });
});

describe('solveSkinWeights', () => {
  const points = [
    ...tube([0, 0, 0], [0, 1, 0], 0.25, 10),
    ...tube([0.2, 1, 0], [1, 1, 0], 0.3, 10),
    ...tube([1, 1, 0], [1.8, 1, 0], 0.12, 10),
  ];
  const radii = segmentRadii(points, ARM, { radiusPercentile: 0.8 });

  it('gives a point deep inside a limb ONE clear owner', () => {
    // The audit's headline ownership defect: mean dominant weight 0.43 against
    // the hand-authored control's 0.82, because 1/d^4 with no length scale makes
    // every candidate near-equal and lands on a 4-way tie at ~0.25 each.
    const mid = [0.6, 1, 0]; // dead centre of the upper arm
    const { joints, weights } = solveSkinWeights([mid], ARM, { radii });
    const [bone, w] = dominant(perJoint(joints, weights, 0));
    expect(bone).toBe(1);
    expect(w).toBeGreaterThan(0.8);
  });

  it('blends across a joint instead of switching hard', () => {
    // The elbow is where a blend is CORRECT; the fix must not turn the whole rig
    // rigid in the course of killing the far-field smear.
    const { joints, weights } = solveSkinWeights([[1, 1, 0]], ARM, { radii });
    const m = perJoint(joints, weights, 0);
    expect(m.get(1) ?? 0).toBeGreaterThan(0.15);
    expect(m.get(2) ?? 0).toBeGreaterThan(0.15);
  });

  it('never lets a .l bone drive -X geometry', () => {
    // Without the laterality guard the two arms cross-drive through the chest.
    const { joints, weights } = solveSkinWeights([[-0.6, 1, 0]], ARM, {
      radii,
      sideGuard: 0.02,
    });
    const m = perJoint(joints, weights, 0);
    expect(m.get(1) ?? 0).toBe(0);
    expect(m.get(2) ?? 0).toBe(0);
  });

  it('assigns a point outside every radius rigidly to its nearest bone', () => {
    // A horn tip or shoulder spike has no articulation to represent, and a
    // BLENDED spike is the one that gets flung off the model.
    const spike = [1.8, 1, 3];
    const { joints, weights, rigid } = solveSkinWeights([spike], ARM, { radii });
    expect(rigid).toBe(1);
    expect(weights[0]).toBe(1);
    expect(joints[0]).toBe(2);
    expect(weights[1]).toBe(0);
  });

  it('picks the rigid owner by raw distance, not by distance over radius', () => {
    // d/r hands an outlier to whichever bone has the fattest radius rather than
    // the one it is physically closest to.
    const fatThenThin = [
      { joint: 0, side: 0, a: [0, 0, 0], b: [0, 1, 0] },
      { joint: 1, side: 0, a: [4, 0, 0], b: [5, 0, 0] },
    ];
    const r = [2.0, 0.05];
    const { joints } = solveSkinWeights([[5.4, 0, 0]], fatThenThin, { radii: r });
    expect(joints[0]).toBe(1);
  });

  it('gives a joint its BEST segment, never the sum of them', () => {
    // The audit's dominant root cause. Segments are attributed to the proximal
    // joint one per child, so chest (to head and both upper arms) and hips (to
    // spine and both thighs) carry three each while every other bone carries
    // one. Summed, those two out-weigh their neighbours everywhere: chest was
    // the nearest bone to 74 vertices and dominated 1833 of them.
    const oneSeg = [{ joint: 0, side: 0, a: [0, 0, 0], b: [1, 0, 0] }];
    const threeSegs = [
      { joint: 0, side: 0, a: [0, 0, 0], b: [1, 0, 0] },
      { joint: 0, side: 0, a: [0, 0, 0], b: [0, 1, 0] },
      { joint: 0, side: 0, a: [0, 0, 0], b: [0, 0, 1] },
      { joint: 1, side: 0, a: [1.6, 0, 0], b: [2.6, 0, 0] },
    ];
    const probe = [[1.3, 0, 0]];
    const r1 = solveSkinWeights(probe, [...oneSeg, threeSegs[3]], { radii: [1, 1] });
    const r3 = solveSkinWeights(probe, threeSegs, { radii: [1, 1, 1, 1] });
    // Joint 0's share must be identical whether it owns one segment or three.
    expect(perJoint(r3.joints, r3.weights, 0).get(0)).toBeCloseTo(
      perJoint(r1.joints, r1.weights, 0).get(0) as number,
      6,
    );
  });

  it('drops candidates far weaker than the winner before truncating to K', () => {
    // With a hard top-K over near-equal candidates, the K-th and (K+1)-th swap
    // rank between neighbouring vertices, the selected bone set changes across
    // that edge, and the mesh tears along it.
    const many = [
      { joint: 0, side: 0, a: [0, 0, 0], b: [0.01, 0, 0] },
      { joint: 1, side: 0, a: [0.9, 0, 0], b: [0.91, 0, 0] },
      { joint: 2, side: 0, a: [0, 0.9, 0], b: [0, 0.91, 0] },
      { joint: 3, side: 0, a: [0, 0, 0.9], b: [0, 0, 0.91] },
      { joint: 4, side: 0, a: [0, -0.95, 0], b: [0, -0.96, 0] },
    ];
    const radii = many.map(() => 1.2);
    const { joints, weights } = solveSkinWeights([[0, 0, 0]], many, {
      radii,
      minWeightFrac: 0.5,
    });
    const m = perJoint(joints, weights, 0);
    // Only the winner survives a 0.5 floor; the four far bones are all much weaker.
    expect(m.size).toBe(1);
    expect(m.get(0)).toBeCloseTo(1, 6);
  });

  it('always produces weights summing to 1', () => {
    const { joints, weights } = solveSkinWeights(points, ARM, { radii });
    for (let v = 0; v < points.length; v++) {
      const total = [...perJoint(joints, weights, v).values()].reduce((s, w) => s + w, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });
});

describe('weldPositions', () => {
  it('collapses co-located duplicates so they cannot disagree', () => {
    // Tripo ships a triangle soup: weighting per VERTEX lets two vertices at one
    // point take different weights and pull apart, cracking the mesh at seams.
    const { nodeOf, nodePos } = weldPositions([
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
    ]);
    expect(nodePos.length).toBe(2);
    expect(nodeOf[0]).toBe(nodeOf[1]);
    expect(nodeOf[0]).toBe(nodeOf[3]);
    expect(nodeOf[2]).not.toBe(nodeOf[0]);
  });

  it('keeps genuinely distinct positions apart', () => {
    const { nodePos } = weldPositions(
      [
        [0, 0, 0],
        [0.01, 0, 0],
      ],
      1e-5,
    );
    expect(nodePos.length).toBe(2);
  });
});

describe('connectedComponents', () => {
  it('finds loose shells that welding did not join', () => {
    // Two separate triangles: 0,1,2 and 3,4,5.
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [9, 0, 0],
      [10, 0, 0],
      [9, 1, 0],
    ];
    const { nodeOf, nodePos } = weldPositions(pts);
    const { count, label } = connectedComponents(nodePos.length, [0, 1, 2, 3, 4, 5], nodeOf);
    expect(count).toBe(2);
    expect(label[nodeOf[0]]).toBe(label[nodeOf[1]]);
    expect(label[nodeOf[0]]).not.toBe(label[nodeOf[3]]);
  });
});

describe('rigidifyShells', () => {
  it('makes a small shell ride one bone as a single piece', () => {
    // A horn whose vertices each pick their own bone shears itself apart.
    const label = Int32Array.from([0, 0, 0]);
    const joints = Uint16Array.from([1, 0, 0, 0, 5, 0, 0, 0, 7, 0, 0, 0]);
    const weights = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const nodePos = [
      [0, 0, 0],
      [0.1, 0, 0],
      [0.2, 0, 0],
    ];
    const n = rigidifyShells(joints, weights, label, 1, 4, { nodePos, maxShellNodes: 10 });
    expect(n).toBe(1);
    // All three now carry the CENTRE member's bone (the middle one), not the first.
    expect([joints[0], joints[4], joints[8]]).toEqual([5, 5, 5]);
  });

  it('leaves a large shell alone so a real limb is never frozen', () => {
    const label = new Int32Array(50);
    const joints = new Uint16Array(50 * 4);
    const weights = new Float32Array(50 * 4);
    for (let i = 0; i < 50; i++) {
      joints[i * 4] = i;
      weights[i * 4] = 1;
    }
    const n = rigidifyShells(joints, weights, label, 1, 4, { maxShellNodes: 10 });
    expect(n).toBe(0);
    expect(joints[49 * 4]).toBe(49);
  });
});

describe('smoothWeights', () => {
  it('relaxes a sharp gradient between neighbours', () => {
    // The measured failure mode after the kernel and the top-K floor: two nodes
    // millimetres apart whose weight vectors differ by half, so the edge between
    // them opens up under a swing. Per-vertex candidate picking cannot fix it.
    const joints = Uint16Array.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const weights = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const adj = [[1], [0, 2], [1]];
    smoothWeights(joints, weights, adj, { iters: 4, mix: 0.5, influences: 4 });
    const mid = perJoint(joints, weights, 1);
    // The middle node now carries some of BOTH bones rather than all of one.
    expect(mid.get(0) ?? 0).toBeGreaterThan(0.05);
    expect(mid.get(1) ?? 0).toBeGreaterThan(0.05);
  });

  it('leaves an isolated node and a uniform shell untouched', () => {
    // Smoothing runs after the shell pass on real meshes; it must be a no-op on
    // a shell whose members already agree, or it would undo the rigid assignment.
    const joints = Uint16Array.from([3, 0, 0, 0, 3, 0, 0, 0]);
    const weights = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0]);
    smoothWeights(joints, weights, [[1], [0]], { iters: 6, mix: 0.5, influences: 4 });
    expect([...joints]).toEqual([3, 0, 0, 0, 3, 0, 0, 0]);
    expect(weights[0]).toBeCloseTo(1, 6);
    expect(weights[4]).toBeCloseTo(1, 6);
  });

  it('keeps weights normalized', () => {
    const joints = Uint16Array.from([0, 1, 0, 0, 1, 2, 0, 0, 2, 3, 0, 0]);
    const weights = Float32Array.from([0.6, 0.4, 0, 0, 0.7, 0.3, 0, 0, 0.5, 0.5, 0, 0]);
    smoothWeights(joints, weights, [[1], [0, 2], [1]], { iters: 3, mix: 0.5, influences: 4 });
    for (let v = 0; v < 3; v++) {
      const total = [...perJoint(joints, weights, v).values()].reduce((s, w) => s + w, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });
});

describe('buildAdjacency', () => {
  it('connects across a welded seam that the raw soup breaks', () => {
    // Two triangles meeting at a duplicated edge: unwelded they share nothing,
    // welded they are neighbours, which is what makes smoothing possible at all.
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ];
    const { nodeOf, nodePos } = weldPositions(pts);
    const adj = buildAdjacency(nodePos.length, [0, 1, 2, 3, 4, 5], nodeOf);
    expect(adj[nodeOf[2]]).toContain(nodeOf[0]);
    // The welded corner reaches the far triangle's own vertex.
    expect(adj[nodeOf[0]]).toContain(nodeOf[5]);
  });
});
