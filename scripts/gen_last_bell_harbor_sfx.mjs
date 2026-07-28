// Bake deterministic placeholder takes for the Last Bell harbor cues
// (lb_bell_toll, lb_harbor_ambience, lb_ship_castoff) with local DSP
// synthesis, gen_ui_sfx.mjs style: synthesize a mono WAV in JS, then push it
// through the same fixed conform path every published SFX uses. The catalog
// entries in scripts/sfx/sfx_prompts.mjs carry real ElevenLabs prompts, so a
// paid run (or a CC0 recording drop-in) replaces these takes without touching
// this script.
//
//   node scripts/gen_last_bell_harbor_sfx.mjs [--force] [--only lb_bell_toll]
//
// Everything is seeded: same run, same bytes, no wall clock.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'public/audio/sfx');
const RATE = 44100;
const TWO_PI = 2 * Math.PI;

// Deterministic PRNG (mulberry32): the takes are reproducible byte for byte.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One decaying, slowly-beating partial pair added into `out`. */
function addPartial(out, freq, amp, decaySec, beatHz, phase) {
  const beat = beatHz * TWO_PI;
  const w = freq * TWO_PI;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = amp * Math.exp(-t / decaySec);
    out[i] +=
      env * 0.5 * (Math.sin(w * t + phase) + Math.sin((w + beat / TWO_PI) * TWO_PI * t + phase));
  }
}

// A large bronze bell: inharmonic partial stack over a hum note, a short
// strike transient, exponential decays, a touch of beating per partial.
function bellToll(durationSec) {
  const n = Math.floor(durationSec * RATE);
  const out = new Float64Array(n);
  const f0 = 217; // the prime; the hum sits an octave below
  const partials = [
    [0.5, 0.55, 4.8, 0.35],
    [1.0, 0.8, 3.6, 0.5],
    [1.19, 0.5, 2.6, 0.7],
    [1.5, 0.36, 2.1, 0.6],
    [2.0, 0.42, 1.6, 0.8],
    [2.67, 0.22, 1.1, 1.0],
    [3.01, 0.16, 0.85, 1.2],
    [4.16, 0.1, 0.6, 1.5],
    [5.43, 0.06, 0.45, 1.8],
  ];
  const random = rng(1727);
  for (const [ratio, amp, decay, beat] of partials) {
    addPartial(out, f0 * ratio, amp, decay, beat, random() * TWO_PI);
  }
  // The clapper strike: an 8 ms noise burst through a crude one-pole lowpass.
  let lp = 0;
  const strikeLen = Math.floor(0.008 * RATE);
  for (let i = 0; i < strikeLen; i++) {
    lp += 0.35 * ((random() * 2 - 1) * 0.9 - lp);
    out[i] += lp * (1 - i / strikeLen);
  }
  // Soft-clip the sum so the partial stack rings without digital edges.
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 0.85);
  return out;
}

// The harbor bed: slow wave-wash noise swells, discrete laps against the
// pilings, a couple of quiet rope creaks, two distant gull cries.
function harborAmbience(durationSec) {
  const n = Math.floor(durationSec * RATE);
  const out = new Float64Array(n);
  const random = rng(40817);
  // Wave wash: lowpassed noise under two slow swell LFOs.
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    lp += 0.045 * (random() * 2 - 1 - lp);
    const swell =
      0.55 + 0.3 * Math.sin(TWO_PI * 0.13 * t + 1.1) + 0.15 * Math.sin(TWO_PI * 0.31 * t);
    out[i] += lp * swell * 0.9;
  }
  // Laps: short bandpassed bursts at uneven moments.
  const lapAt = [0.7, 1.9, 3.4, 4.6, 6.1, 7.7, 8.9];
  for (const at of lapAt) {
    const start = Math.floor(at * RATE);
    const len = Math.floor((0.06 + random() * 0.08) * RATE);
    let bp = 0;
    let bpLp = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const white = random() * 2 - 1;
      bpLp += 0.25 * (white - bpLp);
      bp += 0.18 * (bpLp - bp);
      out[start + i] += (bpLp - bp) * 2.2 * Math.exp(-i / (len * 0.4));
    }
  }
  // Rope creaks: two low grains with rough amplitude modulation.
  for (const [at, freq] of [
    [2.6, 92],
    [7.1, 78],
  ]) {
    const start = Math.floor(at * RATE);
    const len = Math.floor(0.5 * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      const env = Math.sin((Math.PI * i) / len) * 0.09;
      out[start + i] += env * Math.sin(TWO_PI * freq * t) * (0.6 + 0.4 * Math.sin(TWO_PI * 27 * t));
    }
  }
  // Distant gulls: two falling FM cries, quiet and high.
  for (const [at, f] of [
    [3.1, 1250],
    [8.2, 1180],
  ]) {
    const start = Math.floor(at * RATE);
    const len = Math.floor(0.45 * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / len;
      const freq = f * (1 - 0.3 * t) * (1 + 0.04 * Math.sin(TWO_PI * 21 * (i / RATE)));
      const env = Math.sin(Math.PI * t) ** 2 * 0.05;
      out[start + i] += env * Math.sin(TWO_PI * freq * (i / RATE));
    }
  }
  return out;
}

