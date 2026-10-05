// The WOC body size (ModularAppearance.bodyScale) on the one seam that draws it,
// CharacterVisual.setBodyScale: the drawn body scales about its feet on the pose
// wrap (the far mesh and shadow proxy ride that wrap), `height` follows so every
// overhead anchor the renderer reads sits on the smaller head, and it composes
// with the hunter-pet presentation scale on the same wrap. Presentation only:
// the pick capsule keeps its authoritative size, a non-WOC rig (the Combat Mech,
// a form, a mount) never scales, and a mounted rider shrinks while the mount and
// the rider's seat lift stay put.
//
// Driven through the REAL prototype methods on a minimal object whose prototype
// IS CharacterVisual's (the pattern of tests/modular_far_lod.test.ts): a real
// visual needs the shipped GLBs, and every line under test reads only the
// fields set here.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { skinnedCullSphereRadius } from '../src/render/character_cull_core';
import { CharacterVisual } from '../src/render/characters/visual';
import { placeRider } from '../src/render/mount_lifecycle';
import type { MountVisualSpec } from '../src/render/mount_visuals';

interface Harness {
  visual: CharacterVisual;
  root: THREE.Group;
  poseWrap: THREE.Group;
  clickProxy: THREE.Mesh;
  body: THREE.SkinnedMesh;
}

const NORM = 0.01;
const HEIGHT = 2;

/** root > poseWrap > modelWrap (the def's normalization) > model > one skinned
 *  caster, plus the pick capsule as a root child, the way the constructor
 *  builds them. `woc` false stands for any other rig. */
function harness(woc = true): Harness {
  const root = new THREE.Group();
  const poseWrap = new THREE.Group();
  const modelWrap = new THREE.Group();
  modelWrap.scale.setScalar(NORM);
  const model = new THREE.Group();
  const geo = new THREE.BoxGeometry(40, 180, 30);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4),
  );
  const body = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  model.add(body);
  modelWrap.add(model);
  poseWrap.add(modelWrap);
  root.add(poseWrap);
  const clickProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1));
  clickProxy.scale.set(1, HEIGHT, 1);
  root.add(clickProxy);
  const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
  Object.assign(visual, {
    def: woc ? { height: HEIGHT, wocCharacter: { fit: 'male' } } : { height: HEIGHT },
    disposed: false,
    baseHeight: HEIGHT,
    bodyScale: 1,
    presentationScale: 1,
    root,
    poseWrap,
    clickProxy,
    casters: [body],
  });
  return { visual, root, poseWrap, clickProxy, body };
}

/** A caster's cull sphere radius in ROOT space (what three tests the frustum with). */
function rootSpaceCullRadius(h: Harness): number {
  const local = h.body.boundingSphere?.radius ?? Number.NaN;
  return local * h.poseWrap.scale.x * NORM;
}

