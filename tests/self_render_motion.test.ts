import { describe, expect, it } from 'vitest';
import {
  selfRenderBlend,
  selfSnapshotAlpha,
  selfSnapshotPositionInto,
  stepSelfRenderPositionInto,
} from '../src/render/self_render_motion';

describe('self render motion', () => {
  it('adds local visual lead while capping extrapolation', () => {
    expect(selfSnapshotAlpha(0.4, 0.28)).toBeCloseTo(0.68);
    expect(selfSnapshotAlpha(1.1, 0.65)).toBe(1.25);
    expect(selfSnapshotAlpha(0.5, -1)).toBe(0.5);
  });

  it('samples raw snapshot positions without the render smoothing step', () => {
    const out = selfSnapshotPositionInto({ x: 10, y: 1, z: -5 }, { x: 14, y: 3, z: 3 }, 0.5, 0.25, {
      x: 0,
      y: 0,
      z: 0,
    });

    expect(out).toEqual({ x: 13, y: 2.5, z: 1 });
  });

  it('uses an exponential blend so smoothing is frame-rate independent', () => {
    const fastFrame = selfRenderBlend(1 / 120);
    const slowFrame = selfRenderBlend(1 / 30);

    expect(fastFrame).toBeGreaterThan(0);
    expect(fastFrame).toBeLessThan(slowFrame);
    expect(slowFrame).toBeLessThan(1);
  });

  it('seeds immediately before smoothing toward later targets', () => {
    const seeded = stepSelfRenderPositionInto({ x: 0, y: 0, z: 0 }, 5, 1, -2, false, 1 / 60, {
      x: 0,
      y: 0,
      z: 0,
    });
    expect(seeded).toEqual({ x: 5, y: 1, z: -2 });

    const next = stepSelfRenderPositionInto(seeded, 6, 1, -2, true, 1 / 60, {
      x: seeded.x,
      y: seeded.y,
      z: seeded.z,
    });
    expect(next.x).toBeGreaterThan(5);
    expect(next.x).toBeLessThan(6);
    expect(next.y).toBe(1);
    expect(next.z).toBe(-2);
  });

  it('snaps large corrections instead of easing teleports', () => {
    const next = stepSelfRenderPositionInto(
      { x: 0, y: 0, z: 0 },
      20,
      0,
      0,
      true,
      1 / 60,
      { x: 0, y: 0, z: 0 },
      undefined,
      9,
    );

    expect(next).toEqual({ x: 20, y: 0, z: 0 });
  });
});
