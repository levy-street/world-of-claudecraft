import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGardenFeatures,
  gardenFeaturesPreloadInternalsForTest,
} from '../src/render/garden_features';
import { gfxInternalsForTest } from '../src/render/gfx';
import { WORLD_SEED } from '../src/sim/world_seed';

function sceneWithMesh(material: THREE.Material): {
  scene: THREE.Group;
  geometry: THREE.BufferGeometry;
} {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, geometry };
}

describe('Evergarden maze render features', () => {
  let restoreGfx: (() => void) | null = null;

  afterEach(() => {
    gardenFeaturesPreloadInternalsForTest.setMazeScenes(null, null);
    restoreGfx?.();
    restoreGfx = null;
  });

  it('clones cached GLB maze materials when rebuilding standard-tier instances', () => {
    restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x123456 });
    sourceMaterial.name = 'maze-source';
    const { scene, geometry } = sceneWithMesh(sourceMaterial);
    gardenFeaturesPreloadInternalsForTest.setMazeScenes(scene, null);

    const view = buildGardenFeatures(WORLD_SEED);
    const mazeMeshes = view.group.children.filter(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.geometry === geometry,
    );

    expect(mazeMeshes.length).toBeGreaterThan(0);
    for (const mesh of mazeMeshes) {
      expect(mesh.material).not.toBe(sourceMaterial);
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect((mesh.material as THREE.Material).name).toBe('maze-source');
    }
  });

  it('downgrades maze GLB materials to Lambert on low tiers without reusing the cache material', () => {
    restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f9b51,
      emissive: 0x101010,
      side: THREE.DoubleSide,
    });
    sourceMaterial.name = 'maze-low-source';
    const { scene, geometry } = sceneWithMesh(sourceMaterial);
    gardenFeaturesPreloadInternalsForTest.setMazeScenes(scene, null);

    const view = buildGardenFeatures(WORLD_SEED);
    const mazeMesh = view.group.children.find(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.geometry === geometry,
    );

    expect(mazeMesh).toBeDefined();
    if (!mazeMesh) throw new Error('missing maze instance mesh');
    expect(mazeMesh.material).not.toBe(sourceMaterial);
    expect(mazeMesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    const material = mazeMesh.material as THREE.MeshLambertMaterial;
    expect(material.name).toBe('maze-low-source');
    expect(material.color.getHex()).toBe(0x5f9b51);
    expect(material.emissive.getHex()).toBe(0x101010);
    expect(material.side).toBe(THREE.DoubleSide);
  });
});