describe('CharacterVisual.setBodyScale', () => {
  it('scales the drawn body about its feet and reports the drawn height', () => {
    const h = harness();
    expect(h.visual.height).toBe(HEIGHT);
    expect(h.visual.setBodyScale(0.95)).toBe(true);
    expect(h.poseWrap.scale.toArray()).toEqual([0.95, 0.95, 0.95]);
    // the feet stay on the ground: the wrap is scaled, never moved
    expect(h.poseWrap.position.toArray()).toEqual([0, 0, 0]);
    // the nameplate and every overhead anchor read this (height * e.scale + ...)
    expect(h.visual.height).toBeCloseTo(HEIGHT * 0.95, 12);
    // a repeat is no work (the renderer calls it every frame)
    expect(h.visual.setBodyScale(0.95)).toBe(false);
    // taller works the same way
    expect(h.visual.setBodyScale(1.05)).toBe(true);
    expect(h.poseWrap.scale.toArray()).toEqual([1.05, 1.05, 1.05]);
    expect(h.visual.height).toBeCloseTo(HEIGHT * 1.05, 12);
    // and back to the authored size
    expect(h.visual.setBodyScale(1)).toBe(true);
    expect(h.poseWrap.scale.x).toBe(1);
    expect(h.visual.height).toBe(HEIGHT);
  });

  it('clamps to the slider range: 5% either way of the authored size', () => {
    const h = harness();
    h.visual.setBodyScale(0.1);
    expect(h.poseWrap.scale.x).toBe(0.95);
    h.visual.setBodyScale(3);
    expect(h.poseWrap.scale.x).toBe(1.05);
    h.visual.setBodyScale(Number.NaN);
    expect(h.poseWrap.scale.x).toBe(1);
  });

  it('keeps the pick capsule at its authoritative size (targeting never shrinks)', () => {
    const h = harness();
    h.visual.setBodyScale(0.95);
    expect(h.clickProxy.scale.toArray()).toEqual([1, HEIGHT, 1]);
    // the capsule is a ROOT child, outside the scaled wrap
    expect(h.clickProxy.parent).toBe(h.root);
    h.clickProxy.updateWorldMatrix(true, false);
    expect(new THREE.Vector3().setFromMatrixScale(h.clickProxy.matrixWorld).y).toBe(HEIGHT);
  });

  it('composes with the hunter-pet presentation scale on the same wrap', () => {
    const h = harness();
    h.visual.setBodyScale(0.95);
    h.visual.setPresentationScale(1.2);
    expect(h.poseWrap.scale.x).toBeCloseTo(0.95 * 1.2, 12);
    h.visual.setBodyScale(1.05);
    expect(h.poseWrap.scale.x).toBeCloseTo(1.05 * 1.2, 12);
    h.visual.setPresentationScale(1);
    expect(h.poseWrap.scale.x).toBeCloseTo(1.05, 12);
  });

  it('never scales a rig that is not a WOC body (mech, form, mount, mob)', () => {
    const h = harness(false);
    expect(h.visual.setBodyScale(0.95)).toBe(false);
    expect(h.poseWrap.scale.x).toBe(1);
    expect(h.visual.height).toBe(HEIGHT);
  });

  it('re-derives each cull sphere for the drawn body, honest in both directions', () => {
    const h = harness();
    h.visual.setBodyScale(0.95);
    // the cull core's own padding for the SMALLER body, not the big one shrunk
    expect(rootSpaceCullRadius(h)).toBeCloseTo(skinnedCullSphereRadius(HEIGHT * 0.95, 1), 9);
    // and for the TALLER one, never the authored sphere scaled up
    h.visual.setBodyScale(1.05);
    expect(rootSpaceCullRadius(h)).toBeCloseTo(skinnedCullSphereRadius(HEIGHT * 1.05, 1), 9);
    h.visual.setBodyScale(1);
    expect(rootSpaceCullRadius(h)).toBeCloseTo(skinnedCullSphereRadius(HEIGHT, 1), 9);
    expect(h.body.frustumCulled).toBe(true);
  });

  it('shrinks a mounted rider in the saddle while the mount and the seat lift stay', () => {
    const rider = harness();
    const mount = harness(false);
    const group = new THREE.Group();
    group.add(rider.root, mount.root);
    const spec = { seat: 1.3, seatFwd: -0.2 } as MountVisualSpec;
    const v = { group, mountVisual: mount.visual, mountSeatBone: null } as unknown as Parameters<
      typeof placeRider
    >[0];
    rider.visual.setBodyScale(0.95);
    mount.visual.setBodyScale(0.95);
    placeRider(v, rider.root, spec, spec.seat, 0);
    // the rider's root sits on the saddle exactly as at full size...
    expect(rider.root.position.y).toBe(1.3);
    expect(rider.root.position.z).toBe(-0.2);
    expect(rider.root.scale.x).toBe(1);
    // ...and the body under it is the smaller one, scaled about the seat plane
    expect(rider.poseWrap.scale.x).toBe(0.95);
    // the mount keeps its authored size
    expect(mount.poseWrap.scale.x).toBe(1);
    expect(mount.visual.height).toBe(HEIGHT);
  });
});
