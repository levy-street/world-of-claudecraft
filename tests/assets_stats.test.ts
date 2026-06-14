import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assetLoadStarted,
  assetTimingSnapshot,
  recordAssetLoad,
  recordPreloadWait,
  resetAssetTimingForTests,
} from '../src/render/assets/stats';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAssetTimingForTests();
});

describe('asset timing stats', () => {
  it('summarizes asset timings by type and records preload wait', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let now = 1000;
    vi.stubGlobal('performance', {
      now: () => now,
      getEntriesByName: (url: string) => [{ transferSize: url.includes('big') ? 2000 : 500 }],
    });

    const a = assetLoadStarted();
    now += 25;
    recordAssetLoad('gltf', '/media/big.glb', a);

    const b = assetLoadStarted();
    now += 5;
    recordAssetLoad('gltf', '/media/small.glb', b);

    const c = assetLoadStarted();
    now += 40;
    recordAssetLoad('texture', '/media/missing.png', c, true);

    const preload = assetLoadStarted();
    now += 125;
    recordPreloadWait(3, preload, true);

    const snap = assetTimingSnapshot();
    expect(snap.preload).toEqual({ tasks: 3, waitMs: 125, complete: true });
    expect(snap.byType.gltf.count).toBe(2);
    expect(snap.byType.gltf.bytes).toBe(2500);
    expect(snap.byType.gltf.maxMs).toBe(25);
    expect(snap.byType.gltf.slowest[0]).toEqual({ url: '/media/big.glb', ms: 25, bytes: 2000 });
    expect(snap.files).toEqual([
      { type: 'gltf', url: '/media/big.glb', ms: 25, bytes: 2000 },
      { type: 'gltf', url: '/media/small.glb', ms: 5, bytes: 500 },
    ]);
    expect(snap.byType.texture.failed).toBe(1);
  });
});
