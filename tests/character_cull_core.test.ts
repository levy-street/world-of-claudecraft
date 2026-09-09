import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_CULL_ALL,
  CHARACTER_CULL_CASTS,
  CHARACTER_CULL_DRAWS,
  CHARACTER_CULL_MARGIN,
  characterCullBits,
  characterCullRadius,
  characterRigRadius,
  createCharacterCullPass,
  setCharacterCullCamera,
  setCharacterCullShadow,
  skinnedCullSphereRadius,
} from '../src/render/character_cull_core';
import { applySkinnedCullBounds } from '../src/render/characters/skinned_cull_bounds';
import { MOUNTS } from '../src/sim/content/mounts';
import { RUN_SPEED } from '../src/sim/types';

const RIG_HEIGHT = 1.8;
/** The renderer's outer shadow band (ENTITY_PROXY_SHADOW_RANGE_SQ). */
const CAST_RANGE_SQ = 62 * 62;

/** Camera at the origin, looking down -Z at yaw 0: the frame every case reads. */
function viewCamera(yaw = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 0, 0);
  camera.lookAt(-Math.sin(yaw), 0, -Math.cos(yaw));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return camera;
}

/**
 * A key light shaped like the renderer's sun: `elevation` is the unit
 * direction's y, and the light is placed that far up from its target so the
 * core reads the direction back off the position pair, as the renderer's does.
 */
function keyLight(opts: {
  castShadow?: boolean;
  elevation?: number;
  towardZ?: number;
  halfExtent?: number;
  near?: number;
  far?: number;
}) {
  const elevation = opts.elevation ?? 0.9;
  const towardZ = opts.towardZ ?? 0;
  const dir = new THREE.Vector3(
    Math.sqrt(Math.max(0, 1 - elevation * elevation - towardZ * towardZ)),
    elevation,
    towardZ,
  );
  const distance = 400;
  return {
    castShadow: opts.castShadow ?? true,
    position: {
      x: dir.x * distance,
      y: dir.y * distance,
      z: dir.z * distance,
    },
    target: { position: { x: 0, y: 0, z: 0 } },
    shadow: {
      camera: { top: opts.halfExtent ?? 105, near: opts.near ?? 30, far: opts.far ?? 480 },
    },
  };
}

function pass(light = keyLight({}), castRangeSq = CAST_RANGE_SQ) {
  const p = createCharacterCullPass();
  setCharacterCullCamera(p, viewCamera());
  setCharacterCullShadow(p, light, castRangeSq);
  return p;
}

/** The player stands at the origin, so the rig's own offset is its band test. */
function bits(p: ReturnType<typeof pass>, x: number, y: number, z: number, scale = 1) {
  return characterCullBits(p, x, y, z, RIG_HEIGHT, scale, 0, x * x + z * z);
}

