import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  freezeStaticMatrices,
  freezeStaticSubtreeMatrices,
  lookAtFrozen,
  refreshFrozenWorldMatrix,
} from '../src/render/static_matrix';

describe('static matrix traversal', () => {
  it('keeps transform-animated descendants live under a locally frozen root', () => {
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const root = new THREE.Group();
    const moving = new THREE.Object3D();
    moving.position.x = 2;
    root.add(moving);
    scene.add(root);

    freezeStaticMatrices(root);
    moving.matrixAutoUpdate = true;
    moving.position.x = 7;
    scene.updateMatrixWorld();

    expect(moving.matrixWorld.elements[12]).toBe(7);
  });

  it('preserves final world matrices while skipping a fully static subtree', () => {
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const root = new THREE.Group();
    root.position.x = 3;
    const child = new THREE.Object3D();
    child.position.x = 4;
    root.add(child);
    scene.add(root);

    freezeStaticSubtreeMatrices(root);
    expect(root.matrixWorldAutoUpdate).toBe(false);
    expect(child.matrixWorld.elements[12]).toBe(7);

    root.position.x = 30;
    child.position.x = 40;
    scene.updateMatrixWorld();
    expect(child.matrixWorld.elements[12]).toBe(7);
  });

  it('the plain scene walk composes a live child streamed under a SUBTREE-frozen root', () => {
    // Load-bearing r185 premise, pinned so a future three change reds here
    // instead of silently breaking the world: updateMatrixWorld recurses
    // children UNCONDITIONALLY (r165 pruned the walk at a
    // matrixWorldAutoUpdate=false node), and that unconditional descent is
    // the only thing placing content streamed under an already-frozen root.
    // The live case today is water gap sheets: water.ts buildSheet adds a
    // default-flag mesh at y = waterLevel() under a group frozen by the zone
    // load's freeze pass, and nothing ever refreshes it explicitly. If this
    // arm reds on a three bump, streamed-under-frozen content (gap-sheet
    // water first) is rendering at identity transforms.
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const root = new THREE.Group();
    scene.add(root);
    freezeStaticSubtreeMatrices(root);

    const streamed = new THREE.Object3D();
    streamed.position.y = 6.4;
    root.add(streamed);
    scene.updateMatrixWorld();

    // Assert the composed ELEMENTS directly: getWorldPosition self-heals via
    // its own updateWorldMatrix call and would mask a pruned walk.
    expect(streamed.matrixWorld.elements[13]).toBe(6.4);
  });

  it('re-freezing a subtree-frozen root rebakes the root compose (r185 gate)', () => {
    // r185's force flag does not bypass the matrixWorldAutoUpdate gate, so a
    // plain updateMatrixWorld(true) bake skips the root's own compose on a
    // re-freeze; with an ancestor that moved since the first bake, the root
    // (and everything under it) would stay composed against the stale parent
    // world. The flag-preserving bake must heal the whole chain.
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    const root = new THREE.Group();
    root.position.x = 3;
    const child = new THREE.Object3D();
    child.position.x = 4;
    root.add(child);
    parent.add(root);
    scene.add(parent);

    freezeStaticSubtreeMatrices(root);
    expect(child.matrixWorld.elements[12]).toBe(7);

    parent.position.x = 10;
    scene.updateMatrixWorld();
    // The gated root did not follow its parent (the production freeze shape).
    expect(root.matrixWorld.elements[12]).toBe(3);

    freezeStaticMatrices(root);
    expect(root.matrixWorld.elements[12]).toBe(13);
    expect(child.matrixWorld.elements[12]).toBe(17);
    // The stronger subtree freeze survives the rebake.
    expect(root.matrixWorldAutoUpdate).toBe(false);
  });
});

describe('the no-nesting contract for subtree freezes', () => {
  // Re-freeze correctness rests on "no caller nests subtree freezes": the
  // flag-preserving bake heals the freeze ROOT but deliberately not a nested
  // subtree-frozen descendant. The module warns at runtime when the contract
  // breaks; these arms pin the warn AND demonstrate both sides of the hazard.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns on a nested subtree-frozen descendant, whose world stays stale (the hazard)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene();
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.x = 2;
    const leaf = new THREE.Object3D();
    leaf.position.x = 1;
    inner.add(leaf);
    outer.add(inner);
    scene.add(outer);
    freezeStaticSubtreeMatrices(inner);
    expect(leaf.matrixWorld.elements[12]).toBe(3);

    outer.position.x = 10;
    freezeStaticMatrices(outer); // the forbidden nesting shape
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('nested subtree freeze');
    // The hazard is real: the bake healed the outer root but not the nested
    // frozen root, so its subtree is still composed against the stale parent.
    expect(outer.matrixWorld.elements[12]).toBe(10);
    expect(leaf.matrixWorld.elements[12]).toBe(3);
  });

  it('stays silent on every sanctioned shape, and the non-nested re-freeze heals fully', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    const root = new THREE.Group();
    const child = new THREE.Object3D();
    child.position.x = 4;
    root.add(child);
    parent.add(root);
    scene.add(parent);

    // Plain freeze, subtree freeze, re-freeze of the SAME root (the terrain
    // rebuild idiom), and a per-mesh freeze UNDER a subtree-frozen ancestor
    // (the water gap-sheet idiom): none of these nest a frozen root INSIDE
    // the subtree being frozen.
    freezeStaticMatrices(root);
    freezeStaticSubtreeMatrices(root);
    parent.position.x = 6;
    scene.updateMatrixWorld(); // the gated root did not follow; the re-freeze must heal it
    freezeStaticMatrices(root);
    freezeStaticMatrices(child);
    expect(warn).not.toHaveBeenCalled();
    // Absent nesting, the re-freeze healed the whole chain.
    expect(root.matrixWorld.elements[12]).toBe(6);
    expect(child.matrixWorld.elements[12]).toBe(10);
  });
});

