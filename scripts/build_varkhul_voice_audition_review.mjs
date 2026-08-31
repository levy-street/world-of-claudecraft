// Build one consolidated review folder from the current non-human Varkhul
// Voice Design candidates. The raw previews remain untouched.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { RAID_BOSS_VOICE_PROMPTS } from './voices/raid_boss_voice_prompts.mjs';
import {
  buildVarkhulVoiceFilter,
  VARKHUL_VOICE_PROCESSING_PRESET,
} from './voices/varkhul_voice_processing.mjs';

const root = process.cwd();
const force = process.argv.slice(2).includes('--force');
const unknown = process.argv.slice(2).find((arg) => arg !== '--force');
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const auditionRoot = path.join(root, 'tmp', 'raid-boss-voice-auditions', 'varkhul');
const outputDir = path.join(auditionRoot, 'nonhuman-review');
const prompts = RAID_BOSS_VOICE_PROMPTS.filter(({ npcId }) => npcId === 'varkhul');
if (prompts.length === 0) throw new Error('No Varkhul voice prompts are registered');

mkdirSync(outputDir, { recursive: true });
const review = [];
for (const [takeIndex, prompt] of prompts.entries()) {
  const takeDir = path.join(auditionRoot, prompt.takeId);
  const metadataPath = path.join(takeDir, 'audition.json');
  if (!existsSync(metadataPath)) throw new Error(`Missing Varkhul audition: ${metadataPath}`);
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (metadata.boss !== 'varkhul' || metadata.take !== prompt.takeId) {
    throw new Error(`Audition metadata does not match Varkhul take ${prompt.takeId}`);
  }

  for (const candidate of metadata.candidates) {
    const input = path.join(takeDir, candidate.file);
    if (!existsSync(input)) throw new Error(`Missing Varkhul candidate: ${input}`);
    const prefix = String(takeIndex + 1).padStart(2, '0');
    const outputName = `${prefix}-${prompt.takeId}-candidate-${candidate.candidate}.mp3`;
    const output = path.join(outputDir, outputName);
    if (existsSync(output) && !force) {
      throw new Error(`Output already exists: ${output}. Pass --force to replace the review.`);
    }

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
        buildVarkhulVoiceFilter(),
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
    review.push({
      take: prompt.takeId,
      candidate: candidate.candidate,
      source: path.relative(root, input),
      output: outputName,
    });
    console.log(`saved ${path.relative(root, output)}`);
  }
}

writeFileSync(
  path.join(outputDir, 'review.json'),
  `${JSON.stringify(
    {
      boss: 'varkhul',
      processingPreset: VARKHUL_VOICE_PROCESSING_PRESET,
      clips: review,
    },
    null,
    2,
  )}\n`,
);
console.log(`Varkhul review: ${path.relative(root, outputDir)}`);
