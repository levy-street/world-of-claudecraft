// The deepball sound bank (src/game/deepglass_audio.ts).
//
// Synthesis has one failure mode that no type checker and no eyeball catches: a
// filter sweep that goes unstable renders a buffer of NaN, which plays as
// SILENCE with no error anywhere, the cue simply never sounds and nothing in
// the log says so. Every assertion here exists to catch that class of bug at the
// buffer, where it is cheap, rather than in a bout where it is invisible.

import { describe, expect, it } from 'vitest';
import {
  BOUNCE_MAX_DEMAND,
  bounceMixFor,
  DEEPGLASS_LOOP_SFX_KEYS,
  DEEPGLASS_SFX_KEYS,
  type DeepglassCue,
  type DeepglassLoop,
  deepglassLoopSamples,
  deepglassSamples,
} from '../src/game/deepglass_audio';

const CUES = Object.values(DEEPGLASS_SFX_KEYS) as DeepglassCue[];
const LOOPS = Object.values(DEEPGLASS_LOOP_SFX_KEYS) as DeepglassLoop[];
const RATES = [44100, 48000];

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

describe('the deepball sound bank', () => {
  it('stages one cue per SFX key, and every key is a deepball key', () => {
    expect(CUES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CUES).size).toBe(CUES.length); // no cue staged twice
    for (const key of Object.keys(DEEPGLASS_SFX_KEYS)) expect(key.startsWith('dg_')).toBe(true);
  });

  it('renders a finite, audible, in-range buffer for every cue at every rate', () => {
    for (const rate of RATES) {
      for (const cue of CUES) {
        const buf = deepglassSamples(cue, rate);
        expect(buf.length).toBeGreaterThan(rate * 0.2); // no cue is a click
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          // The NaN sweep. `expect` per sample would be 100k assertions a cue,
          // so the loop checks and only reports on the first offender.
          if (!Number.isFinite(buf[i])) {
            throw new Error(`${cue} @${rate}: sample ${i} is ${buf[i]}`);
          }
          peak = Math.max(peak, Math.abs(buf[i]));
        }
        expect(peak).toBeLessThanOrEqual(1); // never clips the master
        expect(peak).toBeGreaterThan(0.5); // ...and is actually loud
        expect(rms(buf)).toBeGreaterThan(0.01); // not one spike over silence
      }
    }
  });

  it('starts and ends at silence, so a cue neither clicks nor cuts off', () => {
    for (const cue of CUES) {
      const buf = deepglassSamples(cue, 48000);
      expect(Math.abs(buf[0])).toBeLessThan(0.2);
      expect(Math.abs(buf[buf.length - 1])).toBeLessThan(1e-3);
    }
  });

  it('is deterministic: the same cue renders identically every time', () => {
    for (const cue of CUES) {
      const a = deepglassSamples(cue, 48000);
      const b = deepglassSamples(cue, 48000);
      expect(a.length).toBe(b.length);
      // Sampled rather than compared whole: a mismatch anywhere fails the same
      // way and this keeps the assertion count sane.
      for (let i = 0; i < a.length; i += 997) expect(a[i]).toBe(b[i]);
    }
  });

  it('gives each cue its own identity rather than one sound at ten lengths', () => {
    // Correlated cues read as one doubled sound when two fire together, which
    // is exactly what a shared seed would produce.
    const heads = CUES.map((cue) => deepglassSamples(cue, 48000).slice(0, 2000));
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let k = 0; k < heads[i].length; k++) {
          dot += heads[i][k] * heads[j][k];
          na += heads[i][k] * heads[i][k];
          nb += heads[j][k] * heads[j][k];
        }
        const corr = Math.abs(dot) / Math.sqrt(Math.max(1e-9, na * nb));
        expect(corr).toBeLessThan(0.9);
      }
    }
  });

  it('keeps the underwater promise: the impacts are dark, the glass is not', () => {
    // A crude high-band energy ratio via first differences (a one-pole HP):
    // water eats the top end, so a strike must be much darker than the cue that
    // is explicitly ALLOWED some brightness (the glass).
    const bright = (cue: DeepglassCue): number => {
      const buf = deepglassSamples(cue, 48000);
      let hi = 0;
      let all = 0;
      for (let i = 1; i < buf.length; i++) {
        const d = buf[i] - buf[i - 1];
        hi += d * d;
        all += buf[i] * buf[i];
      }
      return hi / Math.max(1e-9, all);
    };
    expect(bright('strike')).toBeLessThan(bright('wall'));
    expect(bright('bump')).toBeLessThan(bright('wall'));
    // The bounce is a basketball under water, not on a court: the layer with
    // the most shell in it still has to sit under the glass.
    expect(bright('bounce')).toBeLessThan(bright('wall'));
    expect(bright('bounce_hard')).toBeLessThan(bright('wall'));
  });

  it('makes the bounce layers three different sounds, not one at three sizes', () => {
    // A harder hit deforms the ball further, and a bigger deformation is a
    // LOWER, heavier note. That weight, not level, which the mix supplies
    // separately, is the property that makes the layering read as force, so
    // it is the one worth pinning. Measured as the share of energy under a
    // one-pole at ~110 Hz.
    const weight = (cue: DeepglassCue): number => {
      const buf = deepglassSamples(cue, 48000);
      const k = 1 - Math.exp((-2 * Math.PI * 110) / 48000);
      let lp = 0;
      let low = 0;
      let all = 0;
      for (let i = 0; i < buf.length; i++) {
        lp += k * (buf[i] - lp);
        low += lp * lp;
        all += buf[i] * buf[i];
      }
      return low / Math.max(1e-9, all);
    };
    expect(weight('bounce_hard')).toBeGreaterThan(weight('bounce'));
    expect(weight('bounce')).toBeGreaterThan(weight('bounce_soft'));
    // ...and the heavy layer rings on well past the light one.
    expect(deepglassSamples('bounce_hard', 48000).length).toBeGreaterThan(
      deepglassSamples('bounce_soft', 48000).length * 1.5,
    );
  });
});

