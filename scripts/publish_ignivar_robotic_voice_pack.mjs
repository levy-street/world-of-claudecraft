// Rebuild Ignivar's complete production pack from the two approved clean
// performances, then optionally publish the staged clips to public/. This is
// deliberately offline: it never calls ElevenLabs or consumes API credits.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  buildIgnivarRoboticVoiceFilter,
  IGNIVAR_PRODUCTION_VOICE_PRESET,
} from './voices/ignivar_robotic_voice_processing.mjs';
import { IGNIVAR_VOICE_EXTENSION_LINES } from './voices/ignivar_voice_extension.mjs';
import {
  IGNIVAR_VOICE_PACK_LINES,
  validateIgnivarProductionReceipt,
} from './voices/ignivar_voice_pack.mjs';

const root = process.cwd();
const selectedRoot = path.join(
  root,
  'tmp',
  'raid-boss-voice-auditions',
  'ignivar',
  'forge-heavy-automaton',
);
const signatureSource = path.join(selectedRoot, 'candidate-2.mp3');
const signatureReceiptPath = path.join(selectedRoot, 'master-cut-pack', 'cuts.json');
const extensionRoot = path.join(selectedRoot, 'additional-lines-v3-v1');
const extensionSource = path.join(extensionRoot, 'ignivar-extension-master-raw.mp3');
const extensionReceiptPath = path.join(extensionRoot, 'extension.json');
const outputDir = path.join(selectedRoot, 'production-robotic-automaton');
const mastersDir = path.join(outputDir, '_masters');
const clipsDir = path.join(outputDir, 'clips');
const publicDir = path.join(root, 'public', 'audio', 'voice', 'ignivar');
const publish = process.argv.includes('--publish');
const force = process.argv.includes('--force');
const unknown = process.argv
  .slice(2)
  .find((argument) => argument !== '--publish' && argument !== '--force');
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

for (const required of [
  signatureSource,
  signatureReceiptPath,
  extensionSource,
  extensionReceiptPath,
]) {
  if (!existsSync(required)) throw new Error(`Missing Ignivar production input: ${required}`);
}

const signatureReceipt = JSON.parse(readFileSync(signatureReceiptPath, 'utf8'));
const extensionReceipt = JSON.parse(readFileSync(extensionReceiptPath, 'utf8'));

const signatureLines = validateIgnivarProductionReceipt(
  IGNIVAR_VOICE_PACK_LINES,
  signatureReceipt,
  'Signature receipt',
);
const extensionLines = validateIgnivarProductionReceipt(
  IGNIVAR_VOICE_EXTENSION_LINES,
  extensionReceipt,
  'Extension receipt',
);
const productionLines = [...signatureLines, ...extensionLines];
if (new Set(productionLines.map(({ key }) => key)).size !== productionLines.length) {
  throw new Error('Ignivar production line keys must be unique');
}

mkdirSync(mastersDir, { recursive: true });
mkdirSync(clipsDir, { recursive: true });

function runFfmpeg(arguments_) {
  const result = spawnSync(
    FFMPEG_PATH,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', force ? '-y' : '-n', ...arguments_],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
}

function processMaster(input, output) {
  runFfmpeg([
    '-i',
    input,
    '-filter_complex',
    buildIgnivarRoboticVoiceFilter(IGNIVAR_PRODUCTION_VOICE_PRESET),
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

function cutLine(master, line) {
  const duration = line.end - line.start;
  const fadeOutStart = Math.max(0, duration - 0.025);
  const output = path.join(clipsDir, `${line.key}.mp3`);
  runFfmpeg([
    '-i',
    master,
    '-af',
    `atrim=start=${line.start}:end=${line.end},asetpts=PTS-STARTPTS,` +
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
  return output;
}

const signatureMaster = path.join(mastersDir, 'signature-master.mp3');
const extensionMaster = path.join(mastersDir, 'extension-master.mp3');
processMaster(signatureSource, signatureMaster);
processMaster(extensionSource, extensionMaster);

const staged = [
  ...signatureLines.map((line) => ({ line, file: cutLine(signatureMaster, line) })),
  ...extensionLines.map((line) => ({ line, file: cutLine(extensionMaster, line) })),
];
for (const { file } of staged) {
  if (!existsSync(file)) throw new Error(`Ignivar production clip was not rendered: ${file}`);
}

if (publish) {
  mkdirSync(publicDir, { recursive: true });
  for (const { line, file } of staged) {
    copyFileSync(file, path.join(publicDir, `${line.key}.mp3`));
  }
}

writeFileSync(
  path.join(outputDir, 'production-pack.json'),
  `${JSON.stringify(
    {
      boss: 'ignivar',
      processingPreset: IGNIVAR_PRODUCTION_VOICE_PRESET,
      sources: {
        signature: path.relative(root, signatureSource),
        extension: path.relative(root, extensionSource),
      },
      published: publish,
      lines: staged.map(({ line, file }) => ({
        key: line.key,
        text: line.text,
        start: line.start,
        end: line.end,
        file: path.relative(root, file),
      })),
    },
    null,
    2,
  )}\n`,
);

console.log(`Ignivar production pack: ${path.relative(root, clipsDir)}`);
console.log(
  publish
    ? `Published ${staged.length} clips to ${path.relative(root, publicDir)}`
    : 'Not published',
);
