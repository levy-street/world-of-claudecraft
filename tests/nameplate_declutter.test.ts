import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATE_HEIGHT_PX,
  declutterNameplates,
  declutterNameplatesInPlace,
  MIN_STACK_STEP_PX,
  type NameplateAnchor,
  type NameplateDeclutterMetrics,
  OVERLAP_THRESHOLD_X_PX,
  STACK_GAP_PX,
  STACK_ORDER_QUANTUM_PX,
} from '../src/render/nameplate_declutter';

const ROW = DEFAULT_PLATE_HEIGHT_PX + STACK_GAP_PX;

function newMetrics(): NameplateDeclutterMetrics {
  return { candidateChecks: 0, compressedPlates: 0 };
}

function heightOf(a: NameplateAnchor): number {
  return a.height ?? DEFAULT_PLATE_HEIGHT_PX;
}

/** Every pair sharing a screen column must be vertically disjoint (plates are
 *  bottom-anchored, so a plate owns `[sy - height, sy]`). */
function overlappingPairs(anchors: NameplateAnchor[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i];
      const b = anchors[j];
      if (Math.abs(a.sx - b.sx) > OVERLAP_THRESHOLD_X_PX) continue;
      const disjoint = a.sy <= b.sy - heightOf(b) || b.sy <= a.sy - heightOf(a);
      if (!disjoint) bad.push(`${a.id}/${b.id}`);
    }
  }
  return bad;
}

