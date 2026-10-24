import { Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Large authored maps queue many distinct GLBs before the camera starts moving.
// Nearest-placement priorities must be sampled when a slot opens, while callers
// without priorities retain FIFO order. Exercise the public loader seam.
describe('asset request queue order', () => {
  const started: string[] = [];
  const complete: (() => void)[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { deviceMemory: 8 });
    started.length = 0;
    complete.length = 0;
    vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        setMeshoptDecoder(): void {}
        setKTX2Loader(): void {}
        // the WOC level-of-detail plugin registers on every assembled loader
        register(): void {}
        load(url: string, onLoad: (gltf: unknown) => void): void {
          started.push(url);
          complete.push(() => {
            const scene = new Group();
            for (const name of ['a', 'b']) {
              const part = new Group();
              part.name = name;
              scene.add(part);
            }
            onLoad({ scene });
          });
        }
      },
    }));
    vi.doMock('../src/render/assets/ktx2_support', () => ({ ktx2Loader: () => ({}) }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('three/addons/loaders/GLTFLoader.js');
    vi.doUnmock('../src/render/assets/ktx2_support');
  });

  async function drain(): Promise<void> {
    for (let index = 0; index < complete.length; index++) {
      complete[index]();
      await vi.runAllTimersAsync();
    }
  }

  it('starts the nearest pending asset before earlier distant submissions', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const pending = Array.from({ length: 4 }, (_, index) => loadGltf(`/models/busy-${index}.glb`));
    for (const distance of [9, 2, 5]) {
      pending.push(loadGltf(`/models/distance-${distance}.glb`, () => distance));
    }
    await vi.runAllTimersAsync();
    complete[0]();
    await vi.runAllTimersAsync();
    expect(started[4]).toBe('/models/distance-2.glb');
    await drain();
    expect(started.slice(4)).toEqual([
      '/models/distance-2.glb',
      '/models/distance-5.glb',
      '/models/distance-9.glb',
    ]);
    await Promise.all(pending);
  });

  it('re-reads camera distances whenever a queued request can start', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const pending = Array.from({ length: 4 }, (_, index) => loadGltf(`/models/busy-${index}.glb`));
    let trackedDistance = 100;
    pending.push(loadGltf('/models/tracked.glb', () => trackedDistance));
    pending.push(loadGltf('/models/near.glb', () => 2));
    pending.push(loadGltf('/models/middle.glb', () => 5));
    await vi.runAllTimersAsync();
    complete[0]();
    await vi.runAllTimersAsync();
    expect(started[4]).toBe('/models/near.glb');
    trackedDistance = 1;
    complete[1]();
    await vi.runAllTimersAsync();
    expect(started[5]).toBe('/models/tracked.glb');
    await drain();
    await Promise.all(pending);
  });

  it('keeps FIFO order when supplied priorities tie', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const urls = Array.from({ length: 7 }, (_, index) => `/models/tied-${index}.glb`);
    const pending = urls.map((url) => loadGltf(url, () => 3));
    await vi.runAllTimersAsync();
    await drain();
    expect(started).toEqual(urls);
    await Promise.all(pending);
  });

  it('uses the nearest caller of a shared queued file without another request', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const pending = Array.from({ length: 4 }, (_, index) => loadGltf(`/models/busy-${index}.glb`));
    pending.push(loadGltf('/models/other.glb', () => 5));
    const shared = loadGltf('/models/shared-pending.glb', () => 100);
    pending.push(shared);
    expect(loadGltf('/models/shared-pending.glb', () => 1)).toBe(shared);
    await vi.runAllTimersAsync();
    complete[0]();
    await vi.runAllTimersAsync();
    expect(started[4]).toBe('/models/shared-pending.glb');
    await drain();
    await Promise.all(pending);
    expect(started.filter((url) => url === '/models/shared-pending.glb')).toHaveLength(1);
  });

  it('carries every fragment priority to its shared base-file fetch', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const pending = Array.from({ length: 4 }, (_, index) => loadGltf(`/models/busy-${index}.glb`));
    pending.push(loadGltf('/models/other.glb', () => 5));
    pending.push(loadGltf('/models/pieces.glb#node:a', () => 100));
    pending.push(loadGltf('/models/pieces.glb#node:b', () => 1));
    await vi.runAllTimersAsync();
    complete[0]();
    await vi.runAllTimersAsync();
    expect(started[4]).toBe('/models/pieces.glb');
    await drain();
    await Promise.all(pending);
    expect(started.filter((url) => url === '/models/pieces.glb')).toHaveLength(1);
  });

  it('bounds concurrent loads and starts waiting requests in submission order', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const urls = Array.from({ length: 7 }, (_, index) => `/models/queue-${index}.glb`);
    const pending = urls.map((url) => loadGltf(url));
    await vi.runAllTimersAsync();
    expect(started).toEqual(urls.slice(0, 4));

    // Each completion releases just one slot, preserving the pending order.
    for (let index = 0; index < urls.length; index++) {
      complete[index]();
      await vi.runAllTimersAsync();
      expect(started).toEqual(urls.slice(0, Math.min(5 + index, urls.length)));
    }
    await Promise.all(pending);
  });

  it('keeps pending order when active requests settle out of order', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const urls = Array.from({ length: 6 }, (_, index) => `/models/reversed-${index}.glb`);
    const pending = urls.map((url) => loadGltf(url));
    await vi.runAllTimersAsync();
    complete[3]();
    await vi.runAllTimersAsync();
    expect(started).toEqual(urls.slice(0, 5));
    complete[2]();
    await vi.runAllTimersAsync();
    expect(started).toEqual(urls);
    for (const index of [0, 1, 4, 5]) complete[index]();
    await Promise.all(pending);
  });

  it('shares duplicate in-flight and completed requests without another queue slot', async () => {
    const { loadGltf } = await import('../src/render/assets/loader');
    const url = '/models/shared.glb';
    const first = loadGltf(url);
    expect(loadGltf(url)).toBe(first);
    await vi.runAllTimersAsync();
    expect(started).toEqual([url]);
    complete[0]();
    const result = await first;
    expect(await loadGltf(url)).toBe(result);
    expect(started).toEqual([url]);
  });
});
