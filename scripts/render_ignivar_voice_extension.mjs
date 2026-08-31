// Render one continuous Ignivar performance with the approved finalized voice,
// apply the approved ancient-herald processing once, then cut the new barks by
// ElevenLabs character timestamps. Outputs remain under tmp pending human review.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  decodeIgnivarVoiceExtensionSynthesis,
  IGNIVAR_VOICE_EXTENSION_LINES,
  ignivarVoiceExtensionMasterText,
  resolveIgnivarVoiceExtensionModel,
  validateFinalizedIgnivarVoiceReceipt,
  validateIgnivarVoiceExtensionCache,
} from './voices/ignivar_voice_extension.mjs';
import { buildRaidBossVoiceFilter } from './voices/raid_boss_voice_processing.mjs';
import { phraseCharacterClipBounds } from './voices/voice_clip_extraction.mjs';

const API = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_192';
const PROCESSING_PRESET = 'ancient-herald';
const root = process.cwd();
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const receiptArg = optionValue('--receipt');
const outputArg = optionValue('--output-dir');
const modelArg = optionValue('--model');
const allowedArgs = new Set([
  '--receipt',
  '--output-dir',
  '--model',
  receiptArg,
  outputArg,
  modelArg,
]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
if (!receiptArg || !outputArg) throw new Error('--receipt and --output-dir are required');
const ttsModel = resolveIgnivarVoiceExtensionModel(modelArg);
const masterText = ignivarVoiceExtensionMasterText(ttsModel);

const receiptPath = path.resolve(receiptArg);
const outputDir = path.resolve(outputArg);
const rawPath = path.join(outputDir, 'ignivar-extension-master-raw.mp3');
const alignmentPath = path.join(outputDir, 'alignment.json');
const processedPath = path.join(outputDir, 'ignivar-extension-ancient-herald.mp3');
const clipsDir = path.join(outputDir, 'review');
if (!existsSync(receiptPath)) throw new Error(`Receipt does not exist: ${receiptPath}`);
const receipt = validateFinalizedIgnivarVoiceReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')));
mkdirSync(outputDir, { recursive: true });
mkdirSync(clipsDir, { recursive: true });

function runFfmpeg(arguments_) {
  const result = spawnSync(
    FFMPEG_PATH,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...arguments_],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
}

async function synthesizeMaster() {
  try {
    process.loadEnvFile();
  } catch {
    // A repository-local .env is optional. Ambient environment variables also work.
  }
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const response = await fetch(
    `${API}/v1/text-to-speech/${receipt.voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: masterText, model_id: ttsModel }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Voice synthesis returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const generated = await response.json();
  const { audio, alignment } = decodeIgnivarVoiceExtensionSynthesis(generated);
  writeFileSync(rawPath, audio);
  writeFileSync(alignmentPath, `${JSON.stringify(alignment, null, 2)}\n`);
  return alignment;
}

const hasRaw = existsSync(rawPath);
const hasAlignment = existsSync(alignmentPath);
validateIgnivarVoiceExtensionCache(hasRaw, hasAlignment);
const alignment = hasRaw
  ? JSON.parse(readFileSync(alignmentPath, 'utf8'))
  : await synthesizeMaster();

if (!existsSync(processedPath)) {
  runFfmpeg([
    '-i',
    rawPath,
    '-filter_complex',
    buildRaidBossVoiceFilter(PROCESSING_PRESET),
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
    processedPath,
  ]);
}

const renderedLines = [];
for (const line of IGNIVAR_VOICE_EXTENSION_LINES) {
  const bounds = phraseCharacterClipBounds(alignment, line.text);
  const output = path.join(clipsDir, `${line.outputName}.mp3`);
  if (!existsSync(output)) {
    const duration = bounds.end - bounds.start;
    const fadeOutStart = Math.max(0, duration - 0.025);
    const filter =
      `atrim=start=${bounds.start}:end=${bounds.end},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=0.015,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.025`;
    runFfmpeg([
      '-i',
      processedPath,
      '-af',
      filter,
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
  renderedLines.push({ ...line, ...bounds, file: path.relative(root, output) });
  console.log(`ready ${line.outputName}`);
}

writeFileSync(
  path.join(outputDir, 'extension.json'),
  `${JSON.stringify(
    {
      boss: 'ignivar',
      voiceName: receipt.voiceName,
      sourceTake: receipt.take,
      sourceCandidate: receipt.candidate,
      model: ttsModel,
      processingPreset: PROCESSING_PRESET,
      masterText,
      lines: renderedLines,
    },
    null,
    2,
  )}\n`,
);
console.log(`extension ${path.relative(root, clipsDir)}`);
console.log(`billed ${hasRaw ? 0 : masterText.length} characters`);
