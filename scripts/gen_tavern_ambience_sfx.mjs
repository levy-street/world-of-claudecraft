// Generate the Mirefen tavern's ambience bed (public/audio/sfx/amb_tavern.mp3): a room full
// of talk with a little music from the bard's corner, one seamless stereo loop. Played as a
// non-positional bed by src/game/sfx.ts (the 'tavern' point ambience), whose gain and lowpass
// src/game/tavern_ambience_core.ts decides from the listener's position: muffled through the
// walls outside, clear inside.
//
//   node scripts/gen_tavern_ambience_sfx.mjs
//
// Everything here is the project's own material, deterministic from the seeds below:
//  - the music is the Fenbridge town theme ("Dry Boots and Lamplight", src/game/music.ts
//    composeTownFenbridge), rendered from the procedural score by scripts/render_music.mjs
//    (headless Chrome, the synth voices and the authoring mix chain) into tmp/ when that
//    render is missing. Its first sixteen bars (the A and B sections) of the second pass are
//    cut out, so the wrap lands on the theme's own return to its opening G chord. The tavern
//    stands far outside Fenbridge's hub, where the zone plays the marsh theme, so the town
//    theme never doubles itself here;
//  - the talk is synthesized: a dozen talkers, each a glottal pulse train through three
//    vowel formants that glide from syllable to syllable, in phrases and pauses with a
//    falling intonation, the odd consonant hiss and a few bursts of laughter; a far babble
//    bed of band-shaped noise under them;
//  - the room: mug clinks and set-downs, a few crackles from the hearth, low room tone, and a
//    small stereo reverb over it all.
// The loop is baked seamless: the synthesis runs a warm-up before the cut and past its end,
// and the tail past the end is crossfaded (equal power) into the head, so the runtime's plain
// loop=true playback wraps without a seam. The master is set to BED_LUFS and peak-limited
// here (the catalog marks the key `custom`, so the conform step only enforces the true-peak
// ceiling and re-encodes to the SFX standard: 44.1 kHz, 192 kbps, stereo).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio, measureSfxLufs, measureSfxTruePeakDb } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(REPO_ROOT, 'public/audio/sfx/amb_tavern.mp3');
const SOURCE = join(dirname(OUTPUT), '.amb_tavern.source.wav');
const MUSIC_DIR = join(REPO_ROOT, 'tmp/music_renders');
const MUSIC_WAV = join(MUSIC_DIR, 'town_fenbridge.wav');

const SR = 44100;
/** The Fenbridge theme's tempo and the loop: sixteen bars of 4/4 at 88 bpm. */
const BPM = 88;
const LOOP_SECONDS = (16 * 4 * 60) / BPM;
/** The render's lead-in and one full pass of the 24-bar theme (render_music's layout). */
const RENDER_LEAD = 0.05;
const THEME_PASS = (24 * 4 * 60) / BPM;
/** Warm-up before the cut (reverbs full, talk under way) and the crossfaded tail. */
const WARM = 3;
const XFADE = 0.6;
/** The master's integrated loudness, and the sample ceiling before encoding. */
const BED_LUFS = -17;
const CEILING = 10 ** (-9 / 20);
const SEED = 0x7a7e;

const L = Math.round(LOOP_SECONDS * SR);
const X = Math.round(XFADE * SR);
const W = Math.round(WARM * SR);
const N = W + L + X;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------
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
const rng = mulberry32(SEED);
const rand = (a, b) => a + (b - a) * rng();
const pick = (list) => list[Math.floor(rng() * list.length)];

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
/** RBJ band-pass (constant 0 dB peak gain) coefficients into `c`. */
function bandpassCoeffs(c, f, q) {
  const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  c.b0 = alpha / a0;
  c.b1 = 0;
  c.b2 = -alpha / a0;
  c.a1 = (-2 * Math.cos(w)) / a0;
  c.a2 = (1 - alpha) / a0;
}

function biquad() {
  return { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function runBiquad(s, x) {
  const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
  s.x2 = s.x1;
  s.x1 = x;
  s.y2 = s.y1;
  s.y1 = y;
  return y;
}

function onePoleLowpass(data, f) {
  const k = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += k * (data[i] - y);
    data[i] = y;
  }
}

function onePoleHighpass(data, f) {
  const k = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let low = 0;
  for (let i = 0; i < data.length; i++) {
    low += k * (data[i] - low);
    data[i] -= low;
  }
}

// ---------------------------------------------------------------------------
// Talkers
// ---------------------------------------------------------------------------
/** Vowel formants (Hz): F1, F2, F3. */
const VOWELS = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [300, 2250, 2950],
  [570, 840, 2410],
  [320, 870, 2240],
  [660, 1720, 2410],
  [490, 1350, 1690],
  [440, 1020, 2240],
];
const FORMANT_GAIN = [1.0, 0.62, 0.3];

