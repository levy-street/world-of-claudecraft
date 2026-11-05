// The Guardian of the Quench's sounds (src/game/smith_heart_quench_audio_core.ts
// and its adapter smith_heart_quench_audio.ts): every sample it plays ships in
// the manifest, the HUD's generic nova never doubles one of its cues, a cue
// plays at its body or its point, the awakening's charge is fitted to its bar
// once per bar, the cold warns twice on its rise (soft past half, urgent past
// four fifths, each again only after it falls back under), a slash's line
// warns as it is drawn and clicks as it locks (quiet through The Blades
// Hunt, whose loop runs with its bar), and a slash mark rings in its
// player's ear.

import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { QuenchAudio, type QuenchAudioSink } from '../src/game/smith_heart_quench_audio';
import {
  coldWarningDue,
  QUENCH_BAR_SOUNDS,
  QUENCH_COLD_SOUNDS,
  QUENCH_CRACK_SOUND,
  QUENCH_CUE_SOUNDS,
  QUENCH_HUNT_SOUNDS,
  QUENCH_SFX_KEYS,
  QUENCH_SLASH_SOUNDS,
  quenchBarRate,
  quenchSoundClaims,
  slashLocked,
} from '../src/game/smith_heart_quench_audio_core';
import {
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_TUNING,
} from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

function fakeSink() {
  const plays: {
    key: string;
    x: number;
    y: number;
    z: number;
    rate?: number;
    priority?: boolean;
  }[] = [];
  const preloaded: string[] = [];
  const loops = new Map<string, string>();
  const sink: QuenchAudioSink = {
    playAt: (key, x, y, z, o) => {
      plays.push({ key, x, y, z, rate: o?.rate, priority: o?.priority });
      return true;
    },
    loop: (id, key) => {
      loops.set(id, key);
    },
    unloop: (id) => {
      loops.delete(id);
    },
    preload: (key) => {
      preloaded.push(key);
    },
  };
  return { sink, plays, preloaded, loops };
}

const body = (id: number, x: number, z: number, extra: Partial<Entity> = {}) =>
  ({
    id,
    pos: { x, y: 0, z },
    dead: false,
    castingAbility: null,
    castTotal: 0,
    auras: [],
    ...extra,
  }) as unknown as Entity;

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
    // Every mechanic cue is a priority voice (spell spam never silences it).
    for (const p of plays) expect(p.priority).toBe(true);
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

  it('warns softly past half and urgently past four fifths, each again only after it falls back', () => {
    const { warn, danger } = QUENCH_COLD_SOUNDS;
    expect(coldWarningDue(40, warn.at)).toBe('warn');
    expect(coldWarningDue(70, danger.at)).toBe('danger');
    // A leap over both marks sounds the urgent one.
    expect(coldWarningDue(10, 95)).toBe('danger');
    expect(coldWarningDue(warn.at, 70)).toBeNull();
    expect(coldWarningDue(90, 60)).toBeNull();
    const { sink, plays } = fakeSink();
    const audio = new QuenchAudio(sink);
    const me = body(1, 2, 3);
    for (const c of [10, 49, 51, 79, 81, 99, 60, 85]) audio.update(body(9, 0, 0), me, c);
    expect(plays.filter((p) => p.key === warn.key)).toHaveLength(1);
    expect(plays.filter((p) => p.key === danger.key)).toHaveLength(2);
    for (const p of plays) expect(p).toMatchObject({ x: 2, z: 3 });
    // Nobody in the fight: nothing in anyone's ear.
    const quiet = fakeSink();
    const none = new QuenchAudio(quiet.sink);
    for (const c of [10, 60, 90]) none.update(body(9, 0, 0), null, c);
    expect(quiet.plays).toHaveLength(0);
  });

  it("warns as a slash's line is drawn, clicks as it locks, and strikes as the blade flies", () => {
    expect(slashLocked(0, 3)).toBe(false);
    expect(slashLocked(3 - QUENCH_TUNING.slashLock, 3)).toBe(true);
    // The flight is its own take now, never the old crossing's.
    expect(QUENCH_CUE_SOUNDS[QUENCH_CUES.cross].key).toBe('heart_quench_slash');
    const { sink, plays } = fakeSink();
    const audio = new QuenchAudio(sink);
    const g = body(9, 0, 0);
    audio.update(g, null, null);
    audio.line(0, 77, 5, 0, 6, 0, 3);
    audio.line(0, 77, 5, 0, 6, 1, 3);
    expect(plays.map((p) => p.key)).toEqual([QUENCH_SLASH_SOUNDS.warn.key]);
    expect(plays[0]).toMatchObject({ x: 5, z: 6 });
    audio.line(0, 77, 5, 0, 6, 2.3, 3);
    audio.line(0, 77, 5, 0, 6, 2.6, 3);
    expect(plays.map((p) => p.key)).toEqual([
      QUENCH_SLASH_SOUNDS.warn.key,
      QUENCH_SLASH_SOUNDS.lock.key,
    ]);
    // A new line in the same slot warns again; a line first seen locked never does.
    audio.line(0, 78, 5, 0, 6, 0, 3);
    audio.line(1, 79, 5, 0, 6, 2.9, 3);
    expect(plays.filter((p) => p.key === QUENCH_SLASH_SOUNDS.warn.key)).toHaveLength(2);
  });

  it('runs The Blades Hunt as a loop through its bar, its own lines quiet', () => {
    const { sink, plays, loops } = fakeSink();
    const audio = new QuenchAudio(sink);
    const hunt = body(9, 0, 0, { castingAbility: QUENCH_CASTS.flurry, castTotal: 20 });
    audio.update(hunt, null, null);
    audio.update(hunt, null, null);
    expect(plays.filter((p) => p.key === QUENCH_HUNT_SOUNDS.start.key)).toHaveLength(1);
    expect([...loops.values()]).toEqual([QUENCH_HUNT_SOUNDS.loop.key]);
    audio.line(0, 90, 1, 0, 1, 0, 1);
    audio.line(0, 90, 1, 0, 1, 0.5, 1);
    expect(plays.some((p) => p.key === QUENCH_SLASH_SOUNDS.warn.key)).toBe(false);
    expect(plays.some((p) => p.key === QUENCH_SLASH_SOUNDS.lock.key)).toBe(false);
    audio.update(body(9, 0, 0), null, null);
    expect(loops.size).toBe(0);
  });

  it("rings a slash's mark in the marked player's ear, once each time it lands", () => {
    const { sink, plays } = fakeSink();
    const audio = new QuenchAudio(sink);
    const marked = (on: boolean) =>
      body(1, 4, 5, {
        auras: (on ? [{ id: QUENCH_AURAS.marked }] : []) as unknown as Entity['auras'],
      });
    for (const on of [false, true, true, false, true]) audio.update(body(9, 0, 0), marked(on), 0);
    expect(plays.filter((p) => p.key === 'heart_mark_frost')).toHaveLength(2);
  });
});
