import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { gfxInternalsForTest, resetSurfaceMaterialProfileCache } from '../src/render/gfx';
import {
  buildGroundQuestObject,
  farshoreSalvagePrewarmPlan,
  prewarmFarshoreSalvageObjects,
  questObjectPreloadInternalsForTest,
  resetQuestObjectProfileCaches,
} from '../src/render/quest_objects';

const WRECKAGE_ASSETS = [
  'wreckage_broken_planks.glb',
  'wreckage_waterlogged_barrel.glb',
  'wreckage_damaged_crate.glb',
  'wreckage_fallen_anchor.glb',
  'wreckage_hull_fragment.glb',
  'wreckage_capsized_rowboat.glb',
] as const;

let restoreGfx: (() => void) | null = null;

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  resetSurfaceMaterialProfileCache();
  resetQuestObjectProfileCaches();
});

describe('Farshore salvage render assets', () => {
  it('pins all six shipped GLBs to their visual slots, manifest, credits, and boot prewarm', () => {
    const manifest = readFileSync('src/render/assets/manifest.generated.ts', 'utf8');
    const credits = readFileSync('CREDITS.md', 'utf8');
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    expect(renderer).toMatch(
      /prewarmFarshoreSalvageObjects\(\s*buildGroundQuestObject,\s*\(poolKey, object\) =>\s*this\.storePooledObject\(poolKey, object\)/,
    );

    const expectedPlan = WRECKAGE_ASSETS.map((_, visual) => ({
      visual,
      entityId: 2_147_100_100 + visual,
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
    expect(objects).toHaveLength(WRECKAGE_ASSETS.length);
    expect(builds).toEqual(expectedPlan.map(({ itemId, entityId }) => ({ itemId, entityId })));
    expect(stores.map(({ poolKey }) => poolKey)).toEqual(
      expectedPlan.map(({ poolKey }) => poolKey),
    );

    WRECKAGE_ASSETS.forEach((filename, visual) => {
      const url = `/models/props/${filename}`;
      const entry = farshoreSalvagePrewarmPlan[visual];
      expect(entry?.visual).toBe(visual);
      expect(
        questObjectPreloadInternalsForTest.visualItemIdForEntity(entry.itemId, entry.entityId),
      ).toBe(`farshore_salvage_${visual}`);
      expect(buildGroundQuestObject(entry.itemId, entry.entityId).group.userData).toMatchObject({
        questObjectVisualItemId: `farshore_salvage_${visual}`,
      });
      expect(questObjectPreloadInternalsForTest.questObjectUrl[`farshore_salvage_${visual}`]).toBe(
        url,
      );
      const file = path.join(process.cwd(), 'public', 'models', 'props', filename);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(1_000);
      expect(manifest).toContain(`models/props/${filename}`);
      expect(credits).toContain(`Generated prop model (${filename.replace('.glb', '')})`);
    });
    expect(questObjectPreloadInternalsForTest.visualItemIdForEntity('supply_crate', 17)).toBe(
      'supply_crate',
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
