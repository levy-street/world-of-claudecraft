import * as THREE from 'three';
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
        setKTX2Loader(): void {}
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
        setKTX2Loader(): void {}
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

// releaseHdr is the HDR twin of releaseGltf/releaseTexture: the sky residency
// lane disposes a far realm's decoded HDR, and unless the loader's promise
// cache is dropped in the same step the next ensure is handed that disposed
// texture straight back out of the cache.
describe('loadHdr cache release', () => {
  const url = '/env/vale_day_2k.hdr';

  beforeEach(() => {
    vi.resetModules();
  });

  it('re-fetches after a release, and discriminates on maxWidth', async () => {
    const calls: string[] = [];
    vi.doMock('three/addons/loaders/RGBELoader.js', () => ({
      RGBELoader: class {
        load(loaded: string, onLoad: (tex: unknown) => void): void {
          calls.push(loaded);
          const tex = new THREE.DataTexture(new Uint16Array(4 * 2 * 1), 2, 1);
          tex.type = THREE.HalfFloatType;
          onLoad(tex);
        }
      },
    }));

    const { loadHdr, releaseHdr } = await import('../src/render/assets/loader');
    const first = await loadHdr(url);
    expect(calls).toHaveLength(1);
    expect(await loadHdr(url)).toBe(first);
    expect(calls).toHaveLength(1);

    // A release under the WRONG key must not drop the entry: the maxWidth
    // variant is a separate decode on its own cache line.
    releaseHdr(url, { maxWidth: 512 });
    expect(await loadHdr(url)).toBe(first);
    expect(calls).toHaveLength(1);

    releaseHdr(url);
    const second = await loadHdr(url);
    expect(calls).toHaveLength(2);
    expect(second).not.toBe(first);

    // ...and the same for the PMREM-source variant the sky module loads.
    const small = await loadHdr(url, { maxWidth: 512 });
    expect(calls).toHaveLength(3);
    expect(await loadHdr(url, { maxWidth: 512 })).toBe(small);
    releaseHdr(url, { maxWidth: 512 });
    expect(await loadHdr(url, { maxWidth: 512 })).not.toBe(small);
    expect(calls).toHaveLength(4);
  });
});

describe('loadHdr evicts a terminal failure so a later ensure can recover', () => {
  const url = '/env/marsh_overcast_2k.hdr';

  beforeEach(() => {
    vi.resetModules();
  });

  it('fail-all then recover, on both the default and maxWidth cache keys', async () => {
    // Review round 2: a rejected promise left in hdrCache poisoned every
    // later ensure for the session, defeating the sky evict-and-refetch lane
    // after an outage outlived the bounded retry window.
    let failing = true;
    const calls: string[] = [];
    vi.doMock('three/addons/loaders/RGBELoader.js', () => ({
      RGBELoader: class {
        load(
          loaded: string,
          onLoad: (tex: unknown) => void,
          _onProgress: unknown,
          onError: () => void,
        ): void {
          calls.push(loaded);
          if (failing) {
            onError();
            return;
          }
          const tex = new THREE.DataTexture(new Uint16Array(4 * 2 * 1), 2, 1);
          tex.type = THREE.HalfFloatType;
          onLoad(tex);
        }
      },
    }));

    const { loadHdr } = await import('../src/render/assets/loader');
    await expect(loadHdr(url)).rejects.toThrow('hdr load failed');
    await expect(loadHdr(url, { maxWidth: 512 })).rejects.toThrow('hdr load failed');
    const failedCalls = calls.length;
    expect(failedCalls).toBeGreaterThanOrEqual(2 * MAX_LOAD_ATTEMPTS);

    // Connectivity returns: the SAME urls must issue fresh attempts (a
    // poisoned cache would resolve to the old rejection with zero new calls).
    failing = false;
    const dome = await loadHdr(url);
    expect(dome).toBeTruthy();
    const env = await loadHdr(url, { maxWidth: 512 });
    expect(env).toBeTruthy();
    expect(calls.length).toBe(failedCalls + 2);

    // And the recovered entries cache normally again.
    expect(await loadHdr(url)).toBe(dome);
    expect(await loadHdr(url, { maxWidth: 512 })).toBe(env);
    expect(calls.length).toBe(failedCalls + 2);
  });
});

