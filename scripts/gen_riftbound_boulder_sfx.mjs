// Generate the Riftbound Boulder movement cue from deterministic FFmpeg sources.
//
//   node scripts/gen_riftbound_boulder_sfx.mjs
//
// The seeded noise beds and oscillators are original procedural audio. FFmpeg is
// invoked with argument arrays and no shell. Same archetype as
// gen_terrorspark_groundshaker_sfx.mjs.
//
// What it is trying to sound like: a heavy stone grinding over ground, not an
// impact. mountRun fires this per stride with a 0.44s release, so the take is
// deliberately a touch longer than the gap between plays at mounted run speed:
// consecutive strides overlap into one continuous rumble instead of reading as
// separate thuds. The rift is the quietest layer on purpose. The stone is the
// mount; the magic is only what is holding it together.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(REPO_ROOT, 'public/audio/sfx/mount_run_riftbound_boulder.mp3');
const SOURCE = join(dirname(OUTPUT), '.mount_run_riftbound_boulder.source.wav');
const DURATION = 0.62;

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
    // The body of the roll: brown noise is already weighted toward the bottom,
    // which is what a mass of stone dragging over ground actually sounds like.
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=brown:amplitude=0.34:duration=${DURATION}:sample_rate=44100:seed=5309`,
    // The grit thrown off the contact patch.
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=white:amplitude=0.13:duration=${DURATION}:sample_rate=44100:seed=5311`,
    // One low revolution beat under the whole thing: the stone is round, so it
    // loads and unloads the ground once per turn rather than grinding evenly.
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=41:duration=${DURATION}:sample_rate=44100`,
    // The rift itself, barely there: a thin ringing partial that keeps the cue
    // from reading as a plain rockslide.
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=622:duration=${DURATION}:sample_rate=44100`,
    '-filter_complex',
    '[0:a]lowpass=f=420,volume=0.62,tremolo=f=5.5:d=0.42[body];' +
      '[1:a]highpass=f=1100,lowpass=f=5200,volume=0.16,tremolo=f=17:d=0.7[grit];' +
      '[2:a]volume=0.30,tremolo=f=2.7:d=0.6[turn];' +
      '[3:a]volume=0.035,tremolo=f=3.1:d=0.85,highpass=f=400[rift];' +
      '[body][grit][turn][rift]amix=inputs=4:normalize=0,' +
      'afade=t=in:st=0:d=0.05,afade=t=out:st=0.5:d=0.12,alimiter=limit=0.55[out]',
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
  console.log(`Riftbound Boulder SFX: wrote ${OUTPUT}`);
} finally {
  rmSync(SOURCE, { force: true });
}
