// The Weirdo Cream truck's procedural audio: scripts/sfx/weirdo_cream_audio.mjs.
//
// These cues are synthesized rather than recorded, so the properties that make
// them usable are properties of the maths and can be asserted directly: the
// engine chug has to decay inside its own length or consecutive firings smear
// at full throttle, and the chime has to be exactly the five seconds the brief
// asked for and end quiet enough not to clip off mid-ring.

import { describe, expect, it } from 'vitest';
import {
  CHIME_DURATION,
  CHIME_NOTES,
  ENGINE_DURATION,
  encodeWav,
  renderChime,
  renderEngineChug,
  SAMPLE_RATE,
} from '../scripts/sfx/weirdo_cream_audio.mjs';

/** Root-mean-square of a slice, the honest loudness measure for these checks. */
function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let index = from; index < to; index++) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function peak(samples: Float32Array): number {
  let highest = 0;
  for (const value of samples) highest = Math.max(highest, Math.abs(value));
  return highest;
}

describe('engine chug', () => {
  const chug = renderEngineChug();

  it('is exactly the declared length', () => {
    expect(chug.length).toBe(Math.round(ENGINE_DURATION * SAMPLE_RATE));
  });

  it('is audible without clipping', () => {
    expect(peak(chug)).toBeGreaterThan(0.2);
    expect(peak(chug)).toBeLessThanOrEqual(1);
  });

  it('starts on a transient: the strike is at the front', () => {
    const quarter = Math.floor(chug.length / 4);
    expect(rms(chug, 0, quarter)).toBeGreaterThan(rms(chug, quarter * 3) * 4);
  });

  it('decays close to silence by its end, so firings do not smear', () => {
    // At full throttle the renderer asks for one of these about every 74ms
    // (13.5 Hz). A tail still ringing at the end would stack into a drone.
    const tail = rms(chug, chug.length - Math.round(0.02 * SAMPLE_RATE));
    expect(tail).toBeLessThan(rms(chug, 0, Math.round(0.02 * SAMPLE_RATE)) * 0.1);
  });

  it('is deterministic: the same source renders the same samples', () => {
    expect(Array.from(renderEngineChug())).toEqual(Array.from(chug));
  });
});

describe('chime', () => {
  const chime = renderChime();

  it('is exactly five seconds, as briefed', () => {
    expect(CHIME_DURATION).toBe(5);
    expect(chime.length).toBe(Math.round(5 * SAMPLE_RATE));
  });

  it('is audible without clipping', () => {
    expect(peak(chime)).toBeGreaterThan(0.3);
    expect(peak(chime)).toBeLessThanOrEqual(1);
  });

  it('plays a phrase that fills the whole clip', () => {
    // Every second carries sound: a tune that stopped early would leave a dead
    // stretch the player hears as the cue cutting out.
    for (let second = 0; second < 5; second++) {
      const from = second * SAMPLE_RATE;
      expect(rms(chime, from, from + SAMPLE_RATE), `second ${second}`).toBeGreaterThan(0.01);
    }
  });

  it('ends faded, not chopped mid-ring', () => {
    const lastMs = Math.round(0.005 * SAMPLE_RATE);
    expect(rms(chime, chime.length - lastMs)).toBeLessThan(0.02);
  });

  it('holds the last note and bends it FLAT, which is the joke', () => {
    const last = CHIME_NOTES[CHIME_NOTES.length - 1];
    const [start, duration, , bend] = last;
    expect(start + duration).toBeCloseTo(CHIME_DURATION, 6);
    expect(duration).toBeGreaterThanOrEqual(1);
    // Negative semitones: it sags. A positive bend would read as a flourish
    // rather than as a truck whose tape has stretched.
    expect(bend).toBeLessThan(-0.5);
  });

  it('bends only that final note', () => {
    for (const [, , , bend] of CHIME_NOTES.slice(0, -1)) expect(bend).toBe(0);
  });

  it('lays its notes out in order without overlapping starts', () => {
    let previous = -1;
    for (const [start] of CHIME_NOTES) {
      expect(start).toBeGreaterThan(previous);
      previous = start;
    }
  });

  it('is deterministic: the same source renders the same samples', () => {
    expect(Array.from(renderChime())).toEqual(Array.from(chime));
  });
});

describe('wav encoding', () => {
  it('writes a well-formed 16-bit mono RIFF header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
  });

  it('clamps rather than wrapping at the rails', () => {
    const wav = encodeWav(new Float32Array([2, -2]));
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32767);
  });
});