describe('character cull: the colour pass', () => {
  it('draws a rig standing in front of the camera', () => {
    expect(bits(pass(), 0, 0, -20) & CHARACTER_CULL_DRAWS).toBe(CHARACTER_CULL_DRAWS);
  });

  it('does not draw a rig behind the camera', () => {
    expect(bits(pass(), 0, 0, 20) & CHARACTER_CULL_DRAWS).toBe(0);
  });

  it('does not draw a rig past the far plane', () => {
    expect(bits(pass(), 0, 0, -400) & CHARACTER_CULL_DRAWS).toBe(0);
  });

  it('extracts the same six planes three does', () => {
    const camera = viewCamera();
    const p = createCharacterCullPass();
    setCharacterCullCamera(p, camera);
    const reference = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (let i = 0; i < 6; i++) {
      const plane = reference.planes[i];
      expect(p.planes[i * 4]).toBeCloseTo(plane.normal.x, 10);
      expect(p.planes[i * 4 + 1]).toBeCloseTo(plane.normal.y, 10);
      expect(p.planes[i * 4 + 2]).toBeCloseTo(plane.normal.z, 10);
      expect(p.planes[i * 4 + 3]).toBeCloseTo(plane.constant, 10);
    }
  });

  it('holds the margin past the edge three would already have cut', () => {
    const camera = viewCamera();
    const reference = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const p = pass();
    const unpaddedRadius = characterRigRadius(RIG_HEIGHT, 1);
    // Walk the rig up out of the top of the view until an un-padded sphere
    // (what three would test without the margin) leaves the frustum.
    const sphere = new THREE.Sphere(new THREE.Vector3(), unpaddedRadius);
    let edge = 0;
    for (let y = 0; y < 200; y += 0.05) {
      sphere.center.set(0, y + RIG_HEIGHT * 0.5, -20);
      if (!reference.intersectsSphere(sphere)) {
        edge = y;
        break;
      }
    }
    expect(edge).toBeGreaterThan(0);
    // The margin is exactly what keeps that rig drawing for another frame of
    // movement, so it must not pop out the moment the bare sphere leaves.
    expect(bits(p, 0, edge, -20) & CHARACTER_CULL_DRAWS).toBe(CHARACTER_CULL_DRAWS);
    expect(bits(p, 0, edge + CHARACTER_CULL_MARGIN * 4, -20) & CHARACTER_CULL_DRAWS).toBe(0);
  });

  it('derives the margin from the run speed and the best mount in the catalog', () => {
    const bestMount = Math.max(...Object.values(MOUNTS).map((m) => m.moveSpeedPct));
    expect(bestMount).toBeGreaterThan(0);
    // One yard of animation drift plus one 20 fps frame at mounted run speed.
    expect(CHARACTER_CULL_MARGIN).toBeCloseTo(1 + (RUN_SPEED * (1 + bestMount)) / 20, 10);
    expect(CHARACTER_CULL_MARGIN).toBeCloseTo(1.63, 10);
  });

  it('grows the sphere with the entity scale, not just the authored height', () => {
    // A raid boss at scale 3 fills three times the silhouette; culling it on the
    // unscaled radius would clip its body off at the edge of the view.
    expect(characterRigRadius(RIG_HEIGHT, 2)).toBeCloseTo(5.52, 10);
    expect(characterCullRadius(RIG_HEIGHT, 2, 0)).toBeCloseTo(
      characterRigRadius(RIG_HEIGHT, 2) + CHARACTER_CULL_MARGIN,
      10,
    );
    // Just outside the view for a 1x rig, inside it once the rig is scaled up.
    const p = pass();
    const y = 16;
    expect(bits(p, 0, y, -20, 1) & CHARACTER_CULL_DRAWS).toBe(0);
    expect(bits(p, 0, y, -20, 3) & CHARACTER_CULL_DRAWS).toBe(CHARACTER_CULL_DRAWS);
  });

  it('never shrinks below a caller floor (the aegis dome reaches past the body)', () => {
    expect(characterCullRadius(RIG_HEIGHT, 1, 40)).toBe(40);
    expect(characterCullRadius(RIG_HEIGHT, 1, 0)).toBeCloseTo(
      characterRigRadius(RIG_HEIGHT, 1) + CHARACTER_CULL_MARGIN,
      10,
    );
  });

  it('draws everything while no camera has been pushed', () => {
    const p = createCharacterCullPass();
    expect(characterCullBits(p, 0, 0, 20, RIG_HEIGHT, 1, 0, 400)).toBe(CHARACTER_CULL_ALL);
  });
});

