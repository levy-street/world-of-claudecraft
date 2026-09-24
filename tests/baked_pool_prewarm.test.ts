import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { BakedPoolPrewarm } from '../src/render/ability_vfx/baked_pool_prewarm';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(count = 10) {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const previousTexture = new THREE.Texture();
  const meshes = Array.from({ length: count }, () => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 8, 8),
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: previousTexture },
          uNormal: { value: null },
          uFlow: { value: previousTexture },
          uLighting: { value: null },
          uAuthored: { value: 0 },
          uGutter: { value: 0.018 },
          uOpacity: { value: 0.37 },
          uFrame: { value: 12 },
          uPivot: { value: new THREE.Vector2(0.1, 0.9) },
        },
      }),
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
  const preparation = new BakedPoolPrewarm(scene, meshes);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const programs = new Map([['main', program]]);
  const host = {
    properties: { get: () => ({ programs }) },
    compile: vi.fn(async (_root: THREE.Object3D, _offscreen: boolean) => {}),
    draw: vi.fn((_group: THREE.Group, _carrier: THREE.Object3D) => {}),
  };
  cleanups.push(() => {
    preparation.dispose();
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    texture.dispose();
    previousTexture.dispose();
  });
  const values = () =>
    meshes.map((mesh) =>
      Object.fromEntries(Object.entries(mesh.material.uniforms).map(([key, u]) => [key, u.value])),
    );
  return { scene, meshes, texture, previousTexture, preparation, host, values };
}

it('prepares every actual slot through distinct units and borrowed plain-mesh buffers', async () => {
  const h = fixture();
  const before = h.values();
  const units = h.preparation.units(h.host, h.texture);
  expect(units).toHaveLength(30);
  expect(new Set(units.map((unit) => unit.id)).size).toBe(30);
  expect([...new Set(units.map((unit) => gpuPrepKindOfLabel(unit.id)))]).toEqual([
    'baked-compile',
    'baked-touch',
    'baked-upload',
  ]);
  expect(h.preparation.ready(-1)).toBe(false);
  expect(h.preparation.ready(10)).toBe(false);
  for (let i = 0; i < 10; i++) {
    expect(units.slice(i * 3, i * 3 + 3).map((u) => u.id)).toEqual([
      `baked-compile:slot:${i}`,
      `baked-touch:slot:${i}`,
      `baked-upload:slot:${i}`,
    ]);
    expect(h.preparation.ready(i)).toBe(false);
  }
  h.host.draw.mockImplementation((group, root) => {
    const carrier = root as THREE.Mesh;
    const index = h.meshes.findIndex((mesh) => mesh.geometry === carrier.geometry);
    expect(index).toBeGreaterThanOrEqual(0);
    const original = h.meshes[index];
    expect(carrier.material).toBe(original.material);
    expect(carrier.geometry.getAttribute('position')).toBe(
      original.geometry.getAttribute('position'),
    );
    expect(carrier.geometry.getIndex()).toBe(original.geometry.getIndex());
    expect((carrier as THREE.InstancedMesh).isInstancedMesh).not.toBe(true);
    expect(group.visible).toBe(false);
    expect(original.visible).toBe(false);
    expect(h.preparation.ready(index)).toBe(false);
    const u = original.material.uniforms;
    for (const name of ['uMap', 'uNormal', 'uFlow', 'uLighting'])
      expect(u[name].value).toBe(h.texture);
    expect(u.uAuthored.value).toBe(1);
    expect(u.uGutter.value).toBe(4 / 256);
    expect(u.uOpacity.value).toBe(1);
    expect(u.uFrame.value).toBe(12);
    expect(u.uPivot.value).toBe(before[index].uPivot);
  });
  for (const unit of units) await unit.run();
  expect(h.host.compile).toHaveBeenCalledTimes(10);
  expect(h.host.draw).toHaveBeenCalledTimes(10);
  expect(h.values()).toEqual(before);
  expect(h.meshes.every((_, i) => h.preparation.ready(i))).toBe(true);
  expect(h.preparation.units(h.host, h.texture)).toEqual([]);
});

it('does not change live uniforms while a compile is suspended', async () => {
  const h = fixture(1),
    before = h.values();
  let finish!: () => void;
  h.host.compile.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const units = h.preparation.units(h.host, h.texture);
  const pending = units[0].run();
  expect(h.values()).toEqual(before);
  expect(h.host.draw).not.toHaveBeenCalled();
  finish();
  await pending;
  await units[1].run();
  expect(h.values()).toEqual(before);
  expect(h.preparation.ready(0)).toBe(false);
  await units[2].run();
  expect(h.values()).toEqual(before);
  expect(h.preparation.ready(0)).toBe(true);
});

it('restores every overwritten uniform after a failed draw and retries without claiming readiness', async () => {
  const h = fixture(1),
    before = h.values();
  h.host.draw.mockImplementationOnce(() => {
    throw new Error('upload failed');
  });
  const units = h.preparation.units(h.host, h.texture);
  await units[0].run();
  await units[1].run();
  expect(() => units[2].run()).toThrow('upload failed');
  expect(h.values()).toEqual(before);
  expect(h.preparation.ready(0)).toBe(false);
  for (const unit of h.preparation.units(h.host, h.texture)) await unit.run();
  expect(h.host.compile).toHaveBeenCalledTimes(1);
  expect(h.preparation.ready(0)).toBe(true);
  expect(h.values()).toEqual(before);
});

it('failed compilation cannot reach a draw or bless any slot', async () => {
  const h = fixture(1),
    before = h.values();
  h.host.compile.mockRejectedValueOnce(new Error('compile failed'));
  const units = h.preparation.units(h.host, h.texture);
  await expect(units[0].run()).rejects.toThrow('compile failed');
  expect(() => units[1].run()).toThrow('was not compiled');
  expect(() => units[2].run()).toThrow('was not compiled');
  expect(h.host.draw).not.toHaveBeenCalled();
  expect(h.preparation.ready(0)).toBe(false);
  expect(h.values()).toEqual(before);
});

it('disposal cancels queued and in-flight work without disposing the caller resources', async () => {
  const h = fixture(2),
    before = h.values();
  const geometryDispose = h.meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
  const materialDispose = h.meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'));
  let finish!: () => void;
  h.host.compile.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const units = h.preparation.units(h.host, h.texture);
  const pending = units[0].run();
  h.preparation.dispose();
  finish();
  await pending;
  for (const unit of units.slice(1)) await unit.run();
  expect(h.host.draw).not.toHaveBeenCalled();
  expect(h.host.compile).toHaveBeenCalledTimes(1);
  expect(h.preparation.ready(0)).toBe(false);
  expect(h.preparation.ready(1)).toBe(false);
  expect(h.preparation.units(h.host, h.texture)).toEqual([]);
  expect(h.scene.children).toEqual(h.meshes);
  expect(h.values()).toEqual(before);
  for (const dispose of [...geometryDispose, ...materialDispose])
    expect(dispose).not.toHaveBeenCalled();
});

it('accepts another already-uploaded authored texture without changing the live bindings', async () => {
  const h = fixture(1),
    before = h.values();
  const shear = new THREE.Texture();
  cleanups.push(() => shear.dispose());
  h.host.draw.mockImplementation((_group, root) => {
    const material = (root as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.uniforms.uMap.value).toBe(shear);
  });
  for (const unit of h.preparation.units(h.host, shear)) await unit.run();
  expect(h.preparation.ready(0)).toBe(true);
  expect(h.values()).toEqual(before);
});
