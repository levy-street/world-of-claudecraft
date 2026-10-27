// The Hammer Council's sounds (src/game/smith_heart_council_audio_core.ts and
// its adapter smith_heart_council_audio.ts): every cue the council emits has
// its own shipped sample, the HUD's generic nova never doubles one, the
// Endless Song grows louder and deeper, a bar's charge plays once when the bar
// starts (never late for one already running), the rock's fall as it comes
// into view, and the Walking Slab grinds only while it drags.

import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { CouncilAudio, type CouncilAudioSink } from '../src/game/smith_heart_council_audio';
import {
  barSoundRate,
  COUNCIL_BAR_SOUNDS,
  COUNCIL_CUE_SOUNDS,
  COUNCIL_SFX_KEYS,
  councilSoundClaims,
  ROCK_FALL_SOUND,
  songPulseSound,
} from '../src/game/smith_heart_council_audio_core';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

function fakeSink() {
  const plays: { key: string; x: number; z: number; gain?: number; rate?: number }[] = [];
  const loops = new Map<string, string>();
  const sink: CouncilAudioSink = {
    playAt: (key, x, _y, z, o) => {
      plays.push({ key, x, z, gain: o?.gain, rate: o?.rate });
      return true;
    },
    loop: (id, key) => {
      loops.set(id, key);
    },
    unloop: (id) => {
      loops.delete(id);
    },
    preload: () => {},
  };
  return { sink, plays, loops };
}

const ent = (id: number, x = 0, z = 0, extra: Partial<Entity> = {}) =>
  ({
    id,
    kind: 'mob',
    templateId: 'heart_slabwright',
    dead: false,
    pos: { x, y: 0, z },
    auras: [],
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    ...extra,
  }) as unknown as Entity;

describe('Hammer Council sounds: the plan', () => {
  it('every council cue and its bars ship their own sample', () => {
    for (const cue of Object.values(COUNCIL_CUES)) {
      expect(COUNCIL_CUE_SOUNDS[cue], cue).toBeDefined();
      expect(councilSoundClaims(cue)).toBe(true);
    }
    for (const id of [COUNCIL_CASTS.wrath, COUNCIL_CASTS.bolt, COUNCIL_CASTS.weight])
      expect(councilSoundClaims(id), id).toBe(true);
    for (const key of COUNCIL_SFX_KEYS) {
      expect(key.startsWith('heart_council_'), key).toBe(true);
      expect(Object.hasOwn(SFX_CLIPS, key), `${key} in the manifest`).toBe(true);
    }
    expect(COUNCIL_SFX_KEYS.length).toBe(18);
    expect(councilSoundClaims('frost_nova')).toBe(false);
    expect(councilSoundClaims(undefined)).toBe(false);
  });

  it('the HUD never plays its generic nova over a council cue', () => {
    const nova = (ability: string) =>
      spellFxCue({
        type: 'spellfx',
        sourceId: 1,
        targetId: 1,
        school: 'physical',
        fx: 'nova',
        ability,
      } as Extract<SimEvent, { type: 'spellfx' }>);
    expect(nova(COUNCIL_CUES.crack)).toBeNull();
    expect(nova(COUNCIL_CASTS.wrath)).toBeNull();
    expect(nova('frost_nova')?.key).toBe('frost_nova');
  });

  it('the Endless Song grows louder and deeper to its cap, then holds', () => {
    const at = (n: number) =>
      songPulseSound(n, { key: '', gain: 0, rate: 0, cooldown: 0, at: 'source' });
    let last = at(0);
    for (let n = 1; n <= 30; n++) {
      const now = at(n);
      expect(now.gain).toBeGreaterThanOrEqual(last.gain);
      expect(now.rate).toBeLessThanOrEqual(last.rate);
      last = { ...now };
    }
    expect(at(0).gain).toBeLessThan(at(30).gain);
    expect(at(30)).toEqual(at(300));
    expect(at(30).gain).toBeLessThanOrEqual(1);
  });

  it('a bar charge fits its bar within a breath of its pitch', () => {
    const wrath = COUNCIL_BAR_SOUNDS[COUNCIL_CASTS.wrath];
    expect(barSoundRate(wrath, T.wrathCast)).toBe(1);
    expect(barSoundRate(wrath, T.heirWrathCast)).toBeCloseTo(1.2);
    expect(barSoundRate(COUNCIL_BAR_SOUNDS[COUNCIL_CASTS.echo], T.echoCast)).toBe(1);
    expect(barSoundRate(COUNCIL_BAR_SOUNDS[COUNCIL_CASTS.song], T.songCast)).toBe(1);
    expect(barSoundRate(wrath, 0)).toBe(1);
  });
});

