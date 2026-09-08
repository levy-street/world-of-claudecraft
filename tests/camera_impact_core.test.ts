import { describe, expect, it } from 'vitest';
import { CameraImpact } from '../src/render/camera_impact_core';

const camera = () => ({ position: { x: 0, y: 3, z: 10 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
describe('directional camera impact', () => {
  it('responds away from the hit and restores the exact camera pose', () => {
    const c = camera(),
      a = new CameraImpact();
    a.add(0.4, c.position, 4, 0, 10);
    const before = { ...c.position };
    a.beginDraw(c, 1 / 60, false);
    expect(c.position.x).toBeLessThan(0);
    a.endDraw(c);
    expect(c.position).toEqual(before);
  });
  it('caps overlaps and settles without accumulating drift', () => {
    const c = camera(),
      a = new CameraImpact(),
      before = { ...c.position };
    for (let i = 0; i < 100; i++) a.add(1, c.position, -10, 0, 0);
    for (let i = 0; i < 240; i++) {
      a.beginDraw(c, 1 / 60, false);
      expect(Math.hypot(c.position.x, c.position.y - 3, c.position.z - 10)).toBeLessThan(0.3);
      a.endDraw(c);
    }
    expect(c.position.x).toBeCloseTo(before.x, 12);
    expect(c.position.z).toBeCloseTo(before.z, 12);
    expect(a.beginDraw(c, 1 / 60, false)).toBe(false);
  });
  it('clears in-flight motion immediately when opted out', () => {
    const c = camera(),
      a = new CameraImpact();
    a.add(0.5, c.position, 1, 0, 0);
    expect(a.beginDraw(c, 0.016, true)).toBe(false);
    expect(a.beginDraw(c, 0.016, false)).toBe(false);
    a.add(NaN, c.position);
    expect(a.beginDraw(c, NaN, false)).toBe(false);
  });
});
