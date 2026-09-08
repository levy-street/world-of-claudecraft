import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { CrestPrewarm } from '../src/render/ability_vfx/crest_prewarm';
import { buildFuryCutShape } from '../src/render/ability_vfx/fury_shapes';
import * as productionAssets from '../src/render/ability_vfx/production_assets';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';

const programs = new Map([
  ['canvas', { isReady: () => true, getUniforms: () => ({}), getAttributes: () => ({}) }],
]);
const properties = { get: () => ({ programs }) };

it('uploads the exact live buffers after hidden compilation and never owns their disposal', async () => {
  const scene = new THREE.Scene();
  const geometry = buildFuryCutShape();
  const material = new THREE.MeshBasicMaterial();
  const geometryDispose = vi.spyOn(geometry, 'dispose');
  const materialDispose = vi.spyOn(material, 'dispose');
  const prep = new CrestPrewarm(scene, new Map([['blood_cut', geometry]]), material);
  const carrier = prep.group.children[0] as THREE.Mesh;
  expect(carrier.geometry).toBe(geometry);
  expect(carrier.material).toBe(material);
  expect(prep.group.visible).toBe(false);
  let finish!: () => void;
  const compile = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const draw = vi.fn(() => {
    expect(prep.ready('blood_cut')).toBe(false);
  });
  const units = prep.units({ properties, compile, draw });
  const pending = units[0].run();
  await Promise.resolve();
  expect(prep.group.visible).toBe(false);
  expect(compile).toHaveBeenCalledWith(carrier, true);
  expect(prep.ready('blood_cut')).toBe(false);
  finish();
  await pending;
  expect(prep.ready('blood_cut')).toBe(false);
  await units[1].run();
  await units[2].run();
  await units[3].run();
  expect(draw).toHaveBeenCalledWith(prep.group, carrier);
  expect(prep.ready('blood_cut')).toBe(true);
  await units[0].run();
  await units[1].run();
  await units[2].run();
  await units[3].run();
  expect(compile).toHaveBeenCalledTimes(1);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(prep.units({ properties, compile, draw })).toEqual([]);
  prep.dispose();
  expect(prep.group.parent).toBeNull();
  expect(geometryDispose).not.toHaveBeenCalled();
  expect(materialDispose).not.toHaveBeenCalled();
  geometry.dispose();
  material.dispose();
});

it('cannot call a failed compilation ready or draw it through a later resume unit', async () => {
  const geometry = buildFuryCutShape();
  const material = new THREE.MeshBasicMaterial();
  const prep = new CrestPrewarm(new THREE.Scene(), new Map([['blood_cut', geometry]]), material);
  const draw = vi.fn();
  const failed = prep.units({
    properties,
    compile: async () => {
      throw new Error('link failed');
    },
    draw,
  });
  await expect(failed[0].run()).rejects.toThrow('link failed');
  expect(() => failed[1].run()).toThrow('was not compiled');
  expect(draw).not.toHaveBeenCalled();
  expect(prep.ready('blood_cut')).toBe(false);
  const retry = prep.units({ properties, compile: async () => {}, draw });
  for (const unit of retry) await unit.run();
  expect(prep.ready('blood_cut')).toBe(true);
  prep.dispose();
  geometry.dispose();
  material.dispose();
});

it('retires delayed work safely when the owning effect pool is disposed', async () => {
  const geometry = buildFuryCutShape();
  const material = new THREE.MeshBasicMaterial();
  const prep = new CrestPrewarm(new THREE.Scene(), new Map([['blood_cut', geometry]]), material);
  let finish!: () => void;
  const draw = vi.fn();
  const units = prep.units({
    properties,
    compile: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    draw,
  });
  const pending = units[0].run();
  prep.dispose();
  finish();
  await pending;
  await units[1].run();
  await units[2].run();
  await units[3].run();
  expect(draw).not.toHaveBeenCalled();
  expect(prep.ready('blood_cut')).toBe(false);
  expect(prep.group.children).toHaveLength(0);
  geometry.dispose();
  material.dispose();
});

