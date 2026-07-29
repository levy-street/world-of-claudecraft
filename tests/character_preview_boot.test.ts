import { describe, expect, it, vi } from 'vitest';

// The bug: the landing character-creation preview was gated on the site-wide
// assetsReady() promise with no failure handler. That promise covers EVERY
// registered preload (terrain, dungeon, foliage, character GLBs, ...), so a
// single transient failure ANYWHERE permanently sank the character preview
// with zero retry, most likely on a cold, first-visit cache (no warm HTTP
// cache to mask a flaky fetch). charactersReady() is the narrower fix: it
// only waits on character-boot assets and retries whatever is still missing,
// since loadGltf/loadTexture evict a failed URL from their cache on
// rejection, making a fresh call a real re-fetch attempt.
function mockGltfLoad(failFirstNCalls: number): { calls: Map<string, number> } {
  const calls = new Map<string, number>();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => {
      const n = (calls.get(url) ?? 0) + 1;
      calls.set(url, n);
      if (n <= failFirstNCalls) return Promise.reject(new Error(`transient failure: ${url}`));
      return Promise.resolve({ scene: {}, animations: [] });
    }),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve({})),
    releaseGltf: vi.fn(),
  }));
  return { calls };
}

describe('character preview boot (first-visit transient asset failure)', () => {
  it('retries a failed character GLB and eventually resolves', async () => {
    vi.resetModules();
    const { calls } = mockGltfLoad(1); // every URL fails once, then succeeds
    const { charactersReady } = await import('../src/render/characters/assets');

    await expect(charactersReady(3)).resolves.toBeUndefined();
    // Decisive on the actual readiness check (gltfByUrl.has(assetUrl(u))): every
    // URL must have been retried exactly twice (the initial failure plus the one
    // retry that succeeds), never zero (which would mean the loop fell out
    // without actually resolving anything) and never three (which would mean
    // the early-return on an empty missing set regressed and kept re-fetching
    // URLs that were already cached).
    expect(calls.size).toBeGreaterThan(0);
    for (const count of calls.values()) expect(count).toBe(2);
  });

  it('rejects once every attempt is exhausted, instead of hanging forever', async () => {
    vi.resetModules();
    mockGltfLoad(Number.POSITIVE_INFINITY); // every URL always fails
    const { charactersReady } = await import('../src/render/characters/assets');

    await expect(charactersReady(2)).rejects.toThrow(/character preview assets failed to load/);
  });
});