/** One talker's voice into the stereo buses: phrases of syllables and pauses from `start`. */
function talker(left, right, opts) {
  const { f0, pan, level, breath, busyness, voiceScale } = opts;
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * level;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * level;
  const filters = [biquad(), biquad(), biquad()];
  const cur = [...pick(VOWELS)];
  let phase = rng();
  let t = Math.round(rand(0, 4) * SR);
  const hiss = biquad();
  bandpassCoeffs(hiss, 5200, 1.2);
  while (t < N) {
    // a phrase: a run of syllables under one falling intonation, then a pause
    const syllables = Math.round(rand(3, 14));
    const pitchTop = f0 * rand(1.02, 1.18);
    let s = 0;
    while (s < syllables && t < N) {
      const dur = Math.round(rand(0.09, 0.24) * SR);
      const gap = Math.round(rand(0.015, 0.07) * SR);
      const target = pick(VOWELS).map((f) => f * voiceScale);
      const amp = rand(0.55, 1) * (s === 0 ? 1.1 : 1);
      const consonant = rng() < 0.35 ? Math.round(rand(0.02, 0.06) * SR) : 0;
      const across = syllables > 1 ? s / (syllables - 1) : 0;
      const pitch = pitchTop * (1 - 0.16 * across) * rand(0.95, 1.05);
      const attack = Math.round(0.022 * SR);
      const release = Math.round(0.05 * SR);
      for (let i = 0; i < dur && t + i < N; i++) {
        const n = t + i;
        if ((i & 31) === 0) {
          // the formants glide toward this syllable's vowel over its first 40 ms
          const g = Math.min(1, i / (0.04 * SR));
          for (let k = 0; k < 3; k++) {
            const f = cur[k] + (target[k] - cur[k]) * g;
            bandpassCoeffs(filters[k], f, f / (70 + 30 * k));
          }
        }
        const env =
          i < attack
            ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack)
            : i > dur - release
              ? 0.5 + 0.5 * Math.cos((Math.PI * (i - (dur - release))) / release)
              : 1;
        const f = pitch * (1 + 0.012 * Math.sin((2 * Math.PI * 5.5 * n) / SR));
        phase += f / SR;
        if (phase >= 1) phase -= 1;
        // a glottal pulse: a skewed ramp, richer than a sine, softer than a saw
        const pulse = phase < 0.6 ? phase / 0.6 : (1 - phase) / 0.4;
        const src = (pulse - 0.5) * 2 + (rng() - 0.5) * breath;
        let v = 0;
        for (let k = 0; k < 3; k++) v += runBiquad(filters[k], src) * FORMANT_GAIN[k];
        let out = v * env * amp;
        if (i < consonant) {
          const ce = Math.sin((Math.PI * i) / consonant);
          out += runBiquad(hiss, rng() - 0.5) * 0.9 * ce * amp;
        }
        left[n] += out * gl;
        right[n] += out * gr;
      }
      for (let k = 0; k < 3; k++) cur[k] = target[k];
      t += dur + gap;
      s++;
    }
    t += Math.round(rand(0.25, 3.2 / busyness) * SR);
  }
}

