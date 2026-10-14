// The Sfx engine as the thin consumer of sfx_residency_core: on the iOS memory
// profile it drops idle cosmetic clips past the cap and re-decodes them on the
// next play; on every other host it tracks and drops nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { SFX_IOS_COSMETIC_BUDGET_BYTES } from '../src/game/sfx_residency_core';

/** Each fake decode is this big: three cosmetic clips fit the budget, four cross it. */
const CLIP_BYTES = (SFX_IOS_COSMETIC_BUDGET_BYTES * 2) / 7;

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  onended: (() => void) | null;
  playbackRate: { value: number; setTargetAtTime(): void };
  connect(node: unknown): unknown;
  disconnect(): void;
  start(): void;
  stop(): void;
}

function param() {
  return {
    value: 0,
    setValueAtTime(value: number) {
      this.value = value;
    },
    linearRampToValueAtTime(value: number) {
      this.value = value;
    },
    setTargetAtTime(value: number) {
      this.value = value;
    },
  };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 100;
  destination = {};
  listener = {};
  decodeCalls = 0;
  sources: FakeSource[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return { gain: param(), connect: (node: unknown) => node, disconnect() {} };
  }

  createPanner() {
    return {
      positionX: param(),
      positionY: param(),
      positionZ: param(),
      connect: (node: unknown) => node,
      disconnect() {},
    };
  }

  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      loop: false,
      onended: null,
      playbackRate: { value: 1, setTargetAtTime() {} },
      connect: (node: unknown) => node,
      disconnect() {},
      start() {},
      stop() {},
    };
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      numberOfChannels: channels,
      sampleRate,
      getChannelData: (channel: number) => data[channel],
    };
  }

  async decodeAudioData() {
    this.decodeCalls++;
    return { duration: 1, length: CLIP_BYTES / 4, numberOfChannels: 1, sampleRate: 48_000 };
  }

  async resume(): Promise<void> {}
}

interface SfxLike {
  init(): void;
  preload(key: string): void;
  playUi(key: string): void;
  loop(id: string, key: string, target: number): void;
  unloop(id: string, fade?: number): void;
}

interface SfxInternals {
  buffers: Map<string, unknown>;
  loading: Map<string, Promise<unknown>>;
  pendingOneShots: Set<string>;
  pendingLoops: Map<string, { key: string; target: number }>;
  pendingLoopVariants: Map<string, number>;
  residency: { cosmeticBytes: number; budgetBytes: number } | null;
  loadBuffer(key: string, variantIndex?: number): Promise<unknown>;
}

const internals = (player: SfxLike): SfxInternals => player as unknown as SfxInternals;

async function loadEngine(ios: boolean): Promise<{ player: SfxLike; ctx: FakeAudioContext }> {
  if (ios) {
    vi.doMock('../src/render/gfx', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/render/gfx')>();
      return { ...actual, GFX: { ...actual.GFX, iosMemoryProfile: true } };
    });
  }
  const { sfx } = await import('../src/game/sfx');
  const Constructor = sfx.constructor as new () => SfxLike;
  const player = new Constructor();
  // Startup clips are seeded as already decoded (as sfx_loading.test.ts does),
  // so init() fetches nothing and each case controls every decode it makes.
  for (const [key, entry] of Object.entries(SFX_CLIPS)) {
    if (entry.preload !== 'startup') continue;
    entry.variants.forEach((_variant, index) => {
      internals(player).buffers.set(index === 0 ? key : `${key}:${index}`, {});
    });
  }
  player.init();
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) throw new Error('missing audio context');
  return { player, ctx };
}

async function settle(player: SfxLike): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.all([...internals(player).loading.values()]);
    await Promise.resolve();
  }
}

async function decode(player: SfxLike, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    player.preload(key);
    await settle(player);
  }
}

const cached = (player: SfxLike, key: string): boolean => internals(player).buffers.has(key);

