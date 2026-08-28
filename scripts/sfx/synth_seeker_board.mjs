// Author the Solana Seeker mount's engine takes by synthesis.
//
// Mount engine sounds in this repo are `custom: true` in sfx_prompts.mjs, which
// means they are hand-authored sources the paid generation path never touches.
// This one is synthesised rather than recorded: an ion drive has no real-world
// donor, and a deterministic script re-renders it identically whenever the mix
// needs a nudge.
//
// The set follows the windup/loop/winddown shape the Terrorspark Groundshaker
// already uses (see mountEngine in src/game/sfx.ts): a start take, a sustain
// take driven through Sfx.loop(), and a stop take.
//
//   node scripts/sfx/synth_seeker_board.mjs [--out <dir>]
//
// Writes 32-bit float WAV at 44.1k mono. Encoding, loudness and bitrate are the
// conform path's job (scripts/sfx/conform_audio.mjs), not this script's.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RATE = 44100;

// --- tiny synth toolkit ------------------------------------------------------

/** Deterministic noise. Math.random would make every re-render a new file. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const secondsToFrames = (s) => Math.round(s * RATE);

/** One-pole low pass. `cut` in Hz. */
function lowPass(buf, cut) {
  const dt = 1 / RATE;
  const rc = 1 / (2 * Math.PI * cut);
  const a = dt / (rc + dt);
  const out = new Float32Array(buf.length);
  let last = 0;
  for (let i = 0; i < buf.length; i++) {
    last += a * (buf[i] - last);
    out[i] = last;
  }
  return out;
}

/** One-pole high pass. */
function highPass(buf, cut) {
  const dt = 1 / RATE;
  const rc = 1 / (2 * Math.PI * cut);
  const a = rc / (rc + dt);
  const out = new Float32Array(buf.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    prevOut = a * (prevOut + buf[i] - prevIn);
    prevIn = buf[i];
    out[i] = prevOut;
  }
  return out;
}

const bandPass = (buf, lo, hi) => highPass(lowPass(buf, hi), lo);

function noise(frames, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = rnd() * 2 - 1;
  return out;
}

function mix(target, source, gain = 1) {
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i++) target[i] += source[i] * gain;
  return target;
}

/** Crossfade a buffer's own tail over its head, so it loops without a seam. */
function seamless(buf, fadeSeconds) {
  const f = Math.min(secondsToFrames(fadeSeconds), Math.floor(buf.length / 2));
  const out = buf.slice(0, buf.length - f);
  for (let i = 0; i < f; i++) {
    const w = i / f; // 0 at the head, 1 where the tail ends
    out[i] = out[i] * w + buf[buf.length - f + i] * (1 - w);
  }
  return out;
}

/** Equal-power-ish fade used on the one-shot takes. */
function envelope(frames, points) {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    let v = points[0][1];
    for (let p = 1; p < points.length; p++) {
      const [t0, v0] = points[p - 1];
      const [t1, v1] = points[p];
      if (t >= t0 && t <= t1) {
        const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        v = v0 + (v1 - v0) * k * k * (3 - 2 * k); // smoothstep
        break;
      }
      if (t > t1) v = v1;
    }
    out[i] = v;
  }
  return out;
}

/** Sine sweep with an arbitrary per-frame frequency function. */
function sweep(frames, freqAt, phase0 = 0) {
  const out = new Float32Array(frames);
  let phase = phase0;
  for (let i = 0; i < frames; i++) {
    phase += (2 * Math.PI * freqAt(i / frames)) / RATE;
    out[i] = Math.sin(phase);
  }
  return out;
}

// --- the drive ---------------------------------------------------------------

// The sustain take's length. Every partial below is an integer multiple of
// 1/LOOP_SECONDS, so each one completes a whole number of cycles and the loop
// point lands on identical phase. That is what makes the seam inaudible; a
// crossfade alone leaves a beating artefact on sustained tones.
const LOOP_SECONDS = 2.4;
const BASE = 55; // Hz, the drive's fundamental

/** Snap a frequency to the nearest exact loop harmonic. */
const harmonic = (hz, loopSeconds) => Math.round(hz * loopSeconds) / loopSeconds;

