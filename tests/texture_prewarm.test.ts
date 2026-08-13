import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectPrewarmTextures,
  TEXTURE_PREWARM_SLICE_BUDGET_MS,
  uploadTexturesInSlices,
} from '../src/render/texture_prewarm';

// Duck-typed like three's own isTexture checks, so the collector needs no GL.
const texture = (name: string): THREE.Texture =>
  ({ isTexture: true, name }) as unknown as THREE.Texture;
const targetTexture = (name: string): THREE.Texture =>
  ({ isTexture: true, isRenderTargetTexture: true, name }) as unknown as THREE.Texture;

interface FakeNode {
  material?: unknown;
  children?: FakeNode[];
}

const traversable = (nodes: FakeNode[]) => ({
  traverse(callback: (object: unknown) => void): void {
    const visit = (node: FakeNode): void => {
      callback(node);
      for (const child of node.children ?? []) visit(child);
    };
    for (const node of nodes) visit(node);
  },
});

describe('collectPrewarmTextures', () => {
  it('collects map slots, material arrays, and ShaderMaterial uniforms, deduplicated', () => {
    const shared = texture('shared');
    const root = traversable([
      { material: { map: shared, normalMap: texture('normals'), color: { r: 1 } } },
      {
        material: [
          { map: shared },
          { uniforms: { uAtlas: { value: texture('atlas') }, uTime: { value: 3 } } },
        ],
      },
      { children: [{ material: { emissiveMap: texture('glow') } }] },
      {}, // no material at all (groups, lights)
    ]);
    const out = new Set<THREE.Texture>();
    collectPrewarmTextures(root, out);
    expect([...out].map((entry) => (entry as unknown as { name: string }).name).sort()).toEqual([
      'atlas',
      'glow',
      'normals',
      'shared',
    ]);
  });

  it('never collects render-target textures (they have no image source to upload)', () => {
    const out = new Set<THREE.Texture>();
    collectPrewarmTextures(
      traversable([
        {
          material: { map: targetTexture('rt'), uniforms: { u: { value: targetTexture('rt2') } } },
        },
      ]),
      out,
    );
    expect(out.size).toBe(0);
  });
});

describe('uploadTexturesInSlices', () => {
  it('uploads every texture and yields whenever a slice exceeds the budget', async () => {
    const uploaded: string[] = [];
    let yields = 0;
    // Each upload "costs" 5 virtual ms; with the default 8 ms budget the sweep
    // yields after every second upload.
    let clock = 0;
    const host = {
      initTexture: (entry: THREE.Texture) => {
        uploaded.push((entry as unknown as { name: string }).name);
        clock += 5;
      },
    };
    const count = await uploadTexturesInSlices(
      host,
      [texture('a'), texture('b'), texture('c'), texture('d'), texture('e')],
      {
        yieldToMain: async () => {
          yields++;
        },
        now: () => clock,
      },
    );
    expect(count).toBe(5);
    expect(uploaded).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(yields).toBe(2);
    expect(TEXTURE_PREWARM_SLICE_BUDGET_MS).toBe(8);
  });

  it('stops before the next upload once cancelled (a destroyed context)', async () => {
    const uploaded: string[] = [];
    const count = await uploadTexturesInSlices(
      { initTexture: (entry) => uploaded.push((entry as unknown as { name: string }).name) },
      [texture('a'), texture('b'), texture('c')],
      {
        yieldToMain: async () => {},
        now: () => 0,
        isCancelled: () => uploaded.length >= 2,
      },
    );
    expect(count).toBe(2);
    expect(uploaded).toEqual(['a', 'b']);
  });
});
