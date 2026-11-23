import { describe, expect, it } from 'vitest';
import {
  canvasToWorld,
  mapArtProjection,
  sameMapRect,
  worldToCanvas,
} from '../src/editor/editor_map_core';

describe('editor map atlas projection', () => {
  it('preserves a tall world aspect ratio instead of stretching it square', () => {
    const rect = { minX: -180, maxX: 180, minZ: -540, maxZ: 540 };
    const west = worldToCanvas(-180, 0, rect, 460);
    const east = worldToCanvas(180, 0, rect, 460);
    const north = worldToCanvas(0, -540, rect, 460);
    const south = worldToCanvas(0, 540, rect, 460);

    expect(east.px - west.px).toBeCloseTo((360 / 1080) * 460, 6);
    expect(south.py - north.py).toBeCloseTo(460, 6);
    expect((west.px + east.px) / 2).toBeCloseTo(230, 6);
  });

  it('fills a square minimap rect edge to edge', () => {
    const rect = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    expect(worldToCanvas(-100, -100, rect, 168)).toEqual({ px: 0, py: 0 });
    expect(worldToCanvas(100, 100, rect, 168)).toEqual({ px: 168, py: 168 });
  });

  it('converts a clicked map pin back to the exact world coordinate', () => {
    const rect = { minX: -180, maxX: 180, minZ: -540, maxZ: 540 };
    const point = { x: 73.25, z: -218.5 };
    const canvasPoint = worldToCanvas(point.x, point.z, rect, 460);

    expect(canvasToWorld(canvasPoint.px, canvasPoint.py, rect, 460)).toEqual({
      x: expect.closeTo(point.x, 8),
      z: expect.closeTo(point.z, 8),
    });
  });

  it('rejects clicks in the letterbox outside a tall world map', () => {
    const rect = { minX: -180, maxX: 180, minZ: -540, maxZ: 540 };
    expect(canvasToWorld(20, 230, rect, 460)).toBeNull();
  });

  it('center-crops a square painted plate into the same tall world projection', () => {
    const rect = { minX: -180, maxX: 180, minZ: -540, maxZ: 540 };
    const p = mapArtProjection(1254, 1254, rect, 460);

    expect(p.source.x).toBeCloseTo(418, 6);
    expect(p.source.y).toBe(0);
    expect(p.source.width).toBeCloseTo(418, 6);
    expect(p.source.height).toBe(1254);
    expect(p.destination.x).toBeCloseTo(460 / 3, 6);
    expect(p.destination.y).toBe(0);
    expect(p.destination.width).toBeCloseTo(460 / 3, 6);
    expect(p.destination.height).toBe(460);
  });

  it('detects when the camera crosses into a different zone rect', () => {
    const a = { minX: -180, maxX: 180, minZ: -540, maxZ: -300 };
    expect(sameMapRect(a, { ...a })).toBe(true);
    expect(sameMapRect(a, { ...a, minZ: -300, maxZ: -60 })).toBe(false);
  });
});
