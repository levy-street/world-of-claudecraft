import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildInitialSceneCompileUnits } from '../src/render/initial_scene_compile_units';

function mesh(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BufferGeometry(), material);
}

async function run(units: ReturnType<typeof buildInitialSceneCompileUnits>): Promise<void> {
  for (const unit of units) await unit.run();
}

describe('buildInitialSceneCompileUnits', () => {
  it('collects only visible non-catalog roots for the scene group', async () => {
    const scene = new THREE.Scene();
    const visible = mesh(new THREE.MeshBasicMaterial());
    const hidden = mesh(new THREE.MeshStandardMaterial());
    hidden.visible = false;
    const catalog = new THREE.Group();
    const staged = mesh(new THREE.MeshLambertMaterial());
    catalog.add(staged);
    scene.add(visible, hidden, catalog);
    const compiled: THREE.Object3D[] = [];
    const onCompiledRoot = vi.fn();
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [['catalog', catalog]],
      includeGroup: (id) => id === 'scene',
      playerX: 0,
      playerZ: 0,
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async (root) => compiled.push(root),
      compileShadow: async () => undefined,
      onCompiledRoot,
    });

    await run(units);
    expect(compiled).toEqual([visible]);
    expect(onCompiledRoot).toHaveBeenCalledOnce();
  });

  it('traverses a selected hidden staged catalog explicitly', async () => {
    const scene = new THREE.Scene();
    const catalog = new THREE.Group();
    catalog.visible = false;
    const staged = mesh(new THREE.MeshStandardMaterial());
    staged.visible = false;
    catalog.add(staged);
    scene.add(catalog);
    const compiled: THREE.Object3D[] = [];
    const units = buildInitialSceneCompileUnits({
      scene,
      stagedGroups: [['catalog', catalog]],
      includeGroup: (id) => id === 'catalog',
      playerX: 0,
      playerZ: 0,
      batchSize: 1,
      sharedDedupe: { seen: new Set(), seenKeys: new Set() },
      compileColor: async (root) => compiled.push(root),
      compileShadow: async () => undefined,
      onCompiledRoot: () => undefined,
    });

    await run(units);
    expect(compiled).toEqual([staged]);
  });
});
