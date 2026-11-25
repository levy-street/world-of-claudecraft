// The Quench's ice giving way reads MUCH more strongly (the team's playtest
// of 2026-11-25: "make it MUCH MORE VISIBLE when a piece of ice is about to
// break and when it breaks", "make water pools a lighter blue"): the crack's
// last stretch strobes faster to the break, the rime's crack snaps again and
// again rising in pitch, the break bursts on every preset, and the water is
// a clear glacier blue, no longer near black.

import { describe, expect, it } from 'vitest';
import { QuenchAudio, type QuenchAudioSink } from '../src/game/smith_heart_quench_audio';
import { crackStrainStage, QUENCH_CRACK_STRAIN } from '../src/game/smith_heart_quench_audio_core';
import { CRACK_FLASH_FROM, crackLook } from '../src/render/smith_heart_fx/quench_fight_fx_core';
import { HOLE_BREAK_FLOOR } from '../src/render/smith_heart_fx/quench_hole_core';
import { HOLE_FRAG } from '../src/render/smith_heart_fx/quench_hole_glsl';

function sink() {
  const plays: { key: string; rate?: number; gain?: number }[] = [];
  const s: QuenchAudioSink = {
    playAt: (key, _x, _y, _z, opts) => {
      plays.push({ key, rate: opts?.rate, gain: opts?.gain });
      return true;
    },
  };
  return { s, plays };
}

describe('the ice about to break', () => {
  it('strobes over its last stretch, never before', () => {
    const warn = 2.5;
    for (let e = 0; e < warn * CRACK_FLASH_FROM - 0.01; e += 0.1)
      expect(crackLook(e, warn).flash).toBe(0);
    let lit = 0;
    let dark = 0;
    for (let e = warn * CRACK_FLASH_FROM + 0.01; e < warn; e += 0.01) {
      const f = crackLook(e, warn).flash;
      if (f > 0.8) lit++;
      if (f < 0.2) dark++;
    }
    expect(lit).toBeGreaterThan(5);
    expect(dark).toBeGreaterThan(5);
    // Brighter at the end than at the start.
    expect(crackLook(warn * 0.98, warn).light).toBeGreaterThan(crackLook(0, warn).light);
  });

  it('snaps again at each stage, each higher and louder, once each', () => {
    expect(crackStrainStage(0, 2.5)).toBe(0);
    expect(crackStrainStage(2.5, 2.5)).toBe(QUENCH_CRACK_STRAIN.at.length);
    for (let k = 1; k < QUENCH_CRACK_STRAIN.rate.length; k++) {
      expect(QUENCH_CRACK_STRAIN.rate[k]).toBeGreaterThan(QUENCH_CRACK_STRAIN.rate[k - 1]);
      expect(QUENCH_CRACK_STRAIN.gain[k]).toBeGreaterThan(QUENCH_CRACK_STRAIN.gain[k - 1]);
    }
    const { s, plays } = sink();
    const audio = new QuenchAudio(s);
    for (let e = 0; e <= 2.5; e += 0.05) audio.crackStrain(0, 41, 0, 0, 0, e, 2.5);
    const snaps = plays.filter((p) => p.key === QUENCH_CRACK_STRAIN.key);
    expect(snaps.map((p) => p.rate)).toEqual([...QUENCH_CRACK_STRAIN.rate]);
    // A crack first seen half way sounds only the snaps still to come.
    const late = sink();
    const a2 = new QuenchAudio(late.s);
    for (let e = 1.5; e <= 2.5; e += 0.05) a2.crackStrain(1, 42, 0, 0, 0, e, 2.5);
    expect(late.plays.length).toBe(QUENCH_CRACK_STRAIN.at.filter((a) => a > 1.5 / 2.5).length);
  });
});

describe('the break and the water', () => {
  it('bursts on every preset, and the water is a clear blue', () => {
    expect(HOLE_BREAK_FLOOR).toBeGreaterThanOrEqual(8);
    const rgb = (name: string): number[] => {
      const m = HOLE_FRAG.match(new RegExp(`vec3 ${name} = vec3\\(([^)]*)\\)`));
      return (m?.[1] ?? '').split(',').map(Number);
    };
    const deep = rgb('deepBlue');
    const abyss = rgb('abyss');
    // Blue-dominant and well off black (it was 0.03 blue at its brightest).
    expect(deep[2]).toBeGreaterThanOrEqual(0.4);
    expect(deep[2]).toBeGreaterThan(deep[1] * 2);
    expect(abyss[2]).toBeGreaterThanOrEqual(0.1);
  });
});
