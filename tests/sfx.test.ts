import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import { SFX_CLIPS, type SfxEntry } from '../src/game/sfx_manifest.generated';

// The footstep "jingling" bug: foot clips are ~0.48s but steps fire every ~0.22s
// at a run, so flat retriggers overlap two pitch-jittered copies of one sample and
// comb-filter into a metallic ring. footstep() must (a) shape each play into a
// short transient that is stopped before the next step and (b) alternate pitch
// per step. These tests pin both behaviours via a minimal WebAudio stub.

interface FakeSource {
  buffer: { duration: number } | null;
  playbackRate: { value: number };
  onended: (() => void) | null;
  started: boolean;
  stopAt: number | null;
  connect(n: unknown): unknown;
  start(): void;
  stop(t?: number): void;
}

const sources: FakeSource[] = [];
let nowT = 0;
const WOOD_BUFFER = { duration: 0.37 };

function lastSource(): FakeSource {
  const source = sources.at(-1);
  if (!source) throw new Error('expected an audio source');
  return source;
}

function installAudioStub(): void {
  sources.length = 0;
  nowT += 1000; // monotonic across tests so the singleton's cooldown map never blocks
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  class FakeCtx {
    get currentTime() {
      return nowT;
    }
    destination = {};
    listener = {} as Record<string, unknown>;
    createGain() {
      return {
        gain: param(),
        connect(n: unknown) {
          return n;
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
        setPosition() {},
        connect(n: unknown) {
          return n;
        },
        disconnect() {},
      };
    }
    createBufferSource(): FakeSource {
      const s: FakeSource = {
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        started: false,
        stopAt: null,
        connect(n: unknown) {
          return n;
        },
        start() {
          this.started = true;
        },
        stop(t?: number) {
          this.stopAt = t ?? 0;
        },
      };
      sources.push(s);
      return s;
    }
    resume() {
      return Promise.resolve();
    }
  }
  (globalThis as never as { AudioContext: unknown }).AudioContext = FakeCtx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  installAudioStub();
  // Neutralize the ±jitter so alternation is the only pitch variable under test.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  sfx.init();
  // Footsteps are off by default (the footstepSfx setting); enable them so the
  // play-path behaviours below are exercised. The gate itself is tested separately.
  sfx.setFootstepsEnabled(true);
  // Inject decoded buffers directly (skip async fetch/decode in preload).
  const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
  buffers.set('foot_grass', { duration: 0.48 });
  buffers.set('foot_wood', WOOD_BUFFER);
});

describe('footstep audio', () => {
  it('shapes each footfall into a transient stopped before the next step', () => {
    sfx.footstep(0, 0, 0, 'grass', true, true);
    const src = lastSource();
    expect(src.started).toBe(true);
    // running release 0.17s + tail margin → stopped well under the ~0.22s gap,
    // and far under the raw 0.48s clip that caused the overlap ring.
    expect(src.stopAt).not.toBeNull();
    if (src.stopAt === null) throw new Error('expected the footstep to schedule a stop');
    expect(src.stopAt - nowT).toBeLessThan(0.22);
  });

  it('alternates pitch between consecutive steps (left/right foot)', () => {
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const a = lastSource().playbackRate.value;
    nowT += 0.5; // clear the per-key cooldown so the next step actually plays
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const b = lastSource().playbackRate.value;
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
  });

  it('layers the authored playback rate underneath foot alternation', () => {
    const entry = SFX_CLIPS.foot_grass;
    const original = entry.playbackRate;
    entry.playbackRate = 1.2;
    try {
      sfx.footstep(0, 0, 0, 'grass', false, true);
      const first = lastSource().playbackRate.value;
      nowT += 0.5;
      sfx.footstep(0, 0, 0, 'grass', false, true);
      const second = lastSource().playbackRate.value;
      expect([first, second].sort()).toEqual([1.2 * 0.97, 1.2 * 1.04].sort());
    } finally {
      entry.playbackRate = original;
    }
  });

  it('selects the sampled wood clip for wooden surfaces', () => {
    sfx.footstep(0, 0, 0, 'wood', false, true);
    expect(sources.at(-1)?.buffer).toBe(WOOD_BUFFER);
  });
});

