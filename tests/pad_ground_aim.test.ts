import { describe, expect, it } from 'vitest';
import { nextSnapPoint, reticleStickDelta } from '../src/game/pad_ground_aim';

describe('reticleStickDelta', () => {
  it('uses the camera-relative basis at yaw zero', () => {
    const distance = (24 / 1.2) * 0.5;
    const up = reticleStickDelta(0, -1, 0, 0.5, 24, 1);
    const right = reticleStickDelta(1, 0, 0, 0.5, 24, 1);

    expect(up.dx).toBeCloseTo(Math.sin(0) * distance);
    expect(up.dz).toBeCloseTo(Math.cos(0) * distance);
    expect(right.dx).toBeCloseTo(-Math.cos(0) * distance);
    expect(right.dz).toBeCloseTo(Math.sin(0) * distance);
  });

  it('uses the camera-relative basis at yaw PI over two', () => {
    const yaw = Math.PI / 2;
    const distance = (24 / 1.2) * 0.5;
    const up = reticleStickDelta(0, -1, yaw, 0.5, 24, 1);
    const right = reticleStickDelta(1, 0, yaw, 0.5, 24, 1);

    expect(up.dx).toBeCloseTo(Math.sin(yaw) * distance);
    expect(up.dz).toBeCloseTo(Math.cos(yaw) * distance);
    expect(right.dx).toBeCloseTo(-Math.cos(yaw) * distance);
    expect(right.dz).toBeCloseTo(Math.sin(yaw) * distance);
  });

  it('scales linearly with frame time', () => {
    const short = reticleStickDelta(0.4, -0.8, 0.7, 0.01, 30, 1);
    const long = reticleStickDelta(0.4, -0.8, 0.7, 0.02, 30, 1);

    expect(long.dx).toBeCloseTo(short.dx * 2);
    expect(long.dz).toBeCloseTo(short.dz * 2);
  });

  it('scales linearly with sensitivity and uses the fallback range', () => {
    const normal = reticleStickDelta(0, -1, 0, 1.2, 0, 1);
    const fast = reticleStickDelta(0, -1, 0, 1.2, 0, 2);

    expect(normal).toEqual({ dx: 0, dz: 5 });
    expect(fast).toEqual({ dx: 0, dz: 10 });
  });
});

describe('nextSnapPoint', () => {
  const caster = { x: 0, z: 0 };
  const eastNear = { x: 2, z: 0 };
  const eastFar = { x: 4, z: 0 };
  const north = { x: 0, z: 3 };
  const west = { x: -3, z: 0 };
  const south = { x: 0, z: -3 };
  const candidates = [north, eastFar, south, west, eastNear];

  it('cycles by angle with distance breaking equal-angle ties', () => {
    expect(nextSnapPoint(caster, candidates, south, 1)).toEqual(eastNear);
    expect(nextSnapPoint(caster, candidates, eastNear, 1)).toEqual(eastFar);
    expect(nextSnapPoint(caster, candidates, eastFar, 1)).toEqual(north);
  });

  it('chooses the candidate nearest to the current point before stepping', () => {
    expect(nextSnapPoint(caster, candidates, { x: 3.8, z: 0.1 }, -1)).toEqual(eastNear);
  });

  it('wraps in both directions', () => {
    expect(nextSnapPoint(caster, candidates, west, 1)).toEqual(south);
    expect(nextSnapPoint(caster, candidates, south, -1)).toEqual(west);
  });

  it('starts at the corresponding edge when there is no current point', () => {
    expect(nextSnapPoint(caster, candidates, null, 1)).toEqual(south);
    expect(nextSnapPoint(caster, candidates, null, -1)).toEqual(west);
  });

  it('returns null when there are no candidates', () => {
    expect(nextSnapPoint(caster, [], null, 1)).toBeNull();
  });
});
