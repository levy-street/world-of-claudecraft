// Regression coverage for the "foliage model not preloaded: models/foliage/pine_2.glb"
// world-entry crash: foliage.ts's deferred boot preload once filtered which
// pine/oak/twisted/dead variants it actually fetched to whichever GFX.leanFoliage
// value was live when the deferred lane opened (the pre-WebGL import-time tier
// guess), while placement (buildTrees) resolves against the LIVE tier initGfxTier()
// re-derives later from the real WebGL gpuRenderer string. A LOW-guessed boot never
// fetched the HIGH-only variants, so a live tier that turned out to want them threw.
//
// tests/render_asset_preload.test.ts pins the DATA shape (ALL_FOLIAGE_MODEL_URLS is
// exactly the HIGH union LOW superset). This file proves the RUNTIME behavior: that
// booting under a LOW import-time guess still actually FETCHES every HIGH-only url,
// by mocking the loader/preload registry and driving the real deferred registration
// foliage.ts performs at module import, the same way tests/eastbrook_mailbox_preload.test.ts
// drives mailbox.ts's boot preload.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  releaseGltf: vi.fn(),
  releaseTexture: vi.fn(),
  loadHdr: vi.fn(() => new Promise(() => {})),
  loadTexture: vi.fn(() => new Promise(() => {})),
}));

// foliage.ts pulls in the whole render/ world-content graph transitively (e.g.
// eastbrook_grand_armoury.ts -> eastbrook_surface_atlas.ts registers its own boot
// preload against this SAME loader module), so every export must be present, not
// just the loadGltf/releaseGltf pair foliage.ts itself calls directly.
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  releaseGltf: mocks.releaseGltf,
  releaseTexture: mocks.releaseTexture,
  loadHdr: mocks.loadHdr,
  loadTexture: mocks.loadTexture,
}));

vi.mock('../src/render/assets/preload', () => ({
  // Deferred lane: start the thunk immediately, same idiom as
  // tests/eastbrook_mailbox_preload.test.ts, so the module-import side effect (the
  // registration loop foliage.ts runs at top level) is observable without also
  // driving main.ts's real beginDeferredPreloads() gate.
  registerDeferredPreload: (start: () => Promise<unknown>) => start(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('foliage boot preload fetches every model regardless of the import-time tier guess', () => {
  it('fetches HIGH-only pine variants (pine_2/4/5) even when GFX resolves LOW at import', async () => {
    vi.stubGlobal('window', { location: { search: '?gfx=low' } });
    vi.stubGlobal('location', { search: '?gfx=low' });
    // Never resolve: this test only needs to observe which urls loadGltf was CALLED
    // with, not complete a real parse. An unresolved promise is fine because the
    // deferred registration loop above starts every thunk synchronously and does not
    // await settlement before returning.
    mocks.loadGltf.mockReturnValue(new Promise(() => {}));

    await import('../src/render/foliage');

    const fetchedUrls = new Set(mocks.loadGltf.mock.calls.map(([url]) => url as string));
    // The regression: a LOW-guessed boot used to fetch ONLY pine_1 (FOLIAGE_MODEL_URLS_LOW.pine),
    // skipping pine_2/4/5 entirely, so a live tier that later wanted them threw
    // "foliage model not preloaded" instead of finding them already resident.
    for (const highOnlyPine of [
      'models/foliage/pine_2.glb',
      'models/foliage/pine_4.glb',
      'models/foliage/pine_5.glb',
    ]) {
      expect(fetchedUrls.has(highOnlyPine), highOnlyPine).toBe(true);
    }
    // And the LOW variant every tier needs is still fetched too, so the low-tier
    // player themselves is never left short.
    expect(fetchedUrls.has('models/foliage/pine_1.glb')).toBe(true);
    // The unused-but-shipped pine_3 stays correctly excluded on every tier (see
    // foliage.ts: "pine_3 is shipped but unused").
    expect(fetchedUrls.has('models/foliage/pine_3.glb')).toBe(false);
  });
});
