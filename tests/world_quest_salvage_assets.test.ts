import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groundQuestObjectYaw } from '../src/render/farshore_salvage_assets';
import { gfxInternalsForTest, resetSurfaceMaterialProfileCache } from '../src/render/gfx';
import {
  buildGroundQuestObject,
  farshoreSalvagePrewarmPlan,
  prepareFarshoreSalvageObjects,
  prewarmFarshoreSalvageObjects,
  questObjectPreloadInternalsForTest,
  resetQuestObjectProfileCaches,
} from '../src/render/quest_objects';
import { createWorldQuestPlacerModel } from '../src/render/world_quest_placer_assets';
import { FARSHORE_SALVAGE_PLACEMENTS } from '../src/sim/content/farshore_shipwreck_layout';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial()));
    return { scene };
  }),
}));

const WRECKAGE_ASSETS = [
  'broken_planks.glb',
  'waterlogged_barrel.glb',
  'damaged_crate.glb',
  'fallen_anchor.glb',
  'hull_fragment.glb',
  'capsized_rowboat.glb',
] as const;

let restoreGfx: (() => void) | null = null;

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  resetSurfaceMaterialProfileCache();
  resetQuestObjectProfileCaches();
});

describe('Farshore salvage render assets', () => {
  it('pins all six shipped GLBs to their visual slots, manifest, credits, and boot prewarm', async () => {
    await prepareFarshoreSalvageObjects();
    const manifest = readFileSync('src/render/assets/manifest.generated.ts', 'utf8');
    const credits = readFileSync('CREDITS.md', 'utf8');
    const renderer = readFileSync('src/render/zone_prewarm_groups.ts', 'utf8');
    expect(renderer).toMatch(
      /prewarmFarshoreSalvageObjects\(\s*buildGroundQuestObject,\s*\(poolKey, built\) =>\s*h\.storePooledObject\(poolKey, built\)/,
    );

    const expectedPlan = [0, 1, 2, 3, 5].map((visual) => ({
      visual,
      entityId: 2_147_100_100 + [3, 1, 2, 9, 0, 6][visual],
      itemId: 'wreckfield_flotsam_crate',
      poolKey: `object:wreckfield_flotsam_crate:salvage-${visual}`,
    }));
    expect(farshoreSalvagePrewarmPlan).toEqual(expectedPlan);

    const builds: Array<{ itemId: string; entityId: number }> = [];
    const stores: Array<{ poolKey: string; object: object }> = [];
    const objects = prewarmFarshoreSalvageObjects(
      (itemId, entityId) => {
        builds.push({ itemId, entityId });
        return { visual: builds.length - 1 };
      },
      (poolKey, object) => stores.push({ poolKey, object }),
    );
    expect(objects).toHaveLength(5);
    expect(builds).toEqual(expectedPlan.map(({ itemId, entityId }) => ({ itemId, entityId })));
    expect(stores.map(({ poolKey }) => poolKey)).toEqual(
      expectedPlan.map(({ poolKey }) => poolKey),
    );

    WRECKAGE_ASSETS.forEach((filename, visual) => {
      const url = `/models/world_quests/shipwreck/${filename}`;
      const entry = farshoreSalvagePrewarmPlan.find((row) => row.visual === visual);
      if (visual === 4) expect(entry).toBeUndefined();
      else {
        expect(entry?.visual).toBe(visual);
        if (!entry) throw new Error(`Missing collectible visual ${visual}`);
        expect(
          questObjectPreloadInternalsForTest.visualItemIdForEntity(entry.itemId, entry.entityId),
        ).toBe(`farshore_salvage_${visual}`);
        expect(buildGroundQuestObject(entry.itemId, entry.entityId).group.userData).toMatchObject({
          questObjectVisualItemId: `farshore_salvage_${visual}`,
        });
      }
      expect(questObjectPreloadInternalsForTest.questObjectUrl[`farshore_salvage_${visual}`]).toBe(
        url,
      );
      const file = path.join(
        process.cwd(),
        'public',
        'models',
        'world_quests',
        'shipwreck',
        filename,
      );
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(1_000);
      expect(manifest).toContain(`models/world_quests/shipwreck/${filename}`);
      expect(credits).toContain('public/models/world_quests/shipwreck/');
    });
    expect(questObjectPreloadInternalsForTest.visualItemIdForEntity('supply_crate', 17)).toBe(
      'supply_crate',
    );
  });

  it('matches every exported model and transform without random yaw on fresh or pooled bodies', async () => {
    await prepareFarshoreSalvageObjects();
    for (const [index, placement] of FARSHORE_SALVAGE_PLACEMENTS.entries()) {
      const id = 2147100101 + index;
      const { group, height } = buildGroundQuestObject('wreckfield_flotsam_crate', id);
      expect(group.children.map((child) => child.name)).toEqual([placement.key]);
      const wrapper = new THREE.Group();
      wrapper.add(group);
      wrapper.position.set(placement.x, placement.y, placement.z);
      wrapper.rotation.y = THREE.MathUtils.degToRad(placement.rot);
      wrapper.scale.setScalar(placement.scale);
      const preview = createWorldQuestPlacerModel(placement.key);
      preview.position.copy(wrapper.position);
      preview.rotation.copy(wrapper.rotation);
      preview.scale.copy(wrapper.scale);
      expect(group.rotation.y).toBe(0);
      group.rotation.y = 2; // pool carried a prior body rotation
      group.rotation.y = groundQuestObjectYaw('wreckfield_flotsam_crate', id);
      expect(group.rotation.y).toBe(0);
      expect(new THREE.Box3().setFromObject(wrapper)).toEqual(
        new THREE.Box3().setFromObject(preview),
      );
      expect(height).toBe(1); // native height, scaled only by the entity wrapper
    }
    expect(groundQuestObjectYaw('supply_crate', 17)).toBe((17 % 7) * 0.45);
    expect(
      questObjectPreloadInternalsForTest.visualItemIdForEntity('supply_crate', 2147100100),
    ).toBe('supply_crate');
    expect(readFileSync('src/render/renderer.ts', 'utf8')).toContain(
      "if (result.reused) body.rotation.y = groundQuestObjectYaw(e.objectItemId ?? '', e.id);",
    );
  });

  it('preserves authored double-sided PBR response maps', () => {
    restoreGfx = gfxInternalsForTest.overrideSettings({
      standardMaterials: true,
      surfaceDetail: false,
    });
    const metalnessMap = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.93,
      roughness: 0.71,
      side: THREE.DoubleSide,
    });
    source.metalnessMap = metalnessMap;
    source.roughnessMap = roughnessMap;

    const converted = questObjectPreloadInternalsForTest.convertMaterial(
      source,
      'farshore_salvage_0',
    ) as THREE.MeshStandardMaterial;

    expect(converted).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(converted.metalnessMap).toBe(metalnessMap);
    expect(converted.roughnessMap).toBe(roughnessMap);
    expect(converted.metalness).toBeCloseTo(0.93);
    expect(converted.side).toBe(THREE.DoubleSide);
  });
});
