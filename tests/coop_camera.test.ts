import { describe, expect, it } from 'vitest';
import {
  COOP_CAMERA_FIT_PAD_YD,
  COOP_CAMERA_MAX_DIST,
  COOP_CAMERA_MIN_DIST,
  COOP_LEASH_YD,
  coopCameraFrame,
  coopCentroid,
  coopFitDistance,
  coopMoveAllowed,
  coopSmooth,
  coopSpreadRadius,
} from '../src/game/coop_camera';

const FOV = { fovYDeg: 60, aspect: 16 / 9 };

describe('coopCentroid / coopSpreadRadius', () => {
  it('averages positions and measures the widest XZ offset', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 2, z: 0 },
      { x: 0, y: 4, z: 10 },
      { x: 10, y: 6, z: 10 },
    ];
    const c = coopCentroid(pts);
    expect(c).toEqual({ x: 5, y: 3, z: 5 });
    expect(coopSpreadRadius(pts, c)).toBeCloseTo(Math.hypot(5, 5), 6);
  });

  it('spread ignores height differences (a jump must not zoom the camera)', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 30, z: 0 },
    ];
    expect(coopSpreadRadius(pts, coopCentroid(pts))).toBe(0);
  });
});

describe('coopFitDistance', () => {
  it('floors at the co-op minimum, but honors a larger player zoom', () => {
    // Players standing on top of each other still get the wide shared view.
    expect(coopFitDistance({ spreadYd: 0, baseDist: 12, ...FOV })).toBe(COOP_CAMERA_MIN_DIST);
    // A player already zoomed out past the floor keeps their wider zoom.
    expect(coopFitDistance({ spreadYd: 0, baseDist: 34, ...FOV })).toBe(34);
  });

  it('grows with the spread and clamps at the max', () => {
    const near = coopFitDistance({ spreadYd: 8, baseDist: 12, ...FOV });
    const far = coopFitDistance({ spreadYd: 25, baseDist: 12, ...FOV });
    expect(far).toBeGreaterThan(near);
    expect(coopFitDistance({ spreadYd: 500, baseDist: 12, ...FOV })).toBe(COOP_CAMERA_MAX_DIST);
  });

  it('a narrow (portrait) viewport needs more distance than a wide one', () => {
    // Spread small enough that neither result hits the COOP_CAMERA_MAX_DIST clamp.
    const wide = coopFitDistance({ spreadYd: 6, baseDist: 5, fovYDeg: 60, aspect: 16 / 9 });
    const tall = coopFitDistance({ spreadYd: 6, baseDist: 5, fovYDeg: 60, aspect: 9 / 16 });
    expect(tall).toBeGreaterThan(wide);
  });

  it('fits the padded spread sphere inside the narrower frustum half-angle', () => {
    const spreadYd = 15;
    const d = coopFitDistance({ spreadYd, baseDist: 5, fovYDeg: 60, aspect: 16 / 9 });
    // Vertical fov is the binding plane at 16:9; the padded radius must subtend
    // no more than the half-angle at the returned distance.
    const halfY = (60 / 2 / 180) * Math.PI;
    expect(Math.atan((spreadYd + COOP_CAMERA_FIT_PAD_YD) / d)).toBeLessThanOrEqual(halfY);
  });
});

describe('coopCameraFrame', () => {
  it('returns null for a lone player (normal chase camera keeps control)', () => {
    expect(coopCameraFrame({ players: [{ x: 0, y: 0, z: 0 }], baseDist: 12, ...FOV })).toBeNull();
  });

  it('anchors between the players and zooms to fit', () => {
    const frame = coopCameraFrame({
      players: [
        { x: 0, y: 0, z: 0 },
        { x: 30, y: 0, z: 0 },
      ],
      baseDist: 12,
      ...FOV,
    });
    expect(frame).not.toBeNull();
    expect(frame?.anchor.x).toBeCloseTo(15, 6);
    expect(frame?.dist).toBeGreaterThan(12);
  });
});

describe('coopSmooth', () => {
  it('is frame-rate independent: two half-steps land where one full step does', () => {
    const one = coopSmooth(0, 10, 4, 0.2);
    const half = coopSmooth(coopSmooth(0, 10, 4, 0.1), 10, 4, 0.1);
    expect(half).toBeCloseTo(one, 6);
  });

  it('approaches without overshooting', () => {
    const v = coopSmooth(0, 10, 100, 10);
    expect(v).toBeGreaterThan(9.99);
    expect(v).toBeLessThanOrEqual(10);
  });
});

describe('coopMoveAllowed (leash)', () => {
  const centroid = { x: 0, z: 0 };

  it('always allows movement inside the leash', () => {
    // Facing straight outward (+z at a +z offset) but still inside the radius.
    expect(coopMoveAllowed({ x: 0, z: COOP_LEASH_YD - 1 }, centroid, 0)).toBe(true);
  });

  it('blocks outward movement past the leash', () => {
    // At +z beyond the leash, facing 0 travels along (sin 0, cos 0) = further +z.
    expect(coopMoveAllowed({ x: 0, z: COOP_LEASH_YD + 5 }, centroid, 0)).toBe(false);
  });

  it('never traps: inward movement is allowed at any range', () => {
    // Same spot, facing PI travels along -z, back toward the party.
    expect(coopMoveAllowed({ x: 0, z: COOP_LEASH_YD + 5 }, centroid, Math.PI)).toBe(true);
  });

  it('sideways (tangential) movement at the edge is not outward, so it passes', () => {
    // At +z beyond the leash, facing PI/2 travels along +x, tangent to the circle.
    expect(coopMoveAllowed({ x: 0, z: COOP_LEASH_YD + 5 }, centroid, Math.PI / 2)).toBe(true);
  });
});
