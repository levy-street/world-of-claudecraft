// Build the five party ping cues (scripts/sfx/ping_sfx.mjs) from the trimmed
// CC0 working masters in scripts/sfx/sources/pings/: render each recipe's
// layered mix, level it to a fixed true peak so the five sit together, then
// conform it as a custom master into public/audio/sfx/<key>.mp3.
//
//   node scripts/sfx/build_ping_sfx.mjs [--only <key part>]
//
// Then run `node scripts/build_sfx_manifest.mjs` to regenerate the manifest,
// the runtime pack and the measured gain ceilings. No credentials, no network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { conformSfxAudio, measureSfxTruePeakDb } from './conform_audio.mjs';
import { FFMPEG_PATH } from './ffmpeg_paths.mjs';
import { PING_RECIPES, PING_SOURCES, pingFilterGraph } from './ping_sfx.mjs';

/** Where every ping's true peak lands before the conform pass: half a dB
 *  under the custom-master ceiling, so conform never has to touch the level. */
const PING_PEAK_DBTP = -6.5;
const SOURCES = 'scripts/sfx/sources/pings';
const WORK = 'tmp/ping-sfx';
const OUT = 'public/audio/sfx';

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const ff = (args) =>
  execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

mkdirSync(WORK, { recursive: true });
for (const [key, recipe] of Object.entries(PING_RECIPES)) {
  if (only && !key.includes(only)) continue;
  const inputs = [...new Set(recipe.layers.map((spec) => spec.src))];
  const mixed = join(WORK, `${key}.mix.wav`);
  const levelled = join(WORK, `${key}.wav`);
  ff([
    ...inputs.flatMap((src) => ['-i', join(SOURCES, PING_SOURCES[src])]),
    '-filter_complex',
    pingFilterGraph(recipe, inputs),
    '-map',
    '[out]',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-c:a',
    'pcm_f32le',
    mixed,
  ]);
  const peak = measureSfxTruePeakDb(mixed, FFMPEG_PATH);
  ff([
    '-i',
    mixed,
    '-af',
    `volume=${(PING_PEAK_DBTP - peak).toFixed(2)}dB`,
    '-c:a',
    'pcm_f32le',
    levelled,
  ]);
  const result = conformSfxAudio({
    inputFile: levelled,
    outputFile: join(OUT, `${key}.mp3`),
    duration: recipe.length,
    ffmpegPath: FFMPEG_PATH,
    channels: 1,
    preserveLoudness: true,
  });
  rmSync(mixed, { force: true });
  console.log(`${key}: ${result.outputLevel.toFixed(2)} dBTP (${result.normBranch})`);
}
