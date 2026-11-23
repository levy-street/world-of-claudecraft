import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { VisualDef } from '../src/render/characters/manifest';
import type { FarBakeGate } from '../src/render/characters/visual';
import { WocAtlasSwap } from '../src/render/characters/woc_atlas_swap';

vi.mock('../src/render/characters/assets', () => ({
  applyMaterials: vi.fn(),
  atlasTextureByUrl: () => null,
  characterSourceMaterials: () => [],
  ensureAtlasByUrl: () => null,
  releaseTintedMaterials: vi.fn(),
}));

it('discards a settled atlas proof on context restore and ignores the old callback', () => {
  const swap = new WocAtlasSwap();
  const parent = new THREE.Group();
  const callbacks: Parameters<FarBakeGate>[1][] = [];
  const commit = vi.fn();
  swap.request('/atlas.ktx2', () => ({
    model: new THREE.Group(),
    parent,
    def: {} as VisualDef,
    color: 0xffffff,
    fallback: null,
    emissive: null,
    commit,
    gate: (_root, settled) => callbacks.push(settled),
  }));
  const oldScratch = parent.children[0];
  callbacks[0](() => true);
  expect(swap.settled).toBe(true);
  swap.restart();
  expect(oldScratch.parent).toBeNull();
  expect(swap.settled).toBe(false);
  callbacks[0](() => true);
  expect(swap.settled).toBe(false);
  // Even a premature commit cannot reuse the previous context's prepared bit.
  swap.commit();
  expect(commit).not.toHaveBeenCalled();
  callbacks.at(-1)!(() => true);
  expect(swap.settled).toBe(true);
  swap.commit();
  expect(commit).toHaveBeenCalledOnce();
  expect(swap.currentUrl).toBe('/atlas.ktx2');
  swap.dispose();
});