describe('refreshFrozenWorldMatrix', () => {
  // The r185 premise the helper exists for: a plain updateMatrixWorld() on a
  // matrixWorldAutoUpdate=false node clears the dirty bit WITHOUT composing
  // (r165 composed here). If a future three restores the old semantics, this
  // arm flags the helper for re-evaluation instead of letting it rot.
  it('pins the r185 gate: a plain explicit call leaves a frozen node stale', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.matrixWorldAutoUpdate = false;
    camera.position.x = 5;
    camera.updateMatrixWorld();
    expect(camera.matrixWorld.elements[12]).toBe(0);
    expect(camera.matrixWorldNeedsUpdate).toBe(false);
  });

  it('composes a frozen parentless camera and leaves the freeze in place', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.matrixWorldAutoUpdate = false;
    camera.position.set(3, 0, 0);
    camera.lookAt(0, 0, 0);
    refreshFrozenWorldMatrix(camera);
    expect(camera.matrixWorld.elements[12]).toBe(3);
    expect(camera.matrixWorldAutoUpdate).toBe(false);
  });

  it('composes a frozen node against its live parent chain', () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.position.x = 10;
    const frozen = new THREE.Object3D();
    frozen.position.x = 2;
    parent.add(frozen);
    scene.add(parent);
    scene.updateMatrixWorld(true);
    frozen.matrixWorldAutoUpdate = false;

    frozen.position.x = 4;
    refreshFrozenWorldMatrix(frozen);
    expect(frozen.matrixWorld.elements[12]).toBe(14);
    expect(frozen.matrixWorldAutoUpdate).toBe(false);
  });
});

describe('lookAtFrozen', () => {
  // The v0.38.0 chase-camera regression. Object3D.lookAt derives its EYE
  // position from matrixWorld, not from .position, and r185 gates a node's own
  // compose on matrixWorldAutoUpdate. So aiming the renderer's frozen camera
  // straight after moving it aims from whatever pose the previous refresh
  // baked, one frame stale. Standing still that is invisible (the position did
  // not move between frames); ORBITING, which is exactly what an A/D keyboard
  // turn does, it leaves the avatar off screen centre by one frame of turn.
  const CAMERA_DIST = 8;
  const framedCamera = (): THREE.PerspectiveCamera => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.matrixWorldAutoUpdate = false;
    return camera;
  };
  // Where the chase camera sits for a given yaw, mirroring updateCamera's orbit.
  const orbit = (camera: THREE.PerspectiveCamera, pivot: THREE.Vector3, yaw: number): void => {
    camera.position.set(
      pivot.x - Math.sin(yaw) * CAMERA_DIST,
      pivot.y,
      pivot.z - Math.cos(yaw) * CAMERA_DIST,
    );
  };
  // Horizontal screen offset of the pivot, 0 at centre and 1 at the frame edge.
  const offCentre = (camera: THREE.PerspectiveCamera, pivot: THREE.Vector3): number =>
    Math.abs(pivot.clone().project(camera).x);

  it('pins the r185 hazard: a raw lookAt on a frozen camera aims from the stale pose', () => {
    const camera = framedCamera();
    const pivot = new THREE.Vector3(0, 0, 0);
    orbit(camera, pivot, 0);
    refreshFrozenWorldMatrix(camera);

    // One 60 fps frame of TURN_SPEED (PI rad/s), the exact A/D case.
    orbit(camera, pivot, Math.PI / 60);
    camera.lookAt(pivot);
    refreshFrozenWorldMatrix(camera);

    expect(offCentre(camera, pivot)).toBeGreaterThan(0.03);
  });

  it('aims a frozen camera from its CURRENT position and leaves the freeze in place', () => {
    const camera = framedCamera();
    const pivot = new THREE.Vector3(0, 0, 0);
    orbit(camera, pivot, 0);
    refreshFrozenWorldMatrix(camera);

    orbit(camera, pivot, Math.PI / 60);
    lookAtFrozen(camera, pivot);

    expect(offCentre(camera, pivot)).toBeLessThan(1e-6);
    expect(camera.matrixWorldAutoUpdate).toBe(false);
    // matrixWorld carries the new pose, so the draw and every camera-relative
    // cull downstream read the same orientation the aim just produced.
    expect(camera.matrixWorld.elements[12]).toBeCloseTo(camera.position.x, 10);
    expect(camera.matrixWorld.elements[14]).toBeCloseTo(camera.position.z, 10);
  });

  it('holds the avatar centred across a sustained keyboard turn', () => {
    const camera = framedCamera();
    const pivot = new THREE.Vector3(0, 0, 0);
    orbit(camera, pivot, 0);
    refreshFrozenWorldMatrix(camera);

    // Half a second of held A at 60 fps: the offset must never accumulate.
    let worst = 0;
    for (let frame = 1; frame <= 30; frame++) {
      orbit(camera, pivot, (Math.PI * frame) / 60);
      lookAtFrozen(camera, pivot);
      worst = Math.max(worst, offCentre(camera, pivot));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('aims correctly against a live parent chain', () => {
    const scene = new THREE.Scene();
    const rig = new THREE.Group();
    rig.position.set(100, 0, 0);
    const camera = framedCamera();
    rig.add(camera);
    scene.add(rig);
    scene.updateMatrixWorld(true);

    const pivot = new THREE.Vector3(100, 0, 0);
    orbit(camera, new THREE.Vector3(0, 0, 0), Math.PI / 60);
    lookAtFrozen(camera, pivot);

    expect(offCentre(camera, pivot)).toBeLessThan(1e-6);
    expect(camera.matrixWorldAutoUpdate).toBe(false);
  });
});
