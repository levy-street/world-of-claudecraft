// Render three non-destructive post-processing treatments from one selected
// raid boss voice audition.
//
//   node scripts/process_raid_boss_voice_audition.mjs --input <candidate.mp3>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  buildRaidBossVoiceFilter,
  RAID_BOSS_VOICE_PROCESSING_PRESETS,
} from './voices/raid_boss_voice_processing.mjs';

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const inputArg = optionValue('--input');
const outputArg = optionValue('--output-dir');
const force = args.includes('--force');
const allowedArgs = new Set(['--input', '--output-dir', '--force', inputArg, outputArg]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
if (!inputArg) throw new Error('--input is required');

const input = path.resolve(inputArg);
if (!existsSync(input)) throw new Error(`Input does not exist: ${input}`);
if (path.extname(input).toLowerCase() !== '.mp3') throw new Error('Input must be an MP3 audition');

const outputDir = path.resolve(outputArg ?? path.join(path.dirname(input), 'processed'));
const outputs = RAID_BOSS_VOICE_PROCESSING_PRESETS.map((preset) => ({
  preset,
  output: path.join(outputDir, `${preset.id}.mp3`),
}));
const existing = outputs.find(({ output }) => existsSync(output));
if (existing && !force) {
  throw new Error(
    `Output already exists: ${existing.output}. Pass --force to replace all treatments.`,
  );
}

mkdirSync(outputDir, { recursive: true });
for (const { preset, output } of outputs) {
  const result = spawnSync(
    FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      force ? '-y' : '-n',
      '-i',
      input,
      '-filter_complex',
      buildRaidBossVoiceFilter(preset.id),
      '-map',
      '[out]',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      output,
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
  console.log(`saved ${path.relative(process.cwd(), output)}`);
}
