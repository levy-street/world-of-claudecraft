import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ fail: true, calls: 0 }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => {
    loads.calls++;
    if (loads.fail) throw new Error('Temporary dungeon asset failure');
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    return { scene };
  },
  releaseGltf: vi.fn(),
}));

import { ensureDungeonAssets } from '../src/render/dungeon';

describe('dungeon asset recovery', () => {
  it('retries a rejected asset batch and retains a successful batch', async () => {
    await expect(ensureDungeonAssets()).rejects.toThrow('Temporary dungeon asset failure');
    const firstCalls = loads.calls;
    loads.fail = false;
    await expect(ensureDungeonAssets()).resolves.toBeUndefined();
    expect(loads.calls).toBeGreaterThan(firstCalls);
    const readyCalls = loads.calls;
    await ensureDungeonAssets();
    expect(loads.calls).toBe(readyCalls);
  });
});
