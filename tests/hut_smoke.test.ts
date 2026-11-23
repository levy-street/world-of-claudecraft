// A torched mudfin hut's smoke on screen (src/render/hut_smoke.ts): one mesh, hidden until a hut
// smokes, its puffs written as camera-facing quads in the shared lit smoke material (the Mirefen
// tavern chimney's, so one program and one prewarm twin), the draw range trimmed to the puffs
// actually drawn, a culling sphere that follows them, and none of it on the low effects tier.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, type GfxTier, getActiveGfxProfile } from '../src/render/gfx';
import { HUT_FIRE_BURN_SECONDS, type HutFireBody } from '../src/render/hut_fire_core';
import {
  buildHutSmoke,
  HUT_SMOKE_MAX_PLUMES,
  hutSmokeEnabled,
  hutSmokePrewarmParts,
} from '../src/render/hut_smoke';
import { HUT_SMOKE_END_SECONDS, HUT_SMOKE_PUFFS } from '../src/render/hut_smoke_core';
import { litSmokePuffMaterial } from '../src/render/lit_smoke_puffs';
import {
  buildMirefenTavernSmoke,
  mirefenTavernSmokePrewarmPart,
} from '../src/render/mirefen_tavern_smoke';

const originalProfile = getActiveGfxProfile();
function withTier(tier: GfxTier): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, effectsTier: tier } });
}
afterEach(() => activateGfxProfile(originalProfile));

const BODY: HutFireBody = { x: -83, y: -2.5, z: 266, radius: 2.34, height: 6 };
const CAMERA = { x: -60, z: 240 };

function quads(view: ReturnType<typeof buildHutSmoke>): number {
  return view.mesh.geometry.drawRange.count / 6;
}

