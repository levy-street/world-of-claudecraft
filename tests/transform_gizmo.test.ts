import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gizmoScaleForScreen, TransformGizmo } from '../src/editor/3d/transform_gizmo';

// The 3-axis editor gizmo's handle picking. The seam-aligned rays here are the
// regression case for the DoubleSide pick material: three's CylinderGeometry
// places a vertex seam exactly on the axis plane (theta 0 at +z), and a
// front-side-culled ray in that plane could miss the entry face by floating
// point while its exit face was a culled backface.

function shownGizmo(mode: 'move' | 'rotate' | 'scale'): TransformGizmo {
  const g = new TransformGizmo();
  g.show(
    { mode, moveY: mode === 'move', rotateXZ: true, scaleAxes: ['x', 'y', 'z'] },
    new THREE.Vector3(0, 1.55, -0.7),
    10,
  );
  g.group.updateMatrixWorld(true);
  return g;
}

function rayAt(target: THREE.Vector3): THREE.Raycaster {
  const rc = new THREE.Raycaster();
  const origin = new THREE.Vector3(0, 45, 57);
  rc.set(origin, target.clone().sub(origin).normalize());
  return rc;
}

describe('transform gizmo picking', () => {
  it('hits the Y scale bar with a seam-aligned ray (x = 0 plane)', () => {
    const g = shownGizmo('scale');
    expect(g.pick(rayAt(new THREE.Vector3(0, 7.5, -0.7)))).toBe('y');
  });

  it('hits the X arrow along the +x axis', () => {
    const g = shownGizmo('move');
    expect(g.pick(rayAt(new THREE.Vector3(8, 1.55, -0.7)))).toBe('x');
  });

  it('hits the free-move quad near the origin', () => {
    const g = shownGizmo('move');
    expect(g.pick(rayAt(new THREE.Vector3(2.8, 1.75, 2.1)))).toBe('xz');
  });

  it('hits the Y rotation ring on its rim', () => {
    const g = shownGizmo('rotate');
    expect(g.pick(rayAt(new THREE.Vector3(10, 1.55, -0.7)))).toBe('y');
  });

  it('hits the X tilt ring at 45 degrees in its own (y-z) plane', () => {
    const g = shownGizmo('rotate');
    expect(g.pick(rayAt(new THREE.Vector3(0, 1.55 + 7.07, -0.7 + 7.07)))).toBe('x');
  });

  it('hits the Z tilt ring at 45 degrees in its own (x-y) plane', () => {
    const g = shownGizmo('rotate');
    expect(g.pick(rayAt(new THREE.Vector3(7.07, 1.55 + 7.07, -0.7)))).toBe('z');
  });

  it('hits the uniform scale cube dead center', () => {
    const g = shownGizmo('scale');
    expect(g.pick(rayAt(new THREE.Vector3(0, 2.5, -0.7)))).not.toBeNull();
  });

  it('misses well away from every handle', () => {
    const g = shownGizmo('move');
    expect(g.pick(rayAt(new THREE.Vector3(60, 1.55, -0.7)))).toBeNull();
  });
});

describe('transform gizmo screen sizing', () => {
  it('shrinks proportionally when the camera gets close instead of hitting a huge world floor', () => {
    const close = gizmoScaleForScreen(1, 60, 1000);
    const far = gizmoScaleForScreen(100, 60, 1000);

    expect(close).toBeCloseTo(0.08776, 4);
    expect(far / close).toBeCloseTo(100, 6);
  });

  it('stays the same size everywhere in an orthographic view', () => {
    const close = gizmoScaleForScreen(1, 60, 800, 40);
    const far = gizmoScaleForScreen(500, 60, 800, 40);

    expect(close).toBeCloseTo(3.8, 6);
    expect(far).toBe(close);
  });
});
