import { describe, expect, it, vi } from 'vitest';
import { HoardMechanicAudio } from '../src/game/hoard_mechanic_audio';
import {
  HOARD_MECHANIC_LATE_SEC,
  HOARD_MECHANIC_SFX_KEYS,
  hoardMechanicBeats,
  hoardMechanicDue,
} from '../src/game/hoard_mechanic_audio_core';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { BOULDER_CUE_VARIANTS } from '../src/sim/rift/hoard_boulder_core';
import { COCOON, COCOON_CUE_VARIANTS } from '../src/sim/rift/hoard_cocoon_core';
import { FORGE_HAMMER } from '../src/sim/rift/hoard_forge_hammer_core';
import { TENTACLES } from '../src/sim/rift/hoard_tentacles_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

function cue(variant: HoardBossCueView['variant'], total: number, elapsed: number, cueId = 1) {
  return {
    instanceId: 3,
    cueId,
    kind: 'mark',
    variant,
    phase: 'warning',
    x: 10,
    z: -20,
    radius: 5,
    remaining: total - elapsed,
    total,
  } satisfies HoardBossCueView;
}

describe('hoard mechanic audio core', () => {
  it('only uses samples the game already ships', () => {
    const catalog = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    expect(HOARD_MECHANIC_SFX_KEYS.length).toBeGreaterThan(8);
    for (const key of HOARD_MECHANIC_SFX_KEYS) expect(catalog.has(key), key).toBe(true);
  });

  it('gives every new mechanic a voice', () => {
    for (const variant of [...BOULDER_CUE_VARIANTS, ...COCOON_CUE_VARIANTS]) {
      expect(hoardMechanicBeats(variant), variant).toBeDefined();
    }
    for (const variant of [
      'ember-hammer',
      'ember-hammer-strike',
      'tide-tentacle',
      'tide-whip',
      'tide-sweep',
      'tide-grab',
      'tide-tentacle-fall',
    ] as const) {
      expect(hoardMechanicBeats(variant), variant).toBeDefined();
    }
    // Heartbeat cues restart their clock: a beat on one would stutter.
    expect(hoardMechanicBeats('tide-tentacle-up')).toBeUndefined();
    expect(hoardMechanicBeats('tide-grab-hold')).toBeUndefined();
    expect(hoardMechanicBeats(undefined)).toBeUndefined();
  });

  it('lands each blow on the beat its sim core resolves it', () => {
    const anvil = hoardMechanicBeats('ember-hammer-strike')?.find(
      (beat) => beat.key === 'ui_aura_anvil_strike',
    );
    expect(anvil?.at).toBe(FORGE_HAMMER.warningSec);
    const splash = hoardMechanicBeats('tide-tentacle')?.find((beat) => beat.key === 'move_splash');
    expect(splash?.at).toBe(TENTACLES.spawnWarningSec);
    const lash = hoardMechanicBeats('tide-whip')?.find((beat) => beat.key === 'impact_flesh');
    expect(lash?.at).toBe(TENTACLES.whipTelegraphSec);
    const wrap = hoardMechanicBeats('brood-cocoon')?.find(
      (beat) => beat.key === 'entangling_roots',
    );
    expect(wrap?.at).toBe(COCOON.warningSec);
    // Beats are authored in order and inside a sane range.
    for (const variant of ['ember-hammer-strike', 'tide-tentacle', 'brood-cocoon'] as const) {
      const beats = hoardMechanicBeats(variant) ?? [];
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i].at).toBeGreaterThanOrEqual(beats[i - 1].at);
      }
      for (const beat of beats) {
        expect(beat.gain).toBeGreaterThan(0);
        expect(beat.gain).toBeLessThanOrEqual(1);
        expect(beat.rate).toBeGreaterThan(0.3);
      }
    }
  });

  it('plays a beat once as the clock crosses it, and skips stale ones on first sight', () => {
    const beats = hoardMechanicBeats('ember-hammer-strike') ?? [];
    const out = { play: 0, fired: 0 };
    hoardMechanicDue(beats, 0.2, 0, true, out);
    expect(out.play).toBe(0);
    hoardMechanicDue(beats, FORGE_HAMMER.warningSec + 0.01, out.fired, false, out);
    expect(out.play).toBe(0b0111);
    hoardMechanicDue(beats, FORGE_HAMMER.warningSec + 0.02, out.fired, false, out);
    expect(out.play).toBe(0);
    // Walking in well after the blow: marked as done, never played.
    hoardMechanicDue(beats, FORGE_HAMMER.warningSec + HOARD_MECHANIC_LATE_SEC + 1, 0, true, out);
    expect(out.play).toBe(0);
    expect(out.fired).toBe(0b1111);
  });
});

describe('hoard mechanic audio adapter', () => {
  it('preloads once, plays at the cue, and never twice for one cue', () => {
    const playAt = vi.fn(() => true);
    const preload = vi.fn();
    const audio = new HoardMechanicAudio({ playAt, preload });
    audio.sync([], 0);
    expect(preload).not.toHaveBeenCalled();

    audio.sync([cue('tide-tentacle', 2.1, 0)], 4);
    expect(preload).toHaveBeenCalledTimes(HOARD_MECHANIC_SFX_KEYS.length);
    expect(playAt).toHaveBeenCalledTimes(1);
    expect(playAt).toHaveBeenLastCalledWith('move_swim', 10, 4, -20, expect.any(Object));

    audio.sync([cue('tide-tentacle', 2.1, TENTACLES.spawnWarningSec + 0.01)], 4);
    expect(playAt).toHaveBeenCalledTimes(3);
    // A mirror that restarts the cue's life must not replay what it already did.
    audio.sync([cue('tide-tentacle', 2.1, 0)], 4);
    audio.sync([cue('tide-tentacle', 2.1, TENTACLES.spawnWarningSec + 0.01)], 4);
    expect(playAt).toHaveBeenCalledTimes(3);
    expect(preload).toHaveBeenCalledTimes(HOARD_MECHANIC_SFX_KEYS.length);
  });

  it('forgets a finished cue, so the next one with its id sounds again', () => {
    const playAt = vi.fn(() => true);
    const audio = new HoardMechanicAudio({ playAt });
    audio.sync([cue('brood-cocoon-end', 1, 0)]);
    audio.sync([]);
    audio.sync([cue('brood-cocoon-end', 1, 0)]);
    expect(playAt).toHaveBeenCalledTimes(2);
  });

  it('stays silent for cues with no voice and past its voice budget', () => {
    const playAt = vi.fn(() => true);
    const audio = new HoardMechanicAudio({ playAt });
    audio.sync([cue('tide-wave', 4, 0), cue('tide-tentacle-up', 1.4, 0, 2)]);
    expect(playAt).not.toHaveBeenCalled();
    const many = Array.from({ length: 40 }, (_, i) => cue('brood-cocoon-end', 1, 0, 100 + i));
    audio.sync(many);
    expect(playAt).toHaveBeenCalledTimes(24);
  });
});
