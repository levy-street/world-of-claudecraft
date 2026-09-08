import { expect, it, vi } from 'vitest';
import { furyAudioClaimed, WARRIOR_CONTACT_AUDIO } from '../src/fury_audio_core';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { ABILITIES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { impactCueForDamage, playerSwingCueForDamage } from '../src/ui/combat_sfx';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';

it.each(Object.keys(WARRIOR_CONTACT_AUDIO) as (keyof typeof WARRIOR_CONTACT_AUDIO)[])(
  'owns %s contact at the native pose time in the real painter and both sound consumers',
  (id) => {
    const session = new StudioSession({
      ...DEFAULT_STUDIO_CONFIG,
      cls: 'warrior',
      spec:
        id === 'shield_slam'
          ? 'prot'
          : id === 'mortal_strike' ||
              id === 'execute' ||
              id === 'slam' ||
              id === 'overpower' ||
              id === 'breachmaker'
            ? 'arms'
            : 'fury',
    });
    const source = session.sim.player,
      target = session.sim.entities.get(session.targetIds[0]);
    if (!target) throw new Error('Missing real Studio recipient');
    const queue = new FuryAudioQueue(),
      sound = vi.fn();
    const host = {
      anchorOf: (entityId: number, height: number, out: { x: number; y: number; z: number }) =>
        Object.assign(out, { x: entityId, y: height * 2, z: 0 }),
      abilityAudio: sound,
    } as unknown as SequencerHost;
    let ready = true;
    const painter = new AbilityVfx(
      {
        fx: {
          setDelegates: vi.fn(),
          sequenceInstant: vi.fn(),
          reserveFuryAudio: (
            ...args: Parameters<FuryAudioQueue['reserve']> extends [unknown, ...infer Rest]
              ? Rest
              : never
          ) => queue.reserve(host, ...args),
        },
        vfx: {},
        anchor: () => ({ x: 0, y: 1, z: 0 }),
        audioReady: () => ready,
        localPlayerId: () => source.id,
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    const event: Extract<SimEvent, { type: 'damage' }> = {
      type: 'damage',
      abilityId: id,
      ability: ABILITIES[id].name,
      sourceId: source.id,
      targetId: target.id,
      school: 'physical',
      kind: 'hit',
      amount: 100,
      crit: false,
    };
    painter.onDamage(event);
    expect(furyAudioClaimed(event)).toBe(true);
    expect(playerSwingCueForDamage(event, source)).toBeNull();
    expect(impactCueForDamage(event, target)).toBeNull();
    const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
    const studioAudio = new StudioCombatAudio(sink);
    studioAudio.event(event, session.sim.entities, source.id);
    expect(sink.playAt).not.toHaveBeenCalled();
    queue.update(host, 0.149);
    expect(sound.mock.calls.map((call) => call[0])).toEqual(['release']);
    queue.update(host, 0.0011);
    expect(sound.mock.calls.map((call) => call[6].sample)).toEqual([
      WARRIOR_CONTACT_AUDIO[id].release,
      WARRIOR_CONTACT_AUDIO[id].impacts[0],
    ]);
    queue.update(host, 0.6);
    expect(sound).toHaveBeenCalledTimes(2);
    ready = false;
    const cold = { ...event };
    painter.onDamage(cold);
    expect(furyAudioClaimed(cold)).toBe(false);
    expect(playerSwingCueForDamage(cold, source)).not.toBeNull();
    expect(impactCueForDamage(cold, target)).not.toBeNull();
    studioAudio.event(cold, session.sim.entities, source.id);
    expect(sink.playAt.mock.calls.some(([key]) => key.startsWith('impact_'))).toBe(true);
  },
);
