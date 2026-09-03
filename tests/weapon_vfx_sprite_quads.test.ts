import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spriteQuadPointRange } from '../src/render/sprite_quad_cloud';
import { createWeaponVfx, WEAPON_VFX } from '../src/render/weapon_vfx';

// The weapon-skin sprite clouds (motes, drift, twinkles) draw as instanced
// quads by default (sprite_quad_cloud.ts): ANGLE D3D11 emulates THREE.Points
// with a generated geometry shader. Pinned on the legendary kit, which carries
// all three cloud kinds.

// The module draws its sprite textures on a 2d canvas (the stub shape of
// weapon_vfx_shed.test.ts); everything else in it is plain Three + math.
let priorDocument: unknown;

function stubContext() {
  const gradient = { addColorStop: () => {} };
  const imageData = (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  });
  return {
    fillStyle: '',
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createImageData: imageData,
    getImageData: (_x: number, _y: number, w: number, h: number) => imageData(w, h),
    putImageData: () => {},
  };
}

beforeAll(() => {
  const globals = globalThis as { document?: unknown };
  priorDocument = globals.document;
  globals.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => stubContext() }),
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = priorDocument;
});

function weaponStub(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    ),
  );
  return root;
}

type Cloud = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

function spriteClouds(root: THREE.Object3D): Cloud[] {
  const clouds: Cloud[] = [];
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (material?.uniforms?.uScale) clouds.push(o as Cloud);
  });
  return clouds;
}

describe('weapon-skin sprite clouds', () => {
  const spec = WEAPON_VFX.solheim_last_light_of_the_dawn;

  it('build every cloud kind as one instanced quad per particle', () => {
    expect(spec).toBeTruthy();
    const handle = createWeaponVfx(weaponStub(), spec, { grounded: false, backdrop: false });
    const clouds = spriteClouds(handle.group);
    const kinds = new Set(spec.fx.map((part) => part.kind));
    expect(kinds).toContain('motes');
    expect(kinds).toContain('drift');
    expect(kinds).toContain('twinkles');
    expect(clouds.length).toBeGreaterThanOrEqual(3);
    let points = 0;
    handle.group.traverse((o) => {
      if ((o as THREE.Points).isPoints) points++;
    });
    expect(points).toBe(0);
    for (const cloud of clouds) {
      expect(cloud).toBeInstanceOf(THREE.Mesh);
      expect(cloud.frustumCulled).toBe(false);
      expect(cloud.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
      expect(cloud.geometry.getAttribute('position')).toBeInstanceOf(
        THREE.InstancedBufferAttribute,
      );
      expect(cloud.geometry.getAttribute('aCorner').count).toBe(4);
      expect(cloud.geometry.index?.count).toBe(6);
      expect(cloud.geometry.instanceCount).toBe(cloud.geometry.getAttribute('position').count);
      expect(cloud.geometry.instanceCount).toBeGreaterThan(0);
      expect(cloud.material.uniforms.uPointRange).toBe(spriteQuadPointRange);
      expect(cloud.material.blending).toBe(THREE.AdditiveBlending);
      expect(cloud.material.depthWrite).toBe(false);
      expect(cloud.material.transparent).toBe(true);
      expect(cloud.material.vertexShader).not.toContain('gl_PointSize');
      expect(cloud.material.vertexShader).toContain('max(0.15, -mv.z)');
      expect(cloud.material.vertexShader).toContain(
        'float halfExtent = spritePx * (-mv.z) / (2.0 * uScale);',
      );
      expect(cloud.material.fragmentShader).not.toContain('gl_PointCoord');
      expect(cloud.material.fragmentShader).toContain('texture2D(uMap, SPRITE_COORD)');
    }
    handle.dispose();
  });

  it('keep the per-rig viewport scale reaching every cloud', () => {
    const handle = createWeaponVfx(weaponStub(), spec, { grounded: false, backdrop: false });
    handle.setPixelScale(1440);
    const expected = (1440 * 0.5) / Math.tan((35 * Math.PI) / 360);
    for (const cloud of spriteClouds(handle.group)) {
      expect(cloud.material.uniforms.uScale.value).toBeCloseTo(expected, 6);
    }
    handle.dispose();
  });
});
