import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logAssetMissOnce } from '../src/render/characters/asset_miss_log';
import { mergeSkinnedParts } from '../src/render/characters/rig_merge';
import {
  WOC_WARRIOR_MANIFEST,
  type WocCharacterManifest,
} from '../src/render/characters/woc_character_manifest';
import { applyWocPartVisibility, resolveWocPartNodes } from '../src/render/characters/woc_parts';
import {
  wocAllPartNames,
  wocDefaultAppearance,
  wocMergePartition,
  wocVisibleParts,
} from '../src/render/characters/woc_parts_core';

vi.mock('../src/render/characters/asset_miss_log', () => ({ logAssetMissOnce: vi.fn() }));

const MANIFEST: WocCharacterManifest = {
  ...WOC_WARRIOR_MANIFEST,
  appearance: {},
  defaultAppearance: {},
  armorSlots: { chest: { label: 'Chest' }, hands: { label: 'Hands' } },
  items: {
    original_chest: WOC_WARRIOR_MANIFEST.items.original_chest,
    original_gauntlets: WOC_WARRIOR_MANIFEST.items.original_gauntlets,
  },
  defaultEquipment: { chest: 'original_chest', hands: 'original_gauntlets' },
};

/** All pieces share a material and rig, so only the real WOC partition keeps
 *  independently equipped slots from merging together. */
function mergedBody(names: readonly string[] = wocAllPartNames(MANIFEST)): THREE.Object3D {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  root.add(bone);
  const skeleton = new THREE.Skeleton([bone], [new THREE.Matrix4()]);
  const material = new THREE.MeshBasicMaterial();
  for (const [index, name] of names.entries()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([index, 0, 0, index + 0.5, 0, 0, index, 1, 0], 3),
    );
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    geometry.setIndex([0, 1, 2]);
    const part = new THREE.SkinnedMesh(geometry, material);
    part.name = name;
    part.bind(skeleton, new THREE.Matrix4());
    root.add(part);
  }
  mergeSkinnedParts(root, new Set(), {
    partitionKey: (mesh) => wocMergePartition(MANIFEST, mesh.name),
  });
  // The cached assembled body is cloned before live equipment resolves nodes.
  return clone(root);
}

beforeEach(() => vi.clearAllMocks());

describe('WOC part resolution after the real skinned merge', () => {
  it('resolves both halves of each merged item on the cloned body', () => {
    const root = mergedBody();
    const parts = resolveWocPartNodes(root, MANIFEST);
    expect([...parts.keys()].sort()).toEqual([...wocAllPartNames(MANIFEST)].sort());
    const chest = parts.get('Armor_Original_Chest_Front');
    const gauntlets = parts.get('Armor_Original_Gauntlet_L');
    expect(chest).toHaveLength(1);
    expect(gauntlets).toHaveLength(1);
    expect(parts.get('Armor_Original_Chest_Back')?.[0]).toBe(chest?.[0]);
    expect(parts.get('Armor_Original_Gauntlet_R')?.[0]).toBe(gauntlets?.[0]);
    const chestMesh = chest?.[0] as THREE.SkinnedMesh | undefined;
    expect(chestMesh?.geometry.getAttribute('position').count).toBe(6);
    expect(logAssetMissOnce).not.toHaveBeenCalled();
  });

  it('toggles one merged equipment slot without affecting the other slot or body', () => {
    const parts = resolveWocPartNodes(mergedBody(), MANIFEST);
    const chest = parts.get('Armor_Original_Chest_Front')?.[0];
    const gauntlets = parts.get('Armor_Original_Gauntlet_L')?.[0];
    expect(chest).not.toBe(gauntlets);
    for (const [chestOn, handsOn] of [
      [true, false],
      [false, true],
      [false, false],
      [true, true],
    ]) {
      const visible = wocVisibleParts(MANIFEST, wocDefaultAppearance(MANIFEST), {
        chest: chestOn ? 'original_chest' : null,
        hands: handsOn ? 'original_gauntlets' : null,
      });
      expect(applyWocPartVisibility(parts, MANIFEST, visible)).toBe(
        wocAllPartNames(MANIFEST).length,
      );
      expect(chest?.visible).toBe(chestOn);
      expect(gauntlets?.visible).toBe(handsOn);
      expect(parts.get('Character_Body')?.[0].visible).toBe(true);
    }
  });

  it('merges the remaining split primitives, and reports only a BASE part as a miss', () => {
    // An armor half with no node is not a miss: armor streams in its own set file
    // (woc_armor_packs.ts) and a set not attached yet is legitimately absent.
    const armorOnly = [
      'Armor_Original_Chest_Front_1',
      'Armor_Original_Chest_Front_2',
      'Armor_Original_Gauntlet_L',
      'Armor_Original_Gauntlet_R',
    ];
    const parts = resolveWocPartNodes(mergedBody(['Character_Body', ...armorOnly]), MANIFEST);
    expect(parts.get('Armor_Original_Chest_Front')).toHaveLength(1);
    expect(parts.has('Armor_Original_Chest_Back')).toBe(false);
    expect(logAssetMissOnce).not.toHaveBeenCalled();
    // the base body itself missing is the silent-failure class, said once
    resolveWocPartNodes(mergedBody(armorOnly), MANIFEST);
    expect(logAssetMissOnce).toHaveBeenCalledExactlyOnceWith(
      'woc-parts:woc_humanoid_v1:male',
      'WOC body woc_humanoid_v1: manifest parts resolved to no node: Character_Body',
      undefined,
    );
  });
});