function driveTone(frames, freqScale, loopSeconds) {
  const out = new Float32Array(frames);
  // Fundamental plus a deliberate near-unison. Their difference is exactly one
  // cycle per loop, so the slow throb is itself seamless.
  const partials = [
    [BASE, 0.5],
    [BASE + 1 / loopSeconds, 0.34],
    [BASE * 2, 0.2],
    [BASE * 3, 0.11],
    [BASE * 4.5, 0.055],
    // Upper metallic ring: an ion drive is not a warm engine, it is charged air.
    [BASE * 12, 0.03],
    [BASE * 16, 0.022],
    [BASE * 24, 0.012],
  ];
  for (const [hz, gain] of partials) {
    const f = harmonic(hz, loopSeconds) * freqScale;
    for (let i = 0; i < frames; i++) {
      out[i] += Math.sin((2 * Math.PI * f * i) / RATE) * gain;
    }
  }
  return out;
}

/** The thruster's plasma hiss: filtered noise, breathing slowly. */
function ionHiss(frames, seed, loopSeconds, lo = 1400, hi = 6200) {
  const bed = bandPass(noise(frames, seed), lo, hi);
  // Two breath rates, both whole cycles per loop so they meet themselves.
  const r1 = 2 / loopSeconds;
  const r2 = 3 / loopSeconds;
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    const m =
      0.62 + 0.26 * Math.sin(2 * Math.PI * r1 * t) + 0.12 * Math.sin(2 * Math.PI * r2 * t + 1.1);
    bed[i] *= m;
  }
  return bed;
}

/** Quiet telemetry blips: the craft talking to itself. Four per loop. */
function telemetry(frames, loopSeconds, seed) {
  const out = new Float32Array(frames);
  const rnd = mulberry32(seed);
  const count = 4;
  const steps = [1, 1.5, 1.3333, 2]; // a small consonant set, not a melody
  for (let k = 0; k < count; k++) {
    const at = secondsToFrames((k / count) * loopSeconds);
    const dur = secondsToFrames(0.055);
    const f = harmonic(1760 * steps[k % steps.length], loopSeconds);
    for (let i = 0; i < dur; i++) {
      const idx = (at + i) % frames; // wrap, so a blip near the end still loops
      const t = i / dur;
      const env = Math.exp(-7 * t) * (1 - Math.exp(-90 * t));
      out[idx] += Math.sin((2 * Math.PI * f * (at + i)) / RATE) * env * (0.05 + rnd() * 0.02);
    }
  }
  return out;
}

/** The sustain take. */
export function renderLoop() {
  // Render long, then fold the tail back over the head for the noise layers.
  const fade = 0.12;
  const frames = secondsToFrames(LOOP_SECONDS + fade);
  const buf = new Float32Array(frames);
  mix(buf, driveTone(frames, 1, LOOP_SECONDS), 0.5);
  mix(buf, ionHiss(frames, 0x5ee4e2, LOOP_SECONDS), 0.16);
  mix(buf, telemetry(frames, LOOP_SECONDS, 0xc0ffee), 1);
  // Air moving over the hull: a low bed under everything.
  mix(buf, lowPass(noise(frames, 0x11a5e2), 220), 0.1);
  return seamless(buf, fade);
}