describe('the bounce mix', () => {
  it('walks from a lone pock to all three layers as the hit gets harder', () => {
    const nudge = bounceMixFor(0.5);
    expect(nudge.soft).toBeGreaterThan(0.4);
    expect(nudge.core).toBe(0);
    expect(nudge.heavy).toBe(0);

    const ordinary = bounceMixFor(10);
    expect(ordinary.soft).toBeLessThan(0.05); // the pock is gone by here
    expect(ordinary.core).toBeGreaterThan(0.25); // ...and the core has it

    const rocket = bounceMixFor(30);
    expect(rocket.core).toBeGreaterThan(0.5);
    expect(rocket.heavy).toBeGreaterThan(0.35);
    expect(rocket.core).toBeGreaterThan(ordinary.core * 1.5);
  });

  it('stays inside its headroom, because the layers stack on one transient', () => {
    // Core and heavy both fire on the same instant, the ball meeting the
    // body, so their peaks land on top of each other and their gains are one
    // budget, not three. The first version spent about 1.8 of it.
    for (let speed = 0; speed <= 60; speed += 0.25) {
      const mix = bounceMixFor(speed);
      expect(mix.soft + mix.core + mix.heavy).toBeLessThanOrEqual(BOUNCE_MAX_DEMAND);
    }
  });

  it('pitches down with force, and never asks for more gain than exists', () => {
    let lastRate = Number.POSITIVE_INFINITY;
    let lastHeavy = -1;
    for (let speed = 0; speed <= 40; speed += 0.5) {
      const mix = bounceMixFor(speed);
      expect(mix.rate).toBeLessThanOrEqual(lastRate); // monotone: never wobbles
      expect(mix.heavy).toBeGreaterThanOrEqual(lastHeavy);
      lastRate = mix.rate;
      lastHeavy = mix.heavy;
      for (const layer of [mix.soft, mix.core, mix.heavy]) {
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(1);
      }
      expect(mix.rate).toBeGreaterThan(0.5);
    }
    // The extremes stay far apart, or the whole layering buys nothing.
    expect(bounceMixFor(0).rate - bounceMixFor(40).rate).toBeGreaterThan(0.25);
  });
});

describe('the sustained beds', () => {
  it('renders a finite, audible bed for every loop at every rate', () => {
    for (const rate of RATES) {
      for (const loop of LOOPS) {
        const buf = deepglassLoopSamples(loop, rate);
        expect(buf.length).toBeGreaterThan(rate); // a bed is at least a second
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          if (!Number.isFinite(buf[i]))
            throw new Error(`${loop} @${rate}: sample ${i} is ${buf[i]}`);
          peak = Math.max(peak, Math.abs(buf[i]));
        }
        expect(peak).toBeLessThanOrEqual(1);
        expect(peak).toBeGreaterThan(0.4);
        expect(rms(buf)).toBeGreaterThan(0.01);
      }
    }
  });

  it('wraps without a click, and without the hole a cue fade would leave', () => {
    for (const loop of LOOPS) {
      const buf = deepglassLoopSamples(loop, 48000);
      // A cue fades to silence at both ends; a bed that did would tick a hole
      // in itself once per pass. Both ends must be LIVE signal.
      const level = rms(buf);
      expect(rms(buf.slice(0, 480))).toBeGreaterThan(level * 0.15);
      expect(rms(buf.slice(-480))).toBeGreaterThan(level * 0.15);
      // ...and the step across the wrap must be no worse than the steps the
      // buffer already takes internally, which is what a click actually is.
      let worst = 0;
      for (let i = 1; i < buf.length; i++) worst = Math.max(worst, Math.abs(buf[i] - buf[i - 1]));
      const seam = Math.abs(buf[0] - buf[buf.length - 1]);
      expect(seam).toBeLessThanOrEqual(worst);
    }
  });

  it('keeps the beds dark: they are pressure, not hiss', () => {
    // Most of a bed's energy has to sit under ~200 Hz. Deep water is a WEIGHT,
    // and the first version of the ambient bed failed this, it carried a
    // "whisper of air" layer that read instantly as a room recorded in air,
    // which is the single tell that undoes the whole illusion.
    const subShare = (buf: Float32Array): number => {
      const k = 1 - Math.exp((-2 * Math.PI * 200) / 48000);
      let lp = 0;
      let low = 0;
      let all = 0;
      for (let i = 0; i < buf.length; i++) {
        lp += k * (buf[i] - lp);
        low += lp * lp;
        all += buf[i] * buf[i];
      }
      return low / Math.max(1e-9, all);
    };
    for (const loop of LOOPS) {
      expect(subShare(deepglassLoopSamples(loop, 48000))).toBeGreaterThan(0.6);
    }
  });

  it('is deterministic, so the bed is the same room every session', () => {
    for (const loop of LOOPS) {
      const a = deepglassLoopSamples(loop, 48000);
      const b = deepglassLoopSamples(loop, 48000);
      for (let i = 0; i < a.length; i += 997) expect(a[i]).toBe(b[i]);
    }
  });
});
