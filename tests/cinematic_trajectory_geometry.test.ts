import { describe, expect, it } from 'vitest';
import {
  pointDistance,
  signedRectDistance,
  worldToLocal,
} from '../scripts/lib/cinematic_trajectory_geometry.mjs';

describe('cinematic trajectory geometry', () => {
  const rect = { x: 0, z: 0, hw: 5, hd: 3 };

  it('uses the maximum negative component for an inside point', () => {
    expect(signedRectDistance({ x: 1, z: 2 }, rect)).toBe(-1);
  });

  it('measures an axis-adjacent outside point', () => {
    expect(signedRectDistance({ x: 8, z: 1 }, rect)).toBe(3);
  });

  it('measures a diagonal outside point', () => {
    expect(signedRectDistance({ x: 8, z: 7 }, rect)).toBe(5);
  });

  it('measures point distance on a 3-4-5 triple', () => {
    expect(pointDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it('converts a translated world point through frame yaw', () => {
    const local = worldToLocal(
      { position: { x: 10, y: 5, z: -4 }, yaw: Math.PI / 2 },
      { x: 12, y: 8, z: -7 },
    );

    expect(local.x).toBeCloseTo(3);
    expect(local.y).toBe(3);
    expect(local.z).toBeCloseTo(2);
  });
});
