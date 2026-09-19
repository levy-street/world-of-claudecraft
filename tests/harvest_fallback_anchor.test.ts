import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { harvestFallback } from '../src/render/ability_vfx/harvest_fallback';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';

it('retains each wound origin after shared scratch reuse across recipients and later frames', () => {
  const draws: Array<(points: Vector3[]) => number> = [];
  const host = {
    pathRibbon: vi.fn((_color, _width, _life, draw) => {
      draws.push(draw);
      return true;
    }),
  } as unknown as SequencerHost;
  const scratch = { x: 3, y: 2, z: 7 };
  expect(harvestFallback(host, scratch, 0)).toBe(2);
  Object.assign(scratch, { x: -12, y: 5, z: 24 });
  expect(harvestFallback(host, scratch, Math.PI / 2)).toBe(2);
  Object.assign(scratch, { x: 900, y: -600, z: 400 });
  expect(draws).toHaveLength(4);

  function frame() {
    return draws.map((draw) => {
      const points = Array.from({ length: 9 }, () => new Vector3());
      expect(draw(points)).toBe(points.length);
      expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
      return points.map((point) => point.toArray());
    });
  }
  const first = frame();
  expect(first[0][4]).toEqual([3, 2, 7]);
  expect(first[1][4][0]).toBeCloseTo(3);
  expect(first[1][4][1]).toBeCloseTo(1.87);
  expect(first[1][4][2]).toBeCloseTo(7.12);
  expect(first[2][4]).toEqual([-12, 5, 24]);
  expect(first[3][4][0]).toBeCloseTo(-11.88);
  expect(first[3][4][1]).toBeCloseTo(4.87);
  expect(first[3][4][2]).toBeCloseTo(24);
  Object.assign(scratch, { x: -5_000, y: 800, z: 9_000 });
  expect(frame()).toEqual(first);
});