// Cast off: a long timber groan (falling low tone under rough AM), a series
// of stick-slip creaks, and a water push swelling along the hull.
function shipCastOff(durationSec) {
  const n = Math.floor(durationSec * RATE);
  const out = new Float64Array(n);
  const random = rng(60934);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const u = t / durationSec;
    // Timber groan: 58 Hz sliding to 40 Hz, roughened at 31 Hz.
    const freq = 58 - 18 * u;
    const groan = Math.sin(TWO_PI * freq * t) * (0.55 + 0.45 * Math.sin(TWO_PI * 31 * t)) * 0.5;
    const env = Math.sin(Math.PI * Math.min(1, u * 1.25)) * 0.8;
    out[i] += groan * env;
    // Water push: lowpassed noise swelling through the back half.
    out[i] += (random() * 2 - 1) * 0.12 * u * u;
  }
  // Stick-slip creaks stepping up the hull.
  for (const [at, f] of [
    [0.5, 210],
    [1.2, 260],
    [2.0, 240],
    [2.9, 300],
  ]) {
    const start = Math.floor(at * RATE);
    const len = Math.floor(0.16 * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      const env = Math.sin((Math.PI * i) / len) * 0.16;
      // A saw-ish creak: two detuned sines plus their second harmonic.
      out[start + i] +=
        env *
        (Math.sin(TWO_PI * f * t) + 0.5 * Math.sin(TWO_PI * (f * 2.02) * t)) *
        (0.7 + 0.3 * Math.sin(TWO_PI * 47 * t));
    }
  }
  let last = 0;
  for (let i = 0; i < n; i++) {
    // A gentle one-pole lowpass keeps the noise components watery, not hissy.
    last += 0.22 * (out[i] - last);
    out[i] = Math.tanh(last * 1.4);
  }
  return out;
}

const CUES = [
  { key: 'lb_bell_toll', duration: 6, synth: bellToll },
  { key: 'lb_harbor_ambience', duration: 10, synth: harborAmbience },
  { key: 'lb_ship_castoff', duration: 4, synth: shipCastOff },
];

function writeWav(file, samples) {
  const pcm = Buffer.alloc(44 + samples.length * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + samples.length * 2, 4);
  pcm.write('WAVE', 8);
  pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); // PCM
  pcm.writeUInt16LE(1, 22); // mono
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(file, pcm);
}

export function generateLastBellHarborSfx({ force = false, only = null } = {}) {
  const selected = only ? CUES.filter((cue) => cue.key === only) : CUES;
  if (only && selected.length === 0) throw new Error(`unknown harbor cue: ${only}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  let generated = 0;
  let skipped = 0;
  for (const cue of selected) {
    const destination = join(OUTPUT_DIR, `${cue.key}.mp3`);
    if (existsSync(destination) && !force) {
      skipped++;
      continue;
    }
    const temporary = join(dirname(destination), `.${cue.key}.${process.pid}.source.wav`);
    rmSync(temporary, { force: true });
    try {
      writeWav(temporary, cue.synth(cue.duration));
      conformSfxAudio({
        inputFile: temporary,
        outputFile: destination,
        duration: cue.duration,
        ffmpegPath: FFMPEG_PATH,
        channels: 1,
      });
      generated++;
      console.log(`baked ${cue.key}.mp3`);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return { generated, skipped };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const { generated, skipped } = generateLastBellHarborSfx({
    force: args.includes('--force'),
    only,
  });
  console.log(`harbor sfx: ${generated} baked, ${skipped} already present`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
