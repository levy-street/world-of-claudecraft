import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';

// Issue #2079: a character asset that was never registered as preloaded used to
// throw synchronously from resolvedGltf inside the per-frame render path
// (Renderer.sync -> createView -> new CharacterVisual), which permanently
// stalled rendering (the v0.27.0 training dummy freeze,
// docs/training-dummy-preload-freeze-postmortem.md). The factory now fails
// soft: it returns null so the caller skips that entity's view for the frame
// (the entity stays a future view candidate), and the miss logs once per
// asset, not once per frame.
function mockGltfLoad(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve({ scene: {}, animations: [] })),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
}

// The training dummy resolves to the lazyPreload mob_training_dummy visual,
// whose GLB the eager boot sweep never fetches, so the factory hits the real
// "character asset not preloaded" path with no asset work needed.
const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

describe('createCharacterVisual fails soft on a missing preload (issue 2079)', () => {
  it('returns null instead of throwing, and logs the miss once per asset', async () => {
    vi.resetModules();
    mockGltfLoad();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createCharacterVisual } = await import('../src/render/characters/index');

    const first = createCharacterVisual(dummyEntity);
    const second = createCharacterVisual(dummyEntity);
    expect(first).toBeNull();
    expect(second).toBeNull();

    // One log for the first miss, none for the repeat; the log names the asset
    // so a real incident is diagnosable from a single line.
    const missLogs = errSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('mob_training_dummy')),
    );
    expect(missLogs).toHaveLength(1);
    errSpy.mockRestore();
  });
});

describe('createCharacterVisual happy path (issue 2079)', () => {
  it('builds a visual once the asset is preloaded, with no miss log', async () => {
    vi.resetModules();
    // A minimally real GLTF: a measurable mesh plus every clip the dummy's
    // ClipMap names, so construction exercises the actual assemble/bake path.
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
      return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
    await preloadTrainingDummyAssets();
    const { createCharacterVisual } = await import('../src/render/characters/index');

    const visual = createCharacterVisual(dummyEntity);
    expect(visual).not.toBeNull();
    const missLogs = errSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('mob_training_dummy')),
    );
    expect(missLogs).toHaveLength(0);
    errSpy.mockRestore();
  });
});

describe('logAssetMissOnce (issue 2079)', () => {
  it('logs a key the first time only, independently per key', async () => {
    vi.resetModules();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logAssetMissOnce } = await import('../src/render/characters/asset_miss_log');

    expect(logAssetMissOnce('k1', 'first k1 failure:')).toBe(true);
    expect(logAssetMissOnce('k1', 'repeat k1 failure:')).toBe(false);
    expect(logAssetMissOnce('k2', 'first k2 failure:')).toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
