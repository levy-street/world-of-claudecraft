import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { buildHoardEntrance } from '../src/render/hoard_entrance';
import {
  disposeUnsharedMeshResources,
  isSharedGeometry,
  isSharedMaterial,
} from '../src/render/shared_resource';

function asset() {
  const root = new THREE.Group();
  const earth = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.5, 4),
    new THREE.MeshStandardMaterial({ color: 0x603d22 }),
  );
  earth.name = 'HoardEarthAndStone';
  root.add(earth);
  const hatch = new THREE.Group();
  hatch.name = 'HatchAssembly';
  hatch.rotation.x = -1.42;
  const metal = new THREE.MeshStandardMaterial({ color: 0xa09070 });
  metal.name = 'HoardRarityMetalwork';
  hatch.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), metal));
  root.add(hatch);
  return root;
}
const entity = {
  pos: { x: 10, y: 3, z: 20 },
  facing: Math.PI / 2,
  vaultRarity: 'legendary' as const,
};

describe('buried hoard body ownership and reveal', () => {
  it('deforms quantized scaled earth in world units without integer overflow or horizontal drift', () => {
    const source = asset();
    const original = source.getObjectByName('HoardEarthAndStone') as THREE.Mesh;
    const positions = new THREE.Int16BufferAttribute(
      [32767, 22000, 20000, -32767, -22000, -20000, 10000, 12000, -25000],
      3,
      true,
    );
    original.geometry = new THREE.BufferGeometry();
    original.geometry.setAttribute('position', positions);
    original.scale.set(2.86664, 1.7, 2.2);
    original.position.set(0.2, 0.63, -0.3);
    original.rotation.set(0.23, -0.4, 0.1);
    const saved = positions.array.slice();
    const flat = buildHoardEntrance(
      entity,
      () => 3,
      () => true,
      source,
    ).body;
    const ground = (x: number, z: number) => 3 + (x - 10) * 0.8 + (z - 20) * 0.6;
    const sloped = buildHoardEntrance(entity, ground, () => true, source).body;
    const flatEarth = flat.getObjectByName('HoardEarthAndStone') as THREE.Mesh;
    const slopeEarth = sloped.getObjectByName('HoardEarthAndStone') as THREE.Mesh;
    expect(slopeEarth.geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
    flat.updateMatrixWorld(true);
    sloped.updateMatrixWorld(true);
    for (let i = 0; i < positions.count; i++) {
      const before = new THREE.Vector3()
        .fromBufferAttribute(flatEarth.geometry.getAttribute('position'), i)
        .applyMatrix4(flatEarth.matrixWorld);
      const after = new THREE.Vector3()
        .fromBufferAttribute(slopeEarth.geometry.getAttribute('position'), i)
        .applyMatrix4(slopeEarth.matrixWorld);
      // Facing PI/2 maps local +Z to world +X, and local +X to world -Z.
      const expectedDelta = ground(10 + before.z, 20 - before.x) - 3;
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.z).toBeCloseTo(before.z, 5);
      expect(after.y - before.y).toBeCloseTo(expectedDelta, 5);
    }
    expect(positions.array).toEqual(saved);
    expect(original.geometry.getAttribute('position')).toBe(positions);
  });

  it('keeps the real low-preset body visible and raycastable without cosmetic light meshes', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const body = buildHoardEntrance(
        entity,
        () => 3,
        () => true,
        asset(),
      ).body;
      body.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(1.8, 10, 0), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(body, true);
      expect(hits.some((hit) => hit.object.name === 'HoardEarthAndStone')).toBe(true);
      expect(hits.every((hit) => hit.object.visible)).toBe(true);
      expect(body.visible).toBe(true);
      const effects = body.children[1];
      expect(effects.children).toHaveLength(1);
      expect(effects.children[0].children).toHaveLength(4);
    } finally {
      restore();
    }
  });

  it('keeps source immutable, seats earth across the rotated slope, and shares rigid resources', () => {
    const source = asset();
    const ground = (x: number, z: number) => 3 + (x - 10) * 0.12 + (z - 20) * 0.08;
    const first = buildHoardEntrance(entity, ground, () => false, source).body;
    const second = buildHoardEntrance(entity, ground, () => false, source).body;
    const original = source.getObjectByName('HoardEarthAndStone') as THREE.Mesh;
    const earth = first.getObjectByName('HoardEarthAndStone') as THREE.Mesh;
    expect(earth.geometry).not.toBe(original.geometry);
    expect(isSharedGeometry(earth.geometry)).toBe(false);
    expect(earth.geometry.getAttribute('position').array).not.toEqual(
      original.geometry.getAttribute('position').array,
    );
    expect(isSharedMaterial(earth.material as THREE.Material)).toBe(true);
    const a = first.getObjectByName('HatchAssembly')!.children[0] as THREE.Mesh;
    const b = second.getObjectByName('HatchAssembly')!.children[0] as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect((a.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff8000);
    expect(source.getObjectByName('HatchAssembly')!.rotation.x).toBe(-1.42);
    expect(
      disposeUnsharedMeshResources(first, {
        geometries: true,
        materials: true,
      }),
    ).toEqual({ geometries: 2, materials: 0 });
  });

  it('begins closed until the first visible draw and opens within a second without a portal', () => {
    const built = buildHoardEntrance(
      entity,
      () => 3,
      () => false,
      asset(),
    );
    expect(built.portal).toBeUndefined();
    const hatch = built.body.getObjectByName('HatchAssembly')!;
    expect(hatch.rotation.x).toBe(0);
    const driver = built.body.children[1].children[0].children[0] as THREE.Mesh;
    const draw = driver.onBeforeRender as () => void;
    sharedUniforms.uTime.value = 100;
    draw();
    expect(hatch.rotation.x).toBeCloseTo(0);
    sharedUniforms.uTime.value = 101;
    draw();
    expect(hatch.rotation.x).toBe(-1.42);
    const calm = buildHoardEntrance(
      entity,
      () => 3,
      () => true,
      asset(),
    ).body;
    expect(calm.getObjectByName('HatchAssembly')!.rotation.x).toBe(-1.42);
  });

  it('builds the interior return hatch already open without replaying the dig reveal', () => {
    const body = buildHoardEntrance(
      entity,
      () => 3,
      () => false,
      asset(),
      true,
    ).body;
    expect(body.userData.alreadyOpen).toBe(true);
    const hatch = body.getObjectByName('HatchAssembly')!;
    expect(hatch.rotation.x).toBe(-1.42);
    const driver = body.children[1].children[0].children[0] as THREE.Mesh;
    const draw = driver.onBeforeRender as () => void;
    sharedUniforms.uTime.value = 200;
    draw();
    sharedUniforms.uTime.value = 200.1;
    draw();
    expect(hatch.rotation.x).toBe(-1.42);
  });
});
