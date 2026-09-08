import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { GuardPrewarm } from '../src/render/ability_vfx/guard_prewarm';

function makeProgram() {
  return { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
}

function makeMesh(count = 4) {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  return mesh;
}

function makeHost(program = makeProgram()) {
  const programs = new Map([['main', program]]);
  const properties = { get: () => ({ programs }) };
  return {
    properties,
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
    program,
  };
}

it('borrows exact InstancedMesh buffers after hidden compilation without owning their disposal', async () => {
  const scene = new THREE.Scene();
  const mesh = makeMesh(6);
  const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
  const materialDispose = vi.spyOn(mesh.material as THREE.MeshBasicMaterial, 'dispose');
  const prep = new GuardPrewarm(scene, mesh);
  const carrier = prep.group.children[0] as THREE.InstancedMesh;
  expect(carrier.geometry).toBe(mesh.geometry);
  expect(carrier.material).toBe(mesh.material);
  expect(carrier.instanceMatrix).toBe(mesh.instanceMatrix);
  expect(carrier.instanceColor).toBe(mesh.instanceColor);
  expect(carrier.count).toBe(mesh.instanceMatrix.count);
  expect(carrier.count).toBe(6);
  expect(prep.group.visible).toBe(false);
  expect(prep.group.userData.renderCategory).toBe('prewarm');
  expect(carrier.userData.renderCategory).toBe('prewarm');
  const host = makeHost();
  let finish!: () => void;
  host.compile.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const draw = vi.fn(() => {
    expect(prep.ready()).toBe(false);
  });
  host.draw = draw;
  const units = prep.units(host);
  expect(units).toHaveLength(3);
  expect(units[0].id).toBe('guard-compile');
  expect(units[1].id).toBe('guard-touch');
  expect(units[2].id).toBe('guard-upload');
  const pending = units[0].run();
  await Promise.resolve();
  expect(prep.group.visible).toBe(false);
  expect(host.compile).toHaveBeenCalledWith(carrier, true);
  expect(prep.ready()).toBe(false);
  finish();
  await pending;
  expect(prep.ready()).toBe(false);
  await units[1].run();
  expect(prep.ready()).toBe(false);
  await units[2].run();
  expect(draw).toHaveBeenCalledWith(prep.group, carrier);
  expect(prep.ready()).toBe(true);
  expect(prep.units(host)).toEqual([]);
  prep.dispose();
  expect(prep.group.parent).toBeNull();
  expect(prep.group.children).toHaveLength(0);
  expect(geometryDispose).not.toHaveBeenCalled();
  expect(materialDispose).not.toHaveBeenCalled();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('rejects an absent instanceColor at construction', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  expect(mesh.instanceColor).toBeNull();
  expect(() => new GuardPrewarm(scene, mesh)).toThrow('instanceColor');
  geometry.dispose();
  material.dispose();
});

it('cannot call a failed compilation ready or draw it through a later resume unit, and retries only unpaid work', async () => {
  const mesh = makeMesh();
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const host = makeHost();
  host.compile.mockRejectedValueOnce(new Error('link failed'));
  const draw = vi.fn();
  host.draw = draw;
  const failed = prep.units(host);
  await expect(failed[0].run()).rejects.toThrow('link failed');
  expect(() => failed[1].run()).toThrow('was not compiled');
  expect(draw).not.toHaveBeenCalled();
  expect(prep.ready()).toBe(false);
  const retry = prep.units(host);
  for (const unit of retry) await unit.run();
  expect(prep.ready()).toBe(true);
  prep.dispose();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('retires delayed work safely when the owning pool is disposed in flight', async () => {
  const mesh = makeMesh();
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const host = makeHost();
  let finish!: () => void;
  const draw = vi.fn();
  host.draw = draw;
  host.compile.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const units = prep.units(host);
  const pending = units[0].run();
  prep.dispose();
  finish();
  await pending;
  await units[1].run();
  await units[2].run();
  expect(draw).not.toHaveBeenCalled();
  expect(prep.ready()).toBe(false);
  expect(prep.group.children).toHaveLength(0);
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('shares an in-flight compile between two simultaneous resume requests', async () => {
  const mesh = makeMesh();
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const host = makeHost();
  let finish!: () => void;
  host.compile.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const draw = vi.fn();
  host.draw = draw;
  const first = prep.units(host)[0].run();
  const second = prep.units(host)[0].run();
  expect(host.compile).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  for (const unit of prep.units(host)) await unit.run();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(prep.ready()).toBe(true);
  prep.dispose();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('touches all settled programs and asserts at least one before upload proceeds', async () => {
  const mesh = makeMesh();
  const program = makeProgram();
  const host = makeHost(program);
  const draw = vi.fn();
  host.draw = draw;
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const units = prep.units(host);
  await units[0].run();
  expect(program.getUniforms).not.toHaveBeenCalled();
  await units[1].run();
  expect(program.getUniforms).toHaveBeenCalledTimes(1);
  expect(program.getAttributes).toHaveBeenCalledTimes(1);
  await units[1].run();
  expect(program.getUniforms).toHaveBeenCalledTimes(1);
  await units[2].run();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(prep.ready()).toBe(true);
  prep.dispose();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('rejects zero settled programs before any later touch or upload can bless an empty set', async () => {
  const mesh = makeMesh();
  const emptyProperties = { get: () => ({ programs: new Map<string, never>() }) };
  const host = { properties: emptyProperties, compile: vi.fn(async () => {}), draw: vi.fn() };
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const units = prep.units(host);
  await expect(units[0].run()).rejects.toThrow('at least one');
  expect(() => units[1].run()).toThrow('was not compiled');
  expect(() => units[2].run()).toThrow('was not compiled');
  expect(host.draw).not.toHaveBeenCalled();
  expect(prep.ready()).toBe(false);
  prep.dispose();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});

it('throws from upload when touch was not completed', async () => {
  const mesh = makeMesh();
  const host = makeHost();
  const prep = new GuardPrewarm(new THREE.Scene(), mesh);
  const units = prep.units(host);
  await units[0].run();
  expect(() => units[2].run()).toThrow('untouched');
  expect(host.draw).not.toHaveBeenCalled();
  expect(prep.ready()).toBe(false);
  prep.dispose();
  mesh.geometry.dispose();
  (mesh.material as THREE.MeshBasicMaterial).dispose();
});