beforeEach(() => {
  vi.resetModules();
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../src/render/gfx');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sfx residency on desktop and Android (no iOS memory profile)', () => {
  it('never tracks or drops a decoded clip, however much is decoded', async () => {
    const { GFX } = await import('../src/render/gfx');
    expect(GFX.iosMemoryProfile).toBe(false);
    const { player } = await loadEngine(false);
    expect(internals(player).residency).toBeNull();
    const keys = ['amb_birds', 'amb_rain', 'amb_snow', 'amb_dungeon', 'amb_water'];
    await decode(player, ...keys);
    for (const key of keys) expect(cached(player, key), key).toBe(true);
  });
});

describe('sfx residency on the iOS memory profile', () => {
  it('reads the profile at init and budgets decoded cosmetic clips', async () => {
    const { player } = await loadEngine(true);
    expect(internals(player).residency?.budgetBytes).toBe(SFX_IOS_COSMETIC_BUDGET_BYTES);
  });

  it('drops the least recently used idle ambience bed once a decode crosses the budget', async () => {
    const { player } = await loadEngine(true);
    await decode(player, 'amb_birds', 'amb_rain', 'amb_snow');
    expect(internals(player).residency?.cosmeticBytes).toBe(3 * CLIP_BYTES);
    await decode(player, 'amb_dungeon');
    expect(cached(player, 'amb_birds')).toBe(false);
    for (const key of ['amb_rain', 'amb_snow', 'amb_dungeon'])
      expect(cached(player, key)).toBe(true);
    expect(internals(player).residency?.cosmeticBytes).toBe(3 * CLIP_BYTES);
  });

  it('never counts or drops a pinned spell clip', async () => {
    const { player } = await loadEngine(true);
    const spells = ['proj_fire', 'impact_fire', 'heal_impact', 'proj_frost'];
    for (const key of spells)
      expect(SFX_CLIPS[key as keyof typeof SFX_CLIPS].category).toBe('spells');
    await decode(player, ...spells);
    for (const key of spells) expect(cached(player, key), key).toBe(true);
    expect(internals(player).residency?.cosmeticBytes).toBe(0);
  });

  it('keeps cosmetic clips resident when pinned clips alone exceed any total, with no re-decode', async () => {
    const { player, ctx } = await loadEngine(true);
    const pinned = Object.entries(SFX_CLIPS)
      .filter(([, entry]) => entry.category === 'spells' && entry.preload === 'lazy')
      .map(([key]) => key)
      .slice(0, 8);
    expect(pinned).toHaveLength(8);
    await decode(player, ...pinned.slice(0, 4));
    const summon = 'mount_summon_rallycart_rxt';
    player.loop('bed', 'amb_birds', 0.5);
    await settle(player);
    await decode(player, summon);
    const decodes = ctx.decodeCalls;
    for (const key of pinned.slice(4)) {
      await decode(player, key);
      player.playUi(summon);
      await settle(player);
      const shot = ctx.sources.at(-1);
      expect(shot?.buffer).toBe(internals(player).buffers.get(summon));
      shot?.onended?.();
      player.unloop('bed', 0);
      player.loop('bed', 'amb_birds', 0.5);
      await settle(player);
    }
    expect(ctx.decodeCalls).toBe(decodes + 4);
    for (const key of [...pinned, summon, 'amb_birds']) expect(cached(player, key), key).toBe(true);
    expect(internals(player).residency?.cosmeticBytes).toBe(2 * CLIP_BYTES);
  });

  it('never drops a looping bed or a playing one-shot until its source stops', async () => {
    const { player, ctx } = await loadEngine(true);
    player.loop('bed', 'amb_birds', 0.5);
    await settle(player);
    const summon = 'mount_summon_rallycart_rxt';
    player.playUi(summon);
    await settle(player);
    const shot = ctx.sources.find((source) => !source.loop && source.buffer);
    if (!shot?.onended) throw new Error('the summon one-shot did not start');

    await decode(player, 'amb_rain', 'amb_snow');
    expect(cached(player, 'amb_rain')).toBe(false);
    expect(cached(player, 'amb_birds')).toBe(true);
    expect(cached(player, summon)).toBe(true);

    shot.onended();
    await decode(player, 'amb_water');
    expect(cached(player, summon)).toBe(false);
    expect(cached(player, 'amb_birds')).toBe(true);

    player.unloop('bed', 0);
    await decode(player, 'amb_dungeon');
    expect(cached(player, 'amb_birds')).toBe(false);
  });

  it('holds a fading loop until its deferred stop, then lets it go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { player } = await loadEngine(true);
    player.loop('bed', 'amb_birds', 0.5);
    await settle(player);
    player.unloop('bed', 0.4);
    await decode(player, 'amb_rain', 'amb_snow', 'amb_dungeon');
    expect(cached(player, 'amb_birds')).toBe(true);
    expect(cached(player, 'amb_rain')).toBe(false);

    vi.advanceTimersByTime(600);
    await decode(player, 'amb_water');
    expect(cached(player, 'amb_birds')).toBe(false);
  });

  it('holds a clip a pending one-shot is waiting on', async () => {
    const { player } = await loadEngine(true);
    await decode(player, 'amb_birds');
    internals(player).pendingOneShots.add('amb_birds');
    await decode(player, 'amb_rain', 'amb_snow', 'amb_dungeon');
    expect(cached(player, 'amb_birds')).toBe(true);
    expect(cached(player, 'amb_rain')).toBe(false);

    internals(player).pendingOneShots.delete('amb_birds');
    await decode(player, 'amb_water');
    expect(cached(player, 'amb_birds')).toBe(false);
  });

  it('holds the exact variant a pending loop is waiting on', async () => {
    const { player } = await loadEngine(true);
    const ride = 'mount_run_avian_strider';
    expect(SFX_CLIPS[ride].variants.length).toBeGreaterThan(3);
    await internals(player).loadBuffer(ride, 3);
    await settle(player);
    internals(player).pendingLoops.set('ride', { key: ride, target: 0.85 });
    internals(player).pendingLoopVariants.set('ride', 3);
    await decode(player, 'amb_rain', 'amb_snow', 'amb_dungeon');
    expect(cached(player, `${ride}:3`)).toBe(true);
    expect(cached(player, 'amb_rain')).toBe(false);

    player.unloop('ride');
    await decode(player, 'amb_water');
    expect(cached(player, `${ride}:3`)).toBe(false);
  });

  it('re-decodes an evicted clip through the load path on its next play', async () => {
    const { player, ctx } = await loadEngine(true);
    await decode(player, 'amb_birds', 'amb_rain', 'amb_snow', 'amb_dungeon');
    expect(cached(player, 'amb_birds')).toBe(false);
    const decodes = ctx.decodeCalls;

    player.loop('bed', 'amb_birds', 0.5);
    await settle(player);

    expect(ctx.decodeCalls).toBe(decodes + 1);
    expect(cached(player, 'amb_birds')).toBe(true);
    const bed = ctx.sources.at(-1);
    expect(bed?.loop).toBe(true);
    expect(bed?.buffer).toBe(internals(player).buffers.get('amb_birds'));
  });
});
