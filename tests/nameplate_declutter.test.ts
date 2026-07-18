import { describe, expect, it } from 'vitest';
import {
  declutterNameplates,
  declutterNameplatesInPlace,
  type NameplateAnchor,
  type NameplateDeclutterMetrics,
} from '../src/render/nameplate_declutter';

/**
 * Straightforward O(N^2) connected-component oracle: the spatial-hash hot path
 * must agree with it anchor-for-anchor on every input, or nameplates would
 * silently stack differently in a crowd than they do in the unit tests.
 */
function declutterReference(anchors: NameplateAnchor[]): NameplateAnchor[] {
  const OVERLAP_X = 80;
  const OVERLAP_Y = 18;
  const STACK = 20;
  const out = anchors.map((a) => ({ ...a }));
  const byId = new Map(out.map((a) => [a.id, a]));
  const visited = new Set<number>();
  const ordered = [...out].sort((a, b) => a.id - b.id);
  for (const anchor of ordered) {
    if (visited.has(anchor.id)) continue;

    const cluster: NameplateAnchor[] = [];
    const queue = [anchor];
    const discovered = new Set([anchor.id]);
    for (let q = 0; q < queue.length; q++) {
      const current = queue[q];
      cluster.push(current);
      for (const other of ordered) {
        if (visited.has(other.id) || discovered.has(other.id)) continue;
        if (
          Math.abs(other.sx - current.sx) <= OVERLAP_X &&
          Math.abs(other.sy - current.sy) <= OVERLAP_Y
        ) {
          discovered.add(other.id);
          queue.push(other);
        }
      }
    }
    if (cluster.length < 2) {
      visited.add(anchor.id);
      continue;
    }
    cluster.sort((a, b) => a.id - b.id);
    const baseSy = cluster.reduce((sum, a) => sum + a.sy, 0) / cluster.length;
    cluster.forEach((member, i) => {
      const target = byId.get(member.id);
      if (target) target.sy = baseSy + (i - (cluster.length - 1) / 2) * STACK;
      visited.add(member.id);
    });
  }
  return out;
}

