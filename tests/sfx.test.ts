import { readdirSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORGE_MAX_DISTANCE, MAX_DISTANCE, REF_DISTANCE, sfx } from '../src/game/sfx';
import { SFX_CLIPS, type SfxEntry } from '../src/game/sfx_manifest.generated';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

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
  for (const [index, mountKey] of MOUNT_KEYS.entries()) {
    buffers.set(`mount_run_${mountKey}`, { duration: 0.5 + index / 100 });
  }
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
    // mob_beast_wolf_attack now has real discovered takes (a genuine
    // subfamily voice, not a placeholder), so it no longer demonstrates
    // "unloaded"; a key with no catalog or discovered entry at all does.
    expect(sfx.hasVariants('mob_nonexistent_family_action')).toBe(false);
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

describe('mount running audio', () => {
  it('ships one generated manifest entry for every catalog mount', () => {
    for (const mountKey of MOUNT_KEYS) {
      const entry = SFX_CLIPS[`mount_run_${mountKey}`];
      expect(entry).toMatchObject({
        loop: false,
        spatial: true,
      });
      expect(entry.url).toMatch(
        new RegExp(`^/audio/sfx/mount_run_${mountKey}\\.mp3\\?v=[0-9a-f]{12}$`),
      );
    }
  });

  it('ships one non-empty MP3 asset for every catalog mount and no orphan mount clips', () => {
    const directory = new URL('../public/audio/sfx/', import.meta.url);
    const expected = MOUNT_KEYS.map((mountKey) => `mount_run_${mountKey}.mp3`).sort();
    const actual = readdirSync(directory)
      .filter((file) => file.startsWith('mount_run_') && file.endsWith('.mp3'))
      .sort();

    expect(actual).toEqual(expected);
    for (const file of expected) {
      const url = new URL(file, directory);
      expect(statSync(url).size).toBeGreaterThan(5_000);
      const header = readFileSync(url).subarray(0, 3).toString('ascii');
      expect(header).toBe('ID3');
    }
  });

  it('plays a distinct custom clip for every catalog mount', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    const played = new Set<unknown>();

    for (const mountKey of MOUNT_KEYS) {
      nowT += 0.5;
      sfx.mountRun(0, 0, 0, mountKey, true);
      const src = sources.at(-1)!;
      expect(src.buffer).toBe(buffers.get(`mount_run_${mountKey}`));
      played.add(src.buffer);
    }

    expect(played.size).toBe(MOUNT_KEYS.length);
  });

  it('plays independently of the optional on-foot footstep toggle', () => {
    sfx.setFootstepsEnabled(false);
    sfx.mountRun(0, 0, 0, 'valorsteed', true);
    expect(sources.at(-1)!.started).toBe(true);
  });

  it('truncates each stride before the next mounted running beat', () => {
    sfx.mountRun(0, 0, 0, 'valorsteed', true);
    const src = sources.at(-1)!;
    expect(src.stopAt).not.toBeNull();
    expect(src.stopAt! - nowT).toBeLessThan(0.5);
  });

  it('ignores unknown mount keys', () => {
    const before = sources.length;
    sfx.mountRun(0, 0, 0, 'unknown_mount', true);
    expect(sources.length).toBe(before);
  });
});

