import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';
import { abilityVfxTexturePrewarmSteps } from '../src/render/ability_vfx/prewarm';
import { abilityPrimitivePrewarmEntry } from '../src/render/ability_vfx/primitive_prewarm';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';

vi.mock('../src/render/ability_vfx/prewarm', () => ({
  abilityVfxTexturePrewarmSteps: vi.fn(() => []),
  collectAbilityVfxCompileTargets: vi.fn(() => []),
  persistentClassVfxCompileTargets: vi.fn(() => []),
}));

function fixture() {
  const order: string[] = [];
  let compiled = false;
  let uploaded = false;
  const host = {
    properties: { get: () => ({}) },
    scene: new THREE.Scene(),
    spawn: vi.fn(() => {
      order.push('visible-spawn');
    }),
    stageMaterials: vi.fn(),
    materialUnits: (): PrewarmResumeUnit[] => [],
    geometryUnits: () =>
      uploaded
        ? []
        : [
            {
              id: 'compile',
              run: async () => {
                compiled = true;
                order.push('compile');
              },
            },
            {
              id: 'upload',
              run: () => {
                expect(compiled).toBe(true);
                uploaded = true;
                order.push('upload');
              },
            },
          ],
    texture: vi.fn((_texture: THREE.Texture) => {}),
    materialTextures: vi.fn((_material: THREE.Material | THREE.Material[]) => {}),
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
    withinDeadline: () => true,
  };
  return { host, order, entry: abilityPrimitivePrewarmEntry(host) };
}

it('performs geometry compilation and actual upload during the covered loading entry', async () => {
  const { entry, host, order } = fixture();
  await entry.run();
  expect(order).toEqual(['visible-spawn', 'compile', 'upload']);
  expect(entry.progress()).toEqual({ done: 2, planned: 2, trimmed: false });
  expect(host.stageMaterials).toHaveBeenCalledTimes(1);
  expect(entry.resumePartialUnits()).toEqual([]);
});

it('retains unfinished geometry after the loading deadline without replaying visible effects', async () => {
  const { entry, host, order } = fixture();
  host.withinDeadline = () => order.length < 2;
  await entry.run();
  expect(order).toEqual(['visible-spawn', 'compile']);
  expect(entry.progress()).toEqual({ done: 1, planned: 2, trimmed: true });
  for (const unit of entry.resumePartialUnits()) await unit.run();
  expect(order.at(-1)).toBe('upload');
  expect(host.spawn).toHaveBeenCalledTimes(1);
});

it('gives a policy-skipped entry geometry preparation without any visible spawn', async () => {
  const { entry, host, order } = fixture();
  for (const unit of entry.resumeUnits()) await unit.run();
  expect(order).toEqual(['compile', 'upload']);
  expect(host.spawn).not.toHaveBeenCalled();
  expect(host.stageMaterials).not.toHaveBeenCalled();
});

beforeEach(() => {
  vi.mocked(abilityVfxTexturePrewarmSteps).mockReset().mockReturnValue([]);
});

function recoveryFixture() {
  const h = fixture(),
    texture = new THREE.Texture();
  vi.mocked(abilityVfxTexturePrewarmSteps).mockReturnValue([
    { id: 'steel', build: () => [texture] },
  ]);
  h.host.texture.mockImplementation((t) => {
    expect(t).toBe(texture);
    h.order.push('texture');
  });
  h.host.materialUnits = () => [
    {
      id: 'materials',
      run: () => {
        h.order.push('materials');
      },
    },
  ];
  return { ...h, texture };
}

it.each(['spawn', 'materials', 'second-texture'] as const)(
  'recovers actual texture and material dependencies after %s fails, before geometry and without visible respawn',
  async (failure) => {
    const h = recoveryFixture();
    if (failure === 'spawn')
      h.host.spawn.mockImplementationOnce(() => {
        throw Error('failed');
      });
    else if (failure === 'materials') h.host.stageMaterials.mockRejectedValueOnce(Error('failed'));
    else {
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
        mesh.userData.renderCategory = 'vfx';
        h.host.scene.add(mesh);
      }
      h.host.materialTextures
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw Error('failed');
        });
    }
    await expect(h.entry.run()).rejects.toThrow('failed');
    if (failure === 'second-texture') expect(h.host.materialTextures).toHaveBeenCalledTimes(2);
    h.order.length = 0;
    const units = h.entry.resumePartialUnits();
    expect(units.map((u) => u.id)).toEqual(['texture:steel', 'materials', 'compile', 'upload']);
    for (const unit of units) await unit.run();
    expect(h.order).toEqual(['texture', 'materials', 'compile', 'upload']);
    expect(h.host.texture).toHaveBeenCalledExactlyOnceWith(h.texture);
    expect(h.host.spawn).toHaveBeenCalledTimes(1);
    h.texture.dispose();
    h.host.scene.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.geometry.dispose();
        (n.material as THREE.Material).dispose();
      }
    });
  },
);

it('keeps a successful texture sweep on deadline trim and resumes only unfinished geometry', async () => {
  const h = recoveryFixture();
  h.host.withinDeadline = () => false;
  await h.entry.run();
  h.order.length = 0;
  const units = h.entry.resumePartialUnits();
  expect(units.map((u) => u.id)).toEqual(['compile', 'upload']);
  for (const unit of units) await unit.run();
  expect(h.order).toEqual(['compile', 'upload']);
  expect(h.host.texture).not.toHaveBeenCalled();
  expect(h.host.spawn).toHaveBeenCalledTimes(1);
  h.texture.dispose();
});

it('invalidates a prior successful sweep when a later boot attempt fails before textures', async () => {
  const h = recoveryFixture();
  h.host.withinDeadline = () => false;
  await h.entry.run();
  h.host.stageMaterials.mockRejectedValueOnce(Error('retry failed'));
  await expect(h.entry.run()).rejects.toThrow('retry failed');
  h.order.length = 0;
  for (const unit of h.entry.resumePartialUnits()) await unit.run();
  expect(h.order).toEqual(['texture', 'materials', 'compile', 'upload']);
  expect(h.host.spawn).toHaveBeenCalledTimes(2);
  h.texture.dispose();
});
