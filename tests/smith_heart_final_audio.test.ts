// The Masterless Strength's sounds (src/game/smith_heart_final_audio_core.ts
// and its adapter smith_heart_final_audio.ts): every sample it plays ships in
// the manifest, every final cue sounds and the HUD's generic nova, beam or
// burst never doubles one, a cue used as a beam and a burst plays the right
// layer for each, the Overload's pulse grows with its bar, a bar's warning
// sounds once per bar on the boss and on a Splinter, a footprint warns as it
// appears, the Overload warns once as it passes three quarters, Mythic's
// floor rising back sounds once, the gale loops while it blows, each turn of
// the final phase's mix carries its element's sting, and the local player
// hears their marks and their cold.

import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { FinalAudio, type FinalAudioSink } from '../src/game/smith_heart_final_audio';
import {
  FINAL_BAR_SOUNDS,
  FINAL_CUE_SOUNDS,
  FINAL_FOOTPRINT_SOUNDS,
  FINAL_OVERLOAD_RISING,
  FINAL_REBUILD_SOUND,
  FINAL_SFX_KEYS,
  finalSoundClaims,
  MIX_TURN_STING,
  overloadPulseSound,
  rebuildDue,
} from '../src/game/smith_heart_final_audio_core';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_CUES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CASTS,
  FINAL_PHASE_CUES,
  FINAL_STAGE_CODES,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { spellFxCue } from '../src/ui/combat_sfx';