describe('character cull: the one-frame camera lag', () => {
  it('measures no turn on a still camera', () => {
    const p = createCharacterCullPass();
    setCharacterCullCamera(p, viewCamera());
    setCharacterCullCamera(p, viewCamera());
    expect(p.turnRad).toBeCloseTo(0, 12);
  });

  it('measures the turn between two pushes, and none on the first', () => {
    const p = createCharacterCullPass();
    setCharacterCullCamera(p, viewCamera());
    expect(p.turnRad).toBe(0);
    setCharacterCullCamera(p, viewCamera(Math.PI / 2));
    expect(p.turnRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps a rig the flick is about to reveal, and culls it once the camera settles', () => {
    // 20 yards out at 45 degrees off the axis, so 15 degrees past the 30 degree
    // half-angle: 5.2 yards outside the frustum, more than the rig's own
    // radius, less than half a radian of turn at that distance.
    const x = 20 * Math.SQRT1_2;
    const settled = createCharacterCullPass();
    setCharacterCullShadow(settled, keyLight({ castShadow: false }), CAST_RANGE_SQ);
    setCharacterCullCamera(settled, viewCamera());
    setCharacterCullCamera(settled, viewCamera());
    expect(settled.turnRad).toBeCloseTo(0, 12);
    expect(bits(settled, x, 0, -x) & CHARACTER_CULL_DRAWS).toBe(0);

    const turning = createCharacterCullPass();
    setCharacterCullShadow(turning, keyLight({ castShadow: false }), CAST_RANGE_SQ);
    setCharacterCullCamera(turning, viewCamera(0.5));
    setCharacterCullCamera(turning, viewCamera());
    expect(turning.turnRad).toBeCloseTo(0.5, 6);
    expect(bits(turning, x, 0, -x) & CHARACTER_CULL_DRAWS).toBe(CHARACTER_CULL_DRAWS);
  });
});

describe('character cull: the shadow pass', () => {
  it('casts nothing from behind the camera under a high sun', () => {
    // The stripe lands under the rig's own feet, where no one is looking.
    expect(bits(pass(keyLight({ elevation: 0.95 })), 0, 0, 20) & CHARACTER_CULL_CASTS).toBe(0);
  });

  it('casts from behind the camera when the stripe reaches into the shot', () => {
    // A low sun on the far side of the rig throws its shadow forward, past the
    // camera and into the view volume: the rig draws nothing and still casts.
    const p = pass(keyLight({ elevation: 0.1, towardZ: 0.99 }));
    const b = bits(p, 0, 0, 20);
    expect(b & CHARACTER_CULL_DRAWS).toBe(0);
    expect(b & CHARACTER_CULL_CASTS).toBe(CHARACTER_CULL_CASTS);
  });

  it('casts nothing from outside the light volume', () => {
    // Same geometry, but the ortho box's depth slab no longer reaches the rig.
    const p = pass(keyLight({ elevation: 0.1, towardZ: 0.99, near: 30, far: 100 }));
    expect(bits(p, 0, 0, 20) & CHARACTER_CULL_CASTS).toBe(0);
  });

  it("casts nothing from beyond the renderer's own shadow band", () => {
    // Same geometry as the case above, but the rig sits past the outer band, so
    // every caster it owns already has castShadow false.
    const p = pass(keyLight({ elevation: 0.1, towardZ: 0.99 }), 10 * 10);
    const b = bits(p, 0, 0, 20);
    expect(b & CHARACTER_CULL_DRAWS).toBe(0);
    expect(b & CHARACTER_CULL_CASTS).toBe(0);
    // ...and it does cast once the band reaches it, so the band is the reason.
    expect(bits(pass(keyLight({ elevation: 0.1, towardZ: 0.99 }), 30 * 30), 0, 0, 20)).toBe(
      CHARACTER_CULL_CASTS,
    );
  });

  it('follows the stripe down to the ground the rig stands on, not just to its feet', () => {
    // A half-height sun behind a rig 20 yards back: the stripe only reaches the
    // shot because the sweep keeps going past the body, by the slope allowance.
    const p = pass(keyLight({ elevation: 0.5, towardZ: 0.86 }));
    expect(bits(p, 0, 0, 20) & CHARACTER_CULL_CASTS).toBe(CHARACTER_CULL_CASTS);
  });

  it('stops the sweep at the ortho box width, since no texel exists outside it', () => {
    // Identical geometry; only the box the sweep is allowed to cross changes.
    const wide = pass(keyLight({ elevation: 0.02, towardZ: 0.999, halfExtent: 105 }));
    expect(bits(wide, 0, 0, 40) & CHARACTER_CULL_CASTS).toBe(CHARACTER_CULL_CASTS);
    const narrow = pass(keyLight({ elevation: 0.02, towardZ: 0.999, halfExtent: 10 }));
    expect(bits(narrow, 0, 0, 40) & CHARACTER_CULL_CASTS).toBe(0);
  });

  it('casts nothing when the light sits on its own target', () => {
    const p = createCharacterCullPass();
    setCharacterCullCamera(p, viewCamera());
    setCharacterCullShadow(
      p,
      {
        castShadow: true,
        position: { x: 0, y: 0, z: 0 },
        target: { position: { x: 0, y: 0, z: 0 } },
        shadow: { camera: { top: 105, near: 30, far: 480 } },
      },
      CAST_RANGE_SQ,
    );
    expect(p.shadowsLive).toBe(false);
    expect(bits(p, 0, 0, 20) & CHARACTER_CULL_CASTS).toBe(0);
  });

  it('casts nothing when the key light casts nothing', () => {
    const p = pass(keyLight({ castShadow: false, elevation: 0.1, towardZ: 0.99 }));
    expect(bits(p, 0, 0, 20) & CHARACTER_CULL_CASTS).toBe(0);
    expect(p.shadowsLive).toBe(false);
  });

  it('still casts for a rig the camera can see', () => {
    expect(bits(pass(), 0, 0, -20)).toBe(CHARACTER_CULL_ALL);
  });
});

describe('skinned cull bounds', () => {
  it('pads the sphere to contain the animated rig from any point inside it', () => {
    // The sphere keeps the bind-pose centre, which is at most one rig radius
    // from the rig centre, so twice the radius is what has to survive scaling.
    const worldScale = 4;
    const radius = skinnedCullSphereRadius(RIG_HEIGHT, worldScale);
    expect(radius * worldScale).toBeCloseTo(
      2 * characterRigRadius(RIG_HEIGHT, 1) + CHARACTER_CULL_MARGIN,
      10,
    );
    expect(radius * worldScale).toBeGreaterThan(2 * characterRigRadius(RIG_HEIGHT, 1));
  });

  it('keeps the historical exemption rather than guess a degenerate sphere', () => {
    expect(skinnedCullSphereRadius(RIG_HEIGHT, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('hands three a sphere it can cull with, divided by the scale to the root', () => {
    const root = new THREE.Group();
    const wrap = new THREE.Group();
    wrap.scale.setScalar(0.5);
    root.add(wrap);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.scale.setScalar(2);
    wrap.add(mesh);

    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);

    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.boundingSphere).not.toBeNull();
    // 0.5 * 2 accumulated up to (but not including) the root.
    expect(mesh.boundingSphere?.radius).toBeCloseTo(skinnedCullSphereRadius(RIG_HEIGHT, 1), 10);
    // Re-applying rebuilds from the geometry, so it cannot compound.
    const once = mesh.boundingSphere?.radius ?? 0;
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);
    expect(mesh.boundingSphere?.radius).toBeCloseTo(once, 10);

    // The walk stops AT the root: the entity scale lives above it and rides
    // matrixWorld, so folding it in here would shrink the sphere twice over.
    root.scale.setScalar(3);
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);
    expect(mesh.boundingSphere?.radius).toBeCloseTo(once, 10);
  });

  it('divides by the SMALLEST axis, the arm that cannot under-pad', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    // three scales a sphere by the composed matrix's LARGEST axis, which a
    // rotation between two non-uniform scales makes smaller than the product of
    // the per-node largest ones; the smallest-axis product is the safe divisor.
    mesh.scale.set(4, 1, 1);
    root.add(mesh);
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);
    expect(mesh.boundingSphere?.radius).toBeCloseTo(skinnedCullSphereRadius(RIG_HEIGHT, 1), 10);
  });

  it('says the exemption outright on a collapsed scale chain', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.scale.set(0, 0, 0);
    root.add(mesh);
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);
    expect(mesh.frustumCulled).toBe(false);
  });

  it('leaves a rig on screen visible to three at its padded sphere', () => {
    const camera = viewCamera();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    root.add(mesh);
    applySkinnedCullBounds(mesh, root, RIG_HEIGHT);

    root.position.set(0, 0, -20);
    root.updateMatrixWorld(true);
    expect(frustum.intersectsObject(mesh)).toBe(true);

    root.position.set(0, 0, 60);
    root.updateMatrixWorld(true);
    expect(frustum.intersectsObject(mesh)).toBe(false);
  });
});