describe('Hammer Council sounds: the adapter', () => {
  it('plays a cue where it happens, the song pulse by its count', () => {
    const { sink, plays } = fakeSink();
    const a = new CouncilAudio(sink);
    const pillar = ent(5, 10, 20, {
      kind: 'object',
      auras: [{ id: COUNCIL_AURAS.endlessSong, value: 1 + 6 * T.songPulseGrowth } as never],
    });
    const byId = (id: number) => (id === 5 ? pillar : undefined);
    const ground = () => 0;
    const nova = (ability: string) =>
      ({
        type: 'spellfx',
        sourceId: 5,
        targetId: 5,
        school: 'physical',
        fx: 'nova',
        ability,
      }) as SimEvent;
    expect(a.event(nova(COUNCIL_CUES.crack), byId, ground)).toBe(true);
    expect(plays.at(-1)).toMatchObject({ key: 'heart_council_pillar_crack', x: 10, z: 20 });
    a.event(nova(COUNCIL_CUES.songPulse), byId, ground);
    const loud = songPulseSound(6, { key: '', gain: 0, rate: 0, cooldown: 0, at: 'source' });
    expect(plays.at(-1)).toMatchObject({ key: 'heart_council_song_pulse', gain: loud.gain });
    a.event(
      {
        type: 'spellfxAt',
        x: 3,
        z: 4,
        school: 'physical',
        fx: 'burst',
        ability: COUNCIL_CUES.collapse,
        radius: 4,
      } as SimEvent,
      byId,
      ground,
    );
    expect(plays.at(-1)).toMatchObject({ key: 'heart_council_pillar_collapse', x: 3, z: 4 });
    expect(a.event(nova('frost_nova'), byId, ground)).toBe(false);
  });

  it('a bar charge plays once as the bar starts, never late for one already running', () => {
    const { sink, plays } = fakeSink();
    const a = new CouncilAudio(sink);
    const g = ent(1);
    const byId = () => g;
    a.beginScan();
    a.see(g, 'member');
    a.endScan();
    a.update(0.05, byId);
    expect(plays).toEqual([]);
    g.castingAbility = COUNCIL_CASTS.wrath;
    g.castTotal = T.wrathCast;
    a.update(0.05, byId);
    a.update(0.05, byId);
    expect(plays.map((p) => p.key)).toEqual(['heart_council_wrath_charge']);
    // Seen first mid-bar: silent until the next one.
    const { sink: s2, plays: p2 } = fakeSink();
    const b = new CouncilAudio(s2);
    b.beginScan();
    b.see(g, 'member');
    b.endScan();
    b.update(0.05, byId);
    expect(p2).toEqual([]);
  });

  it('the rock falls into view once per mark', () => {
    const { sink, plays } = fakeSink();
    const a = new CouncilAudio(sink);
    const mark = { id: COUNCIL_AURAS.rockMark, remaining: 3, duration: 5 };
    const p = ent(9, 0, 0, { kind: 'player', auras: [mark as never] });
    const byId = () => p;
    a.beginScan();
    a.see(p, 'rock');
    a.endScan();
    a.update(0.05, byId);
    expect(plays).toEqual([]);
    mark.remaining = ROCK_FALL_SOUND.lead - 0.01;
    a.update(0.05, byId);
    mark.remaining -= 0.5;
    a.update(0.05, byId);
    expect(plays.map((q) => q.key)).toEqual([ROCK_FALL_SOUND.key]);
  });

  it('the Walking Slab grinds only while it drags, and stops when it goes', () => {
    const { sink, loops } = fakeSink();
    const a = new CouncilAudio(sink);
    const slab = ent(4, 0, 0, { kind: 'object' });
    const byId = () => slab;
    a.beginScan();
    a.see(slab, 'slab');
    a.endScan();
    for (let i = 0; i < 10; i++) a.update(0.05, byId);
    expect(loops.size).toBe(0);
    for (let i = 0; i < 4; i++) {
      slab.pos.x += T.slabSpeed / 20;
      a.update(0.05, byId);
    }
    expect([...loops.values()]).toEqual(['heart_council_slab_grind']);
    for (let i = 0; i < 20; i++) a.update(0.05, byId);
    expect(loops.size).toBe(0);
    slab.pos.x += 0.1;
    a.update(0.05, byId);
    expect(loops.size).toBe(1);
    a.beginScan();
    a.endScan();
    expect(loops.size).toBe(0);
  });
});