describe('hut smoke painter', () => {
  it('draws with its own copy of the tavern chimney material: the same program and texture', () => {
    const view = buildHutSmoke();
    const tavern = buildMirefenTavernSmoke();
    const material = view.mesh.material as THREE.MeshLambertMaterial;
    const shared = tavern.mesh.material as THREE.MeshLambertMaterial;
    expect(shared).toBe(litSmokePuffMaterial());
    // its own instance (the particle cloud disposes it), never the shared one
    expect(material).not.toBe(shared);
    // three keys a program on the material's type and parameters, so these must all match
    expect(material.type).toBe(shared.type);
    expect(material.map).toBe(shared.map);
    expect(material.customProgramCacheKey()).toBe(shared.customProgramCacheKey());
    for (const key of ['transparent', 'depthWrite', 'vertexColors', 'side', 'blending'] as const) {
      expect(material[key], key).toBe(shared[key]);
    }
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexColors).toBe(true);
    // the same attribute layout as the tavern's prewarm twin, so the same linked program
    const layout = (g: THREE.BufferGeometry) =>
      Object.entries(g.attributes).map(([name, a]) => [name, a.itemSize]);
    expect(layout(view.mesh.geometry)).toEqual(layout(mirefenTavernSmokePrewarmPart().geometry));
    expect(view.mesh.castShadow).toBe(false);
    expect(view.mesh.receiveShadow).toBe(false);
  });

  it('stays hidden and draws nothing until a hut smokes', () => {
    const view = buildHutSmoke();
    expect(view.mesh.visible).toBe(false);
    view.update([], CAMERA.x, CAMERA.z);
    expect(view.mesh.visible).toBe(false);
    expect(quads(view)).toBe(0);
  });

  it('draws a burning hut plume as quads facing the camera, over the hut', () => {
    const view = buildHutSmoke();
    view.update([{ body: BODY, age: HUT_FIRE_BURN_SECONDS }], CAMERA.x, CAMERA.z);
    expect(view.mesh.visible).toBe(true);
    const n = quads(view);
    expect(n).toBeGreaterThan(HUT_SMOKE_PUFFS / 2);
    expect(n).toBeLessThanOrEqual(HUT_SMOKE_PUFFS);
    const pos = view.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = view.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const toCamera = new THREE.Vector2(CAMERA.x - BODY.x, CAMERA.z - BODY.z).normalize();
    for (let q = 0; q < n; q++) {
      const bl = new THREE.Vector3().fromBufferAttribute(pos, q * 4);
      const br = new THREE.Vector3().fromBufferAttribute(pos, q * 4 + 1);
      const tl = new THREE.Vector3().fromBufferAttribute(pos, q * 4 + 3);
      // the quad's width runs across the view, its height straight up (float32 buffers)
      const across = new THREE.Vector2(br.x - bl.x, br.z - bl.z).normalize();
      expect(Math.abs(across.dot(toCamera))).toBeLessThan(1e-4);
      expect(tl.y - bl.y).toBeGreaterThan(0);
      expect(tl.x).toBeCloseTo(bl.x, 4);
      // above the roofline, and visible
      expect((bl.y + tl.y) / 2).toBeGreaterThan(BODY.y + BODY.height * 0.69);
      expect(col.getW(q * 4)).toBeGreaterThan(0);
      // dark grey smoke, never coloured
      expect(col.getX(q * 4)).toBeLessThan(0.4);
      expect(Math.abs(col.getX(q * 4) - col.getZ(q * 4))).toBeLessThan(0.02);
    }
    // the culling sphere sits on the plume, not at the world origin
    const sphere = view.mesh.geometry.boundingSphere as THREE.Sphere;
    expect(Math.hypot(sphere.center.x - BODY.x, sphere.center.z - BODY.z)).toBeLessThan(10);
    expect(sphere.center.y).toBeGreaterThan(BODY.y + BODY.height);
    for (let q = 0; q < n * 4; q++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, q);
      expect(sphere.containsPoint(v)).toBe(true);
    }
  });

  it('caps the plumes it draws, and hides again once they are gone', () => {
    const view = buildHutSmoke();
    const many = Array.from({ length: HUT_SMOKE_MAX_PLUMES + 3 }, (_, i) => ({
      body: { ...BODY, x: BODY.x + i * 15 },
      age: HUT_FIRE_BURN_SECONDS,
    }));
    view.update(many, CAMERA.x, CAMERA.z);
    expect(quads(view)).toBeLessThanOrEqual(HUT_SMOKE_MAX_PLUMES * HUT_SMOKE_PUFFS);
    expect(quads(view)).toBeGreaterThan((HUT_SMOKE_MAX_PLUMES - 1) * (HUT_SMOKE_PUFFS / 2));
    view.update([{ body: BODY, age: HUT_SMOKE_END_SECONDS }], CAMERA.x, CAMERA.z);
    expect(view.mesh.visible).toBe(false);
    expect(quads(view)).toBe(0);
  });

  it('frees its own buffers and material on dispose, never the shared material or texture', () => {
    const view = buildHutSmoke();
    const scene = new THREE.Scene();
    scene.add(view.mesh);
    const own = view.mesh.material as THREE.MeshLambertMaterial;
    const shared = litSmokePuffMaterial();
    const disposed: string[] = [];
    const watch = (target: THREE.EventDispatcher<{ dispose: object }>, name: string) => {
      const listener = () => disposed.push(name);
      target.addEventListener('dispose', listener);
      return () => target.removeEventListener('dispose', listener);
    };
    const unwatch = [
      watch(view.mesh.geometry, 'geometry'),
      watch(own, 'own material'),
      watch(shared, 'shared material'),
      watch(shared.map as THREE.Texture, 'shared texture'),
    ];
    view.dispose();
    for (const off of unwatch) off();
    expect(view.mesh.parent).toBeNull();
    expect(disposed.sort()).toEqual(['geometry', 'own material']);
  });
});

describe('hut smoke on the effects tiers', () => {
  it('is cosmetic: none on low, from medium up, and its prewarm twin follows', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      withTier(tier);
      expect(hutSmokeEnabled(), tier).toBe(tier !== 'low');
      const parts = hutSmokePrewarmParts();
      expect(parts.length, tier).toBe(tier === 'low' ? 0 : 1);
      for (const part of parts) expect(part.material).toBe(litSmokePuffMaterial());
    }
  });
});