// hasVariants() is the predicate that drives mobSfxKey() in hud.ts:
// mob_${fam}_${templateId}_${action} is preferred when hasVariants() returns
// true, otherwise the family-level key mob_${fam}_${action} is used.
describe('hasVariants', () => {
  it('returns false for an unloaded key', () => {
    expect(sfx.hasVariants('mob_beast_wolf_attack')).toBe(false);
  });

  it('recognizes a release-discovered subfamily entry before its lazy audio loads', () => {
    const key = 'mob_beast_bear_attack';
    const state = sfx as unknown as {
      clips: Record<string, SfxEntry>;
      failedLoads: Set<string>;
    };
    state.clips = {
      ...state.clips,
      [key]: {
        ...SFX_CLIPS.mob_beast_attack,
        variants: [SFX_CLIPS.mob_beast_attack.variants[0]],
      },
    };

    expect(sfx.hasVariants(key)).toBe(true);
    state.failedLoads.add(key);
    expect(sfx.hasVariants(key)).toBe(false);
  });

  it('recognizes an injected procedural buffer and safely ignores unknown string keys', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('procedural_test', { duration: 0.8 });

    expect(sfx.hasVariants('procedural_test')).toBe(true);
    expect(() => sfx.playAt('not_in_manifest', 0, 0, 0)).not.toThrow();
  });
});

// isBuffered/preload back the mob-voice cold-buffer fallback in hud.ts (a
// crit-only cue like hurt has exactly one trigger, so it can lose the race
// to fetch+decode unless warmed ahead of time or checked before playing).
// Both must account for EVERY variant a key can have, not just index 0:
// playAt no-repeat-randoms across variants, so a two-take family
// (mob_dragonkin_hurt, mob_spider_hurt) can have variant 0 warm and variant 1
// still cold.
describe('isBuffered/preload', () => {
  it('reports false until every variant of a multi-take key is buffered', () => {
    const key = 'mob_dragonkin_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(2);
    expect(sfx.isBuffered(key)).toBe(false);
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set(key, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(false); // variant 1 still cold
    buffers.set(`${key}:1`, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(true);
  });

  it('reports true immediately for a single-variant key once buffered', () => {
    const key = 'mob_beast_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(1);
    expect(sfx.isBuffered(key)).toBe(false);
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set(key, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(true);
  });

  it('preload warms every variant of a multi-take key, not just the first', async () => {
    const key = 'mob_spider_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(2);
    sfx.preload(key);
    // loadBuffer is async (fetch+decode); flush microtasks so both loads settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loading = (sfx as unknown as { loading: Map<string, unknown> }).loading;
    expect(loading.has(key)).toBe(false);
    expect(loading.has(`${key}:1`)).toBe(false);
  });
});

// Footstep sounds ship OFF by default and are toggleable via the footstepSfx
// setting. While disabled, footstep() must be a no-op (no source created) for
// self and other entities alike; re-enabling resumes playback.
describe('footstep toggle', () => {
  it('is a no-op when footsteps are disabled', () => {
    sfx.setFootstepsEnabled(false);
    const before = sources.length;
    sfx.footstep(0, 0, 0, 'grass', true, true); // self
    sfx.footstep(5, 0, 5, 'grass', false, false); // another entity
    expect(sources.length).toBe(before);
  });

  it('resumes playback once re-enabled', () => {
    sfx.setFootstepsEnabled(false);
    sfx.footstep(0, 0, 0, 'grass', true, true);
    const muted = sources.length;
    sfx.setFootstepsEnabled(true);
    nowT += 0.5; // clear the per-key cooldown
    sfx.footstep(0, 0, 0, 'grass', true, true);
    expect(sources.length).toBe(muted + 1);
    expect(lastSource().started).toBe(true);
  });
});
