import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PlacementPickProjectionCache,
  placementTemplateBounds,
  projectPlacementPickBounds,
} from '../src/editor/3d/placement_pick_bounds';
import type { MapPlacement } from '../src/sim/map_doc';

const placement: MapPlacement = {
  assetId: 'castle/wall',
  x: 0,
  z: 0,
  rotY: 0,
  scale: 1,
  collide: true,
};
function camera() {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 5, 20);
  camera.lookAt(0, 5, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('placement hover frame projection', () => {
  it('uses the same detached seat, vertical offset and axis scale as placed rendering', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -2, -1), new THREE.Vector3(1, 2, 1));
    const out = projectPlacementPickBounds(
      bounds,
      { ...placement, detached: true, groundY: 2, y: 1, scaleY: 2 },
      1,
      -2,
      999,
      camera(),
      200,
      200,
    )!;
    expect(out.left).toBeCloseTo(90);
    expect(out.top).toBeCloseTo(40);
    expect(out.width).toBeCloseTo(20);
    expect(out.height).toBeCloseTo(80);
  });

  it('caches immutable source bounds without allocating geometry or modifying its owner', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
    expect(placementTemplateBounds(mesh)).toBe(placementTemplateBounds(mesh));
    expect(mesh.parent).toBeNull();
    mesh.geometry.dispose();
  });

  it('hides boxes behind the camera or with no visible area', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    expect(
      projectPlacementPickBounds(box, { ...placement, z: 50 }, 1, 0, 0, camera(), 200, 200),
    ).toBeNull();
    expect(
      projectPlacementPickBounds(new THREE.Box3(), placement, 1, 0, 0, camera(), 200, 200),
    ).toBeNull();
  });
  it('invalidates the numeric projection cache for pose, camera, viewport and lifecycle changes', () => {
    const cache = new PlacementPickProjectionCache();
    const view = camera();
    const placed = { ...placement };
    const update = (width = 200, force = false) =>
      cache.update(0, 0, placed, view, width, 200, force);
    expect(update()).toBe(true);
    expect(update()).toBe(false);
    placed.groundY = 20;
    placed.detached = true;
    expect(update()).toBe(true);
    expect(update()).toBe(false);
    view.position.y += 1;
    view.updateMatrixWorld(true);
    expect(update()).toBe(true);
    expect(update()).toBe(false);
    view.zoom = 2;
    view.updateProjectionMatrix();
    expect(update()).toBe(true);
    expect(update(300)).toBe(true);
    expect(update(300)).toBe(false);
    expect(update(300, true)).toBe(true);
  });
});
