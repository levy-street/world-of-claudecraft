import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { variantGripTransform } from '../src/render/characters/weapon_grip';
import { flattenWeaponAttachmentScene } from '../src/render/characters/weapon_scene';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const GENERATED_WEAPON_MODELS = new Set([
  'bug_squasher_hammer',
  'commit_blade_sword',
  'keyboard_sword',
]);

interface GlbJson {
  accessors?: Array<{
    componentType?: number;
    normalized?: boolean;
  }>;
  meshes?: Array<{
    primitives?: Array<{
      attributes?: Record<string, number>;
    }>;
  }>;
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    matrix?: number[];
    rotation?: number[];
    scale?: number[];
    translation?: number[];
  }>;
}

function glbJson(path: string): GlbJson {
  const bytes = readFileSync(path);
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.toString('ascii', 16, 20)).toBe('JSON');
  return JSON.parse(
    bytes
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .replace(/\0+$/, ''),
  );
}

describe('variantGripTransform', () => {
  it('preserves the authored root transform for variant and pipeline weapons', () => {
    const scene = new THREE.Group();
    const weapon = new THREE.Group();
    weapon.position.set(0.1, 0.64, -0.2);
    weapon.rotation.set(0.2, -0.3, 0.4);
    weapon.scale.setScalar(0.725);
    scene.add(weapon);

    const holder = flattenWeaponAttachmentScene(scene, { family: 'sword' });
    expect(holder.children).toEqual([weapon]);
    expect(holder.position.toArray()).toEqual([0, 0, 0]);
    expect(holder.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(holder.scale.toArray()).toEqual([1, 1, 1]);
    expect(weapon.position.toArray()).toEqual([0.1, 0.64, -0.2]);
    expect(weapon.rotation.toArray().slice(0, 3)).toEqual([0.2, -0.3, 0.4]);
    expect(weapon.scale.toArray()).toEqual([0.725, 0.725, 0.725]);
  });

  it('keeps legacy KayKit flattening when variant-grip resolution returns null', () => {
    const scene = new THREE.Group();
    const weapon = new THREE.Group();
    weapon.position.set(0.1, 0.64, -0.2);
    weapon.rotation.set(0.2, -0.3, 0.4);
    weapon.scale.setScalar(0.725);
    scene.add(weapon);

    const holder = flattenWeaponAttachmentScene(scene, null);
    expect(holder.children).toEqual([weapon]);
    expect(holder.position.toArray()).toEqual([0, 0, 0]);
    expect(holder.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(holder.scale.toArray()).toEqual([0.725, 0.725, 0.725]);
    expect(weapon.position.toArray()).toEqual([0, 0, 0]);
    expect(weapon.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(weapon.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('reproduces the prior family grip exactly when no override is present', () => {
    expect(variantGripTransform(4, false, 0.18, 2)).toEqual({
      position: [0, 0.18, 0],
      quaternion: [0, 1, 0, 0],
      scale: 0.5,
    });
    // The v0.29 off-hand auto-mirror negates X/Z on the left hand; a zero offset
    // mirrors to -0, which is numerically identical (position.set treats them the
    // same) but distinct under toEqual, so pin the mirrored zeros explicitly.
    expect(variantGripTransform(1, true, 0.04, 2)).toEqual({
      position: [-0, 0.04, -0],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
  });

  it('composes position, rotation, and scale overrides on top of the family grip', () => {
    const grip = variantGripTransform(4, false, 0.1, 2, {
      pos: [1, 2, 3],
      rot: [180, 0, 0],
      scale: 1.5,
    });

    expect(grip.position[0]).toBeCloseTo(1);
    expect(grip.position[1]).toBeCloseTo(2.1);
    expect(grip.position[2]).toBeCloseTo(3);
    expect(grip.quaternion[0]).toBeCloseTo(0);
    expect(grip.quaternion[1]).toBeCloseTo(0);
    expect(grip.quaternion[2]).toBeCloseTo(-1);
    expect(grip.quaternion[3]).toBeCloseTo(0);
    expect(grip.scale).toBeCloseTo(0.75);
  });

  it('keeps the KayKit variant node transforms as an identity no-op', () => {
    const modelKeys = [...new Set(Object.values(ITEM_WEAPON_VARIANTS))]
      .filter((key) => !GENERATED_WEAPON_MODELS.has(key))
      .sort();

    for (const key of modelKeys) {
      const json = glbJson(`public/models/weapons/${key}.glb`);
      const scene = json.scenes?.[json.scene ?? 0];
      expect(scene?.nodes, key).toHaveLength(1);
      const root = json.nodes?.[scene?.nodes?.[0] ?? -1];
      expect(root?.matrix, key).toBeUndefined();
      expect(root?.translation, key).toBeUndefined();
      expect(root?.rotation, key).toBeUndefined();
      expect(root?.scale, key).toBeUndefined();
    }
  });

  it('keeps generated weapon positions quantized for High/Ultra N8AO rendering', () => {
    for (const key of GENERATED_WEAPON_MODELS) {
      const json = glbJson(`public/models/weapons/${key}.glb`);
      const positionAccessors = (json.meshes ?? []).flatMap((mesh) =>
        (mesh.primitives ?? []).map(
          (primitive) => json.accessors?.[primitive.attributes?.POSITION ?? -1],
        ),
      );
      expect(positionAccessors.length, key).toBeGreaterThan(0);
      for (const accessor of positionAccessors) {
        expect(accessor?.componentType, key).toBe(5122); // SHORT
        expect(accessor?.normalized, key).toBe(true);
      }
    }
  });
});
