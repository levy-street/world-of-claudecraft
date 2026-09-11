// The deepball bank's WIRING, as opposed to its synthesis (which
// deepglass_audio.test.ts covers at the buffer).
//
// Three things here can be perfectly synthesised and still make no sound, and
// none of them is visible in the bell without a minute-long WebGL reload per
// attempt: a bed that never gets installed under the key the renderer plays, a
// submerged player still hearing a ridge wind because one bed was missed, and a
// thrust loop whose rate never moves because the platform's AudioParam is a
// plain number.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPGLASS_LOOP_SFX_KEYS, DEEPGLASS_SFX_KEYS } from '../src/game/deepglass_audio';
import { sfx } from '../src/game/sfx';

interface FakeSource {
  buffer: AudioBuffer | null;
  playbackRate: { value: number; setTargetAtTime?: (value: number) => void };
  loop: boolean;
  connect(node: unknown): unknown;
  disconnect(): void;
  start(): void;
  stop(): void;
}

interface SfxInternals {
  buffers: Map<string, AudioBuffer>;
  loops: Map<string, { key: string; src: FakeSource; gain: { gain: { value: number } } }>;
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

/** `rampable: false` models the minimal stubs (and old mobile engines) whose
 *  playbackRate is a bare number rather than a full AudioParam. */
function makeContextClass(rampable: boolean) {
  return class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    currentTime = 0;
    sampleRate = 8000;
    destination = {};
    listener = {} as Record<string, unknown>;
    sources: FakeSource[] = [];

    constructor() {
      FakeAudioContext.instances.push(this);
    }

    createGain() {
      return {
        gain: param(),
        connect(node: unknown) {
          return node;
        },
        disconnect() {},
      };
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
        playbackRate: rampable ? param() : { value: 1 },
        loop: false,
        connect(node: unknown) {
          return node;
        },
        disconnect() {},
        start() {},
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
      return {} as AudioBuffer;
    }

    async resume(): Promise<void> {}
  };
}

function makeSfx(): typeof sfx {
  const Constructor = sfx.constructor as new () => typeof sfx;
  return new Constructor();
}

function internals(player: typeof sfx): SfxInternals {
  return player as unknown as SfxInternals;
}

function start(rampable = true): typeof sfx {
  vi.stubGlobal('AudioContext', makeContextClass(rampable));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(8) }) as Response),
  );
  const player = makeSfx();
  player.init();
  return player;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the deepball bank is installed where the renderer looks for it', () => {
  it('bakes every cue AND every bed at startup, under its own key', () => {
    const buffers = internals(start()).buffers;
    for (const key of Object.keys(DEEPGLASS_SFX_KEYS)) expect(buffers.has(key)).toBe(true);
    // The beds are the easy one to drop: they take a separate render path, and
    // a missing loop buffer is silent rather than an error.
    for (const key of Object.keys(DEEPGLASS_LOOP_SFX_KEYS)) expect(buffers.has(key)).toBe(true);
    for (const key of Object.keys(DEEPGLASS_LOOP_SFX_KEYS)) {
      const bed = buffers.get(key);
      expect(bed?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('the submerged ambience', () => {
  it('raises the underwater bed and drops every open-air one', () => {
    const player = start();
    const state = internals(player);
    // The surface beds are real clips; pretend they are already decoded, or
    // they sit in the pending-load queue instead of playing and the test would
    // pass for the wrong reason.
    for (const key of ['amb_wind_vale', 'amb_rain', 'amb_water', 'amb_crowd', 'amb_birds']) {
      state.buffers.set(key, { duration: 1, length: 8, sampleRate: 8 } as AudioBuffer);
    }
    // Above water first, so there is something to drop.
    player.ambience('vale', false, 'rain', true, 1);
    expect(state.loops.has('amb_wind_vale')).toBe(true);
    expect(state.loops.has('dg_ambient')).toBe(false);

    player.ambience('vale', false, 'rain', true, 1, [], true);
    expect(state.loops.has('dg_ambient')).toBe(true);
    // A loop is unlooped by fading and a deferred stop, but it leaves the map
    // immediately — which is what decides whether it is audible.
    for (const key of ['amb_wind_vale', 'amb_rain', 'amb_water', 'amb_crowd']) {
      expect(state.loops.has(key)).toBe(false);
    }

    // ...and back out again: surfacing has to restore the world.
    player.ambience('vale', false, 'rain', true, 1, [], false);
    expect(state.loops.has('dg_ambient')).toBe(false);
    expect(state.loops.has('amb_wind_vale')).toBe(true);
  });

  it('hands the crowd from the open-air bed to the muffled one at the waterline', () => {
    const player = start();
    const state = internals(player);
    state.buffers.set('amb_crowd', { duration: 1, length: 8, sampleRate: 8 } as AudioBuffer);

    // On the terrace: the stands are heard in the air.
    player.ambience('vale', false, null, false, 0.7);
    expect(state.loops.has('amb_crowd')).toBe(true);
    expect(state.loops.has('dg_crowd')).toBe(false);

    // In the bell: the same crowd, now through the glass. Exactly one of the
    // two beds carries it at any moment — both at once is two stadiums.
    player.ambience('vale', false, null, false, 0.7, [], true);
    expect(state.loops.has('amb_crowd')).toBe(false);
    expect(state.loops.has('dg_crowd')).toBe(true);

    // Louder the more that is happening, so a goal reads as the bowl reacting.
    const quiet = state.loops.get('dg_crowd')?.gain.gain.value ?? 0;
    player.ambience('vale', false, null, false, 1, [], true);
    expect(state.loops.get('dg_crowd')?.gain.gain.value ?? 0).toBeGreaterThan(quiet);

    // No crowd anywhere: an empty world must not hum.
    player.ambience('vale', false, null, false, 0, [], true);
    expect(state.loops.has('dg_crowd')).toBe(false);
  });
});

describe('loopRate', () => {
  it('bends a live bed, and leaves an unstarted one alone', () => {
    const player = start();
    player.loopRate('dg_boost_1', 1.3); // nothing playing: must not throw
    player.loop('dg_boost_1', 'dg_boost', 0.4, 1, 2, 3);
    const slot = internals(player).loops.get('dg_boost_1');
    expect(slot).toBeDefined();
    expect(slot?.src.playbackRate.value).toBe(1);
    player.loopRate('dg_boost_1', 1.28);
    expect(slot?.src.playbackRate.value).toBeCloseTo(1.28, 5);
  });

  it('still moves the rate where playbackRate is a bare number', () => {
    // The fallback exists because the ramp is the nice-to-have and the RATE is
    // the point: a thrust bed stuck at unity says nothing about speed.
    const player = start(false);
    player.loop('dg_boost_2', 'dg_boost', 0.4, 0, 0, 0);
    player.loopRate('dg_boost_2', 0.9);
    expect(internals(player).loops.get('dg_boost_2')?.src.playbackRate.value).toBeCloseTo(0.9, 5);
  });

  it('clamps rather than letting a bad speed reading detune the bed to nothing', () => {
    const player = start();
    player.loop('dg_boost_3', 'dg_boost', 0.4, 0, 0, 0);
    player.loopRate('dg_boost_3', 99);
    expect(internals(player).loops.get('dg_boost_3')?.src.playbackRate.value).toBeLessThanOrEqual(
      4,
    );
    player.loopRate('dg_boost_3', -3);
    expect(
      internals(player).loops.get('dg_boost_3')?.src.playbackRate.value,
    ).toBeGreaterThanOrEqual(0.25);
  });
});