/** A burst of laughter: breathy, higher, quick "ha" syllables fading away. */
function laugh(left, right, at, f0, pan, level) {
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * level;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * level;
  const filters = [biquad(), biquad(), biquad()];
  for (let k = 0; k < 3; k++) {
    bandpassCoeffs(filters[k], VOWELS[0][k] * 1.05, VOWELS[0][k] / (60 + 30 * k));
  }
  const count = Math.round(rand(4, 8));
  let t = at;
  let phase = 0;
  for (let c = 0; c < count; c++) {
    const dur = Math.round(rand(0.1, 0.15) * SR);
    const amp = (1 - c / (count + 1)) * rand(0.8, 1);
    const pitch = f0 * (1.35 - 0.05 * c);
    for (let i = 0; i < dur && t + i < N; i++) {
      const n = t + i;
      const env = Math.sin((Math.PI * i) / dur) ** 0.7;
      phase += pitch / SR;
      if (phase >= 1) phase -= 1;
      const pulse = phase < 0.6 ? phase / 0.6 : (1 - phase) / 0.4;
      const src = (pulse - 0.5) * 1.4 + (rng() - 0.5) * 1.1;
      let v = 0;
      for (let k = 0; k < 3; k++) v += runBiquad(filters[k], src) * FORMANT_GAIN[k];
      left[n] += v * env * amp * gl;
      right[n] += v * env * amp * gr;
    }
    t += dur + Math.round(rand(0.05, 0.09) * SR);
  }
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------
/** A pewter or earthenware clink: a few inharmonic partials ringing down fast. */
function clink(left, right, at, pan, level) {
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * level;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * level;
  const r = rand(0.85, 1.2);
  const partials = [2150, 3420, 4810, 6230].map((f) => [f * r * rand(0.98, 1.02), rand(0.4, 1)]);
  const decay = rand(0.05, 0.14);
  const len = Math.round(decay * 6 * SR);
  for (let i = 0; i < len && at + i < N; i++) {
    const t = i / SR;
    let v = 0;
    for (const [f, a] of partials) v += Math.sin(2 * Math.PI * f * t) * a;
    v *= Math.exp(-t / decay) * 0.25;
    left[at + i] += v * gl;
    right[at + i] += v * gr;
  }
}

/** A tankard set down on a board: a dull wooden knock. */
function knock(left, right, at, pan, level) {
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * level;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * level;
  const f = rand(140, 230);
  const len = Math.round(0.12 * SR);
  const bp = biquad();
  bandpassCoeffs(bp, f * 4, 2);
  for (let i = 0; i < len && at + i < N; i++) {
    const t = i / SR;
    const v =
      (Math.sin(2 * Math.PI * f * t) * 0.8 + runBiquad(bp, rng() - 0.5) * 1.5) *
      Math.exp(-t / 0.025);
    left[at + i] += v * gl;
    right[at + i] += v * gr;
  }
}

/** A crackle from the hearth: a tiny bright pop. */
function crackle(left, right, at, pan, level) {
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * level;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * level;
  const len = Math.round(rand(0.002, 0.006) * SR);
  let prev = 0;
  for (let i = 0; i < len && at + i < N; i++) {
    const w = rng() - 0.5;
    const v = (w - prev) * (1 - i / len);
    prev = w;
    left[at + i] += v * gl;
    right[at + i] += v * gr;
  }
}

/** A small stereo room (Schroeder: parallel combs into series allpasses, per channel). */
function reverb(input, delays, allpasses, feedback, damp) {
  const out = new Float32Array(input.length);
  for (const d of delays) {
    const buf = new Float32Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < input.length; i++) {
      const y = buf[idx];
      lp = y * (1 - damp) + lp * damp;
      buf[idx] = input[i] + lp * feedback;
      out[i] += y;
      idx = (idx + 1) % d;
    }
  }
  for (const d of allpasses) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx];
      const x = out[i];
      const y = -x * 0.5 + b;
      buf[idx] = x + b * 0.5;
      out[i] = y;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= delays.length;
  return out;
}

