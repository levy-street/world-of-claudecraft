import { describe, expect, it } from 'vitest';
import {
  advanceShardpikeFlight,
  shardpikeFlightExpired,
  shardpikeTrailDue,
} from '../src/render/shardpike_throw_core';

describe('Shardpike flight planning', () => {
  it.each([30, 60, 120])('travels at the shared authority speed at %i FPS', (fps) => {
    const point = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < fps / 2; i++)
      advanceShardpikeFlight(point, { x: 26, y: 11, z: 0 }, 1 / fps);
    expect(point.x).toBeCloseTo(13, 5);
    expect(point.y).toBeCloseTo(6, 5);
  });
  it('lands exactly at the eye without overshooting on a slow frame', () => {
    const point = { x: 0, y: 1, z: 0 },
      eye = { x: 0.1, y: 9, z: 0 };
    advanceShardpikeFlight(point, eye, 0.2);
    expect(point).toEqual(eye);
  });
  it('ignores negative time instead of flying backwards', () => {
    const point = { x: 0, y: 1, z: 0 };
    advanceShardpikeFlight(point, { x: 10, y: 9, z: 0 }, -1);
    expect(point).toEqual({ x: 0, y: 1, z: 0 });
  });
  it('expires on source death, target removal or the bounded flight deadline', () => {
    expect(shardpikeFlightExpired(0, false, true)).toBe(true);
    expect(shardpikeFlightExpired(0, true, false)).toBe(true);
    expect(shardpikeFlightExpired(3.4, true, true)).toBe(true);
    expect(shardpikeFlightExpired(1, true, true)).toBe(false);
  });
  it('emits on the cadence boundary despite floating point roundoff', () => {
    expect(shardpikeTrailDue(1 / 60)).toBe(false);
    expect(shardpikeTrailDue(1 / 30 - 1e-12)).toBe(true);
  });
});
