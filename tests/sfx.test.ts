import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';

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
  const variants = (sfx as unknown as { variants: Map<string, { duration: number }[]> }).variants;
  variants.set('foot_grass', [{ duration: 0.48 }]);
});

describe('footstep audio', () => {
  it('shapes each footfall into a transient stopped before the next step', () => {
    sfx.footstep(0, 0, 0, 'grass', true, true);
    const src = sources.at(-1)!;
    expect(src.started).toBe(true);
    // running release 0.17s + tail margin → stopped well under the ~0.22s gap,
    // and far under the raw 0.48s clip that caused the overlap ring.
    expect(src.stopAt).not.toBeNull();
    expect(src.stopAt! - nowT).toBeLessThan(0.22);
  });

  it('alternates pitch between consecutive steps (left/right foot)', () => {
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const a = sources.at(-1)!.playbackRate.value;
    nowT += 0.5; // clear the per-key cooldown so the next step actually plays
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const b = sources.at(-1)!.playbackRate.value;
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
  });
});

// hasVariants() is the predicate that drives mobSfxKey() in hud.ts:
// mob_${fam}_${templateId}_${action} is preferred when hasVariants() returns
// true, otherwise the family-level key mob_${fam}_${action} is used.
describe('hasVariants', () => {
  it('returns false for an unloaded key', () => {
    expect(sfx.hasVariants('mob_beast_wolf_attack')).toBe(false);
  });

  it('returns true once a pool is injected for the key', () => {
    (sfx as unknown as { variants: Map<string, { duration: number }[]> }).variants.set(
      'mob_beast_wolf_attack',
      [{ duration: 0.8 }],
    );
    expect(sfx.hasVariants('mob_beast_wolf_attack')).toBe(true);
  });

  it('subfamily key true + family key absent models the preferred-then-fallback flow', () => {
    // When subfamily clips are deployed, hasVariants(subKey) is true and
    // mobSfxKey returns the subfamily key.  Before deployment, hasVariants
    // returns false and mobSfxKey falls back to the family key.
    const subKey = 'mob_beast_bear_attack'; // distinct key so prior tests don't leak
    const famKey = 'mob_beast_attack';
    const variants = (sfx as unknown as { variants: Map<string, { duration: number }[]> }).variants;
    variants.delete(subKey);
    expect(sfx.hasVariants(subKey)).toBe(false); // no variants loaded yet
    variants.set(subKey, [{ duration: 0.8 }]);
    expect(sfx.hasVariants(subKey)).toBe(true);
    expect(sfx.hasVariants(famKey)).toBe(false); // family key unrelated
  });
});

// No-repeat random: the variant selection algorithm must never repeat the last
// index back-to-back and must include every index on first play.
describe('variant selection (nextBuffer)', () => {
  // nextBuffer is private; drive it through playUi which calls it for UI one-shots.
  function injectPool(key: string, pool: { duration: number }[]): void {
    const variants = (sfx as unknown as { variants: Map<string, { duration: number }[]> }).variants;
    variants.set(key, pool);
  }

  it('variant 0 is reachable on first play', () => {
    injectPool('ui_click', [{ duration: 0.1 }, { duration: 0.2 }]);
    // With Math.random()=0.1 and the fixed first-play path:
    //   idx = floor(0.1 * pool.length) = floor(0.1 * 2) = 0  => variant 0 selected.
    // The old buggy code did floor(0.1 * 1)=0 then always bumped idx++ to 1.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    (sfx as unknown as { lastVariant: Map<string, number> }).lastVariant.delete('ui_click');
    sfx.playUi('ui_click');
    const src = sources.at(-1)!;
    expect(src.buffer).toBe(
      (sfx as unknown as { variants: Map<string, { duration: number }[]> }).variants.get(
        'ui_click',
      )![0],
    );
  });

  it('never plays the same variant back-to-back on a 2-clip pool', () => {
    injectPool('ui_click2', [{ duration: 0.1 }, { duration: 0.2 }]);
    (sfx as unknown as { lastVariant: Map<string, number> }).lastVariant.delete('ui_click2');
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    sfx.playUi('ui_click2');
    const first = sources.at(-1)!.buffer;
    nowT += 1; // clear cooldown
    sfx.playUi('ui_click2');
    const second = sources.at(-1)!.buffer;
    expect(first).not.toBe(second);
  });

  it('single-clip pool always returns the one buffer', () => {
    injectPool('ui_single', [{ duration: 0.3 }]);
    sfx.playUi('ui_single');
    const a = sources.at(-1)!.buffer;
    nowT += 1;
    sfx.playUi('ui_single');
    const b = sources.at(-1)!.buffer;
    expect(a).toBe(b);
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
    expect(sources.at(-1)!.started).toBe(true);
  });
});
