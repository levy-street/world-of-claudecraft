// Unit test for the Guide turntable framing math (src/guide/viewer/framing.ts).
//
// The bug: the live /wiki/models turntable framed BIND-pose bounds anchored at the spin-axis
// origin, so skinned creature rigs whose idle clip flings the mesh off the bind box rendered
// blank or off-frame, while the pre-baked stills (which frame POSED bounds) looked right.
//
// frameTurntable must (1) re-center the posed bounds onto the Y spin axis via `offset`, so a
// flung rig stays centered for EVERY turntable yaw, and (2) frame the bounding sphere so all
// of it stays on-screen. We verify those as geometric CONSEQUENCES through an independent
// oracle: a real THREE.PerspectiveCamera positioned from frameTurntable's numbers, then
// camera.project(). The assertions do not restate the dist = radius/sin(fov/2) formula.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Bounds3, frameTurntable } from '../src/guide/viewer/framing';

const FOV = 40;

// Build the THREE camera frameTurntable implies, ready to project().
function cameraFor(f: ReturnType<typeof frameTurntable>, aspect = 1): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, f.near, f.far);
  cam.position.set(f.cameraPos.x, f.cameraPos.y, f.cameraPos.z);
  cam.lookAt(f.target.x, f.target.y, f.target.z);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

// The 8 corners of a box, each shifted by the model offset (x/z) then rotated about the Y
// spin axis by `yaw` (the turntable's rotation), as the live viewer would present them.
function spunCorners(b: Bounds3, offX: number, offZ: number, yaw: number): THREE.Vector3[] {
  const xs = [b.min.x + offX, b.max.x + offX];
  const ys = [b.min.y, b.max.y];
  const zs = [b.min.z + offZ, b.max.z + offZ];
  const out: THREE.Vector3[] = [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (const x of xs)
    for (const y of ys)
      for (const z of zs) out.push(new THREE.Vector3(x * c + z * s, y, -x * s + z * c));
  return out;
}

const YAWS = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);

describe('Guide turntable framing', () => {
  // A "flinging" rig: its posed bounds sit far off the spin-axis origin (center ~(3,1.5,4)),
  // exactly the case that rendered blank before the fix.
  const flung: Bounds3 = { min: { x: 2, y: 0.5, z: 3 }, max: { x: 4, y: 2.5, z: 5 } };

  it('re-centers the posed bounds onto the Y spin axis', () => {
    const f = frameTurntable(flung, FOV);
    // offset must cancel the bounds center on x/z (the center becomes (0, cy, 0)).
    expect(f.offset.x).toBeCloseTo(-3, 6);
    expect(f.offset.z).toBeCloseTo(-4, 6);
    // camera + aim sit on the spin axis.
    expect(f.cameraPos.x).toBeCloseTo(0, 6);
    expect(f.cameraPos.z).toBeGreaterThan(0);
    expect(f.target.x).toBeCloseTo(0, 6);
    expect(f.target.z).toBeCloseTo(0, 6);
    expect(f.far).toBeGreaterThan(f.near);
  });

  it('keeps a flung rig fully on-screen for every turntable yaw (GREEN with the fix)', () => {
    const f = frameTurntable(flung, FOV);
    const cam = cameraFor(f);
    let worstCorner = 0;
    let centerWorstX = 0;
    for (const yaw of YAWS) {
      // The re-centered model center is on the axis, so it projects dead-center for all yaw.
      const center = spunCorners(
        { min: { x: 3, y: 1.5, z: 4 }, max: { x: 3, y: 1.5, z: 4 } },
        f.offset.x,
        f.offset.z,
        yaw,
      )[0];
      const cndc = center.clone().project(cam);
      centerWorstX = Math.max(centerWorstX, Math.abs(cndc.x));

      for (const corner of spunCorners(flung, f.offset.x, f.offset.z, yaw)) {
        const ndc = corner.clone().project(cam);
        worstCorner = Math.max(worstCorner, Math.abs(ndc.x), Math.abs(ndc.y));
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      }
    }
    // Spin-axis invariance: the re-centered center never drifts horizontally.
    expect(centerWorstX).toBeLessThan(1e-6);
    // Tightness: the rig fills the frame (margin 1.15), not zoomed out to a speck.
    expect(worstCorner).toBeGreaterThan(0.5);
  });

  it('would push the flung rig off-screen WITHOUT the re-center offset (the bug)', () => {
    // Same camera, but skip applying the offset: this is the old origin-anchored behavior
    // that ignored the posed center. The flung mesh then orbits the axis and clips out.
    const f = frameTurntable(flung, FOV);
    const cam = cameraFor(f);
    let offScreen = false;
    for (const yaw of YAWS) {
      for (const corner of spunCorners(flung, 0, 0, yaw)) {
        const ndc = corner.clone().project(cam);
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) offScreen = true;
      }
    }
    expect(offScreen).toBe(true);
  });

  it('keeps a wide rig on-screen on a PORTRAIT stage (aspect-aware framing)', () => {
    // A broad creature (wide in x) on the inline-embed 4/5 stage (aspect 0.8): the narrower
    // horizontal fov must bind the framing, or the sides clip. Frame head-on (yaw 0) and at a
    // broadside yaw, projected through an aspect-0.8 oracle camera.
    const aspect = 0.8;
    const wide: Bounds3 = { min: { x: -2.5, y: 0, z: -0.6 }, max: { x: 2.5, y: 1.6, z: 0.6 } };
    const f = frameTurntable(wide, FOV, aspect);
    const cam = cameraFor(f, aspect);
    for (const yaw of [0, Math.PI / 2, Math.PI / 4]) {
      for (const corner of spunCorners(wide, f.offset.x, f.offset.z, yaw)) {
        const ndc = corner.clone().project(cam);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      }
    }
    // The portrait fit must pull the camera back FURTHER than a square fit of the same rig.
    expect(f.cameraPos.z).toBeGreaterThan(frameTurntable(wide, FOV, 1).cameraPos.z);
  });

  it('stays finite for a degenerate (zero-size) bound', () => {
    // A collapsed bound (min == max) must not divide by zero or yield near >= far.
    const point: Bounds3 = { min: { x: 1, y: 1, z: 1 }, max: { x: 1, y: 1, z: 1 } };
    const f = frameTurntable(point, FOV);
    expect(Number.isFinite(f.cameraPos.z)).toBe(true);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
    expect(f.offset.x).toBeCloseTo(-1, 6);
    expect(f.offset.z).toBeCloseTo(-1, 6);
  });

  it('is a near no-op for an already-centered rig (no regression to working rigs)', () => {
    // A player rig: posed bounds already centered on the axis, feet near y=0.
    const centered: Bounds3 = { min: { x: -0.6, y: 0, z: -0.6 }, max: { x: 0.6, y: 2.4, z: 0.6 } };
    const f = frameTurntable(centered, FOV);
    expect(f.offset.x).toBeCloseTo(0, 6);
    expect(f.offset.z).toBeCloseTo(0, 6);
    const cam = cameraFor(f);
    for (const yaw of YAWS) {
      for (const corner of spunCorners(centered, f.offset.x, f.offset.z, yaw)) {
        const ndc = corner.clone().project(cam);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      }
    }
  });
});
