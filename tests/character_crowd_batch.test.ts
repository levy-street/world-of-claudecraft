import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CharacterCrowdBatch } from '../src/render/characters/crowd_batch';
import { type CrowdBatchGroup, groupBatchedCrowd } from '../src/render/characters/crowd_batch_core';

describe('far crowd batching', () => {
  it('groups only nonactionable batched slots by visual variant', () => {
    const groups: CrowdBatchGroup[] = [];
    const count = groupBatchedCrowd(
      [
        { slot: 1, generation: 2, variant: 'mage:blue', mode: 'batchedFar', actionable: false },
        { slot: 2, generation: 1, variant: 'mage:blue', mode: 'batchedFar', actionable: false },
        { slot: 3, generation: 1, variant: 'mage:red', mode: 'batchedFar', actionable: false },
        { slot: 4, generation: 9, variant: 'mage:red', mode: 'batchedFar', actionable: true },
        { slot: 5, generation: 1, variant: 'mage:red', mode: 'rig', actionable: false },
      ],
      groups,
    );
    expect(count).toBe(2);
    expect(groups.slice(0, count)).toEqual([
      { variant: 'mage:blue', slots: [1, 2], generations: [2, 1] },
      { variant: 'mage:red', slots: [3], generations: [1] },
    ]);
  });

  it('clears reused group storage when the crowd shrinks', () => {
    const groups: CrowdBatchGroup[] = [{ variant: 'old', slots: [99], generations: [7] }];
    expect(groupBatchedCrowd([], groups)).toBe(0);
    expect(groups[0]).toEqual({ variant: 'old', slots: [], generations: [] });
  });

  it('tracks live instance and variant counts without rebuilding bounds', () => {
    const batch = new CharacterCrowdBatch();
    const material = new THREE.MeshBasicMaterial();
    batch.registerVariant('mage', {
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material,
      capacity: 2,
      ownsMaterial: true,
    });
    batch.beginFrame();
    expect(batch.addMatrix('mage', new THREE.Matrix4().elements)).toBe(true);
    batch.endFrame();
    expect(batch.variantCount).toBe(1);
    expect(batch.instanceCount).toBe(1);
    expect((batch.group.children[0] as THREE.InstancedMesh).frustumCulled).toBe(false);
    batch.dispose();
  });
});
