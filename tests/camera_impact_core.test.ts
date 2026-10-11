import { describe, expect, it } from 'vitest';
import { CameraImpact, fiestaShakeX, fiestaShakeY } from '../src/render/camera_impact_core';

const camera = () => ({ position: { x: 0, y: 3, z: 10 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
describe('directional camera impact', () => {
  it.each([30, 60, 120])('draws one shove and two smaller returns at %s Hz', (hz) => {
    const c = camera(),
      a = new CameraImpact();
    a.add(0.4, c.position, -10, 3, 10, true);
    const offsets: number[] = [];
    for (let i = 0; i < hz / 3; i++) {
      a.beginDraw(c, 1 / hz, false);
      offsets.push(c.position.x);
      a.endDraw(c);
      expect(c.position.x).toBeCloseTo(0, 12);
      expect(c.position.y).toBeCloseTo(3, 12);
      expect(c.position.z).toBe(10);
    }
    expect(offsets[0]).toBeCloseTo(0.168);
    const negative = offsets.filter((v) => v < 0);
    const lastReturn = offsets.filter((v, i) => i / hz > 0.108 && v > 0);
    expect(negative.length).toBeGreaterThan(0);
    expect(lastReturn.length).toBeGreaterThan(0);
    expect(Math.max(...lastReturn)).toBeLessThan(-Math.min(...negative));
    expect(-Math.min(...negative)).toBeLessThan(offsets[0] * 0.4);
    expect(offsets.at(-1)).toBe(0);
  });
  it('keeps crunch direction independent of another impact and cancels all pending returns', () => {
    const c = camera(),
      a = new CameraImpact();
    a.add(0.4, c.position, -10, 3, 10, true);
    a.add(0.1, c.position, 10, 3, 10);
    a.beginDraw(c, 0, false);
    expect(c.position.x).toBeCloseTo(0.168 - 0.024);
    a.endDraw(c);
    a.clear();
    expect(a.beginDraw(c, 0.08, false)).toBe(false);
    for (let i = 0; i < 100; i++) a.add(1, c.position, -10, 3, 10, true);
    a.beginDraw(c, 0.016, false);
    expect(Math.abs(c.position.x)).toBeLessThanOrEqual(0.18);
    a.endDraw(c);
    expect(a.beginDraw(c, 0.016, true)).toBe(false);
    expect(a.beginDraw(c, 0.016, false)).toBe(false);
  });
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

describe('fiesta screen shake offsets', () => {
  it('squares the trauma and jitters on two incommensurate 60 Hz sines', () => {
    // trauma 0.5 -> intensity 0.25; elapsed 0.01 s -> t = 0.6
    expect(fiestaShakeX(0.5, 0.01)).toBeCloseTo(Math.sin(1.02) * 0.25 * 0.6, 12);
    expect(fiestaShakeY(0.5, 0.01)).toBeCloseTo(Math.sin(1.38 + 1.1) * 0.25 * 0.45, 12);
    // a tiny add barely registers: the square is what keeps small trauma quiet
    expect(Math.abs(fiestaShakeX(0.1, 0.01))).toBeLessThan(Math.abs(fiestaShakeX(0.5, 0.01)) / 20);
    expect(fiestaShakeX(0, 3)).toBeCloseTo(0, 12);
    expect(fiestaShakeY(0, 3)).toBeCloseTo(0, 12);
  });
});
