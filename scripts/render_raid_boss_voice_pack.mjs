// Render and post-process Ignivar's current encounter yells from an approved,
// finalized audition voice. Raw TTS and processed clips remain under tmp until
// the pack receives a final human review.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { IGNIVAR_VOICE_PACK_LINES } from './voices/ignivar_voice_pack.mjs';
import { buildRaidBossVoiceFilter } from './voices/raid_boss_voice_processing.mjs';

const API = 'https://api.elevenlabs.io';
const TTS_MODEL = 'eleven_v3';
const OUTPUT_FORMAT = 'mp3_44100_192';
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
const allowedArgs = new Set(['--receipt', '--output-dir', receiptArg, outputArg]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
if (!receiptArg) throw new Error('--receipt is required');

const receiptPath = path.resolve(receiptArg);
if (!existsSync(receiptPath)) throw new Error(`Receipt does not exist: ${receiptPath}`);
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
if (receipt.boss !== 'ignivar' || !receipt.voiceId) {
  throw new Error('Receipt does not contain a finalized Ignivar voice');
}

const outputDir = path.resolve(outputArg ?? path.join(path.dirname(receiptPath), 'voice-pack'));
const rawDir = path.join(outputDir, 'raw');
const processedDir = path.join(outputDir, 'processed');
mkdirSync(rawDir, { recursive: true });
mkdirSync(processedDir, { recursive: true });

try {
  process.loadEnvFile();
} catch {
  // A repository-local .env is optional. Ambient environment variables also work.
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
const apiKey = process.env.ELEVENLABS_API_KEY;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function synthesize(text, { retries = 4 } = {}) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(
        `${API}/v1/text-to-speech/${receipt.voiceId}?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ text, model_id: TTS_MODEL }),
        },
      );
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const detail = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`Voice synthesis returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

function processLine(input, output, preset) {
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
      '-filter_complex',
      buildRaidBossVoiceFilter(preset),
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
}

let billedCharacters = 0;
for (const line of IGNIVAR_VOICE_PACK_LINES) {
  const rawPath = path.join(rawDir, `${line.key}.mp3`);
  const processedPath = path.join(processedDir, `${line.key}.mp3`);
  if (!existsSync(rawPath)) {
    console.log(`synthesize ${line.key}`);
    writeFileSync(rawPath, await synthesize(line.synthesisText));
    billedCharacters += line.synthesisText.length;
    await sleep(250);
  }
  if (!existsSync(processedPath)) {
    console.log(`process ${line.key} as ${line.processingPreset}`);
    processLine(rawPath, processedPath, line.processingPreset);
  }
}

writeFileSync(
  path.join(outputDir, 'pack.json'),
  `${JSON.stringify(
    {
      boss: 'ignivar',
      model: TTS_MODEL,
      sourceTake: receipt.take,
      sourceCandidate: receipt.candidate,
      lines: IGNIVAR_VOICE_PACK_LINES,
    },
    null,
    2,
  )}\n`,
);
console.log(`voice pack ${path.relative(root, outputDir)}`);
console.log(`billed ${billedCharacters} characters`);
