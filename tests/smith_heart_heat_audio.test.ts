// The Guardian of the Heat's sounds (src/game/smith_heart_heat_audio_core.ts
// and its adapter smith_heart_heat_audio.ts): every sample it plays ships in
// the manifest (the pack's own: no take of the fight's yet), the HUD's
// generic nova or beam never doubles one of its cues, a cue's layers play at
// their body or their point, Shed Heat's charge is fitted to its bar once per
// bar, the heat's swell sounds once as it passes three quarters, and a burn
// sizzles only when the local player's own stacks grow.

import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { HeatAudio, type HeatAudioSink } from '../src/game/smith_heart_heat_audio';
import {
  HEAT_BAR_SOUNDS,
  HEAT_BRIM_SOUND,
  HEAT_BURN_SOUND,
  HEAT_CUE_SOUNDS,
  HEAT_RISING_SOUND,
  HEAT_SFX_KEYS,
  heatBarRate,
  heatSoundClaims,
  heatWarningDue,
} from '../src/game/smith_heart_heat_audio_core';
import { HEAT_CASTS, HEAT_CUES } from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

function fakeSink() {
  const plays: { key: string; x: number; y: number; z: number; rate?: number }[] = [];
  const preloaded: string[] = [];
  const sink: HeatAudioSink = {
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
    resource: 0,
    ...extra,
  }) as Entity;

describe('smith_heart_heat_audio', () => {
  it('ships every sample it plays, gives every cue a sound, and claims exactly its own', () => {
    for (const key of HEAT_SFX_KEYS)
      expect(Object.hasOwn(SFX_CLIPS, key), `${key} in the manifest`).toBe(true);
    for (const cue of Object.values(HEAT_CUES)) {
      expect(heatSoundClaims(cue), cue).toBe(true);
      expect(HEAT_CUE_SOUNDS[cue].length, cue).toBeGreaterThan(0);
    }
    expect(heatSoundClaims('flamestrike')).toBe(false);
    expect(heatSoundClaims(undefined)).toBe(false);
    // Hearthburst is layered (the blast, a meteor, a pyroblast).
    expect(HEAT_CUE_SOUNDS[HEAT_CUES.overheat].length).toBe(3);
  });

  it('the HUD never plays its generic sound over a heat cue', () => {
    const ev = (ability: string, fx: 'nova' | 'beam') =>
      spellFxCue({
        type: 'spellfx',
        sourceId: 1,
        targetId: 2,
        school: 'fire',
        fx,
        ability,
      } as Extract<SimEvent, { type: 'spellfx' }>);
    expect(ev(HEAT_CUES.pulse, 'nova')).toBeNull();
    expect(ev(HEAT_CUES.overheat, 'nova')).toBeNull();
    expect(ev(HEAT_CUES.beam, 'beam')).toBeNull();
    expect(ev(HEAT_CUES.beamBack, 'beam')).toBeNull();
  });

  it("plays a cue's layers at its target, its source or its point", () => {
    const { sink, plays, preloaded } = fakeSink();
    const audio = new HeatAudio(sink);
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
        school: 'fire',
        fx: 'beam',
        ability,
      }) as SimEvent;
    expect(audio.event(fx(HEAT_CUES.beam), of, ground)).toBe(true);
    // The fire at the struck player, the crystal's ring at the crystal.
    expect(plays[0]).toMatchObject({ key: 'cast_fire', x: -5, z: 7 });
    expect(plays[1]).toMatchObject({ key: 'ui_aura_glass_ping', x: 10, z: 20 });
    const at = {
      type: 'spellfxAt',
      x: 4,
      z: 6,
      school: 'fire',
      fx: 'burst',
      ability: HEAT_CUES.rise,
    } as unknown as SimEvent;
    expect(audio.event(at, of, ground)).toBe(true);
    expect(plays[2]).toMatchObject({ key: 'heart_council_pillar_rise', x: 4, y: 4, z: 6 });
    expect(audio.event(fx('fireball'), of, ground)).toBe(false);
    expect([...preloaded].sort()).toEqual([...HEAT_SFX_KEYS].sort());
    audio.brim(1, 0, 2);
    expect(plays[plays.length - 1].key).toBe(HEAT_BRIM_SOUND.key);
  });

  it("fits Shed Heat's charge to its bar, once per bar", () => {
    const sound = HEAT_BAR_SOUNDS[HEAT_CASTS.shed];
    expect(heatBarRate(sound, sound.seconds)).toBe(1);
    expect(heatBarRate(sound, 100)).toBe(0.85);
    const { sink, plays } = fakeSink();
    const audio = new HeatAudio(sink);
    const g = body(9, 0, 0, { castingAbility: HEAT_CASTS.shed, castTotal: 2.5 });
    audio.update(g, null, 0);
    audio.update(g, null, 0);
    expect(plays.filter((p) => p.key === sound.key)).toHaveLength(1);
    // Molten Pour's bar has no charge of the fight's (HeatFx speaks for it).
    audio.update(body(9, 0, 0, { castingAbility: HEAT_CASTS.pour, castTotal: 2 }), null, 0);
    expect(plays).toHaveLength(1);
  });

  it('swells once as the heat passes three quarters, and sizzles as my own burn grows', () => {
    expect(heatWarningDue(70, HEAT_RISING_SOUND.at)).toBe(true);
    expect(heatWarningDue(HEAT_RISING_SOUND.at, 90)).toBe(false);
    const { sink, plays } = fakeSink();
    const audio = new HeatAudio(sink);
    const me = body(1, 2, 3);
    for (const h of [10, 50, 74, 76, 90, 99, 0, 80])
      audio.update(body(9, 0, 0, { resource: h }), me, 0);
    expect(plays.filter((p) => p.key === HEAT_RISING_SOUND.key)).toHaveLength(2);
    for (const b of [0, 1, 2, 2, 1, 2]) audio.update(body(9, 0, 0), me, b);
    expect(plays.filter((p) => p.key === HEAT_BURN_SOUND.key)).toHaveLength(3);
  });
});
