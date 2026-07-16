// Generate the sampled UI sound catalog with deterministic FFmpeg synthesis.
//
//   node scripts/gen_ui_sfx.mjs [--force] [--only ui_click] [--ffmpeg /path]
//
// FFmpeg is invoked directly with an argument array. No shell is involved.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { ffmpegArgsForUiSfx, UI_SFX_SPECS } from './sfx/ui_sfx.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'public/audio/sfx');

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function runFfmpeg(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
}

export function generateUiSfx({ ffmpeg = 'ffmpeg', force = false, only = null } = {}) {
  const selected = only ? UI_SFX_SPECS.filter((spec) => spec.key === only) : UI_SFX_SPECS;
  if (only && selected.length === 0) throw new Error(`unknown UI SFX cue: ${only}`);
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
      runFfmpeg(ffmpeg, ffmpegArgsForUiSfx(spec, temporary));
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
  const result = generateUiSfx({
    force: args.includes('--force'),
    only: valueAfter(args, '--only'),
    ffmpeg: valueAfter(args, '--ffmpeg') ?? 'ffmpeg',
  });
  console.log(
    `UI SFX: ${result.generated} generated, ${result.skipped} skipped, ${result.total} selected.`,
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
