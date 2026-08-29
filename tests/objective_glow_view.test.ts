// The off-screen edge glow: whether the cue shows at all, and which edge.
//
// Two things this exists to stop, both CX reports against the first cut:
// the bloom appearing while the objective was plainly VISIBLE, and the bloom
// appearing on the WRONG edge. The first version keyed on a bearing dead
// zone, which is not the same question as "did this land on screen", and
// measured left/right against the compass rose rather than the camera.

import { describe, expect, it } from 'vitest';
import {
  FULL_INTENSITY_FRAC,
  OFFSCREEN_MARGIN_PX,
  objectiveGlowFromScreen,
  uiLessonGlow,
} from '../src/ui/objective_glow_view';

const VIEW = { width: 1600, height: 900 };
const at = (x: number, behind = false) => ({ x, y: VIEW.height / 2, behind });

describe('objectiveGlowFromScreen: when it shows at all', () => {
  it('stays SILENT for anything on screen', () => {
    // The headline CX complaint: it lit up with the objective in full view.
    for (const x of [0, 1, 400, VIEW.width / 2, VIEW.width - 1, VIEW.width]) {
      expect(objectiveGlowFromScreen(at(x), VIEW), `x=${x}`).toBeNull();
    }
  });

  it('stays silent inside the edge margin, so it cannot flicker', () => {
    expect(objectiveGlowFromScreen(at(-OFFSCREEN_MARGIN_PX + 1), VIEW)).toBeNull();
    expect(objectiveGlowFromScreen(at(VIEW.width + OFFSCREEN_MARGIN_PX - 1), VIEW)).toBeNull();
  });

  it('shows once the objective is genuinely past the edge', () => {
    expect(objectiveGlowFromScreen(at(-OFFSCREEN_MARGIN_PX - 40), VIEW)).not.toBeNull();
    expect(objectiveGlowFromScreen(at(VIEW.width + OFFSCREEN_MARGIN_PX + 40), VIEW)).not.toBeNull();
  });
});

describe('objectiveGlowFromScreen: which edge', () => {
  it('blooms the LEFT edge for an objective off the left', () => {
    expect(objectiveGlowFromScreen(at(-300), VIEW)?.side).toBe('left');
  });

  it('blooms the RIGHT edge for an objective off the right', () => {
    expect(objectiveGlowFromScreen(at(VIEW.width + 300), VIEW)?.side).toBe('right');
  });

  it('answers BEHIND, never a side, for a point behind the camera', () => {
    // CX round 10: "it's still not working when it is behind my character,
    // it sticks to left and right side". A behind-camera point projects to a
    // MIRRORED x, so any left/right read of it is a guess on a meaningless
    // value, and it also insists on one turn direction when either is
    // correct. Behind is its own answer (both edges bloom), so the raw x
    // cannot steer it at all.
    for (const x of [-500, 10, VIEW.width / 2, VIEW.width - 10, VIEW.width + 500]) {
      expect(objectiveGlowFromScreen(at(x, true), VIEW)?.side, `x=${x}`).toBe('behind');
    }
  });

  it('is always full strength when behind, wherever the mirrored x lands', () => {
    expect(objectiveGlowFromScreen(at(10, true), VIEW)?.intensity).toBe(1);
    expect(objectiveGlowFromScreen(at(VIEW.width - 10, true), VIEW)?.intensity).toBe(1);
  });

  it('still answers behind when the mirrored x would have read as ON screen', () => {
    // The silent half of the same bug: a behind-camera point often projects
    // to an x inside the viewport, which the on-screen guard would swallow,
    // leaving a player facing exactly backwards with no cue at all.
    expect(objectiveGlowFromScreen(at(VIEW.width / 2, true), VIEW)).not.toBeNull();
  });
});

describe('objectiveGlowFromScreen: how hard', () => {
  it('ramps from nothing at the edge to full further out', () => {
    const justPast = objectiveGlowFromScreen(at(-OFFSCREEN_MARGIN_PX - 2), VIEW)!;
    expect(justPast.intensity).toBeGreaterThan(0);
    expect(justPast.intensity).toBeLessThan(0.05);
    const full = VIEW.width * FULL_INTENSITY_FRAC;
    expect(objectiveGlowFromScreen(at(-OFFSCREEN_MARGIN_PX - full), VIEW)!.intensity).toBe(1);
  });

  it('never exceeds 1, however far off screen', () => {
    expect(objectiveGlowFromScreen(at(-99_999), VIEW)!.intensity).toBeLessThanOrEqual(1);
    expect(objectiveGlowFromScreen(at(99_999), VIEW)!.intensity).toBeLessThanOrEqual(1);
  });

  it('is symmetric: the same distance either side glows equally hard', () => {
    const left = objectiveGlowFromScreen(at(-400), VIEW)!;
    const right = objectiveGlowFromScreen(at(VIEW.width + 400), VIEW)!;
    expect(left.side).toBe('left');
    expect(right.side).toBe('right');
    expect(left.intensity).toBeCloseTo(right.intensity, 10);
  });

  it('refuses a non-finite projection rather than painting a NaN edge', () => {
    expect(objectiveGlowFromScreen(at(Number.NaN), VIEW)).toBeNull();
    expect(objectiveGlowFromScreen(at(0), { width: 0, height: 0 })).toBeNull();
  });
});

describe('uiLessonGlow', () => {
  it('blooms the bottom at full strength, where the bag buttons live', () => {
    expect(uiLessonGlow()).toEqual({ side: 'bottom', intensity: 1 });
  });
});
