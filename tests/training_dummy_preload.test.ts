import { describe, expect, it, vi } from 'vitest';

// The postmortem: teleporting near the zone3 ogre camp froze the client.
// training_dummy is lazyPreload (it appears in exactly one hub), like the
// Combat Mech, but unlike the mech nothing ever triggered its lazy load:
// Renderer.createView called resolvedGltf() directly and threw "character
// asset not preloaded" every single frame once a dummy became a view
// candidate, which stalled Renderer.sync() forever (the sim tick and audio,
// on a separate per-frame path, kept running underneath, which is why the
// freeze looked like the screen alone had stopped updating).
function mockGltfLoad(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve({ scene: {}, animations: [] })),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
}

describe('training dummy lazy preload (v0.27 freeze fix)', () => {
  it('is not ready until preloadTrainingDummyAssets resolves', async () => {
    vi.resetModules();
    mockGltfLoad();
    const { preloadTrainingDummyAssets, trainingDummyAssetsReady } = await import(
      '../src/render/characters/assets'
    );

    expect(trainingDummyAssetsReady()).toBe(false);
    await preloadTrainingDummyAssets();
    expect(trainingDummyAssetsReady()).toBe(true);
  });

  it('memoizes the load: a second call reuses the same in-flight promise', async () => {
    vi.resetModules();
    mockGltfLoad();
    const loaderModule = await import('../src/render/assets/loader');
    const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');

    const first = preloadTrainingDummyAssets();
    const second = preloadTrainingDummyAssets();
    expect(second).toBe(first);
    await first;
    // The module's own eager boot sweep calls loadGltf for the rest of the
    // (mocked) catalog too, so count only the calls for the dummy's own URL.
    const loadGltf = loaderModule.loadGltf as ReturnType<typeof vi.fn>;
    const dummyCalls = loadGltf.mock.calls.filter(
      ([url]) => url === 'models/creatures/training_dummy.glb',
    );
    expect(dummyCalls).toHaveLength(1);
  });
});