/** The windup: charge, spin up, engage. */
export function renderStart() {
  const seconds = 1.0;
  const frames = secondsToFrames(seconds);
  const buf = new Float32Array(frames);

  // Capacitor charge: a rising whine well above the drive, thinning as it goes.
  const chargeEnv = envelope(frames, [
    [0, 0],
    [0.1, 0.5],
    [0.66, 0.62],
    [0.78, 0],
    [1, 0],
  ]);
  const charge = sweep(frames, (t) => 320 + 2400 * t * t);
  for (let i = 0; i < frames; i++) buf[i] += charge[i] * chargeEnv[i] * 0.12;

  // The drive itself sliding up to pitch, landing exactly on the loop's timbre
  // so the splice into the sustain take is inaudible.
  const spinEnv = envelope(frames, [
    [0, 0],
    [0.3, 0.25],
    [0.8, 0.95],
    [1, 1],
  ]);
  const spin = new Float32Array(frames);
  const scaleAt = (t) => 0.34 + 0.66 * Math.min(1, t / 0.82) ** 0.7;
  for (const [hz, gain] of [
    [BASE, 0.5],
    [BASE * 2, 0.2],
    [BASE * 3, 0.11],
    [BASE * 12, 0.03],
  ]) {
    let phase = 0;
    for (let i = 0; i < frames; i++) {
      phase += (2 * Math.PI * harmonic(hz, LOOP_SECONDS) * scaleAt(i / frames)) / RATE;
      spin[i] += Math.sin(phase) * gain;
    }
  }
  for (let i = 0; i < frames; i++) buf[i] += spin[i] * spinEnv[i] * 0.5;

  // Plasma catching: hiss swells in behind the whine.
  const hiss = ionHiss(frames, 0x9a11e5, seconds, 900, 7000);
  const hissEnv = envelope(frames, [
    [0, 0],
    [0.55, 0.2],
    [0.85, 0.9],
    [1, 0.8],
  ]);
  for (let i = 0; i < frames; i++) buf[i] += hiss[i] * hissEnv[i] * 0.17;

  // Engage: a soft sub thump at the moment the drive takes the weight.
  const at = Math.floor(frames * 0.8);
  const thumpLen = secondsToFrames(0.16);
  for (let i = 0; i < thumpLen && at + i < frames; i++) {
    const t = i / thumpLen;
    const env = Math.exp(-9 * t) * (1 - Math.exp(-120 * t));
    buf[at + i] += Math.sin((2 * Math.PI * 48 * i) / RATE) * env * 0.42;
  }
  return buf;
}

/** The winddown: cut power, bleed the field, settle. */
export function renderStop() {
  const seconds = 0.95;
  const frames = secondsToFrames(seconds);
  const buf = new Float32Array(frames);

  const fallEnv = envelope(frames, [
    [0, 1],
    [0.35, 0.6],
    [0.75, 0.12],
    [1, 0],
  ]);
  const fall = new Float32Array(frames);
  const scaleAt = (t) => 1 - 0.72 * t ** 1.4;
  for (const [hz, gain] of [
    [BASE, 0.5],
    [BASE * 2, 0.2],
    [BASE * 3, 0.11],
    [BASE * 12, 0.03],
  ]) {
    let phase = 0;
    for (let i = 0; i < frames; i++) {
      phase += (2 * Math.PI * harmonic(hz, LOOP_SECONDS) * scaleAt(i / frames)) / RATE;
      fall[i] += Math.sin(phase) * gain;
    }
  }
  for (let i = 0; i < frames; i++) buf[i] += fall[i] * fallEnv[i] * 0.5;

  // Field bleeding off: the hiss outlives the tone and thins as it goes.
  const hiss = bandPass(noise(frames, 0x5ee4e3), 700, 5200);
  const hissEnv = envelope(frames, [
    [0, 0.55],
    [0.3, 0.42],
    [1, 0],
  ]);
  for (let i = 0; i < frames; i++) buf[i] += hiss[i] * hissEnv[i] * 0.2;

  // A last descending chirp: the drive letting go.
  const chirp = sweep(frames, (t) => 1500 * (1 - t) ** 2 + 180);
  const chirpEnv = envelope(frames, [
    [0, 0],
    [0.08, 0.5],
    [0.6, 0.08],
    [1, 0],
  ]);
  for (let i = 0; i < frames; i++) buf[i] += chirp[i] * chirpEnv[i] * 0.09;
  return buf;
}

// --- WAV out -----------------------------------------------------------------

/** Peak-normalise with headroom. Absolute level is the conform path's call. */
function normalise(buf, peak = 0.89) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

export function wav32(buf) {
  const data = Buffer.alloc(buf.length * 4);
  for (let i = 0; i < buf.length; i++) data.writeFloatLE(buf[i], i * 4);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20); // IEEE float
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export const TAKES = {
  mount_run_seeker_board_start: renderStart,
  mount_run_seeker_board: renderLoop,
  mount_run_seeker_board_stop: renderStop,
};

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const outIndex = process.argv.indexOf('--out');
  const dir = outIndex > -1 ? process.argv[outIndex + 1] : 'tmp/seeker_sfx';
  mkdirSync(dir, { recursive: true });
  for (const [key, render] of Object.entries(TAKES)) {
    const buf = normalise(render());
    const file = path.join(dir, `${key}.wav`);
    writeFileSync(file, wav32(buf));
    console.log(`${key.padEnd(34)}${(buf.length / RATE).toFixed(2)}s  -> ${file}`);
  }
}
