import { expect, it, vi } from 'vitest';
import { furyAudioClaimed, WARRIOR_AREA_AUDIO } from '../src/fury_audio_core';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { ABILITIES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { impactCueForDamage, playerSwingCueForDamage, spellFxCue } from '../src/ui/combat_sfx';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';

it.each(Object.keys(WARRIOR_AREA_AUDIO) as (keyof typeof WARRIOR_AREA_AUDIO)[])(
  '%s owns one area recording through the real painter and both sound consumers',
  (id) => {
    const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'prot' });
    const source = session.sim.player,
      target = session.sim.entities.get(session.targetIds[0])!;
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
          sequenceWarriorAreaContact: vi.fn(() => true),
          reserveFuryAudio: (
            ...args: Parameters<FuryAudioQueue['reserve']> extends [unknown, ...infer Rest]
              ? Rest
              : never
          ) => queue.reserve(host, ...args),
          hasRetainedAreaAudio: queue.ownsCast.bind(queue),
        },
        vfx: {},
        hasGestureClip: () => true,
        triggerAttack: vi.fn(),
        anchor: () => ({ x: 0, y: 1, z: 0 }),
        audioReady: () => ready,
        localPlayerId: () => source.id,
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    const cast: Extract<SimEvent, { type: 'spellfx' }> = {
      type: 'spellfx',
      sourceId: source.id,
      targetId: source.id,
      school: 'physical',
      fx: 'nova',
      ability: id,
    };
    painter.handleSpellfx(cast);
    expect(furyAudioClaimed(cast)).toBe(true);
    expect(spellFxCue(cast)).toBeNull();
    const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
    const studio = new StudioCombatAudio(sink);
    studio.event(cast, session.sim.entities, source.id);
    for (let i = 0; i < 9; i++) {
      const event: Extract<SimEvent, { type: 'damage' }> = {
        type: 'damage',
        abilityId: id,
        ability: ABILITIES[id].name,
        sourceId: source.id,
        targetId: target.id,
        school: 'physical',
        kind: 'hit',
        amount: 20,
        crit: false,
      };
      painter.onDamage(event);
      expect(furyAudioClaimed(event)).toBe(true);
      expect(playerSwingCueForDamage(event, source)).toBeNull();
      expect(impactCueForDamage(event, target)).toBeNull();
      studio.event(event, session.sim.entities, source.id);
    }
    expect(sink.playAt).not.toHaveBeenCalled();
    queue.update(host, 0.149);
    expect(sound.mock.calls.map((c) => c[0])).toEqual(['release']);
    queue.update(host, 0.0011);
    expect(sound.mock.calls.map((c) => c[6].sample)).toEqual([
      WARRIOR_AREA_AUDIO[id].release,
      WARRIOR_AREA_AUDIO[id].impacts[0],
    ]);
    queue.update(host, 0.6);
    ready = false;
    const cold = { ...cast };
    painter.handleSpellfx(cold);
    expect(furyAudioClaimed(cold)).toBe(false);
    expect(spellFxCue(cold)).not.toBeNull();
  },
);
