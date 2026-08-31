// Cut Varkhul's approved encounter lines from the selected Obsidian Stone-Forge
// master. Alignment is measured against the clean Voice Design preview, while
// the cuts come from the exact processed performance approved in review.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { RAID_BOSS_VOICE_PROMPTS } from './voices/raid_boss_voice_prompts.mjs';
import {
  VARKHUL_FINALISTS,
  VARKHUL_PRODUCTION_TREATMENT,
} from './voices/varkhul_voice_finalists.mjs';
import {
  normalizeVarkhulAlignmentWords,
  shouldUseVarkhulScribeFallback,
  VARKHUL_VOICE_PACK_LINES,
  validateVarkhulAlignment,
} from './voices/varkhul_voice_pack.mjs';
import { phraseClipBounds } from './voices/voice_clip_extraction.mjs';

const API = 'https://api.elevenlabs.io';
const root = process.cwd();
const publish = process.argv.includes('--publish');
const force = process.argv.includes('--force');
const unknown = process.argv
  .slice(2)
  .find((argument) => argument !== '--publish' && argument !== '--force');
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const takeId = 'obsidian-forge-idol';
const candidate = 2;
const auditionRoot = path.join(root, 'tmp', 'raid-boss-voice-auditions', 'varkhul');
const takeDir = path.join(auditionRoot, takeId);
const rawSource = path.join(takeDir, `candidate-${candidate}.mp3`);
const selected = VARKHUL_FINALISTS[0];
if (selected?.id !== 'obsidian-forge-idol-candidate-2') {
  throw new Error('The approved Varkhul finalist selection has changed');
}
const processedMaster = path.join(
  auditionRoot,
  'finalists-review',
  selected.source.replace('.mp3', `-${VARKHUL_PRODUCTION_TREATMENT}.mp3`),
);
const outputDir = path.join(takeDir, `production-${VARKHUL_PRODUCTION_TREATMENT}`);
const alignmentPath = path.join(outputDir, 'alignment.json');
const clipsDir = path.join(outputDir, 'clips');
const publicDir = path.join(root, 'public', 'audio', 'voice', 'varkhul');

for (const required of [rawSource, processedMaster]) {
  if (!existsSync(required)) throw new Error(`Missing Varkhul production input: ${required}`);
}

const prompt = RAID_BOSS_VOICE_PROMPTS.find(
  (entry) => entry.npcId === 'varkhul' && entry.takeId === takeId,
);
if (!prompt) throw new Error(`Missing Varkhul voice prompt: ${takeId}`);
mkdirSync(outputDir, { recursive: true });
mkdirSync(clipsDir, { recursive: true });

function audioForm() {
  const form = new FormData();
  form.append(
    'file',
    new Blob([readFileSync(rawSource)], { type: 'audio/mpeg' }),
    path.basename(rawSource),
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
    if (!shouldUseVarkhulScribeFallback(response.status, detail)) {
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
  validateVarkhulAlignment(alignment);
  writeFileSync(alignmentPath, `${JSON.stringify(alignment, null, 2)}\n`);
  return alignment;
}

function cutLine(line, bounds, output) {
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
      force ? '-y' : '-n',
      '-i',
      processedMaster,
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
  console.log(`cut ${line.key} at ${bounds.start}s to ${bounds.end}s`);
}

const alignment = existsSync(alignmentPath)
  ? JSON.parse(readFileSync(alignmentPath, 'utf8'))
  : await alignMaster();
const alignedWords = normalizeVarkhulAlignmentWords(alignment.words);
const rendered = [];
for (const line of VARKHUL_VOICE_PACK_LINES) {
  const bounds = phraseClipBounds(alignedWords, line.text, {
    aliases: { varkhul: ['varkol', 'varkul', 'varkel'] },
  });
  const output = path.join(clipsDir, `${line.key}.mp3`);
  if (!existsSync(output) || force) cutLine(line, bounds, output);
  rendered.push({ ...line, ...bounds, file: path.relative(root, output) });
}

if (publish) {
  mkdirSync(publicDir, { recursive: true });
  for (const line of rendered) {
    copyFileSync(path.resolve(line.file), path.join(publicDir, `${line.key}.mp3`));
  }
}

writeFileSync(
  path.join(outputDir, 'production-pack.json'),
  `${JSON.stringify(
    {
      boss: 'varkhul',
      sourceTake: takeId,
      sourceCandidate: candidate,
      processingPreset: VARKHUL_PRODUCTION_TREATMENT,
      rawSource: path.relative(root, rawSource),
      processedMaster: path.relative(root, processedMaster),
      published: publish,
      lines: rendered,
    },
    null,
    2,
  )}\n`,
);
console.log(`Varkhul production pack: ${path.relative(root, clipsDir)}`);
console.log(publish ? `Published ${rendered.length} clips` : 'Not published');
