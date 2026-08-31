// Render Ignivar's approved first-entry line with the finalized ElevenLabs
// voice, apply its definitive post-processing, and optionally publish the exact
// runtime-keyed clip. Cached raw generations are never billed twice.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import { buildIgnivarRoboticVoiceFilter } from './voices/ignivar_robotic_voice_processing.mjs';
import {
  decodeRaidBossRoomWelcomeSynthesis,
  RAID_BOSS_ROOM_WELCOME_VOICE_LINES,
} from './voices/raid_boss_room_welcome_voice_pack.mjs';
import { phraseCharacterClipBounds } from './voices/voice_clip_extraction.mjs';

const API = 'https://api.elevenlabs.io';
const MODEL = 'eleven_v3';
const OUTPUT_FORMAT = 'mp3_44100_192';
const root = process.cwd();
const publish = process.argv.includes('--publish');
const force = process.argv.includes('--force');
const allowedArgs = new Set(['--publish', '--force']);
const unknown = process.argv.slice(2).find((argument) => !allowedArgs.has(argument));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const voiceIds = JSON.parse(
  readFileSync(path.join(root, 'scripts', 'voices', 'voice_ids.json'), 'utf8'),
);
const outputRoot = path.join(root, 'tmp', 'raid-boss-voice-auditions', 'room-welcomes');

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

async function synthesize(line, voiceId, rawPath, alignmentPath) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  const response = await fetch(
    `${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: line.synthesisText, model_id: MODEL }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${line.npcId} synthesis returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const generated = await response.json();
  const { audio, alignment } = decodeRaidBossRoomWelcomeSynthesis(generated, line.npcId);
  writeFileSync(rawPath, audio);
  writeFileSync(alignmentPath, `${JSON.stringify(alignment, null, 2)}\n`);
  return alignment;
}

const rendered = [];
for (const line of RAID_BOSS_ROOM_WELCOME_VOICE_LINES) {
  const voiceId = voiceIds[line.npcId];
  if (!voiceId) throw new Error(`No finalized voice id for ${line.npcId}`);
  const bossDir = path.join(outputRoot, line.npcId);
  const rawPath = path.join(bossDir, 'room-entry-raw.mp3');
  const alignmentPath = path.join(bossDir, 'room-entry-alignment.json');
  const processedPath = path.join(bossDir, 'room-entry-processed-master.mp3');
  const clipPath = path.join(bossDir, `${line.key}.mp3`);
  mkdirSync(bossDir, { recursive: true });

  const hasRaw = existsSync(rawPath);
  const hasAlignment = existsSync(alignmentPath);
  if (hasRaw !== hasAlignment) {
    throw new Error(`${line.npcId} cached raw audio and alignment are incomplete`);
  }
  const alignment = hasRaw
    ? JSON.parse(readFileSync(alignmentPath, 'utf8'))
    : await synthesize(line, voiceId, rawPath, alignmentPath);
  if (!existsSync(processedPath) || force) {
    runFfmpeg([
      '-i',
      rawPath,
      '-filter_complex',
      buildIgnivarRoboticVoiceFilter(line.processingPreset),
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

  const bounds = phraseCharacterClipBounds(alignment, line.text);
  if (!existsSync(clipPath) || force) {
    const duration = bounds.end - bounds.start;
    const fadeOutStart = Math.max(0, duration - 0.025);
    runFfmpeg([
      '-i',
      processedPath,
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
      clipPath,
    ]);
  }

  if (publish) {
    const publicDir = path.join(root, 'public', 'audio', 'voice', line.npcId);
    mkdirSync(publicDir, { recursive: true });
    copyFileSync(clipPath, path.join(publicDir, `${line.key}.mp3`));
  }
  rendered.push({
    npcId: line.npcId,
    key: line.key,
    text: line.text,
    model: MODEL,
    processingPreset: line.processingPreset,
    voiceId,
    billedCharacters: hasRaw ? 0 : line.synthesisText.length,
    start: bounds.start,
    end: bounds.end,
    file: path.relative(root, clipPath),
  });
  console.log(`ready ${line.npcId} ${line.key}`);
}

mkdirSync(outputRoot, { recursive: true });
writeFileSync(
  path.join(outputRoot, 'production-pack.json'),
  `${JSON.stringify({ published: publish, lines: rendered }, null, 2)}\n`,
);
console.log(publish ? `Published ${rendered.length} room welcomes` : 'Not published');