// ---------------------------------------------------------------------------
// The music
// ---------------------------------------------------------------------------
function readMonoWav(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a WAV: ${file}`);
  let at = 12;
  let rate = 0;
  let channels = 0;
  while (at < bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(at + 10);
      rate = bytes.readUInt32LE(at + 12);
    } else if (id === 'data') {
      if (channels !== 1 || rate !== SR) throw new Error(`expected mono ${SR} Hz: ${file}`);
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size;
  }
  throw new Error(`no data chunk: ${file}`);
}

function ensureMusicRender() {
  if (existsSync(MUSIC_WAV)) return;
  mkdirSync(MUSIC_DIR, { recursive: true });
  const result = spawnSync(
    process.execPath,
    ['scripts/render_music.mjs', MUSIC_DIR, 'town_fenbridge'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0 || !existsSync(MUSIC_WAV)) {
    throw new Error('rendering the Fenbridge theme failed (scripts/render_music.mjs)');
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
function build() {
  ensureMusicRender();
  const talkL = new Float32Array(N);
  const talkR = new Float32Array(N);
  // the regulars: a dozen voices round the room, low and high, near and far
  const talkers = 12;
  for (let k = 0; k < talkers; k++) {
    const low = k % 3 !== 2;
    talker(talkL, talkR, {
      f0: low ? rand(92, 140) : rand(175, 235),
      pan: rand(-0.85, 0.85),
      level: rand(0.35, 1),
      breath: rand(0.25, 0.6),
      busyness: rand(0.7, 1.4),
      voiceScale: low ? rand(0.92, 1.02) : rand(1.08, 1.2),
    });
  }
  // a few bursts of laughter
  for (let k = 0; k < 4; k++) {
    const at = W + Math.round(rand(0.06, 0.94) * L);
    laugh(
      talkL,
      talkR,
      at,
      rng() < 0.6 ? rand(110, 150) : rand(200, 250),
      rand(-0.8, 0.8),
      rand(0.6, 1),
    );
  }
  // the far babble: many more voices blurred into a band of breath
  const babbleL = new Float32Array(N);
  const babbleR = new Float32Array(N);
  for (const [bus, off] of [
    [babbleL, 0],
    [babbleR, 1.7],
  ]) {
    const f1 = biquad();
    const f2 = biquad();
    bandpassCoeffs(f1, 520, 0.9);
    bandpassCoeffs(f2, 1450, 1.1);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const w = rng() - 0.5;
      const swell =
        0.65 +
        0.2 * Math.sin(2 * Math.PI * 0.23 * t + off) +
        0.15 * Math.sin(2 * Math.PI * 3.1 * t + off * 2);
      bus[i] = (runBiquad(f1, w) + runBiquad(f2, w) * 0.6) * swell;
    }
  }
  const roomL = new Float32Array(N);
  const roomR = new Float32Array(N);
  // mugs: clinks and set-downs scattered round the tables
  const events = Math.round((LOOP_SECONDS + WARM) * 0.45);
  for (let k = 0; k < events; k++) {
    const at = Math.round(rand(0, N - SR));
    if (rng() < 0.55) clink(roomL, roomR, at, rand(-0.9, 0.9), rand(0.25, 0.6));
    else knock(roomL, roomR, at, rand(-0.9, 0.9), rand(0.35, 0.75));
  }
  // the hearth's crackle, off to the right of the room's middle
  const pops = Math.round((LOOP_SECONDS + WARM) * 2.2);
  for (let k = 0; k < pops; k++) {
    crackle(roomL, roomR, Math.round(rand(0, N - SR)), rand(-0.1, 0.5), rand(0.1, 0.35));
  }
  // room tone: a low warm rumble
  for (const bus of [roomL, roomR]) {
    let brown = 0;
    for (let i = 0; i < N; i++) {
      brown = (brown + (rng() - 0.5) * 0.02) * 0.998;
      bus[i] += brown * 0.35;
    }
  }
  // the music from the bard's corner (the stage is back left): the second pass's opening
  // sixteen bars, warm-up included
  const music = readMonoWav(MUSIC_WAV);
  const cut = Math.round((RENDER_LEAD + THEME_PASS - WARM) * SR);
  if (cut + N > music.length) throw new Error('the Fenbridge render is too short for the loop');
  const musicL = new Float32Array(N);
  const musicR = new Float32Array(N);
  const mPan = -0.35;
  const mgl = Math.cos(((mPan + 1) * Math.PI) / 4);
  const mgr = Math.sin(((mPan + 1) * Math.PI) / 4);
  for (let i = 0; i < N; i++) {
    musicL[i] = music[cut + i] * mgl;
    musicR[i] = music[cut + i] * mgr;
  }
  // levels (relative), then the room's reverb over a send of everything
  const TALK = 2.4;
  const BABBLE = 0.5;
  const ROOM = 0.9;
  const MUSIC = 0.66;
  const dryL = new Float32Array(N);
  const dryR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dryL[i] = talkL[i] * TALK + babbleL[i] * BABBLE + roomL[i] * ROOM + musicL[i] * MUSIC;
    dryR[i] = talkR[i] * TALK + babbleR[i] * BABBLE + roomR[i] * ROOM + musicR[i] * MUSIC;
  }
  const rms = (a, k) => Math.sqrt(a.reduce((s, v) => s + (v * k) ** 2, 0) / a.length);
  const db = (v) => (20 * Math.log10(v)).toFixed(1);
  console.log(
    `  stems (dB rel.): talk ${db(rms(talkL, TALK))}, babble ${db(rms(babbleL, BABBLE))}, ` +
      `room ${db(rms(roomL, ROOM))}, music ${db(rms(musicL, MUSIC))}`,
  );
  const wetL = reverb(dryL, [1557, 1617, 1491, 1422], [556, 441], 0.8, 0.35);
  const wetR = reverb(dryR, [1580, 1640, 1514, 1445], [579, 464], 0.8, 0.35);
  const left = new Float32Array(N);
  const right = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    left[i] = dryL[i] * 0.72 + wetL[i] * 0.5;
    right[i] = dryR[i] * 0.72 + wetR[i] * 0.5;
  }
  // a room, not a microphone in a mouth: trim the boom and the air
  for (const bus of [left, right]) {
    onePoleHighpass(bus, 90);
    onePoleLowpass(bus, 7000);
  }
  // the seamless loop: drop the warm-up, crossfade the tail past the end into the head
  const outL = new Float32Array(L);
  const outR = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    outL[i] = left[W + i];
    outR[i] = right[W + i];
  }
  for (let i = 0; i < X; i++) {
    const a = Math.sqrt(i / X);
    const b = Math.sqrt(1 - i / X);
    outL[i] = left[W + i] * a + left[W + L + i] * b;
    outR[i] = right[W + i] * a + right[W + L + i] * b;
  }
  return [outL, outR];
}

/** A soft knee over the ceiling (sample peaks only: the clinks), then a fixed trim. */
function master(channels, gain) {
  for (const bus of channels) {
    for (let i = 0; i < bus.length; i++) {
      const v = bus[i] * gain;
      const a = Math.abs(v);
      bus[i] =
        a <= CEILING * 0.7
          ? v
          : Math.sign(v) *
            (CEILING * 0.7 + CEILING * 0.3 * Math.tanh((a - CEILING * 0.7) / (CEILING * 0.3)));
    }
  }
}

function writeStereoWav(file, left, right) {
  const pcm = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([header, pcm]));
}

/** The largest sample step across the wrap against the typical step inside the loop. */
function wrapReport(left, right) {
  let typical = 0;
  for (let i = 1; i < left.length; i++) typical += Math.abs(left[i] - left[i - 1]);
  typical /= left.length - 1;
  const wrap = Math.max(
    Math.abs(left[0] - left[left.length - 1]),
    Math.abs(right[0] - right[right.length - 1]),
  );
  return { wrapStep: wrap, meanStep: typical, ratio: wrap / typical };
}

const [left, right] = build();
mkdirSync(dirname(OUTPUT), { recursive: true });
rmSync(SOURCE, { force: true });
try {
  // set the master: measure the unscaled mix, trim it to BED_LUFS, limit the peaks
  let peak = 0;
  for (const bus of [left, right]) for (const v of bus) peak = Math.max(peak, Math.abs(v));
  for (const bus of [left, right]) for (let i = 0; i < bus.length; i++) bus[i] *= 0.5 / peak;
  writeStereoWav(SOURCE, left, right);
  const measured = measureSfxLufs(SOURCE, FFMPEG_PATH);
  // re-run the master from the scaled mix toward the target loudness
  const gain = 10 ** ((BED_LUFS - measured) / 20);
  master([left, right], gain);
  writeStereoWav(SOURCE, left, right);
  const wrap = wrapReport(left, right);
  const result = conformSfxAudio({
    inputFile: SOURCE,
    outputFile: OUTPUT,
    duration: LOOP_SECONDS,
    ffmpegPath: FFMPEG_PATH,
    channels: 2,
    preserveLoudness: true,
  });
  const lufs = measureSfxLufs(OUTPUT, FFMPEG_PATH);
  const truePeak = measureSfxTruePeakDb(OUTPUT, FFMPEG_PATH);
  console.log(
    `Tavern ambience: wrote ${OUTPUT} (${LOOP_SECONDS.toFixed(2)} s loop, ${readFileSync(OUTPUT).length} bytes)`,
  );
  console.log(
    `  loudness ${lufs.toFixed(1)} LUFS, true peak ${truePeak.toFixed(1)} dBFS, conform gain ${result.gainDb} dB`,
  );
  console.log(
    `  wrap step ${wrap.wrapStep.toFixed(5)} vs mean step ${wrap.meanStep.toFixed(5)} (x${wrap.ratio.toFixed(2)})`,
  );
} finally {
  rmSync(SOURCE, { force: true });
}
