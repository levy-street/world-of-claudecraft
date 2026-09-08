import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { abilityPrimitivePrewarmEntry } from '../src/render/ability_vfx/primitive_prewarm';

vi.mock('../src/render/ability_vfx/prewarm', () => ({
  abilityVfxTexturePrewarmSteps: () => [],
  collectAbilityVfxCompileTargets: () => [],
  persistentClassVfxCompileTargets: () => [],
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
    materialUnits: () => [],
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
    texture: vi.fn(),
    materialTextures: vi.fn(),
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
