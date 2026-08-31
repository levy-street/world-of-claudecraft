// Render two non-destructive robotic treatments of the four approved Ignivar
// signature lines, beside the current ancient-herald cuts for direct audition.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  buildIgnivarRoboticVoiceFilter,
  IGNIVAR_ROBOTIC_VOICE_PRESETS,
} from './voices/ignivar_robotic_voice_processing.mjs';

const root = process.cwd();
const selectedRoot = path.join(
  root,
  'tmp',
  'raid-boss-voice-auditions',
  'ignivar',
  'forge-heavy-automaton',
);
const input = path.join(selectedRoot, 'candidate-2.mp3');
const cutsPath = path.join(selectedRoot, 'master-cut-pack', 'cuts.json');
const currentReviewDir = path.join(selectedRoot, 'master-cut-pack', 'review');
const outputDir = path.join(selectedRoot, 'robotic-comparison');
const force = process.argv.includes('--force');
const unknown = process.argv.slice(2).find((arg) => arg !== '--force');
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const reviewNames = ['01-awakening.mp3', '02-skyfire.mp3', '03-last-flame.mp3', '04-death.mp3'];

for (const required of [input, cutsPath, currentReviewDir]) {
  if (!existsSync(required)) throw new Error(`Missing Ignivar comparison input: ${required}`);
}
const receiptPath = path.join(outputDir, 'comparison.json');
if (existsSync(receiptPath) && !force) {
  throw new Error(`Comparison already exists: ${outputDir}. Pass --force to replace it.`);
}

const cuts = JSON.parse(readFileSync(cutsPath, 'utf8'));
if (!Array.isArray(cuts.lines) || cuts.lines.length !== reviewNames.length) {
  throw new Error('Ignivar signature cut receipt must contain exactly four lines');
}
const currentMaster = path.resolve(root, cuts.master);
if (!existsSync(currentMaster))
  throw new Error(`Missing current processed master: ${currentMaster}`);

function runFfmpeg(args) {
  const result = spawnSync(
    FFMPEG_PATH,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', force ? '-y' : '-n', ...args],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
}

function renderSignatureClip(master, bounds, output) {
  const duration = bounds.end - bounds.start;
  const fadeOutStart = Math.max(0, duration - 0.025);
  runFfmpeg([
    '-i',
    master,
    '-af',
    `atrim=start=${bounds.start}:end=${bounds.end},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=0.015,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.025`,
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '192k',
    output,
  ]);
}

function renderAllFourPreview(master, output) {
  const segments = cuts.lines
    .map(
      (bounds, index) =>
        `[0:a]atrim=start=${bounds.start}:end=${bounds.end},asetpts=PTS-STARTPTS,` +
        `${index < cuts.lines.length - 1 ? 'apad=pad_dur=0.55,' : ''}` +
        `afade=t=in:st=0:d=0.015[a${index}]`,
    )
    .join(';');
  const inputs = cuts.lines.map((_, index) => `[a${index}]`).join('');
  runFfmpeg([
    '-i',
    master,
    '-filter_complex',
    `${segments};${inputs}concat=n=${cuts.lines.length}:v=0:a=1[out]`,
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
  ]);
}

mkdirSync(outputDir, { recursive: true });
const currentDir = path.join(outputDir, '00-current-ancient-herald');
mkdirSync(currentDir, { recursive: true });
for (let index = 0; index < reviewNames.length; index++) {
  const sourceName = index === 1 ? '02-rotating-rays.mp3' : reviewNames[index];
  const source = path.join(currentReviewDir, sourceName);
  if (!existsSync(source)) throw new Error(`Missing current comparison clip: ${source}`);
  copyFileSync(source, path.join(currentDir, reviewNames[index]));
}
renderAllFourPreview(currentMaster, path.join(currentDir, '00-all-four.mp3'));

const mastersDir = path.join(outputDir, '_masters');
mkdirSync(mastersDir, { recursive: true });
const rendered = [];
for (let presetIndex = 0; presetIndex < IGNIVAR_ROBOTIC_VOICE_PRESETS.length; presetIndex++) {
  const preset = IGNIVAR_ROBOTIC_VOICE_PRESETS[presetIndex];
  const master = path.join(mastersDir, `${preset.id}.mp3`);
  runFfmpeg([
    '-i',
    input,
    '-filter_complex',
    buildIgnivarRoboticVoiceFilter(preset.id),
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
    master,
  ]);

  const presetDir = path.join(outputDir, `0${presetIndex + 1}-${preset.id}`);
  mkdirSync(presetDir, { recursive: true });
  for (let lineIndex = 0; lineIndex < cuts.lines.length; lineIndex++) {
    renderSignatureClip(
      master,
      cuts.lines[lineIndex],
      path.join(presetDir, reviewNames[lineIndex]),
    );
  }
  renderAllFourPreview(master, path.join(presetDir, '00-all-four.mp3'));
  rendered.push({ preset: preset.id, directory: path.relative(root, presetDir) });
}

writeFileSync(
  receiptPath,
  `${JSON.stringify(
    {
      boss: 'ignivar',
      source: path.relative(root, input),
      current: path.relative(root, currentDir),
      rendered,
    },
    null,
    2,
  )}\n`,
);
console.log(`Ignivar robotic comparison: ${path.relative(root, outputDir)}`);
