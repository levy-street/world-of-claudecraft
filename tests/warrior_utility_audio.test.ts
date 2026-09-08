import { expect, it, vi } from 'vitest';
import { furyAudioClaimed, WARRIOR_UTILITY_AUDIO } from '../src/fury_audio_core';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

it.each(Object.keys(WARRIOR_UTILITY_AUDIO) as (keyof typeof WARRIOR_UTILITY_AUDIO)[])(
  'owns %s with one native-timed caster sound and no generic duplicate',
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
      targetId: id === 'taunt' ? 2 : 1,
      school: 'physical',
      fx: 'selfCast',
      ability: id,
    };
    expect(painter.handleSpellfx(event)).toBe(true);
    expect(furyAudioClaimed(event)).toBe(true);
    expect(spellFxCue(event)).toBeNull();
    const cue = WARRIOR_UTILITY_AUDIO[id];
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

it('Mending has no second generic buff chime while unrelated defensive buffs keep theirs', () => {
  const event = { type: 'aura', targetId: 1, name: 'Furious Mending', gained: true } as Extract<
    SimEvent,
    { type: 'aura' }
  >;
  const aura = { id: 'furious_mending', kind: 'buff_dr', remaining: 10 } as Aura;
  expect(auraApplyCue(event, aura)).toBeNull();
  expect(auraApplyCue(event, { ...aura, id: 'other_defense' })).toBe('buff_apply');
});

import type { Aura } from '../src/sim/types';
import { auraApplyCue } from '../src/ui/combat_sfx';