describe('loadKtx2Texture evicts a terminal failure so a later apply can recover', () => {
  const url = 'textures/terrain/grass_albedo.ktx2';

  beforeEach(() => {
    vi.resetModules();
  });

  it('fail-all then recover, on both the clamp and repeat cache keys', async () => {
    // Review round 3: a rejected promise left in ktx2TexCache poisoned every
    // later load for the session. The terrain, surface-detail and stone-normal
    // owners clear their tasks and a graphics-profile apply rolls back, so a
    // second Apply is meant to retry, but it was handed the old rejection and
    // issued no request at all.
    let failing = true;
    const calls: string[] = [];
    vi.doMock('../src/render/assets/ktx2_support', () => ({
      ktx2Loader: () => ({
        load: (
          loaded: string,
          onLoad: (tex: unknown) => void,
          _onProgress: unknown,
          onError: () => void,
        ): void => {
          calls.push(loaded);
          if (failing) {
            onError();
            return;
          }
          onLoad({ isCompressedTexture: true });
        },
      }),
    }));

    const { loadKtx2Texture } = await import('../src/render/assets/loader');
    await expect(loadKtx2Texture(url)).rejects.toThrow('ktx2 texture load failed');
    await expect(loadKtx2Texture(url, { repeat: true })).rejects.toThrow(
      'ktx2 texture load failed',
    );
    const failedCalls = calls.length;
    expect(failedCalls).toBeGreaterThanOrEqual(2 * MAX_LOAD_ATTEMPTS);

    // The asset comes back: both cache keys must issue fresh attempts (a
    // poisoned cache would replay the old rejection with zero new calls).
    failing = false;
    const clamped = await loadKtx2Texture(url);
    expect(clamped).toBeTruthy();
    const repeated = await loadKtx2Texture(url, { repeat: true });
    expect(repeated.wrapS).toBe(THREE.RepeatWrapping);
    expect(calls.length).toBe(failedCalls + 2);

    // And the recovered entries cache normally again.
    expect(await loadKtx2Texture(url)).toBe(clamped);
    expect(await loadKtx2Texture(url, { repeat: true })).toBe(repeated);
    expect(calls.length).toBe(failedCalls + 2);
  });
});

describe('loadTexture evicts a terminal failure so a later load can recover', () => {
  const url = '/textures/terrain/grass_albedo.jpg';

  beforeEach(() => {
    vi.resetModules();
  });

  it('fail-all then recover, on distinct srgb and repeat cache keys', async () => {
    // Review round 3 follow-up: the same poisoned-cache defect fixed in
    // loadHdr and loadKtx2Texture lived in the third loader cache too.
    let failing = true;
    const calls: string[] = [];
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal<typeof import('three')>();
      return {
        ...actual,
        TextureLoader: class {
          load(
            loaded: string,
            onLoad: (tex: unknown) => void,
            _onProgress: unknown,
            onError: () => void,
          ): void {
            calls.push(loaded);
            if (failing) {
              onError();
              return;
            }
            onLoad(new actual.Texture());
          }
        },
      };
    });

    const { loadTexture } = await import('../src/render/assets/loader');
    await expect(loadTexture(url)).rejects.toThrow('texture load failed');
    await expect(loadTexture(url, { srgb: true, repeat: true })).rejects.toThrow(
      'texture load failed',
    );
    const failedCalls = calls.length;
    expect(failedCalls).toBeGreaterThanOrEqual(2 * MAX_LOAD_ATTEMPTS);

    // A later load of the SAME url must issue a fresh attempt on both keys.
    failing = false;
    const plain = await loadTexture(url);
    expect(plain).toBeTruthy();
    const wrapped = await loadTexture(url, { srgb: true, repeat: true });
    expect(wrapped.wrapS).toBe(THREE.RepeatWrapping);
    expect(calls.length).toBe(failedCalls + 2);

    // And the recovered entries memoize normally again.
    expect(await loadTexture(url)).toBe(plain);
    expect(await loadTexture(url, { srgb: true, repeat: true })).toBe(wrapped);
    expect(calls.length).toBe(failedCalls + 2);
  });
});
