// Cut Ignivar's real encounter yells directly from an approved long-form master.
// Forced alignment supplies exact word bounds; FFmpeg only trims and adds tiny
// edge fades, preserving the chosen performance and processing.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { IGNIVAR_VOICE_PACK_LINES } from './voices/ignivar_voice_pack.mjs';
import { RAID_BOSS_VOICE_PROMPTS } from './voices/raid_boss_voice_prompts.mjs';
import {
  phraseClipBounds,
  shouldUseScribeFallback,
  validateWordAlignment,
} from './voices/voice_clip_extraction.mjs';

const API = 'https://api.elevenlabs.io';
const root = process.cwd();
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
const alignmentArg = optionValue('--alignment');
const allowedArgs = new Set([
  '--input',
  '--output-dir',
  '--alignment',
  inputArg,
  outputArg,
  alignmentArg,
]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
if (!inputArg || !outputArg) throw new Error('--input and --output-dir are required');

const input = path.resolve(inputArg);
const outputDir = path.resolve(outputArg);
const clipsDir = path.join(outputDir, 'clips');
const alignmentPath = path.resolve(alignmentArg ?? path.join(outputDir, 'alignment.json'));
if (!existsSync(input)) throw new Error(`Input does not exist: ${input}`);
if (path.extname(input).toLowerCase() !== '.mp3') throw new Error('Input must be an MP3 master');

const prompt = RAID_BOSS_VOICE_PROMPTS.find(
  ({ npcId, takeId }) => npcId === 'ignivar' && takeId === 'forge-heavy-automaton',
);
if (!prompt) throw new Error('Missing the selected Ignivar voice prompt');

const outputs = IGNIVAR_VOICE_PACK_LINES.map((line) => ({
  line,
  output: path.join(clipsDir, `${line.key}.mp3`),
}));
const existing = outputs.find(({ output }) => existsSync(output));
if (existing) throw new Error(`Output already exists: ${existing.output}`);
mkdirSync(outputDir, { recursive: true });
mkdirSync(clipsDir, { recursive: true });

function audioForm() {
  const form = new FormData();
  form.append(
    'file',
    new Blob([readFileSync(input)], { type: 'audio/mpeg' }),
    path.basename(input),
  );
  return form;
}

async function alignMaster() {
  try {
    process.loadEnvFile();
  } catch {
    // A repository-local .env is optional. Ambient environment variables also work.
  }
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const form = audioForm();
  form.append('text', prompt.previewText);
  const response = await fetch(`${API}/v1/forced-alignment`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  let alignment;
  if (response.ok) {
    alignment = await response.json();
  } else {
    const detail = await response.text().catch(() => '');
    if (!shouldUseScribeFallback(response.status, detail)) {
      throw new Error(`Forced alignment returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    console.log('forced alignment permission unavailable, using Scribe word timestamps');
    const transcriptionForm = audioForm();
    transcriptionForm.append('model_id', 'scribe_v2');
    transcriptionForm.append('language_code', 'eng');
    transcriptionForm.append('tag_audio_events', 'false');
    transcriptionForm.append('num_speakers', '1');
    transcriptionForm.append('timestamps_granularity', 'word');
    const transcription = await fetch(`${API}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: transcriptionForm,
    });
    if (!transcription.ok) {
      const transcriptionDetail = await transcription.text().catch(() => '');
      throw new Error(
        `Speech transcription returned ${transcription.status}: ${transcriptionDetail.slice(0, 300)}`,
      );
    }
    alignment = await transcription.json();
  }
  validateWordAlignment(alignment, 'Forced alignment');
  writeFileSync(alignmentPath, `${JSON.stringify(alignment, null, 2)}\n`);
  return alignment;
}

const alignment = existsSync(alignmentPath)
  ? JSON.parse(readFileSync(alignmentPath, 'utf8'))
  : await alignMaster();
const receiptLines = [];

for (const { line, output } of outputs) {
  const bounds = phraseClipBounds(alignment.words, line.text, {
    aliases: { ignivar: ['ignavar'], varkhul: ['varkol'] },
  });
  const duration = bounds.end - bounds.start;
  const fadeOutStart = Math.max(0, duration - 0.025);
  const filter =
    `atrim=start=${bounds.start}:end=${bounds.end},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=0.015,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.025`;
  const result = spawnSync(
    FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-n',
      '-i',
      input,
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
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
  receiptLines.push({ key: line.key, text: line.text, ...bounds });
  console.log(`cut ${line.key} at ${bounds.start}s to ${bounds.end}s`);
}

writeFileSync(
  path.join(outputDir, 'cuts.json'),
  `${JSON.stringify(
    {
      boss: 'ignivar',
      master: path.relative(root, input),
      alignmentLoss: alignment.loss,
      lines: receiptLines,
    },
    null,
    2,
  )}\n`,
);
console.log(`master cuts ${path.relative(root, clipsDir)}`);
