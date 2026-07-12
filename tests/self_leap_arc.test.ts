import { describe, expect, it } from 'vitest';
import { advanceSelfLeapArc, createSelfLeapArc } from '../src/render/self_leap_arc';

describe('self leap arc', () => {
  it('starts a render arc for leap-sized ground displacements', () => {
    const arc = createSelfLeapArc({ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 });
    expect(arc).toBeTruthy();
    expect(arc?.duration).toBeGreaterThan(0.42);
    expect(arc?.apexHeight).toBeGreaterThan(1.2);
  });

  it('rejects tiny hops and teleport-like jumps', () => {
    expect(createSelfLeapArc({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBeNull();
    expect(createSelfLeapArc({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 })).toBeNull();
    expect(createSelfLeapArc({ x: 0, y: 0, z: 0 }, { x: 8, y: 5, z: 0 })).toBeNull();
  });

  it('follows a parabola and lands exactly on the target', () => {
    let arc = createSelfLeapArc({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(arc).toBeTruthy();
    const mid = advanceSelfLeapArc(arc!, arc!.duration / 2);
    expect(mid.done).toBe(false);
    expect(mid.point.x).toBeCloseTo(5);
    expect(mid.point.y).toBeGreaterThan(0.8);
    arc = mid.arc;
    const end = advanceSelfLeapArc(arc, arc.duration);
    expect(end.done).toBe(true);
    expect(end.point).toEqual({ x: 10, y: 0, z: 0 });
  });
});
