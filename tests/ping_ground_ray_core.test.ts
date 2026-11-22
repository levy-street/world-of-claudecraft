// The ground ping's cursor ray against the real floor
// (src/render/ping_ground_ray_core.ts): flat ground, rising and falling
// slopes, a hill hiding the valley behind it, a sky pick, a roof over the
// ground, and why the old flat plane at the player's feet was wrong at range.
// Plus the HUD's ground context (ping_wheel_core.ts groundPingContext): a hit
// the sim would refuse is no ping, never a stand-in spot.

import { describe, expect, it } from 'vitest';
import { type FloorAt, marchRayToFloor } from '../src/render/ping_ground_ray_core';
import { PARTY_PING_RANGE, PARTY_PING_VERTICAL_REACH } from '../src/sim/social/party_pings';
import { groundPingContext } from '../src/ui/hud/pings/ping_wheel_core';

const flat: FloorAt = () => 0;
/** A camera 10 yd up looking along +x and down, meeting y = 0 at x = 100. */
const cam = { x: 0, y: 10, z: 0 };
const down = { x: 100, y: -10, z: 0 };

describe('marchRayToFloor', () => {
  it('meets flat ground where the ray crosses it', () => {
    const hit = marchRayToFloor(cam, down, flat, 300);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(100, 1);
    expect(hit?.y).toBe(0);
    expect(hit?.z).toBeCloseTo(0, 5);
  });

  it('meets rising ground sooner, and stands on it', () => {
    // Ground climbing 1 yd per 20 along +x: y = x / 20. The ray y = 10 - x / 10.
    const uphill: FloorAt = (x) => x / 20;
    const hit = marchRayToFloor(cam, down, uphill, 300);
    // 10 - x/10 = x/20  ->  x = 66.67, y = 3.33
    expect(hit?.x).toBeCloseTo(200 / 3, 1);
    expect(hit?.y).toBeCloseTo(10 / 3, 1);
  });

  it('meets falling ground farther out, below the start height', () => {
    // Ground dropping 1 yd per 20 along +x: y = -x / 20.
    const downhill: FloorAt = (x) => -x / 20;
    const hit = marchRayToFloor(cam, down, downhill, 300);
    // 10 - x/10 = -x/20  ->  x = 200, y = -10
    expect(hit?.x).toBeCloseTo(200, 1);
    expect(hit?.y).toBeCloseTo(-10, 1);
    // The old flat plane at the player's feet (y = 0) put this ping at x = 100,
    // half the way to where the cursor points.
  });

  it('a hill in front hides the valley behind it (the first crossing wins)', () => {
    // A 6 yd ridge between x = 40 and x = 50, then a deep valley.
    const ridge: FloorAt = (x) => (x >= 40 && x <= 50 ? 6 : -30);
    const hit = marchRayToFloor(cam, down, ridge, 400);
    // The ray is at y = 6 at x = 40: it strikes the ridge's face.
    expect(hit?.x).toBeGreaterThanOrEqual(39.9);
    expect(hit?.x).toBeLessThanOrEqual(41);
    expect(hit?.y).toBe(6);
  });

  it('a ray into the sky meets nothing', () => {
    expect(marchRayToFloor(cam, { x: 1, y: 0.2, z: 0 }, flat, 300)).toBeNull();
    // Level, and nothing within reach.
    expect(marchRayToFloor(cam, { x: 1, y: 0, z: 0 }, flat, 300)).toBeNull();
  });

  it('ground past the reach is no hit', () => {
    expect(marchRayToFloor(cam, down, flat, 50)).toBeNull();
  });

  it('a degenerate direction or reach is no hit', () => {
    expect(marchRayToFloor(cam, { x: 0, y: 0, z: 0 }, flat, 300)).toBeNull();
    expect(marchRayToFloor(cam, down, flat, 0)).toBeNull();
  });

  it('a roof under the ray (a storey-aware floor) is where it lands', () => {
    // A 4 yd roof over x in [40, 80], the ground at 0 elsewhere. Like the
    // sim's floor query, the roof only counts from a reference at or over it.
    const roofed: FloorAt = (x, _z, ref) => (x >= 40 && x <= 80 && ref >= 4 ? 4 : 0);
    const hit = marchRayToFloor(cam, down, roofed, 300);
    // The ray comes down to y = 4 at x = 60: it lands on the roof there, not
    // on the ground under it at x = 100.
    expect(hit?.x).toBeCloseTo(60, 1);
    expect(hit?.y).toBe(4);
  });

  it('a camera already under the floor reports the floor right there', () => {
    const hit = marchRayToFloor({ x: 3, y: -1, z: 4 }, down, flat, 300);
    expect(hit).toEqual({ x: 3, y: 0, z: 4 });
  });

  it('works along any heading (z and a diagonal)', () => {
    const hz = marchRayToFloor(cam, { x: 0, y: -10, z: -100 }, flat, 300);
    expect(hz?.z).toBeCloseTo(-100, 1);
    const hd = marchRayToFloor(cam, { x: 60, y: -10, z: 80 }, flat, 300);
    expect(hd?.x).toBeCloseTo(60, 1);
    expect(hd?.z).toBeCloseTo(80, 1);
  });
});

describe('groundPingContext', () => {
  const me = { x: 0, y: 5, z: 0 };

  it('a hit in range is a ground ping at the floor under the cursor', () => {
    expect(groundPingContext({ x: 30, y: 1, z: 40 }, me)).toEqual({
      kind: 'ground',
      x: 30,
      y: 1,
      z: 40,
    });
  });

  it('no hit (sky) is no ping', () => {
    expect(groundPingContext(null, me)).toEqual({ kind: 'none' });
  });

  it('a hit past the ping range is no ping, not a spot short of it', () => {
    expect(groundPingContext({ x: PARTY_PING_RANGE + 1, y: 5, z: 0 }, me)).toEqual({
      kind: 'none',
    });
    expect(groundPingContext({ x: PARTY_PING_RANGE - 1, y: 5, z: 0 }, me).kind).toBe('ground');
  });

  it('a hit too far above or below is no ping', () => {
    const tooLow = me.y - PARTY_PING_VERTICAL_REACH - 1;
    expect(groundPingContext({ x: 10, y: tooLow, z: 0 }, me)).toEqual({ kind: 'none' });
    const tooHigh = me.y + PARTY_PING_VERTICAL_REACH + 1;
    expect(groundPingContext({ x: 10, y: tooHigh, z: 0 }, me)).toEqual({ kind: 'none' });
  });
});
