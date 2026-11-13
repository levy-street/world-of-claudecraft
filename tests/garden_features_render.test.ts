import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGardenFeatures,
  gardenFeaturesPreloadInternalsForTest,
  WATCHER_SPOTS,
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
    gardenFeaturesPreloadInternalsForTest.setWatcherScene(null);
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

  it('stands the kit bust at each of the four Fountain Court spots, facing the fountain', () => {
    restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a8a });
    sourceMaterial.name = 'eh_ashlar';
    const { scene, geometry } = sceneWithMesh(sourceMaterial);
    gardenFeaturesPreloadInternalsForTest.setWatcherScene(scene);

    const view = buildGardenFeatures(WORLD_SEED);
    const busts = view.group.children.filter(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.geometry === geometry,
    );
    expect(busts).toHaveLength(1);
    const bust = busts[0];
    expect(bust.count).toBe(4);
    expect(WATCHER_SPOTS).toHaveLength(4);
    // the cached kit material is cloned, never handed out
    expect(bust.material).not.toBe(sourceMaterial);
    expect((bust.material as THREE.Material).name).toBe('eh_ashlar');
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const facing = new THREE.Vector3();
    WATCHER_SPOTS.forEach(([x, z], i) => {
      bust.getMatrixAt(i, m);
      at.setFromMatrixPosition(m);
      expect(at.x).toBeCloseTo(x, 6);
      expect(at.z).toBeCloseTo(z, 6);
      // local +z turned toward the fountain at (360, 1016.5)
      facing.set(0, 0, 1).transformDirection(m);
      const toFountain = new THREE.Vector3(360 - x, 0, 1016.5 - z).normalize();
      expect(facing.dot(toFountain)).toBeCloseTo(1, 5);
    });
  });

  it('draws no watcher before the bust model has loaded, and never the old primitive figure', () => {
    restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    const view = buildGardenFeatures(WORLD_SEED);
    // with no model in hand the group holds no instanced mesh of four at all
    const fours = view.group.children.filter(
      (child) => child instanceof THREE.InstancedMesh && child.count === 4,
    );
    expect(fours).toHaveLength(0);
    expect(gardenFeaturesPreloadInternalsForTest.watcherAssetUrl).toBe(
      '/models/biome/kcas_decor_statue.glb',
    );
  });
});
