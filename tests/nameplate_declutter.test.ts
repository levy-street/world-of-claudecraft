import { describe, expect, it } from 'vitest';
import {
  declutterNameplates,
  declutterNameplatesInPlace,
  HERALDRY_OVERLAP_THRESHOLD_X_PX,
  HERALDRY_OVERLAP_THRESHOLD_Y_PX,
  HERALDRY_STACK_OFFSET_PX,
  type NameplateAnchor,
  type NameplateDeclutterMetrics,
  OVERLAP_THRESHOLD_X_PX,
  OVERLAP_THRESHOLD_Y_PX,
  STACK_OFFSET_PX,
} from '../src/render/nameplate_declutter';
import { NAMEPLATE_DOT_SCALE_MAX, nameplateDotRowHeight } from '../src/render/nameplate_dots_core';

// Independent oracle literals. This reference exists to catch drift in the
// optimized spatial-hash implementation, so it must not import the production
// thresholds it is checking.
const BASE_OVERLAP_X = 80;
const BASE_OVERLAP_Y = 18;
const BASE_STACK = 20;
const HERALDRY_OVERLAP_X = 95;
const HERALDRY_OVERLAP_Y = 26;
const HERALDRY_STACK = 28;
const HERALDRY_EXTRA_LIFT = 8;
// The dot row's lift at the slider's 150% default and 300% maximum: a 13px icon,
// a 7px countdown step and 3px of pad, scaled (nameplate_dots_core.ts). Literal
// here for the same reason as the thresholds above; the production row height
// is pinned to these in the dot-row cases below.
const DOT_ROW_LIFT_DEFAULT = 34.5;
const DOT_ROW_LIFT_MAX = 69;

function liftOf(anchor: NameplateAnchor): number {
  return anchor.extraLift ?? 0;
}

function heraldryAnchor(id: number, sx: number, sy: number): NameplateAnchor {
  return { id, sx, sy, extraLift: HERALDRY_EXTRA_LIFT };
}

function referenceAnchorsOverlap(a: NameplateAnchor, b: NameplateAnchor): boolean {
  const lifted = liftOf(a) > 0 || liftOf(b) > 0;
  const overlapX = lifted ? HERALDRY_OVERLAP_X : BASE_OVERLAP_X;
  // the taller lift of the pair extends the bare vertical reach by exactly itself
  const overlapY = BASE_OVERLAP_Y + Math.max(liftOf(a), liftOf(b));
  return Math.abs(a.sx - b.sx) <= overlapX && Math.abs(a.sy - b.sy) <= overlapY;
}

/**
 * Straightforward O(N^2) connected-component oracle: the spatial-hash hot path
 * must agree with it anchor-for-anchor on every input, or nameplates would
 * silently stack differently in a crowd than they do in the unit tests.
 */
