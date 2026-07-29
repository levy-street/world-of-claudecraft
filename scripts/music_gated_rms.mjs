// Gated-RMS loudness pass over WAV renders from scripts/render_music.mjs, the
// second half of the THEME_TRIM measurement documented in src/game/music.ts:
// windowed RMS (400ms windows), windows more than 15 dB under the loudest
// window gated out (so drop bars and quiet middles do not skew the level),
// then each theme's trim suggested as reference / measured, where the
// reference is the Eastbrook town theme (the game's loudness anchor).
//
// Run after rendering (renders must be at trim 1 for a fresh measurement):
//   node scripts/render_music.mjs tmp/music_renders
//   node scripts/music_gated_rms.mjs [dir=tmp/music_renders] [ref=town_eastbrook]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'tmp/music_renders';
const REF = process.argv[3] || 'town_eastbrook';
const WINDOW_S = 0.4;
const GATE_DB = 15;

function readWavMono16(file) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file}: not a RIFF/WAVE file`);
  }
  const sampleRate = buf.readUInt32LE(24);
  const dataLen = buf.readUInt32LE(40);
  const samples = new Float64Array(dataLen / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(44 + i * 2) / 0x8000;
  }
  return { sampleRate, samples };
}

function gatedRms(samples, sampleRate) {
  const win = Math.floor(sampleRate * WINDOW_S);
  const means = [];
  for (let start = 0; start + win <= samples.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += samples[i] * samples[i];
    means.push(sum / win);
  }
  const loudest = Math.max(...means);
  const floor = loudest / 10 ** (GATE_DB / 10);
  const kept = means.filter((m) => m >= floor);
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  return Math.sqrt(mean);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.wav'));
if (files.length === 0) {
  console.error(`no .wav files in ${DIR}; render first with scripts/render_music.mjs`);
  process.exit(1);
}
const results = new Map();
for (const f of files) {
  const { sampleRate, samples } = readWavMono16(path.join(DIR, f));
  results.set(path.basename(f, '.wav'), gatedRms(samples, sampleRate));
}
const ref = results.get(REF);
if (!ref) {
  console.error(`reference theme "${REF}" not among the renders`);
  process.exit(1);
}
console.log(`gated RMS (${WINDOW_S * 1000}ms windows, -${GATE_DB}dB gate), ref=${REF}`);
for (const [name, rms] of [...results.entries()].sort()) {
  const db = 20 * Math.log10(rms / ref);
  console.log(
    `${name.padEnd(26)} rms ${rms.toFixed(5)}  ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB  trim ${(ref / rms).toFixed(2)}`,
  );
}
