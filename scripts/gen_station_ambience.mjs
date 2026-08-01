// Generate the crafting-station ambience beds with deterministic seeded
// synthesis (scripts/sfx/station_ambience.mjs), then run the shared conform
// pass so the output matches every other generated amb_* loop (44.1 kHz,
// 192 kbps MP3, LUFS-normalized under the true-peak ceiling).
//
//   node scripts/gen_station_ambience.mjs [--force] [--only amb_loom] [--ffmpeg /path]
//
// FFmpeg is invoked through conformSfxAudio with an argument array. No shell.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  renderStationAmbience,
  SAMPLE_RATE,
  STATION_AMBIENCE_SPECS,
} from './sfx/station_ambience.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'public/audio/sfx');

/** Wrap mono float32 PCM in a WAV container (format 3, IEEE float). */
function floatWav(pcm) {
  const dataBytes = pcm.length * 4;
  const buf = Buffer.alloc(58 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(50 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(18, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(32, 34);
  buf.writeUInt16LE(0, 36); // cbSize
  buf.write('fact', 38);
  buf.writeUInt32LE(4, 42);
  buf.writeUInt32LE(pcm.length, 46);
  buf.write('data', 50);
  buf.writeUInt32LE(dataBytes, 54);
  for (let i = 0; i < pcm.length; i++) buf.writeFloatLE(pcm[i], 58 + i * 4);
  return buf;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function generateStationAmbience({ ffmpeg = FFMPEG_PATH, force = false, only = null } = {}) {
  const selected = only
    ? STATION_AMBIENCE_SPECS.filter((spec) => spec.key === only)
    : STATION_AMBIENCE_SPECS;
  if (only && selected.length === 0) throw new Error(`unknown station ambience: ${only}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;
  for (const spec of selected) {
    const destination = join(OUTPUT_DIR, `${spec.key}.mp3`);
    if (existsSync(destination) && !force) {
      skipped++;
      continue;
    }
    const temporary = join(dirname(destination), `.${spec.key}.${process.pid}.source.wav`);
    rmSync(temporary, { force: true });
    try {
      writeFileSync(temporary, floatWav(renderStationAmbience(spec.key)));
      conformSfxAudio({
        inputFile: temporary,
        outputFile: destination,
        duration: spec.duration,
        ffmpegPath: ffmpeg,
      });
      generated++;
    } catch (error) {
      throw new Error(`failed to generate ${spec.key}: ${error.message ?? error}`);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return { generated, skipped, total: selected.length };
}

function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--force', '--only', '--ffmpeg']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!known.has(arg)) throw new Error(`unknown argument: ${arg}`);
    if (arg === '--only' || arg === '--ffmpeg') index++;
  }
  const result = generateStationAmbience({
    force: args.includes('--force'),
    only: valueAfter(args, '--only'),
    ffmpeg: valueAfter(args, '--ffmpeg') ?? FFMPEG_PATH,
  });
  console.log(
    `Station ambience: ${result.generated} generated, ${result.skipped} skipped, ${result.total} selected.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
