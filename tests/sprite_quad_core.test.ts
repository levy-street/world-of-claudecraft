import { describe, expect, it } from 'vitest';
import {
  POINT_SIZE_RANGE_FALLBACK,
  POOLED_CLOUD_MAX_POINT_PX,
  pooledCloudPointSize,
  rasterizedPointSize,
  SPRITE_QUAD_CORNERS,
  SPRITE_QUAD_INDEX,
  spriteQuadHalfExtent,
  spriteQuadPixelSize,
  spriteQuadPointCoord,
  viewportPointScale,
  weaponCloudPointSize,
} from '../src/render/sprite_quad_core';

// The renderer's world camera and the weapon inspector rig, at the viewport
// heights a desktop, a laptop and a phone render at.
const WORLD_FOV = 60;
const RIG_FOV = 35;
const HEIGHTS = [720, 1080, 1440, 390];
const DEPTHS = [0.05, 0.15, 0.5, 1, 2.5, 8, 30, 120];

/** Window pixels the point sprite covers: the formula, then the driver clamp. */
function pointSpritePixels(pointSize: number): number {
  return rasterizedPointSize(pointSize, POINT_SIZE_RANGE_FALLBACK);
}

/** Window pixels the quad covers, read back from its projected half extent. */
function quadPixels(pointSize: number, depth: number, scale: number): number {
  const half = spriteQuadHalfExtent(pointSpritePixels(pointSize), depth, scale);
  return spriteQuadPixelSize(half, depth, scale);
}

