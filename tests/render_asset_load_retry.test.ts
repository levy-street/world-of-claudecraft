import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOAD_ATTEMPTS, retryDelayMs } from '../src/render/assets/load_retry';

// Bug: a single transient network failure (common on mobile) permanently
// killed a boot-time glTF fetch, surfacing "asset load failed ... missing
// file or bad GLB" for a perfectly fine file and stranding the player behind
// the fatal "Return to Login" overlay. loadGltf must retry a bounded number
// of times before giving up.
describe('asset load retry policy', () => {
  it('backs off with a fixed, increasing schedule', () => {
    expect(retryDelayMs(1)).toBeGreaterThan(0);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
    // Deterministic, not random: same attempt number always yields the same delay.
    expect(retryDelayMs(1)).toBe(retryDelayMs(1));
  });

  it('caps at a small number of attempts (not unbounded retry-storm)', () => {
    expect(MAX_LOAD_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(MAX_LOAD_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe('loadGltf retries a transient failure before rejecting', () => {
  const url = 'models/chars/enemies/skeleton_mage.glb';

  beforeEach(() => {
    vi.resetModules();
  });

  it('succeeds if a later attempt loads fine', async () => {
    let calls = 0;
    const fakeGltf = { scene: {} };
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        setMeshoptDecoder(): void {}
        load(
          _url: string,
          onLoad: (g: unknown) => void,
          _onProgress: unknown,
          onError: () => void,
        ): void {
          calls++;
          if (calls < MAX_LOAD_ATTEMPTS) onError();
          else onLoad(fakeGltf);
        }
      },
    }));
    vi.doMock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));

    const { loadGltf } = await import('../src/render/assets/loader');
    const result = await loadGltf(url);
    expect(result).toBe(fakeGltf);
    expect(calls).toBe(MAX_LOAD_ATTEMPTS);
  });

  it('rejects, and evicts the cache entry, once every attempt fails', async () => {
    let calls = 0;
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        setMeshoptDecoder(): void {}
        load(_url: string, _onLoad: unknown, _onProgress: unknown, onError: () => void): void {
          calls++;
          onError();
        }
      },
    }));
    vi.doMock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));

    const { loadGltf } = await import('../src/render/assets/loader');
    await expect(loadGltf(url)).rejects.toThrow('missing file or bad GLB');
    expect(calls).toBe(MAX_LOAD_ATTEMPTS);

    // Cache was evicted: a later call re-attempts from scratch rather than
    // permanently replaying the same rejected promise.
    calls = 0;
    await expect(loadGltf(url)).rejects.toThrow('missing file or bad GLB');
    expect(calls).toBe(MAX_LOAD_ATTEMPTS);
  });
});