describe('renderer wiring: the two bits and the band they are measured on', () => {
  const renderer = readFileSync(
    fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
    'utf8',
  );

  it('reads DRAWS for the colour decision and hides only when BOTH bits are clear', () => {
    expect(renderer).toContain(
      'const characterBodyOnScreen = (cullBits & CHARACTER_CULL_DRAWS) !== 0;',
    );
    // The AND is the whole point: flipping it to OR re-introduces the deleted
    // shadow of a rig standing behind the camera.
    expect(renderer).toContain(
      'if (!charOnScreen && (cullBits & CHARACTER_CULL_CASTS) === 0) v.group.visible = false;',
    );
  });

  it('keeps the pose live for a rig that is drawn only into the shadow map', () => {
    // Without this a shadow-only rig freezes its pose while group.position keeps
    // moving, and its shadow slides across the ground in a stale silhouette.
    expect(renderer).toContain('charOnScreen || (cullBits & CHARACTER_CULL_CASTS) !== 0,');
  });

  it('runs the cull on every tier, behind the dev flag rather than the shadow tier', () => {
    expect(renderer).toContain("this.cullCharacters = !renderLayerDisabled('charcull');");
    expect(renderer).not.toContain('this.cullCharacters = !sun.castShadow;');
  });

  it("measures the cast band on the renderer's own outer shadow bound", () => {
    expect(renderer).toContain(
      'setCharacterCullShadow(this.characterCull, this.sun, ENTITY_PROXY_SHADOW_RANGE_SQ);',
    );
    // The bands the renderer actually switches casters on. The proxy band is the
    // outer one, so handing it to the cull can never drop a live caster; if the
    // articulated band ever grew past it, this pin is what says so.
    const articulated = /const ENTITY_SHADOW_RANGE_SQ = (\d+) \* (\d+);/.exec(renderer);
    const proxy = /const ENTITY_PROXY_SHADOW_RANGE_SQ = (\d+) \* (\d+);/.exec(renderer);
    expect(articulated).not.toBeNull();
    expect(proxy).not.toBeNull();
    expect(Number(articulated?.[1])).toBe(25);
    expect(Number(proxy?.[1])).toBe(62);
    expect(Number(articulated?.[1])).toBeLessThanOrEqual(Number(proxy?.[1]));
    // ...and the test's own stand-in for it matches.
    expect(CAST_RANGE_SQ).toBe(Number(proxy?.[1]) ** 2);
  });
});

