// Generate the tank mount movement cue from deterministic FFmpeg sources.
//
//   node scripts/gen_terrorspark_groundshaker_sfx.mjs
//
// The seeded noise beds and oscillator are original procedural audio. FFmpeg
// is invoked with argument arrays and no shell.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(REPO_ROOT, 'public/audio/sfx/mount_run_terrorspark_groundshaker.mp3');
const SOURCE = join(dirname(OUTPUT), '.mount_run_terrorspark_groundshaker.source.wav');
const DURATION = 0.6;

function runFfmpeg(args) {
  const result = spawnSync(FFMPEG_PATH, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
}

mkdirSync(dirname(OUTPUT), { recursive: true });
rmSync(SOURCE, { force: true });
try {
  runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:amplitude=0.12:duration=${DURATION}:sample_rate=44100:seed=8101`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=58:duration=${DURATION}:sample_rate=44100`,
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=white:amplitude=0.08:duration=${DURATION}:sample_rate=44100:seed=8102`,
    '-filter_complex',
    '[0:a]highpass=f=140,lowpass=f=950,volume=0.45,tremolo=f=9:d=0.75[tracks];' +
      '[1:a]volume=0.25,tremolo=f=6:d=0.55[engine];' +
      '[2:a]highpass=f=900,lowpass=f=3200,volume=0.20,tremolo=f=14:d=0.8[clatter];' +
      '[tracks][engine][clatter]amix=inputs=3:normalize=0,' +
      'afade=t=in:st=0:d=0.015,afade=t=out:st=0.53:d=0.07,alimiter=limit=0.55[out]',
    '-map',
    '[out]',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'pcm_s16le',
    SOURCE,
  ]);
  conformSfxAudio({
    inputFile: SOURCE,
    outputFile: OUTPUT,
    duration: DURATION,
    ffmpegPath: FFMPEG_PATH,
    channels: 1,
  });
  console.log(`Tank mount SFX: wrote ${OUTPUT}`);
} finally {
  rmSync(SOURCE, { force: true });
}
