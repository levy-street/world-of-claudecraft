import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { normalizeWorldQuestPlacerModel } from '../src/render/world_quest_placer_assets';
import {
  isWorldQuestPlacerKey,
  WORLD_QUEST_PLACER_ASSETS,
  WORLD_QUEST_PLACER_KEYS,
  worldQuestPlacerUrl,
} from '../src/render/world_quest_placer_catalog';

vi.mock('../src/render/assets/loader', () => ({ loadGltf: vi.fn() }));

describe('world quest placer assets', () => {
  it('pins the seven supplied models, labels and starting sizes', () => {
    expect(
      Object.entries(WORLD_QUEST_PLACER_ASSETS).map(([key, asset]) => [
        key,
        asset.label,
        asset.file,
        asset.scale,
      ]),
    ).toEqual([
      ['wq_shipwreck', 'Shipwreck', 'shipwreck', 26],
      ['wq_broken_planks', 'Broken planks', 'broken_planks', 2],
      ['wq_waterlogged_barrel', 'Waterlogged barrel', 'waterlogged_barrel', 1.5],
      ['wq_damaged_crate', 'Damaged crate', 'damaged_crate', 1.5],
      ['wq_fallen_anchor', 'Fallen anchor', 'fallen_anchor', 2],
      ['wq_hull_fragment', 'Hull fragment', 'hull_fragment', 3],
      ['wq_capsized_rowboat', 'Capsized rowboat', 'capsized_rowboat', 5],
    ]);
    expect(WORLD_QUEST_PLACER_KEYS.map(worldQuestPlacerUrl)).toEqual([
      '/models/world_quests/shipwreck/shipwreck.glb',
      '/models/world_quests/shipwreck/broken_planks.glb',
      '/models/world_quests/shipwreck/waterlogged_barrel.glb',
      '/models/world_quests/shipwreck/damaged_crate.glb',
      '/models/world_quests/shipwreck/fallen_anchor.glb',
      '/models/world_quests/shipwreck/hull_fragment.glb',
      '/models/world_quests/shipwreck/capsized_rowboat.glb',
    ]);
  });

  it('ships every catalog model with decodable meshopt geometry and GPU-compressed textures', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(WORLD_QUEST_PLACER_KEYS).toHaveLength(7);
    for (const key of WORLD_QUEST_PLACER_KEYS) {
      const url = worldQuestPlacerUrl(key);
      const bytes = readFileSync(path.join(__dirname, '..', 'public', url));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(json.extensionsRequired).toContain('KHR_texture_basisu');
      expect(
        json.images.every((image: { mimeType: string }) => image.mimeType === 'image/ktx2'),
      ).toBe(true);
      expect(MEDIA_ASSETS[url.slice(1)], url).toBeDefined();
      const doc = await io.readBinary(bytes);
      expect(doc.getRoot().listMeshes(), key).toHaveLength(1);
      const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
      expect(prim.getIndices()!.getCount() / 3).toBeGreaterThan(900);
      expect(prim.getIndices()!.getCount() / 3).toBeLessThan(1200);
      expect(prim.getAttribute('POSITION')!.getCount()).toBeGreaterThan(0);
      expect(doc.getRoot().listTextures()).toHaveLength(1);
    }
  });

  it('centers and grounds all scene children without changing shared source geometry', () => {
    const source = new THREE.Group();
    source.position.set(8, 3, -4);
    const geometry = new THREE.BoxGeometry(2, 4, 6);
    const material = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(geometry, material);
    const b = new THREE.Mesh(geometry, [material, material]);
    b.position.x = 4;
    source.add(a, b);
    const original = new THREE.Box3().setFromObject(source).clone();
    const normalized = normalizeWorldQuestPlacerModel(source);
    const bounds = new THREE.Box3().setFromObject(normalized.root);
    expect(bounds.min.toArray()).toEqual([-3, 0, -3]);
    expect(bounds.max.toArray()).toEqual([3, 4, 3]);
    expect(normalized.native).toEqual({ len: 6, hei: 4, dep: 6 });
    expect(new THREE.Box3().setFromObject(source)).toEqual(original);
    const meshes: THREE.Mesh[] = [];
    normalized.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes[0].geometry).toBe(geometry);
    expect(Array.isArray(meshes[1].material)).toBe(true);
    for (const slot of meshes[1].material as THREE.Material[]) expect(slot).toBe(material);
    expect(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
    expect(a.castShadow).toBe(false);
  });

  it('rejects empty imports and inherited object keys', () => {
    expect(() => normalizeWorldQuestPlacerModel(new THREE.Group())).toThrow('no geometry');
    expect(isWorldQuestPlacerKey('toString')).toBe(false);
    expect(isWorldQuestPlacerKey('wq_shipwreck')).toBe(true);
  });
});