/** Deterministic LCG so a failure is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('nameplate vertical stacking', () => {
  it('leaves well-separated anchors untouched', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 500, sy: 300 },
    ];
    expect(declutterNameplates(anchors)).toEqual(anchors);
  });

  it('lifts the higher plate and leaves the nearest (bottom-most) one exactly where it projected', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 200, sy: 150 }, // farther away: projects higher on screen
      { id: 2, sx: 202, sy: 160 }, // nearer: bottom-most, keeps its spot
    ];

    const out = declutterNameplates(anchors);

    expect(out[1].sy).toBe(160);
    expect(out[0].sy).toBe(160 - ROW);
    // horizontal position is never touched, only vertical stacking separates plates
    expect(out[0].sx).toBe(200);
    expect(out[1].sx).toBe(202);
  });

  it('never pushes a plate BELOW its projected anchor', () => {
    const rng = makeRng(0x5eed);
    for (let trial = 0; trial < 40; trial++) {
      const anchors: NameplateAnchor[] = [];
      for (let i = 0; i < 25; i++) {
        anchors.push({
          id: i + 1,
          sx: Math.round(rng() * 300),
          sy: Math.round(rng() * 120),
          height: 20 + Math.round(rng() * 20),
        });
      }
      const before = anchors.map((a) => a.sy);

      declutterNameplatesInPlace(anchors);

      for (let i = 0; i < anchors.length; i++) {
        expect(anchors[i].sy, `trial ${trial}, id ${anchors[i].id}`).toBeLessThanOrEqual(before[i]);
      }
    }
  });

  it('leaves no overlapping pair in a dense random crowd', () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 40; trial++) {
      const anchors: NameplateAnchor[] = [];
      // few enough per column that the lift cap never engages, so "no overlap"
      // is the exact expectation rather than a best effort
      for (let i = 0; i < 5; i++) {
        anchors.push({
          id: i + 1,
          sx: Math.round(rng() * 600),
          sy: Math.round(rng() * 80),
          height: 20 + Math.round(rng() * 20),
        });
      }

      declutterNameplatesInPlace(anchors);

      expect(overlappingPairs(anchors), `trial ${trial}`).toEqual([]);
    }
  });

  it('stacks a column of three plates in ascending screen order without gaps growing', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 300, sy: 200 },
      { id: 2, sx: 301, sy: 200 },
      { id: 3, sx: 299, sy: 200 },
    ];

    const out = declutterNameplates(anchors);
    const ys = out.map((n) => n.sy).sort((x, y) => x - y);

    expect(ys).toEqual([200 - 2 * ROW, 200 - ROW, 200]);
  });

  it('spaces a tall plate by ITS height, not by a fixed row offset', () => {
    const tall: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 200 }, // lifted above the tall plate below it
      { id: 2, sx: 100, sy: 200, height: 60 },
    ];

    const out = declutterNameplates(tall);

    // equal sy, so the id tiebreak gives id 1 the anchor spot and the TALL
    // plate rides above it, cleared by the DEFAULT height of the plate below.
    expect(out[0].sy).toBe(200);
    expect(out[1].sy).toBe(200 - DEFAULT_PLATE_HEIGHT_PX - STACK_GAP_PX);
    expect(overlappingPairs(out)).toEqual([]);

    // and the other way round: a tall plate underneath pushes further
    const tallBelow: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 210, height: 60 },
      { id: 2, sx: 100, sy: 200 },
    ];
    const out2 = declutterNameplates(tallBelow);
    expect(out2[0].sy).toBe(210);
    expect(out2[1].sy).toBe(210 - 60 - STACK_GAP_PX);
  });

  it('keeps a pinned plate (the current target) exactly where it projected and flows the rest around it', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 400, sy: 300 }, // nearest: would normally own this spot
      { id: 2, sx: 400, sy: 300, pinned: true },
      { id: 3, sx: 400, sy: 300 },
    ];

    const out = declutterNameplates(anchors);

    expect(out[1].sy).toBe(300);
    expect(out.map((a) => a.sy).sort((x, y) => x - y)).toEqual([300 - 2 * ROW, 300 - ROW, 300]);
    expect(overlappingPairs(out)).toEqual([]);
  });

  it('is independent of the order the painter enumerated its views in', () => {
    const base: NameplateAnchor[] = [
      { id: 9, sx: 400, sy: 400 },
      { id: 1, sx: 401, sy: 400 },
      { id: 4, sx: 399, sy: 412 },
      { id: 7, sx: 460, sy: 405, height: 44 },
    ];
    const expected = new Map(declutterNameplates(base).map((a) => [a.id, a.sy]));

    for (const seed of [1, 2, 3]) {
      const rng = makeRng(seed);
      const shuffled = [...base].sort(() => rng() - 0.5);
      for (const a of declutterNameplates(shuffled)) expect(a.sy).toBe(expected.get(a.id));
    }
  });

  it('does not let plates in a different screen column push each other', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 0, sy: 100 },
      { id: 2, sx: OVERLAP_THRESHOLD_X_PX + 0.5, sy: 100 },
      { id: 3, sx: 2 * (OVERLAP_THRESHOLD_X_PX + 0.5), sy: 100 },
    ];

    const out = declutterNameplates(anchors);

    expect(out.map((a) => a.sy)).toEqual([100, 100, 100]);
  });

  it('still stacks a transitive chain whose endpoints do not overlap each other', () => {
    // A shares a column with B, B with C, but A and C are 140px apart. B must
    // clear A, and C must clear B; A and C may share a row.
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 0, sy: 100 },
      { id: 2, sx: 70, sy: 100 },
      { id: 3, sx: 140, sy: 100 },
    ];

    const out = declutterNameplates(anchors);

    expect(out.map((a) => a.sy)).toEqual([100, 100 - ROW, 100]);
    expect(overlappingPairs(out)).toEqual([]);
  });

  it('compresses a crowded column instead of piling its overflow on one line', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 30; i++) anchors.push({ id: i + 1, sx: 500, sy: 400 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    const ys = anchors.map((a) => a.sy).sort((x, y) => y - x);
    expect(ys[0]).toBe(400); // the bottom plate still owns its own anchor
    for (let i = 1; i < ys.length; i++) {
      // every plate keeps a DISTINCT row, at or above the compressed floor
      expect(ys[i - 1] - ys[i]).toBeGreaterThanOrEqual(MIN_STACK_STEP_PX);
      expect(ys[i - 1] - ys[i]).toBeLessThan(ROW);
    }
    expect(metrics.compressedPlates).toBeGreaterThan(0);
  });

  it('does not compress a populous column whose plates sit at different depths', () => {
    // Eight plates share one screen column but are spread over 600px: only the
    // first pair collides, so nobody may be compressed on a column head count.
    const anchors: NameplateAnchor[] = [];
    const depths = [100, 130, 200, 300, 400, 500, 600, 700];
    for (const [i, sy] of depths.entries()) anchors.push({ id: i + 1, sx: 500, sy, height: 46 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(metrics.compressedPlates).toBe(0);
    expect(overlappingPairs(anchors)).toEqual([]);
    // the colliding pair separates by the full plate height, not a compressed step
    expect(anchors[1].sy).toBe(130);
    expect(anchors[0].sy).toBe(130 - 46 - STACK_GAP_PX);
    // every other plate keeps its projected spot
    expect(anchors.slice(2).map((a) => a.sy)).toEqual(depths.slice(2));
  });

  it('does not compress a column that fits at full plate height', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4; i++) anchors.push({ id: i + 1, sx: 500, sy: 400 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    const ys = anchors.map((a) => a.sy).sort((x, y) => y - x);
    for (let i = 1; i < ys.length; i++) expect(ys[i - 1] - ys[i]).toBe(ROW);
    expect(metrics.compressedPlates).toBe(0);
    expect(overlappingPairs(anchors)).toEqual([]);
  });

  it('keeps the stack order stable when two plates drift past each other', () => {
    // sub-pixel depth jitter must not trade rows frame to frame: the ordering
    // key is quantized, so the id tiebreak holds the two plates in place.
    const seen = new Set<string>();
    for (let step = 0; step <= 6; step++) {
      const drift = (step - 3) * (STACK_ORDER_QUANTUM_PX / 8);
      const frame: NameplateAnchor[] = [
        { id: 1, sx: 300, sy: 300 },
        { id: 2, sx: 300, sy: 300 + drift },
      ];
      const out = declutterNameplates(frame);
      const lower = (out[0].sy > out[1].sy ? out[0] : out[1]).id;
      seen.add(String(lower));
    }
    expect([...seen]).toEqual(['1']);
  });

  it('honours the live prefix so a pooled scratch array never leaks stale anchors', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 100, sy: 100 },
      { id: 3, sx: 100, sy: 100 }, // stale pooled slot, beyond `count`
    ];

    declutterNameplatesInPlace(anchors, 2);

    expect(anchors[0].sy).toBe(100);
    expect(anchors[1].sy).toBe(100 - ROW);
    expect(anchors[2].sy).toBe(100); // untouched, and it did not push anyone
  });

  it('does not mutate the input array elements through the allocating wrapper', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 10, sy: 10 },
      { id: 2, sx: 11, sy: 10 },
    ];
    const originalSy = anchors.map((n) => n.sy);

    declutterNameplates(anchors);

    expect(anchors.map((n) => n.sy)).toEqual(originalSy);
  });
});

describe('nameplate vertical stacking: hot path', () => {
  it('mutates in place and hands back the same array objects', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 200, sy: 150 },
      { id: 2, sx: 202, sy: 151 },
    ];
    const first = anchors[0];

    const out = declutterNameplatesInPlace(anchors);

    expect(out).toBe(anchors);
    expect(out[0]).toBe(first); // element objects reused, not reallocated
    expect(overlappingPairs(out)).toEqual([]);
  });

  it('does not scan plates outside the candidate columns', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 2_000; i++) anchors.push({ id: i + 1, sx: i * 1_000, sy: i * 1_000 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(metrics.candidateChecks).toBe(0);
    expect(metrics.compressedPlates).toBe(0);
  });

  it('stays near-linear on a realistic screen-wide crowd', () => {
    // 150 plates spread over a 1280px viewport: the per-frame case that matters.
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 150; i++) {
      anchors.push({ id: i + 1, sx: (i * 137) % 1280, sy: 200 + ((i * 91) % 400), height: 46 });
    }
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 40);
  });

  it('resolves a packed column in one pass per plate, not one hop per plate above it', () => {
    // Every plate lands in the same column: the frontier walk must clear the
    // whole run at once. A regression to hop-and-rescan multiplies this by the
    // column depth (and silently truncates at MAX_RESOLVE_ITERATIONS).
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 160; i++) anchors.push({ id: i + 1, sx: 400, sy: 300, height: 46 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    // two resolve passes per plate (full separation, then the compressed retry),
    // each walking the colliding run once: a regression to hop-and-rescan was
    // ~700 checks per plate here
    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 200);
    // and no plate is left sharing a row with another, however deep the column
    const ys = anchors.map((a) => a.sy).sort((x, y) => y - x);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i - 1] - ys[i]).toBeGreaterThanOrEqual(MIN_STACK_STEP_PX);
    }
  });

  it('keeps a long single-row chain linear in the number of plates', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 2_000; i++) anchors.push({ id: i + 1, sx: i * 70, sy: 100 });
    const metrics = newMetrics();

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(overlappingPairs(anchors.slice(0, 50))).toEqual([]);
    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 16);
  });

  it('leaves every non-finite projection untouched while finite anchors still stack', () => {
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

    declutterNameplatesInPlace(anchors);

    for (let i = 0; i < invalidBefore.length; i++) {
      expect(Object.is(anchors[i].sx, invalidBefore[i].sx)).toBe(true);
      expect(Object.is(anchors[i].sy, invalidBefore[i].sy)).toBe(true);
    }
    // ids 7 and 8 sit within the ordering quantum, so the id tiebreak (not the
    // 1px depth difference) decides which one keeps its projected spot
    expect(anchors[6].sy).toBe(100);
    expect(anchors[7].sy).toBe(100 - ROW);
  });

  it('falls back to the default height for a missing or nonsensical height', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 300 },
      { id: 2, sx: 100, sy: 300, height: 0 },
      { id: 3, sx: 100, sy: 300, height: Number.NaN },
      { id: 4, sx: 100, sy: 300, height: -40 },
    ];

    const out = declutterNameplates(anchors);

    expect(out.map((a) => a.sy)).toEqual([300, 300 - ROW, 300 - 2 * ROW, 300 - 3 * ROW]);
  });

  it('does not merge distinct far coordinates whose column quotient rounds together', () => {
    const farX = 1.2501 * 2 ** 60;
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: farX + 256, sy: 100 },
    ];
    const before = anchors.map((a) => ({ ...a }));

    declutterNameplatesInPlace(anchors);

    expect(anchors).toEqual(before);
  });

  it('treats signed zero column coordinates as the same column', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: -0, sy: 100 },
      { id: 2, sx: 0, sy: 101 },
    ];

    declutterNameplatesInPlace(anchors);

    expect(anchors[0].sy).toBe(100);
    expect(anchors[1].sy).toBe(100 - ROW);
  });

  it('is reusable across calls of shrinking size (stale scratch never leaks)', () => {
    const big: NameplateAnchor[] = [];
    for (let i = 0; i < 50; i++) big.push({ id: i + 1, sx: 100, sy: 100 });
    declutterNameplatesInPlace(big);

    const small: NameplateAnchor[] = [
      { id: 1, sx: 500, sy: 500 },
      { id: 2, sx: 900, sy: 500 },
    ];

    declutterNameplatesInPlace(small);

    // a stale column from the previous call must not push these apart
    expect(small.map((a) => a.sy)).toEqual([500, 500]);
  });
});