describe('the pass split is three r185 behaviour, re-read not assumed', () => {
  const threeSource = (path: string) =>
    readFileSync(
      fileURLToPath(new URL(`../node_modules/three/src/${path}`, import.meta.url)),
      'utf8',
    );

  it('gates the colour pass draw AND its skeleton update on the camera frustum', () => {
    const src = threeSource('renderers/WebGLRenderer.js');
    const guard = src.indexOf(
      'if ( ! object.frustumCulled || _frustum.intersectsObject( object ) ) {',
    );
    expect(guard).toBeGreaterThan(-1);
    // objects.update (which calls Skeleton.update, which re-arms the bone
    // texture) sits INSIDE the guard: a culled rig flattens no palette.
    const body = src.slice(guard, guard + 400);
    expect(body).toContain('objects.update( object )');
  });

  it('gates the shadow pass draw on the SHADOW camera frustum', () => {
    const src = threeSource('renderers/webgl/WebGLShadowMap.js');
    const guard = src.indexOf('! object.frustumCulled || _frustum.intersectsObject( object )');
    expect(guard).toBeGreaterThan(-1);
    expect(src.slice(guard, guard + 400)).toContain('objects.update( object )');
    // That _frustum is the LIGHT's own, built from the shadow camera, which is
    // what makes the padded sphere answer a different question in each pass.
    expect(src).toContain('_frustum = shadow.getFrustum();');
    const lightShadow = threeSource('lights/LightShadow.js');
    expect(lightShadow).toContain('const shadowCamera = this.camera;');
    expect(lightShadow).toContain(
      '_projScreenMatrix.multiplyMatrices( shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse );',
    );
  });

  it('stops at an invisible subtree in both passes, which is what a hidden group buys', () => {
    expect(threeSource('renderers/WebGLRenderer.js')).toContain(
      'if ( object.visible === false ) return;',
    );
    expect(threeSource('renderers/webgl/WebGLShadowMap.js')).toContain(
      'if ( object.visible === false ) return;',
    );
  });

  it('flattens the palette and re-arms the bone texture inside objects.update', () => {
    const src = threeSource('renderers/webgl/WebGLObjects.js');
    expect(src).toContain('skeleton.update()');
    expect(threeSource('objects/Skeleton.js')).toContain('boneTexture.needsUpdate = true');
  });
});
