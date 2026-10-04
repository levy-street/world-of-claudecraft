// Generate the Fire and Fly fragmentation shell's three layers: the burst in the
// air, one bomblet's pop (the game plays it once per bomblet, positioned), and
// the tail of dirt and rumble after the last bomblet.
//
//   node scripts/gen_groundshaker_frag_sfx.mjs
//
// Heavy black powder with dirt: the whump, the bomblet pop and the rumble are
// cuts of the shipped shell blast (public/audio/sfx/impact_groundshaker.mp3,
// CC BY 3.0, see CREDITS.md); the crack, sub, iron whirs, smoke, thump, dirt,
// clods, pebbles and sand are original FFmpeg synthesis. Every noise is seeded
// and every grain time is a fixed-seed draw, so a rerun writes byte-identical
// files. FFmpeg is invoked with argument arrays and no shell.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SFX_DIR = join(REPO_ROOT, 'public/audio/sfx');
const IMPACT_SRC = join(SFX_DIR, 'impact_groundshaker.mp3');
const OUTPUT_STEM = 'impact_groundshaker_frag';
const SR = 44100;
/** The repo's short-clip conform target; each layer is normalized to it before conform. */
const LAYER_PEAK_DBTP = -6;

const db = (x) => 10 ** (x / 20);
const f = (x) => Number(x.toFixed(6)).toString();

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