it('settles both output variants and touches each in its own unit before any geometry draw', async () => {
  const geometry = buildFuryCutShape(),
    material = new THREE.MeshBasicMaterial();
  const prep = new CrestPrewarm(new THREE.Scene(), new Map([['blood_cut', geometry]]), material);
  let canvasReady = false;
  const canvas = { isReady: () => canvasReady, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const offscreen = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const properties = {
    get: () => ({
      programs: new Map([
        ['canvas', canvas],
        ['offscreen', offscreen],
      ]),
    }),
  };
  const draw = vi.fn();
  const units = prep.units({ properties, compile: async () => {}, draw });
  const linking = units[0].run();
  await Promise.resolve();
  await Promise.resolve();
  expect(canvas.getUniforms).not.toHaveBeenCalled();
  expect(() => units[1].run()).toThrow('was not compiled');
  canvasReady = true;
  await linking;
  expect(prep.ready('blood_cut')).toBe(false);
  await units[1].run();
  expect(canvas.getUniforms).toHaveBeenCalledTimes(1);
  expect(canvas.getAttributes).toHaveBeenCalledTimes(1);
  expect(offscreen.getUniforms).not.toHaveBeenCalled();
  expect(() => units[3].run()).toThrow('untouched programs');
  await units[2].run();
  await units[3].run();
  expect(offscreen.getUniforms).toHaveBeenCalledTimes(1);
  expect(offscreen.getAttributes).toHaveBeenCalledTimes(1);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(prep.ready('blood_cut')).toBe(true);
  prep.dispose();
  geometry.dispose();
  material.dispose();
});

it.each([0, 3])('refuses an unexpected output variant count of %i', async (count) => {
  const geometry = buildFuryCutShape(),
    material = new THREE.MeshBasicMaterial();
  const prep = new CrestPrewarm(new THREE.Scene(), new Map([['blood_cut', geometry]]), material);
  const variants = new Map(
    Array.from({ length: count }, (_, i) => [
      String(i),
      { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() },
    ]),
  );
  const draw = vi.fn();
  const units = prep.units({
    properties: { get: () => ({ programs: variants }) },
    compile: async () => {},
    draw,
  });
  await expect(units[0].run()).rejects.toThrow('one or two output programs');
  expect(prep.ready('blood_cut')).toBe(false);
  expect(draw).not.toHaveBeenCalled();
  prep.dispose();
  geometry.dispose();
  material.dispose();
});

it('releases every live crest resource even when a carrier removal listener throws', () => {
  const scene = new THREE.Scene();
  const crests = new SignatureCrests(scene);
  const probe = crests as unknown as {
    slots: Array<{ mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> }>;
    shapes: Map<string, THREE.BufferGeometry>;
  };
  const materials = probe.slots.map((s) => vi.spyOn(s.mesh.material, 'dispose'));
  const geometries = [...probe.shapes.values()].map((g) => vi.spyOn(g, 'dispose'));
  crests.preparation.group.addEventListener('removed', () => {
    throw new Error('detach failed');
  });
  expect(() => crests.dispose()).toThrow('Signature crest cleanup failed');
  for (const dispose of [...materials, ...geometries]) expect(dispose).toHaveBeenCalledTimes(1);
  expect(scene.children).toHaveLength(0);
  expect(crests.preparation.group.children).toHaveLength(0);
  expect(() => crests.dispose()).not.toThrow();
});

it('binds exact shared Warrior textures to every slot without owning disposal', () => {
  const texture = new THREE.Texture(),
    dispose = vi.spyOn(texture, 'dispose');
  const source = vi.spyOn(productionAssets, 'warriorPressureTexture').mockReturnValue(texture);
  const blood = new THREE.Texture();
  const bloodDispose = vi.spyOn(blood, 'dispose');
  const bloodSource = vi.spyOn(productionAssets, 'warriorBloodTexture').mockReturnValue(blood);
  const steel = new THREE.Texture();
  const steelDispose = vi.spyOn(steel, 'dispose');
  const steelSource = vi.spyOn(productionAssets, 'warriorSteelTexture').mockReturnValue(steel);
  const scene = new THREE.Scene(),
    crests = new SignatureCrests(scene);
  try {
    const slots = scene.children.filter((child) => child.name === 'signatureCrest') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >[];
    expect(slots).toHaveLength(8);
    for (const mesh of slots) {
      expect(mesh.material.uniforms.uPressureMap.value).toBe(texture);
      expect(mesh.material.uniforms.uBloodMap.value).toBe(blood);
      expect(mesh.material.uniforms.uSteelMap.value).toBe(steel);
    }
  } finally {
    crests.dispose();
    source.mockRestore();
    bloodSource.mockRestore();
    steelSource.mockRestore();
  }
  expect(dispose).not.toHaveBeenCalled();
  expect(bloodDispose).not.toHaveBeenCalled();
  expect(steelDispose).not.toHaveBeenCalled();
  texture.dispose();
  blood.dispose();
  steel.dispose();
});

it('shares an in-flight compile between selected-kit preparation and the ordinary catalogue', async () => {
  const geometry = buildFuryCutShape();
  const material = new THREE.MeshBasicMaterial();
  const prep = new CrestPrewarm(new THREE.Scene(), new Map([['blood_cut', geometry]]), material);
  let finish!: () => void;
  const compile = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const draw = vi.fn();
  const host = { properties, compile, draw };
  const first = prep.units(host)[0].run();
  const second = prep.units(host)[0].run();
  expect(compile).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  for (const unit of prep.units(host)) await unit.run();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(prep.ready('blood_cut')).toBe(true);
  prep.dispose();
  geometry.dispose();
  material.dispose();
});