/** Deterministic LCG so a failure is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('nameplate declutter', () => {
  it('leaves well-separated anchors untouched', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 500, sy: 300 },
    ];
    expect(declutterNameplates(anchors)).toEqual(anchors);
  });

  it('separates two anchors that project to nearly the same spot', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 200, sy: 150 },
      { id: 2, sx: 202, sy: 151 },
    ];
    const out = declutterNameplates(anchors);
    const a = out.find((n) => n.id === 1);
    const b = out.find((n) => n.id === 2);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(18);
    // horizontal position is untouched, only vertical stacking separates plates
    expect(a?.sx).toBe(200);
    expect(b?.sx).toBe(202);
  });

  it('separates anchors whose wide labels would overlap even though the anchor points are tens of px apart', () => {
    // Two NPCs standing near each other project anchor points ~60px apart
    // horizontally, well beyond a naive point-collision check, but their
    // rendered name labels (100-250px wide, single text line) still overlap.
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 400, sy: 200 },
      { id: 2, sx: 460, sy: 202 },
    ];
    const out = declutterNameplates(anchors);
    const a = out.find((n) => n.id === 1);
    const b = out.find((n) => n.id === 2);
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(18);
  });

  it('stacks a cluster of 3+ overlapping anchors without unbounded growth', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 300, sy: 200 },
      { id: 2, sx: 301, sy: 200 },
      { id: 3, sx: 299, sy: 201 },
    ];
    const out = declutterNameplates(anchors);
    const ys = out.map((n) => n.sy).sort((x, y) => x - y);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(18);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(18);
    expect(ys[2] - ys[0]).toBeLessThan(200);
  });

  it('stacks a transitive chain where the endpoints do not directly overlap', () => {
    // A overlaps B (70px apart) and B overlaps C (70px apart), but A and C
    // are 140px apart, beyond OVERLAP_THRESHOLD_X_PX (80px). All three still
    // belong to the same collision component and must be stacked together.
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 0, sy: 100 },
      { id: 2, sx: 70, sy: 100 },
      { id: 3, sx: 140, sy: 100 },
    ];

    const out = declutterNameplates(anchors);
    expect(out.map((anchor) => anchor.sy)).toEqual([80, 100, 120]);
  });

  it('orders a cluster stably by id regardless of input order', () => {
    const anchors: NameplateAnchor[] = [
      { id: 9, sx: 400, sy: 400 },
      { id: 1, sx: 401, sy: 400 },
    ];
    const reversed: NameplateAnchor[] = [anchors[1], anchors[0]];
    const out1 = declutterNameplates(anchors);
    const out2 = declutterNameplates(reversed);
    const find = (arr: NameplateAnchor[], id: number) => arr.find((n) => n.id === id)?.sy;
    expect(find(out1, 1)).toBe(find(out2, 1));
    expect(find(out1, 9)).toBe(find(out2, 9));
  });

  it('does not mutate the input array elements', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 10, sy: 10 },
      { id: 2, sx: 11, sy: 10 },
    ];
    const originalSy = anchors.map((n) => n.sy);
    declutterNameplates(anchors);
    expect(anchors.map((n) => n.sy)).toEqual(originalSy);
  });
});

describe('nameplate declutter: spatial-hash hot path', () => {
  it('mutates in place and hands back the same array', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 200, sy: 150 },
      { id: 2, sx: 202, sy: 151 },
    ];
    const first = anchors[0];
    const out = declutterNameplatesInPlace(anchors);
    expect(out).toBe(anchors);
    expect(out[0]).toBe(first); // element objects reused, not reallocated
    expect(Math.abs(out[0].sy - out[1].sy)).toBeGreaterThanOrEqual(18);
  });

  it('matches the O(N^2) reference on dense random crowds', () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(rng() * 60);
      const anchors: NameplateAnchor[] = [];
      for (let i = 0; i < n; i++)
        anchors.push({
          // a tight screen box, so clusters genuinely form and overlap
          id: Math.floor(rng() * 100000),
          sx: Math.round(rng() * 400 - (trial % 2 === 0 ? 0 : 200)),
          sy: Math.round(rng() * 90 - (trial % 2 === 0 ? 0 : 45)),
        });
      // ids must be unique (entity ids are)
      const seen = new Set<number>();
      const uniq = anchors.filter((anchor) => {
        if (seen.has(anchor.id)) return false;
        seen.add(anchor.id);
        return true;
      });

      const expected = declutterReference(uniq);
      const actual = declutterNameplatesInPlace(uniq.map((a) => ({ ...a })));
      const byId = (arr: NameplateAnchor[]) => new Map(arr.map((a) => [a.id, a]));
      const e = byId(expected);
      const a = byId(actual);
      expect(a.size).toBe(e.size);
      for (const [id, ea] of e) {
        const aa = a.get(id);
        expect(aa, `trial ${trial}, id ${id}`).toBeDefined();
        expect(aa?.sx, `trial ${trial}, id ${id} sx`).toBeCloseTo(ea.sx, 9);
        expect(aa?.sy, `trial ${trial}, id ${id} sy`).toBeCloseTo(ea.sy, 9);
      }
    }
  });

  it('matches the reference on sparse crowds where nothing collides', () => {
    const rng = makeRng(7);
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 40; i++)
      anchors.push({ id: i + 1, sx: i * 400 + rng(), sy: i * 100 + rng() });
    const expected = declutterReference(anchors);
    const actual = declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
    for (let i = 0; i < anchors.length; i++) expect(actual[i].sy).toBeCloseTo(expected[i].sy, 9);
  });

  it('handles anchors that project to negative screen coords', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: -30, sy: -12 },
      { id: 2, sx: -28, sy: -11 },
    ];
    const expected = declutterReference(anchors);
    const actual = declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
    expect(actual[0].sy).toBeCloseTo(expected[0].sy, 9);
    expect(actual[1].sy).toBeCloseTo(expected[1].sy, 9);
    expect(Math.abs(actual[0].sy - actual[1].sy)).toBeGreaterThanOrEqual(18);
  });

  it.each([
    ['inclusive horizontal threshold', { sx: 0, sy: 0 }, { sx: 80, sy: 0 }, true],
    ['outside horizontal threshold', { sx: 0, sy: 0 }, { sx: 80.0001, sy: 0 }, false],
    ['inclusive vertical threshold', { sx: 0, sy: 0 }, { sx: 0, sy: 18 }, true],
    ['outside vertical threshold', { sx: 0, sy: 0 }, { sx: 0, sy: 18.0001 }, false],
    ['inclusive diagonal threshold', { sx: 0, sy: 0 }, { sx: 80, sy: 18 }, true],
    ['inclusive opposite diagonal', { sx: 0, sy: 18 }, { sx: 80, sy: 0 }, true],
    ['negative to positive cell boundary', { sx: -40, sy: 0 }, { sx: 40, sy: 0 }, true],
  ])('pins the %s', (_label, a, b, collides) => {
    const anchors: NameplateAnchor[] = [
      { id: 1, ...a },
      { id: 2, ...b },
    ];

    const actual = declutterNameplatesInPlace(anchors);

    const moved = actual[0].sy !== a.sy || actual[1].sy !== b.sy;
    expect(moved).toBe(collides);
  });

  it('matches the reference for anchors projected millions of pixels off-screen', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 4e7, sy: 3e6 },
      { id: 2, sx: 4e7 + 30, sy: 3e6 + 5 }, // collides with 1
      { id: 3, sx: -4e7, sy: -3e6 }, // far away, must not join
      { id: 4, sx: 500, sy: 500 },
    ];
    const expected = declutterReference(anchors);
    const actual = declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
    for (let i = 0; i < anchors.length; i++) expect(actual[i].sy).toBeCloseTo(expected[i].sy, 6);
    expect(Math.abs(actual[0].sy - actual[1].sy)).toBeGreaterThanOrEqual(18);
    expect(actual[2].sy).toBe(-3e6); // untouched
    expect(actual[3].sy).toBe(500); // untouched
  });

  it('keeps sparse far projections linear instead of collapsing them into one edge bucket', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: 5e6 + i * 1_000, sy: 1e6 + i * 1_000 });
    }
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };
    declutterNameplatesInPlace(anchors, anchors.length, metrics);
    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it('keeps a long transitive chain local to nearby hash cells', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: i * 70, sy: 100 });
    }
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors[1].sy - anchors[0].sy).toBe(20);
    expect(anchors[anchors.length - 1].sy - anchors[anchors.length - 2].sy).toBe(20);
    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 8);
  });

  it('does not rescan a dense collision bucket for every component member', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: 100, sy: 100 });
    }
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors[1].sy - anchors[0].sy).toBe(20);
    expect(anchors[anchors.length - 1].sy - anchors[anchors.length - 2].sy).toBe(20);
    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it('does not repeatedly scan a dense non-overlapping neighbour bucket', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) anchors.push({ id: i, sx: 0, sy: 100 });
    for (let i = 0; i < 4_000; i++) anchors.push({ id: 4_000 + i, sx: 159, sy: 100 });
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it.each([
    ['left cell below right', { sx: 79, sy: 0 }, { sx: 0, sy: 17 }, { sx: 158, sy: 34 }],
    ['left cell above right', { sx: 79, sy: 35 }, { sx: 0, sy: 18 }, { sx: 158, sy: 0 }],
  ])(
    'rejects dense diagonal neighbour buckets without a false merge when the %s',
    (_label, leftXBound, leftYBound, right) => {
      const anchors: NameplateAnchor[] = [];
      for (let i = 0; i < 2_000; i++) anchors.push({ id: i, ...leftXBound });
      for (let i = 0; i < 2_000; i++) anchors.push({ id: 2_000 + i, ...leftYBound });
      for (let i = 0; i < 4_000; i++) anchors.push({ id: 4_000 + i, ...right });
      const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

      declutterNameplatesInPlace(anchors, anchors.length, metrics);

      const leftBaseSy = (leftXBound.sy + leftYBound.sy) / 2;
      const componentMid = (4_000 - 1) / 2;
      expect(anchors[0].sy).toBe(leftBaseSy - componentMid * 20);
      expect(anchors[3_999].sy).toBe(leftBaseSy + componentMid * 20);
      expect(anchors[4_000].sy).toBe(right.sy - componentMid * 20);
      expect(anchors[7_999].sy).toBe(right.sy + componentMid * 20);
      expect(metrics.candidateChecks).toBeLessThan(anchors.length * 2);
    },
  );

  it('does not resize typed spatial buffers after their high-water capacity is warm', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 10_000; i++) {
      anchors.push({ id: i, sx: i * 1_000, sy: i * 1_000 });
    }
    const metrics = { candidateChecks: 0, spatialHashResizes: -1 };
    declutterNameplatesInPlace(anchors, anchors.length, metrics);
    expect(metrics.spatialHashResizes).toBeGreaterThan(0);

    for (const count of [anchors.length, 5_000, 500, 50]) {
      metrics.spatialHashResizes = -1;
      declutterNameplatesInPlace(anchors, count, metrics);
      expect(metrics.spatialHashResizes).toBe(0);
    }

    metrics.spatialHashResizes = -1;
    declutterNameplatesInPlace(anchors, anchors.length, metrics);
    expect(metrics.spatialHashResizes).toBe(0);
  });

  it('does not self-collide when adjacent far cell coordinates round together', () => {
    const farX = 80 * (Number.MAX_SAFE_INTEGER + 1);
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: -farX, sy: 500 },
    ];
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors).toEqual([
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: -farX, sy: 500 },
    ]);
    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it('does not merge distinct far coordinates whose quotient rounds to one cell id', () => {
    const farX = 1.2501 * 2 ** 60;
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: farX + 256, sy: 100 },
    ];

    declutterNameplatesInPlace(anchors);

    expect(anchors).toEqual([
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: farX + 256, sy: 100 },
    ]);
  });

  it('does not round a far diagonal gap down into the overlap threshold', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 576460752303423700, sy: 67108871.674485 },
      { id: 2, sx: 576460752303423900, sy: 67108855.61777681 },
    ];
    const before = anchors.map((anchor) => ({ ...anchor }));

    declutterNameplatesInPlace(anchors);

    expect(anchors).toEqual(before);
  });

  it.each([
    [
      'left cell below right',
      { id: 1, sx: 70, sy: 144115188075856000 },
      { id: 2, sx: 100, sy: 144115188075856030 },
    ],
    [
      'left cell above right',
      { id: 1, sx: 70, sy: 144115188075856030 },
      { id: 2, sx: 100, sy: 144115188075856000 },
    ],
  ])('does not round a far y gap down for a diagonal with the %s', (_label, a, b) => {
    const anchors: NameplateAnchor[] = [a, b];
    const before = anchors.map((anchor) => ({ ...anchor }));

    declutterNameplatesInPlace(anchors);

    expect(anchors).toEqual(before);
  });

  it('treats signed zero cell coordinates as the same cell', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: -0, sy: 100 },
      { id: 2, sx: 0, sy: 101 },
    ];

    declutterNameplatesInPlace(anchors);

    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBeGreaterThanOrEqual(18);
  });

  it('ignores every non-finite projection while finite anchors still stack', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: Number.NaN, sy: 100 },
      { id: 2, sx: Number.POSITIVE_INFINITY, sy: 100 },
      { id: 3, sx: Number.NEGATIVE_INFINITY, sy: 100 },
      { id: 4, sx: 100, sy: Number.NaN },
      { id: 5, sx: 100, sy: Number.POSITIVE_INFINITY },
      { id: 6, sx: 100, sy: Number.NEGATIVE_INFINITY },
      { id: 7, sx: 100, sy: 100 },
      { id: 8, sx: 104, sy: 101 },
    ];
    const invalidBefore = anchors.slice(0, 6).map((anchor) => ({ ...anchor }));
    const metrics: NameplateDeclutterMetrics = { candidateChecks: 0, spatialHashResizes: 0 };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    for (let i = 0; i < invalidBefore.length; i++) {
      expect(Object.is(anchors[i].sx, invalidBefore[i].sx)).toBe(true);
      expect(Object.is(anchors[i].sy, invalidBefore[i].sy)).toBe(true);
    }
    expect(Math.abs(anchors[6].sy - anchors[7].sy)).toBeGreaterThanOrEqual(18);
    // Resolved finite candidates are consumed from the bucket instead of rescanned.
    expect(metrics.candidateChecks).toBe(2);
  });

  it('is reusable across calls of shrinking size (stale scratch never leaks)', () => {
    const big: NameplateAnchor[] = [];
    for (let i = 0; i < 50; i++) big.push({ id: i + 1, sx: 100, sy: 100 });
    declutterNameplatesInPlace(big);

    const small: NameplateAnchor[] = [
      { id: 1, sx: 500, sy: 500 },
      { id: 2, sx: 900, sy: 500 },
    ];
    const expected = declutterReference(small);
    const actual = declutterNameplatesInPlace(small.map((a) => ({ ...a })));
    expect(actual[0].sy).toBeCloseTo(expected[0].sy, 9);
    expect(actual[1].sy).toBeCloseTo(expected[1].sy, 9);
  });

  // The painter hands in a POOLED array whose tail still holds last frame's
  // anchors, and bounds the live region with `count`. This is the whole reason
  // the pooling is safe: without the bound, stale anchors from a previous, larger
  // frame would join this frame's clustering and shove live plates around.
  it('ignores the stale tail beyond `count`', () => {
    const anchors: NameplateAnchor[] = [
      // this frame's two live plates, far apart, so nothing should move
      { id: 1, sx: 500, sy: 500 },
      { id: 2, sx: 900, sy: 500 },
      // last frame's leftovers, parked right on top of plate 1
      { id: 3, sx: 500, sy: 500 },
      { id: 4, sx: 502, sy: 501 },
      { id: 5, sx: 501, sy: 499 },
      { id: 6, sx: 503, sy: 500 },
    ];

    declutterNameplatesInPlace(anchors, 2);

    // the live pair is untouched: it never saw the stale anchors
    expect(anchors[0]).toEqual({ id: 1, sx: 500, sy: 500 });
    expect(anchors[1]).toEqual({ id: 2, sx: 900, sy: 500 });
    // and the stale tail is left exactly as it was, not restacked
    expect(anchors[2]).toEqual({ id: 3, sx: 500, sy: 500 });
    expect(anchors[3]).toEqual({ id: 4, sx: 502, sy: 501 });
    expect(anchors[4]).toEqual({ id: 5, sx: 501, sy: 499 });
    expect(anchors[5]).toEqual({ id: 6, sx: 503, sy: 500 });
  });

  it('clamps `count` to the array length', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 104, sy: 101 },
    ];
    expect(() => declutterNameplatesInPlace(anchors, 99)).not.toThrow();
    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBeGreaterThanOrEqual(18);
  });
});
