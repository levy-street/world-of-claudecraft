import { describe, expect, it } from 'vitest';
import {
  declutterNameplates,
  declutterNameplatesInPlace,
  type NameplateAnchor,
} from '../src/render/nameplate_declutter';

/**
 * The original O(N^2) rescan, kept verbatim as the oracle: the spatial-hash hot
 * path must agree with it anchor-for-anchor on every input, or nameplates would
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
    const cluster = ordered.filter(
      (other) =>
        !visited.has(other.id) &&
        Math.abs(other.sx - anchor.sx) <= OVERLAP_X &&
        Math.abs(other.sy - anchor.sy) <= OVERLAP_Y,
    );
    if (cluster.length < 2) {
      visited.add(anchor.id);
      continue;
    }
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
          sx: Math.round(rng() * 400),
          sy: Math.round(rng() * 90),
        });
      // ids must be unique (entity ids are)
      const seen = new Set<number>();
      const uniq = anchors.filter((a) => !seen.has(a.id) && (seen.add(a.id), true));

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

  it('anchors past the cell clamp share an edge bucket yet cluster like the reference', () => {
    // Beyond ~2.6M px the cell coords clamp, so ALL of these land in one bucket.
    // Membership must still be decided by the exact |dx| / |dy| test: the two
    // distant pairs must not merge into a single stack.
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 5e6, sy: 1e6 },
      { id: 2, sx: 5e6 + 10, sy: 1e6 + 2 }, // pair A
      { id: 3, sx: 9e6, sy: 2e6 },
      { id: 4, sx: 9e6 + 10, sy: 2e6 + 2 }, // pair B, same clamped cell as A
    ];
    const expected = declutterReference(anchors);
    const actual = declutterNameplatesInPlace(anchors.map((x) => ({ ...x })));
    for (let i = 0; i < anchors.length; i++) expect(actual[i].sy).toBeCloseTo(expected[i].sy, 6);

    // each pair stacked with its own neighbour, and the two pairs stayed apart
    expect(Math.abs(actual[0].sy - actual[1].sy)).toBeGreaterThanOrEqual(18);
    expect(Math.abs(actual[2].sy - actual[3].sy)).toBeGreaterThanOrEqual(18);
    expect(Math.abs(actual[0].sy - actual[2].sy)).toBeGreaterThan(1000);
  });

  it('survives a non-finite projection without throwing', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: Number.NaN, sy: Number.NaN },
      { id: 2, sx: Number.POSITIVE_INFINITY, sy: 10 },
      { id: 3, sx: 100, sy: 100 },
      { id: 4, sx: 104, sy: 101 },
    ];
    expect(() => declutterNameplatesInPlace(anchors)).not.toThrow();
    // the two real, colliding anchors still separated
    expect(Math.abs(anchors[2].sy - anchors[3].sy)).toBeGreaterThanOrEqual(18);
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