function fakeSink() {
  const plays: {
    key: string;
    x: number;
    y: number;
    z: number;
    gain?: number;
    rate?: number;
    priority?: boolean;
  }[] = [];
  const loops = new Map<string, string>();
  const preloaded: string[] = [];
  const sink: FinalAudioSink = {
    playAt: (key, x, y, z, o) => {
      plays.push({ key, x, y, z, gain: o?.gain, rate: o?.rate, priority: o?.priority });
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
  return { sink, plays, loops, preloaded };
}

type AuraStub = { id: string; value?: number; value2?: number };

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

const withAuras = (e: Entity, auras: AuraStub[]) => {
  (e as unknown as { auras: AuraStub[] }).auras = auras;
  return e;
};

const none = () => undefined;

describe('smith_heart_final_audio: the plan', () => {
  it('ships every sample it plays, sounds every cue, and claims exactly its own', () => {
    for (const key of FINAL_SFX_KEYS)
      expect(Object.hasOwn(SFX_CLIPS, key), `${key} in the manifest`).toBe(true);
    const cues = [...Object.values(FINAL_CUES), ...Object.values(FINAL_PHASE_CUES)];
    for (const cue of cues) {
      expect(finalSoundClaims(cue), cue).toBe(true);
      expect(FINAL_CUE_SOUNDS[cue].length, cue).toBeGreaterThan(0);
    }
    expect(Object.keys(FINAL_CUE_SOUNDS).sort()).toEqual([...cues].sort());
    expect(finalSoundClaims('flamestrike')).toBe(false);
    expect(finalSoundClaims(undefined)).toBe(false);
  });

  it('the HUD never plays its generic sound over a final cue', () => {
    for (const cue of [FINAL_CUES.root, FINAL_CUES.bolt, FINAL_PHASE_CUES.shear])
      for (const fx of ['nova', 'beam'] as const)
        expect(
          spellFxCue({
            type: 'spellfx',
            sourceId: 1,
            targetId: 2,
            school: 'arcane',
            fx,
            ability: cue,
          } as Extract<SimEvent, { type: 'spellfx' }>),
          cue,
        ).toBeNull();
  });

  it('keeps every warning a warning: the bars and footprints never borrow an impact', () => {
    for (const s of Object.values(FINAL_BAR_SOUNDS)) expect(s.key).toMatch(/charge|warn|gather/);
    expect(FINAL_FOOTPRINT_SOUNDS.tremor?.key).toBe('heart_final_tremor_warn');
    // The quarter change and the Overload's own impacts are the final's takes.
    expect(FINAL_CUE_SOUNDS[FINAL_CUES.root][0].key).toBe('heart_final_quarter_shift');
    expect(FINAL_CUE_SOUNDS[FINAL_CUES.burst][0].key).toBe('heart_final_overload_burst');
  });

  it('grows the Overload pulse with its bar, and hears the floor rise back once', () => {
    const empty = overloadPulseSound(0);
    const full = overloadPulseSound(1);
    expect(full.gain).toBeGreaterThan(empty.gain);
    expect(full.rate).toBeLessThan(empty.rate);
    expect(overloadPulseSound(5)).toEqual(full);
    expect(rebuildDue(0b0011, 0)).toBe(true);
    expect(rebuildDue(0, 0)).toBe(false);
    expect(rebuildDue(0b0001, 0b0011)).toBe(false);
  });
});

describe('smith_heart_final_audio: the adapter', () => {
  it("plays a cue's layers where they belong, a beam's mark and a burst's blast apart", () => {
    const { sink, plays, preloaded } = fakeSink();
    const audio = new FinalAudio(sink);
    const ents = new Map([
      [1, body(1, 10, 20)],
      [2, body(2, -5, 7)],
    ]);
    const of = (id: number) => ents.get(id);
    const ground = () => 3;
    const beam = {
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'fire',
      fx: 'beam',
      ability: FINAL_PHASE_CUES.coal,
    } as SimEvent;
    expect(audio.event(beam, of, ground)).toBe(true);
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ key: 'heart_heat_kindling', x: -5, z: 7 });
    const burst = {
      type: 'spellfxAt',
      x: 4,
      z: 6,
      school: 'fire',
      fx: 'burst',
      ability: FINAL_PHASE_CUES.coal,
    } as unknown as SimEvent;
    expect(audio.event(burst, of, ground)).toBe(true);
    expect(plays[1]).toMatchObject({ key: 'heart_heat_seed_burst', x: 4, y: 4, z: 6 });
    for (const p of plays) expect(p.priority).toBe(true);
    expect(audio.event({ ...beam, ability: 'fireball' } as SimEvent, of, ground)).toBe(false);
    expect([...preloaded].sort()).toEqual([...FINAL_SFX_KEYS].sort());
  });

  it("sounds the pulse louder at a fuller bar, and a mix turn's element sting", () => {
    const { sink, plays } = fakeSink();
    const audio = new FinalAudio(sink);
    const boss = withAuras(body(1, 0, 0), [{ id: overloadAuraId('heat'), value: 100 }]);
    const pulse = {
      type: 'spellfx',
      sourceId: 1,
      targetId: 1,
      school: 'arcane',
      fx: 'nova',
      ability: FINAL_CUES.pulse,
    } as SimEvent;
    audio.event(
      pulse,
      () => boss,
      () => 0,
    );
    expect(plays[0].gain).toBe(overloadPulseSound(1).gain);
    const turn = {
      type: 'spellfxAt',
      x: 0,
      z: 0,
      school: 'frost',
      fx: 'burst',
      ability: FINAL_PHASE_CUES.mixTurn,
    } as unknown as SimEvent;
    audio.event(turn, none, () => 0);
    expect(plays.slice(1).map((p) => p.key)).toEqual([
      'heart_final_mix_turn',
      MIX_TURN_STING.frost.key,
    ]);
  });

  it('warns once per bar on the boss and on a Splinter, never a bar already running', () => {
    const { sink, plays } = fakeSink();
    const audio = new FinalAudio(sink);
    const boss = body(1, 0, 0);
    const splinter = body(5, 3, 3);
    const of = (id: number) => (id === 5 ? splinter : undefined);
    // First heard mid-bar: never replayed late.
    boss.castingAbility = FINAL_CASTS.anvil;
    boss.castTotal = 6;
    audio.update(boss, [5], of, null, null, null);
    expect(plays).toHaveLength(0);
    boss.castingAbility = null;
    audio.update(boss, [5], of, null, null, null);
    boss.castingAbility = FINAL_CASTS.bolt;
    boss.castTotal = 2;
    splinter.castingAbility = FINAL_PHASE_CASTS.shear;
    splinter.castTotal = 2;
    audio.update(boss, [5], of, null, null, null);
    audio.update(boss, [5], of, null, null, null);
    expect(plays.map((p) => p.key).sort()).toEqual(
      [
        FINAL_BAR_SOUNDS[FINAL_CASTS.bolt].key,
        FINAL_BAR_SOUNDS[FINAL_PHASE_CASTS.shear].key,
      ].sort(),
    );
    expect(plays.find((p) => p.key === 'heart_final_shear_warn')).toMatchObject({ x: 3, z: 3 });
  });

  it('warns as the fullest Overload bar passes three quarters, rearmed only once it drains', () => {
    const { sink, plays } = fakeSink();
    const audio = new FinalAudio(sink);
    const at = (v: number) =>
      withAuras(body(1, 0, 0), [{ id: overloadAuraId('quench'), value: v }]);
    for (const v of [10, 50, 74, 76, 90, 70, 80, 40, 80])
      audio.update(at(v), [], none, null, null, null);
    expect(plays.filter((p) => p.key === FINAL_OVERLOAD_RISING.key)).toHaveLength(2);
  });

  it("hears Mythic's floor rise back once the fallen quarters are gone", () => {
    const { sink, plays } = fakeSink();
    const audio = new FinalAudio(sink);
    const centre = { x: 7, y: 1, z: 9 };
    const collapse = (fallen: number) =>
      withAuras(body(1, 0, 0), [
        { id: FINAL_PHASE_AURAS.phase, value: FINAL_STAGE_CODES.collapse },
        { id: FINAL_PHASE_AURAS.hidden, value: fallen },
      ]);
    audio.update(collapse(0), [], none, null, null, centre);
    audio.update(collapse(1), [], none, null, null, centre);
    audio.update(collapse(3), [], none, null, null, centre);
    expect(plays).toHaveLength(0);
    audio.update(body(1, 0, 0), [], none, null, null, centre);
    audio.update(body(1, 0, 0), [], none, null, null, centre);
    expect(plays.filter((p) => p.key === FINAL_REBUILD_SOUND.key)).toHaveLength(1);
    expect(plays[0]).toMatchObject({ x: 7, z: 9 });
  });

  it('greets a footprint with its warning, loops the gale while it blows', () => {
    const { sink, plays, loops } = fakeSink();
    const audio = new FinalAudio(sink);
    audio.footprint('tremor', 1, 0, 2);
    audio.footprint('emberPool', 1, 0, 2);
    expect(plays.map((p) => p.key)).toEqual(['heart_final_tremor_warn']);
    audio.update(null, [], none, { x: 0, y: 0, z: 0 }, null, null);
    expect(loops.size).toBe(1);
    audio.update(null, [], none, null, null, null);
    expect(loops.size).toBe(0);
  });

  it('rings my marks and my cold in my ear', () => {
    const { sink, plays } = fakeSink();
    const audio = new FinalAudio(sink);
    const me = (auras: AuraStub[]) => withAuras(body(9, 2, 3), auras);
    audio.update(null, [], none, null, me([]), null);
    audio.update(null, [], none, null, me([{ id: FINAL_AURAS.ember }]), null);
    audio.update(null, [], none, null, me([{ id: FINAL_AURAS.cold, value: 60 }]), null);
    audio.update(null, [], none, null, me([{ id: FINAL_AURAS.cold, value: 90 }]), null);
    expect(plays.map((p) => p.key)).toEqual([
      'heart_mark_fire',
      'heart_quench_cold_warn',
      'heart_quench_cold_danger',
    ]);
  });
});