describe('sprite quad size parity', () => {
  it('uScale is the device pixels per world unit at depth one', () => {
    // 720 px over a 60 degree vertical fov: half the height over tan(30).
    expect(viewportPointScale(720, WORLD_FOV)).toBeCloseTo(360 / Math.tan(Math.PI / 6), 9);
    expect(viewportPointScale(1080, RIG_FOV)).toBeCloseTo(540 / Math.tan((35 * Math.PI) / 360), 9);
  });

  it('the pooled cloud quad spans the same pixels as its point at every depth and height', () => {
    for (const height of HEIGHTS) {
      const scale = viewportPointScale(height, WORLD_FOV);
      for (const depth of DEPTHS) {
        for (const size of [0.08, 0.35, 1.2, 4]) {
          const point = pooledCloudPointSize(size, scale, depth);
          expect(quadPixels(point, depth, scale)).toBeCloseTo(pointSpritePixels(point), 6);
        }
      }
    }
  });

  it('the weapon cloud quad spans the same pixels as its point at every depth and height', () => {
    for (const height of HEIGHTS) {
      const scale = viewportPointScale(height, RIG_FOV);
      for (const depth of DEPTHS) {
        for (const size of [0.012, 0.05, 0.2]) {
          const point = weaponCloudPointSize(size, scale, depth);
          expect(quadPixels(point, depth, scale)).toBeCloseTo(pointSpritePixels(point), 6);
        }
      }
    }
  });

  it('the pooled formula attenuates with depth, floors at one unit and caps at 110 px', () => {
    const scale = viewportPointScale(1080, WORLD_FOV);
    const near = pooledCloudPointSize(0.05, scale, 2);
    const far = pooledCloudPointSize(0.05, scale, 20);
    expect(near).toBeLessThan(POOLED_CLOUD_MAX_POINT_PX);
    expect(far).toBeCloseTo(near / 10, 9);
    // nearer than the floor the point stops growing
    expect(pooledCloudPointSize(0.02, scale, 0.3)).toBe(pooledCloudPointSize(0.02, scale, 1));
    // a large particle near the camera hits the cloud's own cap
    expect(pooledCloudPointSize(4, scale, 1)).toBe(POOLED_CLOUD_MAX_POINT_PX);
    expect(pooledCloudPointSize(-1, scale, 1)).toBe(0);
  });

  it('the weapon formula floors the depth at 0.15 and never caps on its own', () => {
    const scale = viewportPointScale(1080, RIG_FOV);
    expect(weaponCloudPointSize(0.05, scale, 0.05)).toBe(weaponCloudPointSize(0.05, scale, 0.15));
    expect(weaponCloudPointSize(0.05, scale, 0.3)).toBeCloseTo(
      weaponCloudPointSize(0.05, scale, 0.15) / 2,
      9,
    );
    expect(weaponCloudPointSize(1, scale, 0.15)).toBeGreaterThan(POINT_SIZE_RANGE_FALLBACK.max);
  });

  it('reproduces the driver clamp at both ends of the point size range', () => {
    const range = { min: 1, max: 1024 };
    // a huge weapon mote right against the lens rasterizes at the driver cap
    expect(rasterizedPointSize(5000, range)).toBe(1024);
    // a distant speck still lights one pixel
    expect(rasterizedPointSize(0.2, range)).toBe(1);
    expect(rasterizedPointSize(0, range)).toBe(1);
    expect(rasterizedPointSize(300, range)).toBe(300);
    // the quad honours the clamped size, not the formula's
    const scale = viewportPointScale(1080, RIG_FOV);
    const clampedHalf = spriteQuadHalfExtent(rasterizedPointSize(5000, range), 0.15, scale);
    expect(spriteQuadPixelSize(clampedHalf, 0.15, scale)).toBeCloseTo(1024, 6);
    const speckHalf = spriteQuadHalfExtent(rasterizedPointSize(0.2, range), 120, scale);
    expect(spriteQuadPixelSize(speckHalf, 120, scale)).toBeCloseTo(1, 6);
    // a wider desktop GL range lets the same mote grow past the D3D11 cap
    expect(rasterizedPointSize(1500, { min: 1, max: 2047 })).toBe(1500);
  });

  it('degrades to a zero extent on a degenerate scale or depth instead of NaN', () => {
    expect(spriteQuadHalfExtent(10, 5, 0)).toBe(0);
    expect(spriteQuadHalfExtent(10, 5, Number.NaN)).toBe(0);
    expect(spriteQuadPixelSize(1, 0, 600)).toBe(0);
    expect(spriteQuadPixelSize(1, -2, 600)).toBe(0);
  });

  it('maps the quad corners onto gl_PointCoord with t growing downward', () => {
    expect(spriteQuadPointCoord(-1, -1)).toEqual([0, 1]);
    expect(spriteQuadPointCoord(1, -1)).toEqual([1, 1]);
    expect(spriteQuadPointCoord(1, 1)).toEqual([1, 0]);
    expect(spriteQuadPointCoord(-1, 1)).toEqual([0, 0]);
    expect(spriteQuadPointCoord(0, 0)).toEqual([0.5, 0.5]);
  });

  it('describes one counter-clockwise quad of two triangles', () => {
    expect(SPRITE_QUAD_CORNERS).toEqual([-1, -1, 1, -1, 1, 1, -1, 1]);
    expect(SPRITE_QUAD_INDEX).toEqual([0, 1, 2, 0, 2, 3]);
    // both triangles wind the same way (positive signed area)
    const area = (a: number, b: number, c: number): number => {
      const [ax, ay] = [SPRITE_QUAD_CORNERS[a * 2], SPRITE_QUAD_CORNERS[a * 2 + 1]];
      const [bx, by] = [SPRITE_QUAD_CORNERS[b * 2], SPRITE_QUAD_CORNERS[b * 2 + 1]];
      const [cx, cy] = [SPRITE_QUAD_CORNERS[c * 2], SPRITE_QUAD_CORNERS[c * 2 + 1]];
      return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };
    expect(area(SPRITE_QUAD_INDEX[0], SPRITE_QUAD_INDEX[1], SPRITE_QUAD_INDEX[2])).toBeGreaterThan(
      0,
    );
    expect(area(SPRITE_QUAD_INDEX[3], SPRITE_QUAD_INDEX[4], SPRITE_QUAD_INDEX[5])).toBeGreaterThan(
      0,
    );
  });
});
