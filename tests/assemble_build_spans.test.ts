// The compose steps of a modular body report themselves as `view-part:*`
// sub-spans (src/render/characters/assets.ts assembleModular through
// src/render/build_spans.ts): the renderer routes them into its build ledger,
// so a capture names WHICH step of a composed build burned the frame. The
// real assembleModular runs end to end over a stub GLB (the modular_far_lod
// harness: a mocked loader plus a fresh module instance), with a recording
// sink installed on that same fresh build_spans instance.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { DEFAULT_LOOK, MODULAR_WARRIOR_KEY } from '../src/render/characters/modular';

type AssetsModule = typeof import('../src/render/characters/assets');
type BuildSpansModule = typeof import('../src/render/build_spans');
type Span = { kind: string; ms: number; atMs: number };

function stubGltf() {
  const scene = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  m.name = 'body';
  scene.add(m);
  return { scene, animations: [] };
}

async function loadFresh(): Promise<{ assets: AssetsModule; spans: BuildSpansModule }> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
  }));
  const spans = (await import('../src/render/build_spans')) as BuildSpansModule;
  const assets = (await import('../src/render/characters/assets')) as AssetsModule;
  await assets.charactersReady();
  return { assets, spans };
}

describe('assembleModular emits the view-part sub-spans of one composed build', () => {
  let spansModule: BuildSpansModule | null = null;

  afterEach(() => {
    spansModule?.setBuildSpanSink(null);
    spansModule = null;
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  it('records the assemble steps, in compose order, once each, through the installed sink', async () => {
    const { assets, spans } = await loadFresh();
    spansModule = spans;
    const recorded: Span[] = [];
    spans.setBuildSpanSink((kind, ms, atMs) => recorded.push({ kind, ms, atMs }));
    const root = assets.assembleModular(VISUALS[MODULAR_WARRIOR_KEY], DEFAULT_LOOK);
    expect(root).toBeInstanceOf(THREE.Object3D);
    expect(recorded.map((s) => s.kind)).toEqual([
      'view-part:assemble:variant',
      'view-part:assemble:parts',
      'view-part:assemble:decals',
      'view-part:assemble:recolor',
      'view-part:assemble:morphs',
      'view-part:assemble:props',
    ]);
    for (const span of recorded) {
      expect(span.ms).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(span.atMs)).toBe(true);
    }
    // the sink is the only outlet: cleared, a second compose is silent
    spans.setBuildSpanSink(null);
    assets.assembleModular(VISUALS[MODULAR_WARRIOR_KEY], DEFAULT_LOOK);
    expect(recorded).toHaveLength(6);
  });
});
