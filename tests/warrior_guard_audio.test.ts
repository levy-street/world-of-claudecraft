import { expect, it, vi } from 'vitest';
import { furyAudioClaimed, WARRIOR_GUARD_AUDIO } from '../src/fury_audio_core';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

it.each(Object.keys(WARRIOR_GUARD_AUDIO) as (keyof typeof WARRIOR_GUARD_AUDIO)[])(
  'owns original %s activation even after flourish normalization, with one timed caster lock',
  (id) => {
    const queue = new FuryAudioQueue(),
      sound = vi.fn();
    const host = {
      anchorOf: (id: number, _frac: number, out: { x: number; y: number; z: number }) =>
        Object.assign(out, { x: id, y: 1, z: 0 }),
      abilityAudio: sound,
    } as unknown as SequencerHost;
    let ready = true;
    const fx = new Proxy(
      {
        reserveFuryAudio: (
          ...args: Parameters<FuryAudioQueue['reserve']> extends [unknown, ...infer Rest]
            ? Rest
            : never
        ) => queue.reserve(host, ...args),
      },
      {
        get(target, key) {
          if (!(key in target)) Reflect.set(target, key, vi.fn());
          return Reflect.get(target, key);
        },
      },
    );
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {},
        anchor: () => ({ x: 1, y: 1, z: 0 }),
        audioReady: () => ready,
        localPlayerId: () => 1,
        hasGestureClip: () => true,
        triggerAttack: vi.fn(),
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    const event: Extract<SimEvent, { type: 'spellfx' }> = {
      type: 'spellfx',
      sourceId: 1,
      targetId: 1,
      school: 'physical',
      fx: id === 'raised_guard' ? 'flourish' : 'selfCast',
      ability: id,
    };
    expect(painter.handleSpellfx(event)).toBe(true);
    expect(furyAudioClaimed(event)).toBe(true);
    expect(spellFxCue(event)).toBeNull();
    const cue = WARRIOR_GUARD_AUDIO[id];
    expect(sound.mock.calls.map((c) => c[6].sample)).toEqual([cue.release]);
    queue.update(host, cue.times[0] - 0.001);
    expect(sound).toHaveBeenCalledTimes(1);
    queue.update(host, 0.0011);
    expect(sound.mock.calls.map((c) => c[6].sample)).toEqual([cue.release, cue.impacts[0]]);
    expect(sound.mock.calls.every((c) => c[3] === 1)).toBe(true);
    queue.update(host, 1);
    expect(sound).toHaveBeenCalledTimes(2);
    ready = false;
    const cold = { ...event };
    painter.handleSpellfx(cold);
    expect(furyAudioClaimed(cold)).toBe(false);
    expect(sound).toHaveBeenCalledTimes(2);
  },
);
