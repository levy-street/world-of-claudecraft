// loadGltf's two start classes, through the REAL loader (src/render/assets/loader.ts) with
// only the GLTFLoader's network read stubbed: a file somebody needs now starts before the
// bulk stream queued ahead of it, a queued bulk load is promoted when its file is demanded
// (one promise, one fetch), and the loader never runs more than its slots at once.
// loadKtx2Texture carries the same two classes for a standalone atlas fetched ahead of need
// (the crowd prefetch's under-armor atlases).
//
// The rule itself (two lines, promotion, the limit) is pinned on the pure queue in
// tests/load_queue_core.test.ts; this file pins that the loader is wired to it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOAD_ATTEMPTS, retryDelayMs } from '../src/render/assets/load_retry';

/** The loads the stubbed GLTFLoader was asked to read, in order, each held open until the
 *  test lands it. */
const wire = vi.hoisted(() => ({
  started: [] as string[],
  land: new Map<string, (ok?: boolean) => void>(),
}));

const fileOf = (resolved: string): string => resolved.replace(/^.*\//, '').replace(/\..*$/, '');

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder(): void {}
    setKTX2Loader(): void {}
    register(): void {}
    load(url: string, onLoad: (g: unknown) => void, _p: unknown, onError: () => void): void {
      const name = fileOf(url);
      wire.started.push(name);
      wire.land.set(name, (ok = true) => {
        if (ok) onLoad({ scene: {}, name });
        else onError();
      });
    }
  },
}));
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));
// The standalone KTX2 path reads through the shared transcoder loader: the same held wire.
vi.mock('../src/render/assets/ktx2_support', () => ({
  ktx2Loader: () => ({
    load(url: string, onLoad: (t: unknown) => void, _p: unknown, onError: () => void): void {
      const name = fileOf(url);
      wire.started.push(name);
      wire.land.set(name, (ok = true) => {
        if (ok) onLoad({ name });
        else onError();
      });
    },
  }),
}));

/** The desktop GLB slot count (loader.ts gltfQueue): Node is not a constrained browser. */
const SLOTS = 4;

const url = (name: string): string => `models/test/${name}.glb`;

/** Let queued starts run (each is deferred a task) and settle the chains behind them. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
}

type Loader = typeof import('../src/render/assets/loader');

async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  wire.started.length = 0;
  wire.land.clear();
  return import('../src/render/assets/loader');
}

/** Occupy every slot with a held demand load, so whatever is asked next has to wait. */
async function fillSlots(loader: Loader): Promise<string[]> {
  const names = Array.from({ length: SLOTS }, (_, i) => `busy${i}`);
  for (const name of names) void loader.loadGltf(url(name));
  await flush();
  expect(wire.started).toEqual(names);
  return names;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadGltf start order', () => {
  it('starts a demand load before the background loads queued ahead of it', async () => {
    const loader = await freshLoader();
    const busy = await fillSlots(loader);
    // the bulk stream, then two files somebody needs now
    for (const name of ['bulk1', 'bulk2', 'bulk3']) {
      void loader.loadGltf(url(name), { priority: 'background' });
    }
    void loader.loadGltf(url('armor'));
    void loader.loadGltf(url('hair'), { priority: 'demand' });
    await flush();
    expect(wire.started).toEqual(busy);

    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started.at(-1)).toBe('armor');
    wire.land.get(busy[1])?.();
    await flush();
    expect(wire.started.at(-1)).toBe('hair');
    wire.land.get(busy[2])?.();
    wire.land.get(busy[3])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'armor', 'hair', 'bulk1', 'bulk2']);
  });

  it('promotes a queued background load when its file is demanded: one promise, one fetch', async () => {
    const loader = await freshLoader();
    const busy = await fillSlots(loader);
    const background = ['bulk1', 'bulk2', 'bulk3'].map((name) =>
      loader.loadGltf(url(name), { priority: 'background' }),
    );
    await flush();
    // a body needs the last file of the stream now
    const demanded = loader.loadGltf(url('bulk3'));
    expect(demanded).toBe(background[2]);

    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'bulk3']);
    wire.land.get('bulk3')?.();
    await expect(demanded).resolves.toMatchObject({ name: 'bulk3' });
    await flush();
    wire.land.get(busy[1])?.();
    await flush();
    // the rest of the stream follows in its own order, and bulk3 was read exactly once
    expect(wire.started).toEqual([...busy, 'bulk3', 'bulk1', 'bulk2']);
    expect(wire.started.filter((name) => name === 'bulk3')).toHaveLength(1);
  });

  it('leaves the order alone when a queued background load is asked for as background again', async () => {
    const loader = await freshLoader();
    const busy = await fillSlots(loader);
    void loader.loadGltf(url('bulk1'), { priority: 'background' });
    const second = loader.loadGltf(url('bulk2'), { priority: 'background' });
    // the same stream asked twice (a profile re-apply): still one load, still in its place
    expect(loader.loadGltf(url('bulk2'), { priority: 'background' })).toBe(second);
    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'bulk1']);
  });

  it('never reads more than its slots at once, whatever the mix', async () => {
    const loader = await freshLoader();
    const names = Array.from({ length: 14 }, (_, i) => `f${i}`);
    names.forEach((name, i) => {
      void loader.loadGltf(url(name), { priority: i % 2 === 0 ? 'background' : 'demand' });
    });
    void loader.loadGltf(url('f8')); // a promotion in the middle of it
    let landed = 0;
    for (let round = 0; round < 40 && landed < names.length; round++) {
      await flush();
      expect(wire.started.length - landed).toBeLessThanOrEqual(SLOTS);
      const next = wire.started[landed];
      if (next === undefined) continue;
      wire.land.get(next)?.();
      landed++;
    }
    await flush();
    expect(landed).toBe(names.length);
    expect([...wire.started].sort()).toEqual([...names].sort());
  });

  it('frees the slot of a load that failed', async () => {
    const loader = await freshLoader();
    const busy = await fillSlots(loader);
    const waiting = loader.loadGltf(url('next'), { priority: 'background' });
    const failing = loader.loadGltf(url(busy[0]));
    const outcome = failing.then(
      () => 'landed',
      () => 'failed',
    );
    // every attempt of the bounded retry fails (load_retry.ts)
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
      wire.land.get(busy[0])?.(false);
      await vi.advanceTimersByTimeAsync(retryDelayMs(attempt));
    }
    await expect(outcome).resolves.toBe('failed');
    await flush();
    expect(wire.started.at(-1)).toBe('next');
    wire.land.get('next')?.();
    await expect(waiting).resolves.toMatchObject({ name: 'next' });
  });
});

