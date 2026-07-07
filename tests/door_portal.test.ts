// The dungeon door / exit-portal visual system extracted from renderer.ts.
// Geometry/material shape, shared-resource tagging, and the Nythraxis click-box
// special case. Three.js runs headless in Node (no WebGL needed for geometry).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDoorBody } from '../src/render/door_portal';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';

const meshes = (body: THREE.Group): THREE.Mesh[] =>
  body.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

describe('buildDoorBody: standard arch door', () => {
  it('builds arch + keystone + two plinths + portal, and returns the portal mesh', () => {
    const { body, portal } = buildDoorBody(true, null, false);
    const ms = meshes(body);
    // arch, keystone, plinth x2, portal
    expect(ms.length).toBe(5);
    expect(portal).toBeDefined();
    expect(body.children).toContain(portal);
  });

  it('positions the portal at y=2.15 with the classic 1x1.35x1 oval scale', () => {
    const { portal } = buildDoorBody(false, null, false);
    expect(portal?.position.y).toBeCloseTo(2.15);
    expect(portal?.scale.x).toBeCloseTo(1);
    expect(portal?.scale.y).toBeCloseTo(1.35);
    expect(portal?.scale.z).toBeCloseTo(1);
  });

  it('the stone frame meshes cast shadows', () => {
    const { body } = buildDoorBody(true, null, false);
    // every non-portal mesh (arch/keystone/plinths) casts a shadow
    const frame = meshes(body).filter((m) => m.geometry.type !== 'CircleGeometry');
    expect(frame.length).toBe(4);
    expect(frame.every((m) => m.castShadow)).toBe(true);
  });
});

describe('buildDoorBody: Nythraxis crypt click-box', () => {
  it('an entering nythraxis_crypt door is a single invisible click-box with no portal', () => {
    const { body, portal } = buildDoorBody(true, 'nythraxis_crypt', false);
    const ms = meshes(body);
    expect(ms.length).toBe(1);
    expect(portal).toBeUndefined();
    expect(ms[0].position.y).toBeCloseTo(2.1);
  });

  it('the special-case only applies when entering (an exit uses the normal arch)', () => {
    const { body, portal } = buildDoorBody(false, 'nythraxis_crypt', false);
    expect(meshes(body).length).toBe(5);
    expect(portal).toBeDefined();
  });
});

describe('shared-resource tagging (disposal guard contract)', () => {
  it('door geometries and materials are marked shared so per-view disposal skips them', () => {
    const { body, portal } = buildDoorBody(true, null, false);
    for (const m of meshes(body)) {
      expect(isSharedGeometry(m.geometry)).toBe(true);
      expect(isSharedMaterial(m.material as THREE.Material)).toBe(true);
    }
    if (!portal) throw new Error('expected a portal mesh');
    expect(isSharedMaterial(portal.material as THREE.Material)).toBe(true);
  });

  it('reuses the same cached geometry instances across builds', () => {
    const a = buildDoorBody(true, null, false);
    const b = buildDoorBody(true, null, false);
    const archA = meshes(a.body)[0];
    const archB = meshes(b.body)[0];
    // same shared geometry object, not a fresh allocation per door
    expect(archA.geometry).toBe(archB.geometry);
  });
});

describe('portal material: tint per direction and HDR boost per tier', () => {
  const portalMat = (entering: boolean, lowGfx: boolean): THREE.MeshBasicMaterial => {
    const { portal } = buildDoorBody(entering, null, lowGfx);
    if (!portal) throw new Error('expected a portal mesh');
    return portal.material as THREE.MeshBasicMaterial;
  };

  it('entering vs exit use distinct base tints', () => {
    // low tier: no boost, so the color is the raw tint
    const enter = portalMat(true, true);
    const exit = portalMat(false, true);
    expect(enter.color.getHex()).toBe(0x9a5df0);
    expect(exit.color.getHex()).toBe(0x6ab8ff);
    expect(enter.transparent).toBe(true);
    expect(enter.blending).toBe(THREE.AdditiveBlending);
    expect(enter.depthWrite).toBe(false);
  });

  it('non-low tier multiplies the tint by the bloom boost (2x), low tier does not', () => {
    const enterHigh = portalMat(true, false);
    const enterLow = portalMat(true, true);
    // The boost multiplies the working color channels by 2 (no clamp at this tint).
    expect(enterHigh.color.r).toBeCloseTo(enterLow.color.r * 2);
    expect(enterHigh.color.r).toBeGreaterThan(enterLow.color.r);
  });
});
