import { describe, expect, it } from 'vitest';
import { portraitFrameParams } from '../src/render/characters/portrait_framing';

describe('portraitFrameParams', () => {
  it('defaults to a tight head-and-shoulders crop for headshot framing', () => {
    const p = portraitFrameParams('headshot');
    expect(p.fov).toBe(26);
    expect(p.extentFrac).toBeCloseTo(0.44, 5);
  });

  it('body framing uses a wider, normal lens and shows most of the figure', () => {
    const p = portraitFrameParams('body');
    expect(p.fov).toBe(45);
    expect(p.extentFrac).toBeCloseTo(1.15, 5);
  });

  it('body framing shows strictly more of the model height than headshot (the fix: no more helmet-only crop)', () => {
    const headshot = portraitFrameParams('headshot');
    const body = portraitFrameParams('body');
    expect(body.extentFrac).toBeGreaterThan(headshot.extentFrac);
    // Headshot looks near the top of the figure; body looks at mid-height.
    expect(body.targetYFromFeetFrac).toBeLessThan(headshot.targetYFromFeetFrac);
  });
});