/** The desktop texture slot count (loader.ts textureQueue). */
const TEXTURE_SLOTS = 6;
const atlas = (name: string): string => `textures/test/${name}.ktx2`;

describe('loadKtx2Texture start order', () => {
  /** Occupy every texture slot with a held demand load. */
  async function fillTextureSlots(loader: Loader): Promise<string[]> {
    const names = Array.from({ length: TEXTURE_SLOTS }, (_, i) => `tex${i}`);
    for (const name of names) void loader.loadKtx2Texture(atlas(name));
    await flush();
    expect(wire.started).toEqual(names);
    return names;
  }

  it('starts a demand texture before the background atlases queued ahead of it', async () => {
    const loader = await freshLoader();
    const busy = await fillTextureSlots(loader);
    void loader.loadKtx2Texture(atlas('ahead1'), { priority: 'background' });
    void loader.loadKtx2Texture(atlas('ahead2'), { priority: 'background' });
    void loader.loadKtx2Texture(atlas('needed'));
    await flush();
    expect(wire.started).toEqual(busy);
    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started.at(-1)).toBe('needed');
    wire.land.get(busy[1])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'needed', 'ahead1']);
  });

  it('promotes a queued background atlas when a body asks for it: one promise, one fetch', async () => {
    const loader = await freshLoader();
    const busy = await fillTextureSlots(loader);
    void loader.loadKtx2Texture(atlas('ahead1'), { priority: 'background' });
    const queued = loader.loadKtx2Texture(atlas('ahead2'), { priority: 'background' });
    await flush();
    // a body wears the second atlas now
    const demanded = loader.loadKtx2Texture(atlas('ahead2'));
    expect(demanded).toBe(queued);
    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'ahead2']);
    wire.land.get('ahead2')?.();
    await expect(demanded).resolves.toMatchObject({ name: 'ahead2' });
    expect(wire.started.filter((name) => name === 'ahead2')).toHaveLength(1);
  });

  it('leaves a background atlas in its place when it is asked for as background again', async () => {
    const loader = await freshLoader();
    const busy = await fillTextureSlots(loader);
    void loader.loadKtx2Texture(atlas('ahead1'), { priority: 'background' });
    const second = loader.loadKtx2Texture(atlas('ahead2'), { priority: 'background' });
    expect(loader.loadKtx2Texture(atlas('ahead2'), { priority: 'background' })).toBe(second);
    wire.land.get(busy[0])?.();
    await flush();
    expect(wire.started).toEqual([...busy, 'ahead1']);
  });
});