function ff(args, capture = false) {
  const r = spawnSync(FFMPEG_PATH, ['-hide_banner', '-nostdin', ...args], {
    encoding: capture ? 'buffer' : 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'],
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(String(r.stderr).trim().slice(-2000));
  return r;
}

let work = '';
let workCount = 0;
const tmp = (name) => join(work, `${String(workCount++).padStart(3, '0')}_${name}.wav`);

// Expression builders for aevalsrc (mono, t in seconds).
const gate = (t0, len, body) => `if(between(t,${f(t0)},${f(t0 + len)}),${body},0)`;
const envAt = (t0, att, tau) => `(1-exp(-(t-${f(t0)})/${f(att)}))*exp(-(t-${f(t0)})/${f(tau)})`;
const glidePhase = (t0, f0, f1, k) =>
  `2*PI*(${f(f1)}*(t-${f(t0)})+${f(f0 - f1)}*${f(k)}*(1-exp(-(t-${f(t0)})/${f(k)})))`;
/** A seeded white-noise sample, drawn once per sample into ld(2). */
const noisePrelude = (seed) => `if(eq(n,0),st(1,${seed}),0);st(2,random(1)*2-1);`;
const noiseBurst = ({ t0 = 0, att = 0.0003, tau, amp = 1 }) =>
  gate(t0, 8 * tau + att * 4, `${f(amp)}*ld(2)*${envAt(t0, att, tau)}`);

/** A tone gliding exponentially from f0 to f1, with inharmonic partials and flutter. */
function tone({ t0 = 0, f0, f1 = f0, k = 0.05, att = 0.001, tau, amp = 1, partials, flutter }) {
  const parts = partials ?? [[1, 1]];
  const sum = parts
    .map(([ratio, a]) => `${f(a)}*sin(${glidePhase(t0, f0 * ratio, f1 * ratio, k)})`)
    .join('+');
  const am = flutter
    ? `*(1-${f(flutter.depth)}*0.5*(1+sin(2*PI*${f(flutter.hz)}*(t-${f(t0)}))))`
    : '';
  return gate(t0, 8 * tau + att * 4, `${f(amp)}*(${sum})*${envAt(t0, att, tau)}${am}`);
}

function synth(name, dur, expr, af = '') {
  const out = tmp(name);
  const chain = [af, `afade=t=out:st=${f(Math.max(0, dur - 0.02))}:d=0.02`]
    .filter(Boolean)
    .join(',');
  ff([
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${expr}':s=${SR}:d=${f(dur)}:c=mono`,
    '-af',
    chain,
    '-c:a',
    'pcm_f32le',
    out,
  ]);
  return out;
}

/** A cut of the shipped shell blast: start, duration, playback rate (pitch and time), filters, fades. */
function cut(name, file, { start = 0, dur, rate = 1, af = '', fadeIn = 0.002, fadeOut = 0.03 }) {
  const out = tmp(name);
  const chain = [
    `atrim=start=${f(start)}:duration=${f(dur)}`,
    'asetpts=PTS-STARTPTS',
    `afade=t=in:st=0:d=${f(fadeIn)}`,
    `afade=t=out:st=${f(Math.max(0, dur - fadeOut))}:d=${f(fadeOut)}`,
    rate !== 1 ? `asetrate=${Math.round(SR * rate)},aresample=${SR}` : '',
    af,
    'aformat=sample_fmts=flt:channel_layouts=mono',
  ]
    .filter(Boolean)
    .join(',');
  ff(['-y', '-loglevel', 'error', '-i', file, '-af', chain, '-c:a', 'pcm_f32le', out]);
  return out;
}

/** Sum mono items ({ file, at, gain }) onto one timeline of `dur` seconds. */
function mix(name, items, dur, post = '') {
  const out = tmp(name);
  const inputs = [];
  const chains = [];
  items.forEach((it, j) => {
    inputs.push('-i', it.file);
    chains.push(
      `[${j}:a]aformat=sample_fmts=flt:channel_layouts=mono,volume=${f(it.gain ?? 1)},` +
        `adelay=${Math.round((it.at ?? 0) * SR)}S:all=1[a${j}]`,
    );
  });
  const labels = items.map((_, j) => `[a${j}]`).join('');
  const tail = [
    `${labels}amix=inputs=${items.length}:normalize=0:duration=longest`,
    `apad=whole_dur=${f(dur)}`,
    `atrim=0:${f(dur)}`,
    post,
    `afade=t=out:st=${f(dur - 0.03)}:d=0.03`,
  ]
    .filter(Boolean)
    .join(',');
  ff([
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${chains.join(';')};${tail}[out]`,
    '-map',
    '[out]',
    '-c:a',
    'pcm_f32le',
    out,
  ]);
  return out;
}

function samplePeak(file) {
  const r = ff(['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-'], true);
  const buf = r.stdout;
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return peak || 1;
}

function truePeakDb(file) {
  const r = ff(['-i', file, '-af', 'apad=pad_dur=1,ebur128=peak=true', '-f', 'null', '-']);
  const tp = String(r.stderr).match(/True peak:\s*Peak:\s*(-?inf|[-\d.]+)\s*dBFS/i);
  const value = Number.parseFloat(tp?.[1] ?? 'NaN');
  if (!Number.isFinite(value)) throw new Error(`true peak unreadable for ${file}`);
  return value;
}

function component(file, peakDb) {
  return { file, gain: db(peakDb) / samplePeak(file) };
}

/**
 * Shaves the first transient by cutDb with a fast look-ahead limiter, so the
 * crack keeps its edge without setting the true peak alone.
 */
function limitLayer(name, file, cutDb) {
  const out = tmp(name);
  ff([
    '-y',
    '-loglevel',
    'error',
    '-i',
    file,
    '-af',
    `volume=${f(1 / samplePeak(file))},alimiter=limit=${f(db(-cutDb))}:attack=0.5:release=30:level=0:latency=1`,
    '-c:a',
    'pcm_f32le',
    out,
  ]);
  return out;
}

function toTruePeak(name, file, targetDb) {
  const out = tmp(name);
  ff([
    '-y',
    '-loglevel',
    'error',
    '-i',
    file,
    '-af',
    `volume=${f(db(targetDb - truePeakDb(file)))}`,
    '-c:a',
    'pcm_f32le',
    out,
  ]);
  return out;
}

/** Debris rattle: noise grains at fixed-seed times and levels, thinning out. */
function grainCloud({ seed, count, from, to, skew, tauMin, tauMax, ampFrom, ampTo }) {
  const rnd = mulberry32(seed);
  const terms = [];
  for (let i = 0; i < count; i++) {
    const u = (i + rnd() * 0.9) / count;
    const t0 = from + (to - from) * u ** skew;
    const tau = tauMin + (tauMax - tauMin) * rnd();
    const amp = (ampFrom + (ampTo - ampFrom) * u) * (0.55 + 0.45 * rnd());
    terms.push(noiseBurst({ t0, att: 0.0004, tau, amp }));
  }
  return terms.join('+');
}

/** A fuller whump-crack on the shell blast's head, tumbling iron, powder smoke, a slap echo. */
function burstLayer() {
  const crack = synth(
    'burst_crack',
    0.3,
    `${noisePrelude(2101)}${noiseBurst({ att: 0.0003, tau: 0.007, amp: 1 })}+${noiseBurst({ att: 0.002, tau: 0.035, amp: 0.35 })}`,
    'highpass=f=250,lowpass=f=6500,equalizer=f=1300:t=q:w=0.8:g=3',
  );
  const powder = cut('burst_powder', IMPACT_SRC, {
    start: 0,
    dur: 0.5,
    rate: 1.25,
    af: 'highpass=f=80',
    fadeOut: 0.18,
  });
  const sub = synth('burst_sub', 0.5, tone({ f0: 95, f1: 45, k: 0.05, att: 0.002, tau: 0.09 }));
  const whirSpecs = [
    [0.01, 1500, 0.16, 23],
    [0.03, 1950, 0.12, 31],
    [0.055, 1150, 0.2, 19],
  ];
  const whirs = synth(
    'burst_whir',
    0.9,
    whirSpecs
      .map(([t0, f0, tau, fm]) =>
        tone({
          t0,
          f0,
          f1: f0 * 0.6,
          k: 0.18,
          att: 0.012,
          tau,
          amp: 0.3,
          partials: [
            [1, 1],
            [1.53, 0.45],
            [2.31, 0.2],
          ],
          flutter: { hz: fm, depth: 0.8 },
        }),
      )
      .join('+'),
    'highpass=f=300',
  );
  const smoke = synth(
    'burst_smoke',
    0.9,
    `${noisePrelude(2102)}${noiseBurst({ att: 0.015, tau: 0.22, amp: 1 })}`,
    'highpass=f=500,lowpass=f=2600',
  );
  return mix(
    'burst_mix',
    [
      { ...component(crack, -1), at: 0 },
      { ...component(powder, -3), at: 0.003 },
      { ...component(sub, -4), at: 0 },
      { ...component(whirs, -10), at: 0 },
      { ...component(smoke, -17), at: 0 },
    ],
    0.9,
    'aecho=0.9:0.5:45|95:0.18|0.09',
  );
}

/** A short bright powder pop off the blast's head, a thump, a spray of dirt, a small crack. */
function bombletLayer() {
  const powder = cut('bomb_powder', IMPACT_SRC, {
    start: 0,
    dur: 0.32,
    rate: 1.7,
    af: 'lowpass=f=3500,highpass=f=60',
    fadeOut: 0.12,
  });
  const thump = synth(
    'bomb_thump',
    0.4,
    tone({ f0: 120, f1: 48, k: 0.04, att: 0.0015, tau: 0.07 }),
  );
  const dirt = synth(
    'bomb_dirt',
    0.4,
    `${noisePrelude(2201)}${noiseBurst({ att: 0.006, tau: 0.06, amp: 1 })}`,
    'bandpass=f=900:width_type=q:w=0.8',
  );
  const crack = synth(
    'bomb_crack',
    0.15,
    `${noisePrelude(2202)}${noiseBurst({ att: 0.0003, tau: 0.006, amp: 1 })}`,
    'highpass=f=800',
  );
  return mix(
    'bomblet_mix',
    [
      { ...component(powder, -2), at: 0 },
      { ...component(thump, -2), at: 0 },
      { ...component(dirt, -9), at: 0.004 },
      { ...component(crack, -7), at: 0 },
    ],
    0.42,
  );
}

/** The blast's own rolling rumble, clods and pebbles pattering down, a sand trickle. */
function tailLayer() {
  const rumble = cut('tail_rumble', IMPACT_SRC, {
    start: 0.6,
    dur: 2.0,
    af: 'lowpass=f=320,lowpass=f=320',
    fadeIn: 0.08,
    fadeOut: 0.6,
  });
  const clods = synth(
    'tail_clods',
    1.9,
    `${noisePrelude(2301)}${grainCloud({ seed: 2302, count: 30, from: 0.06, to: 1.3, skew: 1.6, tauMin: 0.008, tauMax: 0.02, ampFrom: 1, ampTo: 0.25 })}`,
    'bandpass=f=750:width_type=q:w=0.7,lowpass=f=2200',
  );
  const pebbles = synth(
    'tail_pebbles',
    1.9,
    `${noisePrelude(2303)}${grainCloud({ seed: 2304, count: 22, from: 0.1, to: 1.4, skew: 1.4, tauMin: 0.002, tauMax: 0.004, ampFrom: 1, ampTo: 0.35 })}`,
    'bandpass=f=3200:width_type=q:w=1',
  );
  const sand = synth(
    'tail_sand',
    1.9,
    `${noisePrelude(2305)}${noiseBurst({ att: 0.12, tau: 0.45, amp: 1 })}`,
    'highpass=f=1500,lowpass=f=6000',
  );
  return mix(
    'tail_mix',
    [
      { ...component(rumble, -1), at: 0 },
      { ...component(clods, -5), at: 0 },
      { ...component(pebbles, -13), at: 0 },
      { ...component(sand, -24), at: 0 },
    ],
    1.9,
  );
}

const LAYERS = [
  { name: 'burst', render: burstLayer, crestCutDb: 4, duration: 0.9 },
  { name: 'bomblet', render: bombletLayer, crestCutDb: 3, duration: 0.42 },
  { name: 'tail', render: tailLayer, crestCutDb: 1, duration: 1.9 },
];

if (!existsSync(IMPACT_SRC)) throw new Error(`missing shipped clip ${IMPACT_SRC}`);
work = mkdtempSync(join(tmpdir(), 'woc-frag-sfx-'));
try {
  for (const layer of LAYERS) {
    const shaved = limitLayer(`${layer.name}_lim`, layer.render(), layer.crestCutDb);
    const source = toTruePeak(`${layer.name}_norm`, shaved, LAYER_PEAK_DBTP);
    const output = join(SFX_DIR, `${OUTPUT_STEM}_${layer.name}.mp3`);
    conformSfxAudio({
      inputFile: source,
      outputFile: output,
      duration: layer.duration,
      ffmpegPath: FFMPEG_PATH,
      channels: 1,
      preserveLoudness: true,
    });
    console.log(`Frag shell SFX: wrote ${output}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
