import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import { SFX_CLIPS, type SfxEntry } from '../src/game/sfx_manifest.generated';

interface FakeParam {
  value: number;
  targets: number[];
  setValueAtTime(value: number): void;
  linearRampToValueAtTime(value: number): void;
  setTargetAtTime(value: number): void;
}

interface FakeSource {
  buffer: AudioBuffer | null;
  playbackRate: { value: number };
  loop: boolean;
  onended: (() => void) | null;
  started: boolean;
  connect(node: unknown): unknown;
  disconnect(): void;
  start(): void;
  stop(): void;
}

interface SfxInternals {
  buffers: Map<string, AudioBuffer>;
  loading: Map<string, Promise<AudioBuffer | null>>;
  failedLoads: Set<string>;
  clips: Record<string, SfxEntry>;
  pendingLoops: Map<string, { key: string; target: number; x?: number; y?: number; z?: number }>;
}

const BUFFER = { duration: 0.5 } as AudioBuffer;

function param(): FakeParam {
  return {
    value: 0,
    targets: [],
    setValueAtTime(value) {
      this.value = value;
    },
    linearRampToValueAtTime(value) {
      this.value = value;
    },
    setTargetAtTime(value) {
      this.targets.push(value);
      this.value = value;
    },
  };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  sampleRate = 100;
  destination = {};
  listener = {} as Record<string, unknown>;
  sources: FakeSource[] = [];
  gains: { gain: FakeParam; connect(node: unknown): unknown; disconnect(): void }[] = [];
  decodeCalls = 0;
  decodedBuffer = BUFFER;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const gain = {
      gain: param(),
      connect(node: unknown) {
        return node;
      },
      disconnect() {},
    };
    this.gains.push(gain);
    return gain;
  }

  createPanner() {
    return {
      panningModel: '',
      distanceModel: '',
      refDistance: 0,
      maxDistance: 0,
      rolloffFactor: 0,
      positionX: param(),
      positionY: param(),
      positionZ: param(),
      connect(node: unknown) {
        return node;
      },
      disconnect() {},
    };
  }

  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      playbackRate: { value: 1 },
      loop: false,
      onended: null,
      started: false,
      connect(node: unknown) {
        return node;
      },
      disconnect() {},
      start() {
        this.started = true;
      },
      stop() {},
    };
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      numberOfChannels: channels,
      sampleRate,
      getChannelData(channel: number) {
        return data[channel];
      },
    } as AudioBuffer;
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    this.decodeCalls++;
    return this.decodedBuffer;
  }

  async resume(): Promise<void> {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(ok = true): Response {
  return {
    ok,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response;
}

function makeSfx() {
  const Constructor = sfx.constructor as new () => typeof sfx;
  return new Constructor();
}

function last<T>(values: T[], label: string): T {
  const value = values.at(-1);
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function internals(player: typeof sfx): SfxInternals {
  return player as unknown as SfxInternals;
}

// Mirrors sfx.ts's private assetCacheKey: variant 0 caches under the bare
// key, every other variant under `${key}:${index}`.
function assetCacheKeyForTest(key: string, variantIndex: number): string {
  return variantIndex === 0 ? key : `${key}:${variantIndex}`;
}

function startWithStartupCached(): { player: typeof sfx; ctx: FakeAudioContext } {
  const player = makeSfx();
  const state = internals(player);
  for (const [key, entry] of Object.entries(SFX_CLIPS)) {
    if (entry.preload !== 'startup') continue;
    // Seed EVERY variant's cache key, not just the first: preloadStartup()
    // eagerly loads every variant of every startup key, and a key with more
    // than one take (most combat/movement/UI keys now do) would otherwise
    // still trigger real fetches for its later variants during init().
    entry.variants.forEach((_variant, index) => {
      state.buffers.set(assetCacheKeyForTest(key, index), BUFFER);
    });
  }
  player.init();
  return { player, ctx: last(FakeAudioContext.instances, 'audio context') };
}

async function settle(player: typeof sfx, key: string): Promise<void> {
  const pending = internals(player).loading.get(key);
  if (pending) await pending;
  await Promise.resolve();
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sampled SFX loading', () => {
  it('preloads only entries marked for startup', async () => {
    const fetchMock = vi.fn(async (_url: string) => response());
    vi.stubGlobal('fetch', fetchMock);
    const player = makeSfx();

    player.init();
    await Promise.all([...internals(player).loading.values()]);

    const startup = Object.values(SFX_CLIPS).filter((entry) => entry.preload === 'startup');
    const startupVariants = startup.flatMap((entry) => entry.variants);
    const lazyUrls = new Set(
      Object.values(SFX_CLIPS)
        .filter((entry) => entry.preload === 'lazy')
        .map((entry) => entry.url),
    );
    const fetched = fetchMock.mock.calls.map(([url]) => String(url));
    expect(fetched).toHaveLength(startupVariants.length);
    expect(new Set(fetched)).toEqual(new Set(startupVariants.map((variant) => variant.url)));
    expect(fetched.some((url) => lazyUrls.has(url))).toBe(false);
    expect(last(FakeAudioContext.instances, 'audio context').decodeCalls).toBe(
      startupVariants.length,
    );
  });

  it('retains positional clips as mono buffers without re-encoding the asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    const { player, ctx } = startWithStartupCached();
    const cue = Object.entries(SFX_CLIPS).find(
      ([, entry]) => entry.spatial && entry.preload === 'lazy',
    )?.[0];
    if (!cue) throw new Error('manifest has no lazy spatial cue');
    const left = new Float32Array([1, -1, 0.5, 0]);
    const right = new Float32Array([-1, 1, 0.5, 1]);
    ctx.decodedBuffer = {
      duration: 4 / 48_000,
      length: 4,
      numberOfChannels: 2,
      sampleRate: 48_000,
      getChannelData(channel: number) {
        return channel === 0 ? left : right;
      },
    } as AudioBuffer;

    const loaded = await (
      player as unknown as { loadBuffer(key: string): Promise<AudioBuffer | null> }
    ).loadBuffer(cue);

    if (!loaded) throw new Error('spatial cue did not load');
    expect(loaded.numberOfChannels).toBe(1);
    expect([...loaded.getChannelData(0)]).toEqual([0, 0, 0.5, 0.5]);
    expect(internals(player).buffers.get(cue)).toBe(loaded);
  });

  it('retains both channels of the global water ambience bed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    const { player, ctx } = startWithStartupCached();
    ctx.decodedBuffer = {
      duration: 2 / 48_000,
      length: 2,
      numberOfChannels: 2,
      sampleRate: 48_000,
      getChannelData(channel: number) {
        return channel === 0 ? new Float32Array([1, 0]) : new Float32Array([0, 1]);
      },
    } as AudioBuffer;

    const loaded = await (
      player as unknown as { loadBuffer(key: string): Promise<AudioBuffer | null> }
    ).loadBuffer('amb_water');

    if (!loaded) throw new Error('water ambience did not load');
    expect(SFX_CLIPS.amb_water.spatial).toBe(false);
    expect(loaded.numberOfChannels).toBe(2);
  });

  it('deduplicates a shared lazy fetch and decode across one-shots and loops', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { player, ctx } = startWithStartupCached();
    const key = 'cast_fire';

    player.playAt(key, 0, 0, 0, { jitter: false });
    player.loop('cast:a', key, 0.4, 0, 0, 0);
    player.loop('cast:b', key, 0.5, 1, 0, 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve(response());
    await settle(player, key);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.decodeCalls).toBe(1);
  });

  it('negative-caches HTTP failures instead of refetching on every event', async () => {
    const fetchMock = vi.fn(async () => response(false));
    vi.stubGlobal('fetch', fetchMock);
    const { player } = startWithStartupCached();
    const key = 'cast_frost';

    player.playAt(key, 0, 0, 0);
    await settle(player, key);
    player.playAt(key, 0, 0, 0);
    await settle(player, key);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals(player).failedLoads.has(key)).toBe(true);
  });

  it('clears failed loop waiters and makes later ambience frames allocation-free', async () => {
    const fetchMock = vi.fn(async () => response(false));
    vi.stubGlobal('fetch', fetchMock);
    const { player } = startWithStartupCached();
    const key = 'amb_campfire';
    const id = 'world:campfire:failed';

    player.loop(id, key, 0.18, 0, 1, 0);
    await settle(player, key);
    expect(internals(player).failedLoads.has(key)).toBe(true);
    expect(internals(player).pendingLoops.has(id)).toBe(false);

    const loadSpy = vi.spyOn(
      player as unknown as { loadBuffer(key: string): Promise<AudioBuffer | null> },
      'loadBuffer',
    );
    for (let i = 0; i < 20; i++) player.loop(id, key, 0.18, 0, 1, 0);

    expect(loadSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals(player).pendingLoops.has(id)).toBe(false);
  });

  it('registers one waiter while updating a pending loop to its latest values', async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );
    const { player, ctx } = startWithStartupCached();
    const key = 'cast_shadow';

    player.loop('cast:pending', key, 0.2, 1, 2, 3);
    const load = internals(player).loading.get(key);
    if (!load) throw new Error('missing pending cast load');
    const thenSpy = vi.spyOn(load, 'then');
    for (let i = 0; i < 20; i++) player.loop('cast:pending', key, 0.4, 8, 9, 10);

    expect(thenSpy).not.toHaveBeenCalled();
    expect(internals(player).pendingLoops.get('cast:pending')).toEqual({
      key,
      target: 0.4,
      x: 8,
      y: 9,
      z: 10,
    });

    gate.resolve(response());
    await settle(player, key);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].loop).toBe(true);
  });

  it('cancels a pending loop and lets the same id begin loading a replacement key', async () => {
    const fireGate = deferred<Response>();
    const frostGate = deferred<Response>();
    const fetchMock = vi.fn((url: string) =>
      url === SFX_CLIPS.cast_fire.url ? fireGate.promise : frostGate.promise,
    );
    vi.stubGlobal('fetch', fetchMock);
    const { player, ctx } = startWithStartupCached();

    player.loop('cast:replace', 'cast_fire', 0.3, 1, 2, 3);
    player.unloop('cast:replace');
    player.loop('cast:replace', 'cast_frost', 0.6, 4, 5, 6);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireGate.resolve(response());
    frostGate.resolve(response());
    await settle(player, 'cast_fire');
    await settle(player, 'cast_frost');

    expect(ctx.sources).toHaveLength(1);
    expect(player.hasLoop('cast:replace')).toBe(true);
  });

  it('cancels a pending ambience load when its world condition clears', async () => {
    const rainGate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === SFX_CLIPS.amb_rain.url ? rainGate.promise : Promise.resolve(response(false)),
      ),
    );
    const { player } = startWithStartupCached();

    player.ambience('vale', false, 'rain', false);
    expect(internals(player).pendingLoops.has('amb_rain')).toBe(true);
    player.ambience('vale', false, null, false);
    expect(internals(player).pendingLoops.has('amb_rain')).toBe(false);

    rainGate.resolve(response());
    await settle(player, 'amb_rain');
    expect(player.hasLoop('amb_rain')).toBe(false);
  });

  it('multiplies caller gain by the generated manifest gain for shots and loops', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { player, ctx } = startWithStartupCached();
    const key = 'combat_crit';
    const entry = SFX_CLIPS[key];
    const originalGain = entry.gain;
    entry.gain = 0.25;

    try {
      player.playAt(key, 0, 0, 0, { gain: 0.4, jitter: false, cooldown: 0 });
      expect(last(ctx.gains, 'one-shot gain').gain.value).toBeCloseTo(0.1);

      player.loop('gain:test', key, 0.8);
      expect(last(ctx.gains, 'loop gain').gain.targets.at(-1)).toBeCloseTo(0.2);
    } finally {
      entry.gain = originalGain;
    }
  });

  it('composes authored playback rate with caller rate, jitter, and loops', () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const { player, ctx } = startWithStartupCached();
    const positional = SFX_CLIPS.combat_crit as { playbackRate?: number };
    const ui = SFX_CLIPS.ui_click as { playbackRate?: number };
    const loop = SFX_CLIPS.cast_fire as { playbackRate?: number };
    const originals = [positional.playbackRate, ui.playbackRate, loop.playbackRate];
    internals(player).buffers.set('cast_fire', BUFFER);
    positional.playbackRate = 1.25;
    ui.playbackRate = 0.8;
    loop.playbackRate = 1.1;

    try {
      player.playAt('combat_crit', 0, 0, 0, { rate: 0.8, cooldown: 0 });
      expect(last(ctx.sources, 'positional source').playbackRate.value).toBeCloseTo(
        0.8 * 1.25 * 1.03,
      );

      player.playUi('ui_click', { rate: 1.5 });
      expect(last(ctx.sources, 'UI source').playbackRate.value).toBeCloseTo(1.5 * 0.8 * 1.025);

      player.loop('rate:test', 'cast_fire', 0.4);
      expect(last(ctx.sources, 'loop source').playbackRate.value).toBeCloseTo(1.1);
    } finally {
      if (originals[0] === undefined) delete positional.playbackRate;
      else positional.playbackRate = originals[0];
      if (originals[1] === undefined) delete ui.playbackRate;
      else ui.playbackRate = originals[1];
      if (originals[2] === undefined) delete loop.playbackRate;
      else loop.playbackRate = originals[2];
    }
  });

  it('defaults a missing authored playback rate to unity', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { player, ctx } = startWithStartupCached();
    const entry = SFX_CLIPS.combat_crit as { playbackRate?: number };
    const original = entry.playbackRate;
    delete entry.playbackRate;

    try {
      player.playAt('combat_crit', 0, 0, 0, {
        rate: 0.75,
        jitter: false,
        cooldown: 0,
      });
      expect(last(ctx.sources, 'one-shot source').playbackRate.value).toBeCloseTo(0.75);
    } finally {
      if (original !== undefined) entry.playbackRate = original;
    }
  });

  it('replays a lazy one-shot below 120 ms but drops it once it is stale', async () => {
    const quickGate = deferred<Response>();
    const staleGate = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => quickGate.promise)
      .mockImplementationOnce(() => staleGate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const quick = startWithStartupCached();
    quick.player.playAt('cast_arcane', 0, 0, 0, { jitter: false });
    quick.ctx.currentTime = 0.119;
    quickGate.resolve(response());
    await settle(quick.player, 'cast_arcane');
    expect(quick.ctx.sources).toHaveLength(1);

    const stale = startWithStartupCached();
    stale.player.playAt('cast_nature', 0, 0, 0, { jitter: false });
    stale.ctx.currentTime = 0.121;
    staleGate.resolve(response());
    await settle(stale.player, 'cast_nature');
    expect(stale.ctx.sources).toHaveLength(0);
  });

  it('replays a startup UI cue when its preload finishes promptly', async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );
    const { player, ctx } = startWithStartupCached();
    internals(player).buffers.delete('ui_click');

    player.playUi('ui_click', { jitter: false });
    ctx.currentTime = 0.249;
    gate.resolve(response());
    await settle(player, 'ui_click');

    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(true);
  });

  it('playUi enforces an explicit cooldown (opt-in only, no default), unlike playAt', () => {
    const { player, ctx } = startWithStartupCached();
    internals(player).buffers.set('ui_error', BUFFER);

    // No cooldown requested: back-to-back calls both play, matching every
    // pre-existing playUi call site's expectation (variant cycling, clicks).
    player.playUi('ui_click', { jitter: false });
    player.playUi('ui_click', { jitter: false });
    expect(ctx.sources).toHaveLength(2);

    // An explicit cooldown IS enforced: the real bug this closes had
    // audio.error() pass { cooldown: 1.5 } to playUi, which silently ignored
    // it entirely, so spamming a failed ability still spammed the sound.
    ctx.sources.length = 0;
    player.playUi('ui_error', { jitter: false, cooldown: 1.5 });
    player.playUi('ui_error', { jitter: false, cooldown: 1.5 });
    expect(ctx.sources).toHaveLength(1);

    ctx.currentTime += 1.5;
    player.playUi('ui_error', { jitter: false, cooldown: 1.5 });
    expect(ctx.sources).toHaveLength(2);
  });

  it('no-repeat-randoms ordered runtime takes only when a one-shot source is accepted', () => {
    vi.stubGlobal('fetch', vi.fn());
    // The previous variant is downweighted (weight 0.15 of 1), not excluded, so
    // this needs three concrete roll values rather than one flat stub: 0 with no
    // prior pick lands on index 0 (equal weights); 0.9 against weights [0.15, 1]
    // (total 1.15) clears the first bucket and lands on index 1; 0 against
    // weights [1, 0.15] (total 1.15) lands back on index 0 immediately.
    const random = vi.spyOn(Math, 'random');
    const { player, ctx } = startWithStartupCached();
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.9).mockReturnValueOnce(0);
    const state = internals(player);
    const key = 'ui_click';
    const second = { duration: 0.6 } as AudioBuffer;
    const entry = SFX_CLIPS[key];
    state.clips = {
      ...state.clips,
      [key]: {
        ...entry,
        variants: [
          {
            ...entry.variants[0],
            id: '1',
            url: `/audio/sfx/${key}_1.mp3?v=${entry.variants[0].sha256.slice(0, 12)}`,
          },
          {
            id: '2',
            url: `/audio/sfx/blobs/${'a'.repeat(64)}.mp3`,
            bytes: 1,
            sha256: 'a'.repeat(64),
          },
        ],
      },
    };
    state.buffers.set(`${key}:1`, second);

    player.playUi(key, { jitter: false });
    player.playUi(key, { jitter: false });
    player.playUi(key, { jitter: false });

    expect(ctx.sources.map((source) => source.buffer)).toEqual([BUFFER, second, BUFFER]);
  });

  function threeVariantClips(state: SfxInternals, key: keyof typeof SFX_CLIPS) {
    const second = { duration: 0.6 } as AudioBuffer;
    const third = { duration: 0.7 } as AudioBuffer;
    const entry = SFX_CLIPS[key];
    state.clips = {
      ...state.clips,
      [key]: {
        ...entry,
        variants: [
          { ...entry.variants[0], id: '1' },
          {
            id: '2',
            url: `/audio/sfx/blobs/${'a'.repeat(64)}.mp3`,
            bytes: 1,
            sha256: 'a'.repeat(64),
          },
          {
            id: '3',
            url: `/audio/sfx/blobs/${'b'.repeat(64)}.mp3`,
            bytes: 1,
            sha256: 'b'.repeat(64),
          },
        ],
      },
    };
    state.buffers.set(`${key}:1`, second);
    state.buffers.set(`${key}:2`, third);
    return { second, third };
  }

  it('lands on a distinct variant across a 3-take pool when rolls clear the repeat weight', () => {
    vi.stubGlobal('fetch', vi.fn());
    const random = vi.spyOn(Math, 'random');
    const { player, ctx } = startWithStartupCached();
    const key = 'ui_click';
    const { second, third } = threeVariantClips(internals(player), key);

    // Drives every "which weight bucket does the roll land in" branch: first
    // pick unweighted (equal odds over [0,1,2]); each following roll is high
    // enough to clear the previous index's downweighted (0.15) bucket, landing
    // on a fresh variant instead. See REPEAT_VARIANT_WEIGHT in sfx.ts.
    random.mockReturnValueOnce(0); // equal weights [1,1,1] -> index 0
    random.mockReturnValueOnce(0.3); // weights [0.15,1,1] clears bucket 0 -> index 1
    random.mockReturnValueOnce(0.9); // weights [1,0.15,1] clears buckets 0-1 -> index 2
    random.mockReturnValueOnce(0); // weights [1,1,0.15] -> index 0

    for (let i = 0; i < 4; i++) player.playUi(key, { jitter: false });

    const played = ctx.sources.map((source) => source.buffer);
    expect(played).toEqual([BUFFER, second, third, BUFFER]);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
  });

  it('can still repeat the immediately previous variant on a low roll, unlike hard exclusion', () => {
    vi.stubGlobal('fetch', vi.fn());
    const random = vi.spyOn(Math, 'random');
    const { player, ctx } = startWithStartupCached();
    const key = 'ui_click';
    threeVariantClips(internals(player), key);

    random.mockReturnValueOnce(0); // equal weights [1,1,1] -> index 0
    // weights [0.15,1,1], total 2.15: a roll under 0.15 / 2.15 lands back in
    // the downweighted bucket 0, repeating the immediately previous variant.
    random.mockReturnValueOnce(0.05);

    player.playUi(key, { jitter: false });
    player.playUi(key, { jitter: false });

    const played = ctx.sources.map((source) => source.buffer);
    expect(played).toEqual([BUFFER, BUFFER]);
  });

  it('does not advance the ordered take when cooldown rejects a positional play', () => {
    vi.stubGlobal('fetch', vi.fn());
    // nextVariantIndex is called on every attempt, including a cooldown-rejected
    // one, but commitVariant only fires once the play is accepted. So the
    // rejected middle call still consumes a roll (value irrelevant, it is never
    // committed) between the two that matter: see the weighting comment above.
    const random = vi.spyOn(Math, 'random');
    const { player, ctx } = startWithStartupCached();
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.9);
    const state = internals(player);
    const key = 'combat_crit';
    const second = { duration: 0.6 } as AudioBuffer;
    const entry = SFX_CLIPS[key];
    state.clips = {
      ...state.clips,
      [key]: {
        ...entry,
        variants: [
          {
            ...entry.variants[0],
            id: '1',
            url: `/audio/sfx/${key}_1.mp3?v=${entry.variants[0].sha256.slice(0, 12)}`,
          },
          {
            id: '2',
            url: `/audio/sfx/${key}_2.mp3?v=${'a'.repeat(12)}`,
            bytes: 1,
            sha256: 'a'.repeat(64),
          },
        ],
      },
    };
    state.buffers.set(`${key}:1`, second);

    player.playAt(key, 0, 0, 0, { jitter: false, cooldown: 0.1 });
    player.playAt(key, 0, 0, 0, { jitter: false, cooldown: 0.1 });
    ctx.currentTime = 0.11;
    player.playAt(key, 0, 0, 0, { jitter: false, cooldown: 0.1 });

    expect(ctx.sources.map((source) => source.buffer)).toEqual([BUFFER, second]);
  });

  it('pins a loop to one runtime take while independent loop slots advance the cycle', () => {
    vi.stubGlobal('fetch', vi.fn());
    // A reused loop id (the second 'cast:first' call) skips variant selection
    // entirely (its slot already exists), so only two rolls happen: one for
    // the id's first-ever pick, one for the second, distinct loop id.
    const random = vi.spyOn(Math, 'random');
    const { player, ctx } = startWithStartupCached();
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    const state = internals(player);
    const key = 'cast_fire';
    const second = { duration: 0.6 } as AudioBuffer;
    const entry = SFX_CLIPS[key];
    state.clips = {
      ...state.clips,
      [key]: {
        ...entry,
        variants: [
          {
            ...entry.variants[0],
            id: '1',
            url: `/audio/sfx/${key}_1.mp3?v=${entry.variants[0].sha256.slice(0, 12)}`,
          },
          {
            id: '2',
            url: `/audio/sfx/blobs/${'b'.repeat(64)}.mp3`,
            bytes: 1,
            sha256: 'b'.repeat(64),
          },
        ],
      },
    };
    state.buffers.set(key, BUFFER);
    state.buffers.set(`${key}:1`, second);

    player.loop('cast:first', key, 0.4);
    player.loop('cast:first', key, 0.5);
    player.loop('cast:second', key, 0.4);

    expect(ctx.sources.map((source) => source.buffer)).toEqual([BUFFER, second]);
    expect(player.hasLoop('cast:first')).toBe(true);
    expect(player.hasLoop('cast:second')).toBe(true);
  });

  it('reuses nearby point ambience loops and removes them beyond the listener cutoff', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { player, ctx } = startWithStartupCached();
    for (const key of Object.keys(SFX_CLIPS)) {
      if (key.startsWith('amb_')) internals(player).buffers.set(key, BUFFER);
    }
    const point = {
      id: 'world:campfire:0:0',
      kind: 'campfire',
      x: 0,
      y: 1,
      z: 0,
    } as const;
    const positionSpy = vi.spyOn(
      player as unknown as {
        setPannerPos(panner: PannerNode, x: number, y: number, z: number): void;
      },
      'setPannerPos',
    );

    player.setListener(0, 1, 0, 0, 0, -1);
    player.ambience('vale', false, null, false, 0, []);
    const globalSources = ctx.sources.length;
    player.ambience('vale', false, null, false, 0, [point]);

    expect(player.hasLoop(point.id)).toBe(true);
    expect(ctx.sources).toHaveLength(globalSources + 1);
    expect(positionSpy).toHaveBeenCalledTimes(1);
    player.ambience('vale', false, null, false, 0, [point]);
    expect(ctx.sources).toHaveLength(globalSources + 1);
    expect(positionSpy).toHaveBeenCalledTimes(1);

    player.setListener(100, 1, 100, 0, 0, -1);
    player.ambience('vale', false, null, false, 0, [point]);
    expect(player.hasLoop(point.id)).toBe(false);
  });

  it('cancels a point ambience load when the listener leaves before decode', async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );
    const { player, ctx } = startWithStartupCached();
    for (const key of Object.keys(SFX_CLIPS)) {
      if (key.startsWith('amb_') && key !== 'amb_forge') {
        internals(player).buffers.set(key, BUFFER);
      }
    }
    const point = {
      id: 'world:forge:9.5:17.5',
      kind: 'forge',
      x: 9.5,
      y: 1,
      z: 17.5,
    } as const;

    player.setListener(9.5, 1, 17.5, 0, 0, -1);
    player.ambience('vale', false, null, false, 0, [point]);
    expect(internals(player).pendingLoops.has(point.id)).toBe(true);
    expect(internals(player).pendingLoops.get(point.id)?.key).toBe('amb_forge');
    const sourcesBeforeDecode = ctx.sources.length;

    player.setListener(100, 1, 100, 0, 0, -1);
    player.ambience('vale', false, null, false, 0, [point]);
    expect(internals(player).pendingLoops.has(point.id)).toBe(false);

    gate.resolve(response());
    await settle(player, 'amb_forge');
    expect(player.hasLoop(point.id)).toBe(false);
    expect(ctx.sources).toHaveLength(sourcesBeforeDecode);
  });

  it('keeps the procedural Vale Cup crowd bed and roar beside sampled runtime clips', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { player, ctx } = startWithStartupCached();
    const state = internals(player);

    expect(state.buffers.has('amb_crowd')).toBe(true);
    expect(state.buffers.has('vcup_crowd_roar')).toBe(true);
    player.ambience('vale', false, null, false, 1);
    expect(player.hasLoop('amb_crowd')).toBe(true);

    player.crowdRoar();
    expect(last(ctx.sources, 'crowd roar').buffer).toBe(state.buffers.get('vcup_crowd_roar'));
    expect(typeof player.goalHorn).toBe('function');
  });
});