function declutterReference(anchors: NameplateAnchor[]): NameplateAnchor[] {
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
        if (referenceAnchorsOverlap(other, current)) {
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
    // one pitch per component: the bare one plus the tallest lift in it
    const stack = BASE_STACK + cluster.reduce((tallest, a) => Math.max(tallest, liftOf(a)), 0);
    cluster.forEach((member, i) => {
      const target = byId.get(member.id);
      if (target) target.sy = baseSy + (i - (cluster.length - 1) / 2) * stack;
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

/** The hot path must agree with the oracle anchor for anchor on `anchors`. */
function expectHotPathMatchesReference(anchors: NameplateAnchor[], label: string): void {
  const expected = declutterReference(anchors);
  const actual = declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
  const byId = (arr: NameplateAnchor[]) => new Map(arr.map((a) => [a.id, a]));
  const e = byId(expected);
  const a = byId(actual);
  expect(a.size).toBe(e.size);
  for (const [id, ea] of e) {
    const aa = a.get(id);
    expect(aa, `${label}, id ${id}`).toBeDefined();
    expect(aa?.sx, `${label}, id ${id} sx`).toBeCloseTo(ea.sx, 9);
    expect(aa?.sy, `${label}, id ${id} sy`).toBeCloseTo(ea.sy, 9);
  }
}

/** Unique-id random crowd in a box, so clusters genuinely form and overlap. */
function randomCrowd(
  rng: () => number,
  trial: number,
  box: { width: number; height: number },
  pickLift: () => number,
): NameplateAnchor[] {
  const n = 2 + Math.floor(rng() * 60);
  const anchors: NameplateAnchor[] = [];
  for (let i = 0; i < n; i++)
    anchors.push({
      id: Math.floor(rng() * 100000),
      sx: Math.round(rng() * box.width - (trial % 2 === 0 ? 0 : box.width / 2)),
      sy: Math.round(rng() * box.height - (trial % 2 === 0 ? 0 : box.height / 2)),
      extraLift: pickLift(),
    });
  // ids must be unique (entity ids are)
  const seen = new Set<number>();
  return anchors.filter((anchor) => {
    if (seen.has(anchor.id)) return false;
    seen.add(anchor.id);
    return true;
  });
}

describe('nameplate declutter', () => {
  it('leaves well-separated anchors untouched', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 500, sy: 300 },
    ];
    expect(declutterNameplates(anchors)).toEqual(anchors);
  });

  it('E45: two heraldry plates 25px apart vertically clear at the accepted 28px pitch', () => {
    const anchors: NameplateAnchor[] = [heraldryAnchor(1, 200, 100), heraldryAnchor(2, 200, 125)];
    const out = declutterNameplates(anchors);
    expect(OVERLAP_THRESHOLD_Y_PX).toBe(18);
    expect(STACK_OFFSET_PX).toBe(20);
    expect(Math.abs((out[0]?.sy ?? 0) - (out[1]?.sy ?? 0))).toBe(28);
  });

  it('E45: the left-mounted seal keeps the accepted 95px heraldry reach', () => {
    // The world-heraldry envelope reserves 15px beyond the established 80px
    // label reach, so two rewarded plates at the 95px boundary must stack.
    const heraldryReach = 95;
    const anchors: NameplateAnchor[] = [
      heraldryAnchor(1, 200, 100),
      heraldryAnchor(2, 200 + heraldryReach, 100),
    ];

    const out = declutterNameplates(anchors);

    expect(OVERLAP_THRESHOLD_X_PX).toBe(80);
    expect(Math.abs((out[0]?.sy ?? 0) - (out[1]?.sy ?? 0))).toBe(28);
  });

  it('keeps borderless crowds on the established collision envelope and stack pitch', () => {
    const widePair: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 190, sy: 100 },
    ];
    const tallPair: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 100, sy: 125 },
    ];
    const denseCrowd: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 100, sy: 100 },
      { id: 3, sx: 100, sy: 100 },
    ];

    expect(declutterNameplates(widePair)).toEqual(widePair);
    expect(declutterNameplates(tallPair)).toEqual(tallPair);
    expect(declutterNameplates(denseCrowd).map((anchor) => anchor.sy)).toEqual([80, 100, 120]);
  });

  it.each([
    ['left plate wears heraldry', true, HERALDRY_OVERLAP_X, HERALDRY_OVERLAP_Y, true],
    ['right plate wears heraldry', false, HERALDRY_OVERLAP_X, HERALDRY_OVERLAP_Y, true],
    ['horizontal reach is exceeded', true, HERALDRY_OVERLAP_X + 0.0001, 0, false],
    ['vertical reach is exceeded', false, 0, HERALDRY_OVERLAP_Y + 0.0001, false],
  ])('uses the exact heraldry envelope when the %s', (_label, heraldryLeft, dx, dy, collides) => {
    const left = heraldryLeft ? heraldryAnchor(1, 100, 100) : { id: 1, sx: 100, sy: 100 };
    const right = heraldryLeft
      ? { id: 2, sx: 100 + dx, sy: 100 + dy }
      : heraldryAnchor(2, 100 + dx, 100 + dy);
    const anchors: NameplateAnchor[] = [left, right];

    const out = declutterNameplates(anchors);

    expect(HERALDRY_OVERLAP_THRESHOLD_X_PX).toBe(HERALDRY_OVERLAP_X);
    expect(HERALDRY_OVERLAP_THRESHOLD_Y_PX).toBe(HERALDRY_OVERLAP_Y);
    expect(HERALDRY_STACK_OFFSET_PX).toBe(HERALDRY_STACK);
    expect(out[0].sy !== anchors[0].sy || out[1].sy !== anchors[1].sy).toBe(collides);
    if (collides) expect(Math.abs(out[0].sy - out[1].sy)).toBe(HERALDRY_STACK);
  });

  it('uses the heraldry pitch for a transitive component without widening borderless pairs', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 0, sy: 100 },
      { id: 2, sx: 70, sy: 100 },
      heraldryAnchor(3, 165, 100),
    ];

    const out = declutterNameplates(anchors);

    expect(out.map((anchor) => anchor.sy)).toEqual([72, 100, 128]);
  });

  describe('the dot row lift as a pixel count', () => {
    // Two enemies at one projected anchor, both carrying your dot row. Read as
    // a flag, every lifted plate took the 8px heraldry envelope, so at 300% the
    // pair landed 28px apart under 39px icons (PR 3853 review).
    it.each([
      ['100%', 1, 23, 43, [78.5, 121.5]],
      ['the 150% default', 1.5, 34.5, 54.5, [72.75, 127.25]],
      ['the 300% maximum', 3, 69, 89, [55.5, 144.5]],
    ])(
      'stacks two dotted plates at %s far enough to clear the whole row',
      (_label, scale, lift, pitch, expected) => {
        // the production row height at this scale, and the literal it must be
        expect(nameplateDotRowHeight(1, scale)).toBe(lift);
        const anchors: NameplateAnchor[] = [
          { id: 1, sx: 100, sy: 100, extraLift: lift },
          { id: 2, sx: 100, sy: 100, extraLift: lift },
        ];

        const out = declutterNameplates(anchors);

        expect(out.map((anchor) => anchor.sy)).toEqual(expected);
        expect(out[1].sy - out[0].sy).toBe(pitch);
        expect(pitch).toBe(BASE_STACK + lift);
      },
    );

    it('pins the slider maximum the 300% case stands on', () => {
      expect(NAMEPLATE_DOT_SCALE_MAX).toBe(3);
      expect(nameplateDotRowHeight(1, NAMEPLATE_DOT_SCALE_MAX)).toBe(DOT_ROW_LIFT_MAX);
      expect(nameplateDotRowHeight(1, 1.5)).toBe(DOT_ROW_LIFT_DEFAULT);
    });

    it.each([
      ['the dotted plate is below', false],
      ['the dotted plate is above', true],
    ])('collides across the whole row height when %s', (_label, dottedAbove) => {
      const reach = BASE_OVERLAP_Y + DOT_ROW_LIFT_DEFAULT;
      const dotted = (id: number, sy: number): NameplateAnchor => ({
        id,
        sx: 100,
        sy,
        extraLift: DOT_ROW_LIFT_DEFAULT,
      });
      const pair = (gap: number): NameplateAnchor[] =>
        dottedAbove
          ? [dotted(1, 100), { id: 2, sx: 100, sy: 100 + gap }]
          : [{ id: 1, sx: 100, sy: 100 }, dotted(2, 100 + gap)];

      // at the exact reach the pair stacks at the row's pitch around its mean
      expect(declutterNameplates(pair(reach)).map((anchor) => anchor.sy)).toEqual([99, 153.5]);
      const apart = pair(reach + 0.0001);
      expect(declutterNameplates(apart)).toEqual(apart);
    });

    it('sweeps enough hash cells to find a 300% row five cells below a bare plate', () => {
      // 100 sits in cell 5 and 187 in cell 10: outside the 5x5 heraldry sweep,
      // but exactly 18px plus the 69px row apart, so the pair collides.
      const reach = BASE_OVERLAP_Y + DOT_ROW_LIFT_MAX;
      const bare: NameplateAnchor = { id: 1, sx: 100, sy: 100 };
      const lifted = (dx: number, dy: number): NameplateAnchor => ({
        id: 2,
        sx: 100 + dx,
        sy: 100 + dy,
        extraLift: DOT_ROW_LIFT_MAX,
      });

      expect(declutterNameplates([bare, lifted(0, reach)]).map((a) => a.sy)).toEqual([99, 188]);
      expect(
        declutterNameplates([bare, lifted(HERALDRY_OVERLAP_X, reach)]).map((a) => a.sy),
      ).toEqual([99, 188]);
      const pastSideways = [bare, lifted(HERALDRY_OVERLAP_X + 0.0001, reach)];
      expect(declutterNameplates(pastSideways)).toEqual(pastSideways);
      const pastBelow = [bare, lifted(HERALDRY_OVERLAP_X, reach + 0.0001)];
      expect(declutterNameplates(pastBelow)).toEqual(pastBelow);
    });

    it('widens the vertical neighbour sweep with the tallest live lift', () => {
      const metrics: NameplateDeclutterMetrics = {
        candidateChecks: 0,
        neighborCellProbes: 0,
        spatialHashResizes: 0,
      };
      const far = (lift: number): NameplateAnchor[] => [
        { id: 1, sx: 0, sy: 0, extraLift: lift },
        { id: 2, sx: OVERLAP_THRESHOLD_X_PX * 8, sy: 0 },
      ];

      // 18 + 34.5 = 52.5px of reach spans three 18px cells; 87px spans five;
      // heraldry on a 300% row (95px) spans six. Sideways stays two cells.
      declutterNameplatesInPlace(far(DOT_ROW_LIFT_DEFAULT), 2, metrics);
      expect(metrics.neighborCellProbes).toBe(2 * 5 * 7);
      declutterNameplatesInPlace(far(DOT_ROW_LIFT_MAX), 2, metrics);
      expect(metrics.neighborCellProbes).toBe(2 * 5 * 11);
      declutterNameplatesInPlace(far(HERALDRY_EXTRA_LIFT + DOT_ROW_LIFT_MAX), 2, metrics);
      expect(metrics.neighborCellProbes).toBe(2 * 5 * 13);
    });

    it('fans a mixed component at the pitch its tallest member needs', () => {
      const anchors: NameplateAnchor[] = [
        { id: 1, sx: 0, sy: 100 },
        { id: 2, sx: 70, sy: 100 },
        { id: 3, sx: 165, sy: 100, extraLift: DOT_ROW_LIFT_DEFAULT },
      ];
      expect(declutterNameplates(anchors).map((a) => a.sy)).toEqual([45.5, 100, 154.5]);

      // heraldry and a 300% row on the same plate add up
      const wearer: NameplateAnchor[] = [
        { id: 1, sx: 100, sy: 100, extraLift: HERALDRY_EXTRA_LIFT + DOT_ROW_LIFT_MAX },
        heraldryAnchor(2, 100, 100),
      ];
      expect(declutterNameplates(wearer).map((a) => a.sy)).toEqual([51.5, 148.5]);
    });

    it('reads a non-finite or negative lift as no lift at all', () => {
      // an infinite lift would otherwise make the sweep radius unbounded
      const anchors: NameplateAnchor[] = [
        { id: 1, sx: 100, sy: 100, extraLift: Number.POSITIVE_INFINITY },
        { id: 2, sx: 100, sy: 100, extraLift: Number.NaN },
        { id: 3, sx: 100, sy: 100, extraLift: -5 },
      ];
      expect(declutterNameplates(anchors).map((a) => a.sy)).toEqual([80, 100, 120]);
    });
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
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
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
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
  });

  it('stacks a cluster of 3+ overlapping anchors without unbounded growth', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 300, sy: 200 },
      { id: 2, sx: 301, sy: 200 },
      { id: 3, sx: 299, sy: 201 },
    ];
    const out = declutterNameplates(anchors);
    const ys = out.map((n) => n.sy).sort((x, y) => x - y);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
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
    expect(out.map((anchor) => anchor.sy)).toEqual([
      100 - STACK_OFFSET_PX,
      100,
      100 + STACK_OFFSET_PX,
    ]);
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
    expect(Math.abs(out[0].sy - out[1].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
  });

  it('matches the O(N^2) reference on dense random crowds', () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 60; trial++) {
      // a tight screen box, so clusters genuinely form and overlap
      const crowd = randomCrowd(rng, trial, { width: 400, height: 90 }, () =>
        rng() < 0.35 ? HERALDRY_EXTRA_LIFT : 0,
      );
      expectHotPathMatchesReference(crowd, `trial ${trial}`);
    }
  });

  it('matches the O(N^2) reference on dense crowds carrying dot rows and heraldry', () => {
    // Every lift the painter can produce, mixed at random: the taller-lift
    // rule, the lifted reach edges and the widened sweep all have to agree
    // with the oracle on the same crowd, including a plate wearing both.
    const rng = makeRng(0xd07);
    const lifts = [
      0,
      0,
      HERALDRY_EXTRA_LIFT,
      DOT_ROW_LIFT_DEFAULT,
      DOT_ROW_LIFT_MAX,
      HERALDRY_EXTRA_LIFT + DOT_ROW_LIFT_MAX,
    ];
    for (let trial = 0; trial < 60; trial++) {
      // taller than the heraldry box, so a 300% row does not merge everything
      const crowd = randomCrowd(
        rng,
        trial,
        { width: 400, height: 400 },
        () => lifts[Math.floor(rng() * lifts.length)],
      );
      expectHotPathMatchesReference(crowd, `mixed trial ${trial}`);
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
    expect(Math.abs(actual[0].sy - actual[1].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
  });

  it.each([
    [
      'inclusive horizontal threshold',
      { sx: 0, sy: 0 },
      { sx: OVERLAP_THRESHOLD_X_PX, sy: 0 },
      true,
    ],
    [
      'outside horizontal threshold',
      { sx: 0, sy: 0 },
      { sx: OVERLAP_THRESHOLD_X_PX + 0.0001, sy: 0 },
      false,
    ],
    ['inclusive vertical threshold', { sx: 0, sy: 0 }, { sx: 0, sy: OVERLAP_THRESHOLD_Y_PX }, true],
    [
      'outside vertical threshold',
      { sx: 0, sy: 0 },
      { sx: 0, sy: OVERLAP_THRESHOLD_Y_PX + 0.0001 },
      false,
    ],
    [
      'inclusive diagonal threshold',
      { sx: 0, sy: 0 },
      { sx: OVERLAP_THRESHOLD_X_PX, sy: OVERLAP_THRESHOLD_Y_PX },
      true,
    ],
    [
      'inclusive opposite diagonal',
      { sx: 0, sy: OVERLAP_THRESHOLD_Y_PX },
      { sx: OVERLAP_THRESHOLD_X_PX, sy: 0 },
      true,
    ],
    [
      'negative to positive cell boundary',
      { sx: -OVERLAP_THRESHOLD_X_PX / 2, sy: 0 },
      { sx: OVERLAP_THRESHOLD_X_PX / 2, sy: 0 },
      true,
    ],
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
    expect(Math.abs(actual[0].sy - actual[1].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
    expect(actual[2].sy).toBe(-3e6); // untouched
    expect(actual[3].sy).toBe(500); // untouched
  });

  it('keeps sparse far projections linear instead of collapsing them into one edge bucket', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: 5e6 + i * 1_000, sy: 1e6 + i * 1_000 });
    }
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };
    declutterNameplatesInPlace(anchors, anchors.length, metrics);
    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it('keeps a long transitive chain local to nearby hash cells', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: i * 70, sy: 100 });
    }
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors[1].sy - anchors[0].sy).toBe(STACK_OFFSET_PX);
    expect(anchors[anchors.length - 1].sy - anchors[anchors.length - 2].sy).toBe(STACK_OFFSET_PX);
    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 8);
  });

  it('widens the neighbour sweep only when a live anchor wears heraldry', () => {
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 123,
      spatialHashResizes: 123,
      neighborCellProbes: 123,
    };

    declutterNameplatesInPlace([], 0, metrics);

    expect(metrics).toEqual({
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    });

    const borderless: NameplateAnchor[] = [
      { id: 1, sx: 0, sy: 0 },
      { id: 2, sx: OVERLAP_THRESHOLD_X_PX * 4, sy: 0 },
    ];

    declutterNameplatesInPlace(borderless, borderless.length, metrics);

    expect(metrics.neighborCellProbes).toBe(borderless.length * 9);

    const mixed = [heraldryAnchor(1, 0, 0), { id: 2, sx: OVERLAP_THRESHOLD_X_PX * 4, sy: 0 }];

    declutterNameplatesInPlace(mixed, mixed.length, metrics);

    expect(metrics.neighborCellProbes).toBe(mixed.length * 25);
  });

  it('keeps the heraldry-only diagonal scan linear in a large mixed chain', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      const anchor = { id: i, sx: i * 90, sy: i * 24 };
      anchors.push(i % 2 === 0 ? heraldryAnchor(anchor.id, anchor.sx, anchor.sy) : anchor);
    }
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors[1].sy - anchors[0].sy).toBe(HERALDRY_STACK);
    expect(anchors[anchors.length - 1].sy - anchors[anchors.length - 2].sy).toBe(HERALDRY_STACK);
    expect(metrics.candidateChecks).toBeLessThan(anchors.length * 12);
  });

  it('does not rescan a dense collision bucket for every component member', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: i, sx: 100, sy: 100 });
    }
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(anchors[1].sy - anchors[0].sy).toBe(STACK_OFFSET_PX);
    expect(anchors[anchors.length - 1].sy - anchors[anchors.length - 2].sy).toBe(STACK_OFFSET_PX);
    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it('does not repeatedly scan a dense non-overlapping neighbour bucket', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 4_000; i++) anchors.push({ id: i, sx: 0, sy: 100 });
    for (let i = 0; i < 4_000; i++) {
      anchors.push({ id: 4_000 + i, sx: OVERLAP_THRESHOLD_X_PX * 2 - 1, sy: 100 });
    }
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    expect(metrics.candidateChecks).toBe(anchors.length);
  });

  it.each([
    [
      'left cell below right',
      { sx: OVERLAP_THRESHOLD_X_PX - 1, sy: 0 },
      { sx: 0, sy: OVERLAP_THRESHOLD_Y_PX - 1 },
      {
        sx: (OVERLAP_THRESHOLD_X_PX - 1) * 2,
        sy: (OVERLAP_THRESHOLD_Y_PX - 1) * 2,
      },
    ],
    [
      'left cell above right',
      {
        sx: OVERLAP_THRESHOLD_X_PX - 1,
        sy: (OVERLAP_THRESHOLD_Y_PX - 1) * 2 + 1,
      },
      { sx: 0, sy: OVERLAP_THRESHOLD_Y_PX },
      { sx: (OVERLAP_THRESHOLD_X_PX - 1) * 2, sy: 0 },
    ],
  ])(
    'rejects dense diagonal neighbour buckets without a false merge when the %s',
    (_label, leftXBound, leftYBound, right) => {
      const anchors: NameplateAnchor[] = [];
      for (let i = 0; i < 2_000; i++) anchors.push({ id: i, ...leftXBound });
      for (let i = 0; i < 2_000; i++) anchors.push({ id: 2_000 + i, ...leftYBound });
      for (let i = 0; i < 4_000; i++) anchors.push({ id: 4_000 + i, ...right });
      const metrics: NameplateDeclutterMetrics = {
        candidateChecks: 0,
        neighborCellProbes: 0,
        spatialHashResizes: 0,
      };

      declutterNameplatesInPlace(anchors, anchors.length, metrics);

      const leftBaseSy = (leftXBound.sy + leftYBound.sy) / 2;
      const componentMid = (4_000 - 1) / 2;
      expect(anchors[0].sy).toBe(leftBaseSy - componentMid * STACK_OFFSET_PX);
      expect(anchors[3_999].sy).toBe(leftBaseSy + componentMid * STACK_OFFSET_PX);
      expect(anchors[4_000].sy).toBe(right.sy - componentMid * STACK_OFFSET_PX);
      expect(anchors[7_999].sy).toBe(right.sy + componentMid * STACK_OFFSET_PX);
      expect(metrics.candidateChecks).toBeLessThan(anchors.length * 2);
    },
  );

  it('does not resize typed spatial buffers after their high-water capacity is warm', () => {
    const anchors: NameplateAnchor[] = [];
    for (let i = 0; i < 10_000; i++) {
      anchors.push({ id: i, sx: i * 1_000, sy: i * 1_000 });
    }
    const metrics = { candidateChecks: 0, neighborCellProbes: 0, spatialHashResizes: -1 };
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
    const farX = OVERLAP_THRESHOLD_X_PX * (Number.MAX_SAFE_INTEGER + 1);
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: farX, sy: 100 },
      { id: 2, sx: -farX, sy: 500 },
    ];
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

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
      { id: 1, sx: 70, sy: 2 ** 57 + 128 },
      { id: 2, sx: 100, sy: 2 ** 57 + 256 },
    ],
    [
      'left cell above right',
      { id: 1, sx: 70, sy: 2 ** 57 + 256 },
      { id: 2, sx: 100, sy: 2 ** 57 + 128 },
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

    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
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
    const metrics: NameplateDeclutterMetrics = {
      candidateChecks: 0,
      neighborCellProbes: 0,
      spatialHashResizes: 0,
    };

    declutterNameplatesInPlace(anchors, anchors.length, metrics);

    for (let i = 0; i < invalidBefore.length; i++) {
      expect(Object.is(anchors[i].sx, invalidBefore[i].sx)).toBe(true);
      expect(Object.is(anchors[i].sy, invalidBefore[i].sy)).toBe(true);
    }
    expect(Math.abs(anchors[6].sy - anchors[7].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
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
    expect(Math.abs(anchors[0].sy - anchors[1].sy)).toBeGreaterThanOrEqual(STACK_OFFSET_PX);
  });
});