describe('amb_forge: its own narrower audible distance', () => {
  beforeEach(() => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('amb_forge', { duration: 3 });
    buffers.set('amb_campfire', { duration: 3 });
    sfx.setListener(0, 0, 0, 0, 0, 1);
  });

  function forgeSlot() {
    const loops = (sfx as unknown as { loops: Map<string, { panner: unknown }> }).loops;
    return loops.get('forge-1');
  }

  it('uses FORGE_MAX_DISTANCE on its panner, not the shared MAX_DISTANCE every other sound uses', () => {
    const withinRange = FORGE_MAX_DISTANCE - 1;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    const slot = forgeSlot();
    expect(slot).toBeDefined();
    const panner = slot?.panner as { refDistance: number; maxDistance: number };
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE); // not the shared MAX_DISTANCE
    expect(panner.refDistance).toBe(REF_DISTANCE); // unchanged
  });

  it('stops playing beyond its own cutoff, well inside the shared MAX_DISTANCE (46)', () => {
    // Halfway between the forge's own cutoff and the shared MAX_DISTANCE:
    // guaranteed past the forge's cutoff and comfortably under the shared
    // ceiling every other positional sound still uses, at any tuned value.
    // If this were using the shared default, it would still be audible here.
    const beyondForgeRange = (FORGE_MAX_DISTANCE + MAX_DISTANCE) / 2;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: beyondForgeRange, y: 0, z: 0 },
    ]);
    expect(forgeSlot()).toBeUndefined();
  });

  it('a campfire at the same distance is unaffected, still using the shared MAX_DISTANCE', () => {
    const beyondForgeRange = (FORGE_MAX_DISTANCE + MAX_DISTANCE) / 2;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'campfire-1', kind: 'campfire', x: beyondForgeRange, y: 0, z: 0 },
    ]);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.get('campfire-1')).toBeDefined();
  });

  it('re-syncs an already-live loop panner to its override every frame, not only on creation', () => {
    const withinRange = FORGE_MAX_DISTANCE - 1;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    const panner = forgeSlot()?.panner as { refDistance: number; maxDistance: number };
    // Simulate drift: something else on the panner left maxDistance stale.
    panner.maxDistance = MAX_DISTANCE;
    expect(panner.maxDistance).not.toBe(FORGE_MAX_DISTANCE);

    // ambience() calls loop() again next frame for the same live source.
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE);
  });

  it('carries the maxDistance override through the pending-load round trip', () => {
    // A distinct id: the singleton sfx's loops/pendingLoops maps persist
    // across tests, so reusing 'forge-1' here would hit the still-live slot
    // from a sibling test's resync path instead of the pending-load branch.
    const id = 'forge-pending';
    // The outer beforeEach preloads amb_forge; remove it so this call takes
    // the pending-load branch instead of creating the panner immediately.
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.delete('amb_forge');
    sfx.loop(id, 'amb_forge', 1, 5, 0, 5, FORGE_MAX_DISTANCE);
    const pendingLoops = (sfx as unknown as { pendingLoops: Map<string, { maxDistance?: number }> })
      .pendingLoops;
    const pending = pendingLoops.get(id);
    expect(pending?.maxDistance).toBe(FORGE_MAX_DISTANCE);

    // The buffer finishes loading; replay loop() with exactly what the
    // pending record carried, the same value the real load callback reads.
    buffers.set('amb_forge', { duration: 3 });
    sfx.loop(id, 'amb_forge', 1, 5, 0, 5, pending?.maxDistance);
    const loops = (sfx as unknown as { loops: Map<string, { panner: unknown }> }).loops;
    const panner = loops.get(id)?.panner as { refDistance: number; maxDistance: number };
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE);
    expect(panner.refDistance).toBe(REF_DISTANCE);
  });
});

// playAt's boolean return is the load-bearing contract behind the mob
// idle-bark per-entity cooldown (src/ui/mob_idle_sfx.ts, hud.ts): a caller
// stamps its own cooldown only when this returns true, so a false positive
// here (returning true on a cooldown-blocked or unbuffered attempt) would
// silently bench a mob for the full cooldown window over a bark that never
// actually played, the exact bug the design's own doc comment warns about.
describe('playAt return value', () => {
  it('returns false for an unbuffered key (kicks off the async load instead)', () => {
    expect(sfx.playAt('mob_beast_idle', 0, 0, 0)).toBe(false);
  });

  it('returns true for a scheduled play, then false for an immediate repeat blocked by the per-key cooldown', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('foot_stone', { duration: 0.3 });

    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(true);
    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(false); // same instant, default 0.03s cooldown blocks it

    nowT += 1; // clear the cooldown
    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(true);
  });
});

describe('timedGroundLoop (Blizzard storm)', () => {
  beforeEach(() => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('blizzard', { duration: 8 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a loop and auto-stops it after the given duration', () => {
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 0, 0, 0, 6.5);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('groundZone:blizzard')).toBe(true);
    vi.advanceTimersByTime(6500);
    expect(loops.has('groundZone:blizzard')).toBe(false);
  });

  it('a fresh call before expiry reschedules the stop instead of stacking timers', () => {
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 0, 0, 0, 6.5);
    vi.advanceTimersByTime(5000); // most of the way through, still alive
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 10, 0, 10, 6.5); // zone lands again
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    vi.advanceTimersByTime(5000); // the ORIGINAL timer would have fired by now
    expect(loops.has('groundZone:blizzard')).toBe(true); // still alive: rescheduled
    vi.advanceTimersByTime(1500);
    expect(loops.has('groundZone:blizzard')).toBe(false);
  });

  it('ignores an unknown key entirely', () => {
    const before = sources.length;
    sfx.timedGroundLoop('groundZone:nope', 'not_a_real_key', 0, 0, 0, 5);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('groundZone:nope')).toBe(false);
    expect(sources.length).toBe(before);
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
