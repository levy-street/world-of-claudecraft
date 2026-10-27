// The Guardian of the Quench's sounds (src/game/smith_heart_quench_audio_core.ts
// and its adapter smith_heart_quench_audio.ts): every sample it plays ships in
// the manifest, the HUD's generic nova never doubles one of its cues, a cue
// plays at its body or its point, the awakening's charge is fitted to its bar
// once per bar, and the cold warning sounds once as the bar passes three
// quarters (again only after it falls back under).

import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { QuenchAudio, type QuenchAudioSink } from '../src/game/smith_heart_quench_audio';
import {
  coldWarningDue,
  QUENCH_BAR_SOUNDS,
  QUENCH_COLD_SOUND,
  QUENCH_CRACK_SOUND,
  QUENCH_CUE_SOUNDS,
  QUENCH_SFX_KEYS,
  quenchBarRate,
  quenchSoundClaims,
} from '../src/game/smith_heart_quench_audio_core';
import { QUENCH_CASTS, QUENCH_CUES } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

function fakeSink() {
  const plays: { key: string; x: number; y: number; z: number; rate?: number }[] = [];
  const preloaded: string[] = [];
  const sink: QuenchAudioSink = {
    playAt: (key, x, y, z, o) => {
      plays.push({ key, x, y, z, rate: o?.rate });
      return true;
    },
    preload: (key) => {
      preloaded.push(key);
    },
  };
  return { sink, plays, preloaded };
}

const body = (id: number, x: number, z: number, extra: Partial<Entity> = {}) =>
  ({
    id,
    pos: { x, y: 0, z },
    dead: false,
    castingAbility: null,
    castTotal: 0,
    ...extra,
  }) as Entity;

describe('smith_heart_quench_audio', () => {
  it('ships every sample it plays, and claims exactly its own cues', () => {
    expect(QUENCH_SFX_KEYS.length).toBeGreaterThanOrEqual(11);
    for (const key of QUENCH_SFX_KEYS)
      expect(Object.hasOwn(SFX_CLIPS, key), `${key} in the manifest`).toBe(true);
    for (const cue of Object.values(QUENCH_CUES))
      expect(quenchSoundClaims(cue), cue).toBe(Object.hasOwn(QUENCH_CUE_SOUNDS, cue));
    expect(quenchSoundClaims(QUENCH_CUES.shatter)).toBe(true);
    expect(quenchSoundClaims('frost_nova')).toBe(false);
    expect(quenchSoundClaims(undefined)).toBe(false);
  });

  it('the HUD never plays its generic nova over a quench cue', () => {
    const nova = (ability: string) =>
      spellFxCue({
        type: 'spellfx',
        sourceId: 1,
        targetId: 1,
        school: 'frost',
        fx: 'nova',
        ability,
      } as Extract<SimEvent, { type: 'spellfx' }>);
    expect(nova(QUENCH_CUES.shatter)).toBeNull();
    expect(nova(QUENCH_CUES.wake)).toBeNull();
    expect(nova('frost_nova')?.key).toBe('frost_nova');
  });

  it('plays a cue at its target, its source or its point', () => {
    const { sink, plays, preloaded } = fakeSink();
    const audio = new QuenchAudio(sink);
    const ents = new Map([
      [1, body(1, 10, 20)],
      [2, body(2, -5, 7)],
    ]);
    const of = (id: number) => ents.get(id);
    const ground = () => 3;
    const fx = (ability: string) =>
      ({
        type: 'spellfx',
        sourceId: 1,
        targetId: 2,
        school: 'frost',
        fx: 'nova',
        ability,
      }) as SimEvent;
    expect(audio.event(fx(QUENCH_CUES.freeze), of, ground)).toBe(true);
    expect(plays[0]).toMatchObject({ key: 'heart_quench_freeze', x: -5, z: 7 });
    expect(audio.event(fx(QUENCH_CUES.wake), of, ground)).toBe(true);
    expect(plays[1]).toMatchObject({ key: 'heart_quench_wake', x: 10, z: 20 });
    const at = {
      type: 'spellfxAt',
      sourceId: 1,
      x: 4,
      z: 6,
      school: 'frost',
      fx: 'nova',
      ability: QUENCH_CUES.hole,
    } as unknown as SimEvent;
    expect(audio.event(at, of, ground)).toBe(true);
    expect(plays[2]).toMatchObject({ key: 'heart_quench_hole', x: 4, y: 4, z: 6 });
    expect(audio.event(fx('frostbolt'), of, ground)).toBe(false);
    expect(plays).toHaveLength(3);
    expect([...preloaded].sort()).toEqual([...QUENCH_SFX_KEYS].sort());
    audio.crack(1, 0, 2);
    expect(plays[3].key).toBe(QUENCH_CRACK_SOUND.key);
  });

  it("fits the awakening's charge to its bar, once per bar", () => {
    const sound = QUENCH_BAR_SOUNDS[QUENCH_CASTS.wake];
    expect(sound.key).toBe('heart_quench_wake_charge');
    expect(quenchBarRate(sound, sound.seconds)).toBe(1);
    expect(quenchBarRate(sound, 100)).toBe(0.85);
    expect(quenchBarRate(sound, 0.1)).toBe(1.2);
    const { sink, plays } = fakeSink();
    const audio = new QuenchAudio(sink);
    const g = body(9, 0, 0, { castingAbility: QUENCH_CASTS.wake, castTotal: 4 });
    audio.update(g, null, null);
    audio.update(g, null, null);
    audio.update(g, null, null);
    expect(plays.filter((p) => p.key === sound.key)).toHaveLength(1);
    expect(plays[0].rate).toBe(quenchBarRate(sound, 4));
    // The breath's bar has no charge of its own (its cone speaks for it).
    audio.update(
      body(9, 0, 0, { castingAbility: QUENCH_CASTS.breath, castTotal: 2.5 }),
      null,
      null,
    );
    expect(plays).toHaveLength(1);
  });

  it('warns once as the cold passes three quarters, again only after it falls back', () => {
    expect(coldWarningDue(70, QUENCH_COLD_SOUND.at)).toBe(true);
    expect(coldWarningDue(QUENCH_COLD_SOUND.at, 90)).toBe(false);
    expect(coldWarningDue(80, 60)).toBe(false);
    const { sink, plays } = fakeSink();
    const audio = new QuenchAudio(sink);
    const me = body(1, 2, 3);
    for (const c of [10, 50, 74, 76, 90, 99, 60, 80]) audio.update(body(9, 0, 0), me, c);
    expect(plays.filter((p) => p.key === QUENCH_COLD_SOUND.key)).toHaveLength(2);
    expect(Object.hasOwn(SFX_CLIPS, QUENCH_COLD_SOUND.key)).toBe(true);
  });
});
