import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ready: false }));
vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const THREE = await import('three');
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  return {
    fragmentGeometry: () => (state.ready ? geometry : null),
    warriorRockTexture: () => null,
  };
});

import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import { prepareImpactFragments } from './helpers/impact_fragment_prewarm';

describe('demand-loaded Shaman debris', () => {
  it('finishes releasing every owned buffer even if one scene detach fails', async () => {
    state.ready = true;
    const scene = new THREE.Scene();
    const pool = new SolidImpactFragments(scene);
    await prepareImpactFragments(pool);
    const meshes = scene.children.filter((node) =>
      node.name.startsWith('solidImpact:'),
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
    const disposals = meshes.flatMap((mesh) => [
      vi.spyOn(mesh.geometry, 'dispose'),
      vi.spyOn(mesh.material, 'dispose'),
    ]);
    const carrier = scene.children.find((node) => node.name === 'signature-crest-prewarm')!;
    vi.spyOn(carrier, 'removeFromParent').mockImplementationOnce(() => {
      throw new Error('detach failed');
    });
    expect(() => pool.dispose()).toThrow('Impact fragment cleanup failed');
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(() => pool.dispose()).not.toThrow();
  });
  it('prepares late assets once and holds impacts until the scheduled compile settles', async () => {
    state.ready = false;
    const scene = new THREE.Scene();
    const pool = new SolidImpactFragments(scene);
    const burst = () => pool.burst('stone_chip', 0, 1, 0, 0xffffff, 3, 1, 0, 1, () => 0);
    expect(burst()).toBe(0);
    expect(scene.children).toHaveLength(0);
    state.ready = true;
    let resolve!: () => void;
    const compile = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const uniforms = vi.fn(() => ({}));
    const attributes = vi.fn(() => ({}));
    const programs = new Map([
      ['canvas', { isReady: () => true, getUniforms: uniforms, getAttributes: attributes }],
    ]);
    const draw = vi.fn();
    const host = { compile, draw, properties: { get: () => ({ programs }) } };
    const units = pool.prewarmUnits(host);
    await units[0].run();
    const task = units[1].run();
    expect(compile).toHaveBeenCalledOnce();
    expect(burst()).toBe(0);
    resolve();
    await task;
    expect(draw).not.toHaveBeenCalled();
    expect(burst()).toBe(0);
    compile.mockImplementation(async () => {});
    for (const unit of units.slice(2)) await unit.run();
    expect(uniforms).toHaveBeenCalled();
    expect(attributes).toHaveBeenCalled();
    expect(draw).toHaveBeenCalledTimes(3);
    const objects = [...scene.children];
    expect(objects.filter((object) => object.name.startsWith('solidImpact:'))).toHaveLength(3);
    expect(burst()).toBe(3);
    expect(pool.prewarmUnits(host)).toEqual([]);
    expect(compile).toHaveBeenCalledTimes(3);
    expect(scene.children).toEqual(objects);
    pool.dispose();
    expect(scene.children).toHaveLength(0);
    expect(pool.prewarmUnits(host)).toEqual([]);
    expect(compile).toHaveBeenCalledTimes(3);
    const rebuilt = new SolidImpactFragments(scene);
    expect(rebuilt.burst('stone_chip', 0, 1, 0, 0xffffff, 3, 1, 0, 1, () => 0)).toBe(0);
    for (const unit of rebuilt.prewarmUnits(host)) await unit.run();
    expect(compile).toHaveBeenCalledTimes(6);
    expect(rebuilt.burst('stone_chip', 0, 1, 0, 0xffffff, 3, 1, 0, 1, () => 0)).toBe(3);
    rebuilt.dispose();
  });
});
