// Render, treat and publish the Smith's Heart's voice pack: every line the
// raid's speakers say (src/sim/encounters/smith_heart/voice_lines.ts), in its
// finalized voice (scripts/voices/voice_ids.json, chosen from the auditions
// of scripts/audition_raid_boss_voices.mjs --set heart and finalized by
// scripts/finalize_raid_boss_voice.mjs), synthesized with its performance
// direction (scripts/voices/smith_heart_voice_pack.mjs) and processed through
// its elemental treatment (raid_boss_voice_processing.mjs). The Ignivar way:
// raw takes and treated clips stay under tmp until published.
//
//   node scripts/render_smith_heart_voice_pack.mjs [--only <id part>] [--force]
//        [--review <dir>] [--publish]
//
// --only     render only lines whose pack id contains the text
// --force    synthesize the selected lines again (a new take)
// --review   copy every treated clip to <dir>/<voice>/<NN>_<moment>.mp3
// --publish  copy every treated clip to public/audio/voice/<voice>/<key>.mp3
//            (with --only, the selected lines only) and drop a fully
//            published raid voice's clips no line uses any more; then run
//            node scripts/gen_npc_lines.mjs --only <no line> to rebuild the
//            voice manifest from disk.
//
// The ElevenLabs key is read from the environment or the local .env.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';
import {
  buildSmithHeartVoiceFilter,
  SMITH_HEART_CLEAN_VOICE_FILTER,
} from './voices/raid_boss_voice_processing.mjs';
import {
  packLine,
  reviewName,
  SMITH_HEART_SPEAKERS,
  SMITH_HEART_TTS_MODEL,
} from './voices/smith_heart_voice_pack.mjs';

const API = 'https://api.elevenlabs.io';
/** The pack's level (a touch over the raid's -14 LUFS score as played), the
 *  most a trim lifts a clip, and the limiter's ceiling (linear, about -1.5
 *  dBFS) that keeps a lifted roar's peaks clean. */
const SMITH_HEART_TARGET_LUFS = -15;
const SMITH_HEART_MAX_TRIM_DB = 8;
const SMITH_HEART_PEAK_LIMIT = 0.84;
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

const only = optionValue('--only');
const review = optionValue('--review');
const force = args.includes('--force');
const publish = args.includes('--publish');
const allowed = new Set(['--only', '--review', '--force', '--publish', only, review]);
const unknown = args.find((arg) => !allowed.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

async function loadLines() {
  const build = await esbuild.build({
    stdin: {
      contents:
        "export { SMITH_HEART_VOICE_LINES } from './src/sim/encounters/smith_heart/voice_lines.ts';",
      resolveDir: root,
      sourcefile: 'smith-heart-voice-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const url = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  return (await import(url)).SMITH_HEART_VOICE_LINES;
}

const lines = (await loadLines()).map(packLine);
const ids = JSON.parse(readFileSync(path.join(root, 'scripts/voices/voice_ids.json'), 'utf8'));
const workDir = path.join(root, 'tmp', 'smith-heart-voice-pack');
const rawDir = path.join(workDir, 'raw');
const processedDir = path.join(workDir, 'processed');

try {
  process.loadEnvFile();
} catch {
  // A repository-local .env is optional. Ambient environment variables also work.
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
const apiKey = process.env.ELEVENLABS_API_KEY;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function synthesize(voiceId, text, { retries = 4 } = {}) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: SMITH_HEART_TTS_MODEL }),
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const detail = await response.text().catch(() => '');
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`Voice synthesis returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

function ffmpeg(args) {
  const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `FFmpeg exited with status ${result.status}`);
  }
  return result.stderr;
}

/** A treated clip's integrated loudness (LUFS) and true peak (dBFS). */
function measure(file) {
  const log = ffmpeg(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = Number([...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const peak = Number([...log.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1]);
  return { lufs, peak };
}

/** Treat a raw take, then trim it onto the pack's level: a one-pass loudnorm
 *  lands a short bark low, so the treated clip is measured, its gain set to
 *  SMITH_HEART_TARGET_LUFS and its peaks held under SMITH_HEART_PEAK_LIMIT. */
function treat(input, output, preset) {
  const filter = preset ? buildSmithHeartVoiceFilter(preset) : SMITH_HEART_CLEAN_VOICE_FILTER;
  const wav = `${output}.wav`;
  ffmpeg([
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-filter_complex',
    // The clean chain names its output too.
    preset ? filter : `[0:a]${filter}`,
    '-map',
    '[out]',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-c:a',
    'pcm_f32le',
    wav,
  ]);
  const { lufs } = measure(wav);
  const gain = Math.min(SMITH_HEART_MAX_TRIM_DB, SMITH_HEART_TARGET_LUFS - lufs);
  ffmpeg([
    '-loglevel',
    'error',
    '-y',
    '-i',
    wav,
    '-af',
    `volume=${gain.toFixed(2)}dB,alimiter=limit=${SMITH_HEART_PEAK_LIMIT}:attack=4:release=60:level=disabled`,
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
  rmSync(wav);
}

let billed = 0;
const selected = lines.filter((line) => !only || line.id.includes(only));
for (const line of selected) {
  const voiceId = ids[line.voiceNpc];
  if (!voiceId) throw new Error(`No finalized voice for ${line.voiceNpc}`);
  const raw = path.join(rawDir, line.voiceNpc, `${line.key}.mp3`);
  const processed = path.join(processedDir, line.voiceNpc, `${line.key}.mp3`);
  mkdirSync(path.dirname(raw), { recursive: true });
  mkdirSync(path.dirname(processed), { recursive: true });
  if (force || !existsSync(raw)) {
    console.log(`synthesize ${line.id}`);
    writeFileSync(raw, await synthesize(voiceId, line.synthesisText));
    billed += line.synthesisText.length;
    await sleep(200);
  }
  treat(raw, processed, line.preset);
}

if (review) {
  const counters = {};
  for (const line of lines) {
    const processed = path.join(processedDir, line.voiceNpc, `${line.key}.mp3`);
    if (!existsSync(processed)) continue;
    counters[line.voiceNpc] = (counters[line.voiceNpc] ?? 0) + 1;
    const dir = path.join(path.resolve(review), line.voiceNpc);
    mkdirSync(dir, { recursive: true });
    const n = String(counters[line.voiceNpc]).padStart(2, '0');
    copyFileSync(processed, path.join(dir, `${n}_${reviewName(line)}`));
  }
}

if (publish) {
  // With --only, only the selected lines are published (a voice recast on
  // its own leaves the others' shipped clips as they are).
  const keep = new Map();
  for (const line of selected) {
    const processed = path.join(processedDir, line.voiceNpc, `${line.key}.mp3`);
    if (!existsSync(processed)) throw new Error(`Unrendered line: ${line.id}`);
    const dir = path.join(root, 'public', 'audio', 'voice', line.voiceNpc);
    mkdirSync(dir, { recursive: true });
    copyFileSync(processed, path.join(dir, `${line.key}.mp3`));
    if (!keep.has(line.voiceNpc)) keep.set(line.voiceNpc, new Set());
    keep.get(line.voiceNpc).add(`${line.key}.mp3`);
  }
  // A raid voice's folder holds its pack only (Thessaly's holds her other
  // lines too, so hers is never swept).
  for (const [voiceNpc, files] of keep) {
    // Swept only when every line of the voice was published now.
    if (lines.some((l) => l.voiceNpc === voiceNpc && !files.has(`${l.key}.mp3`))) continue;
    const speaker = SMITH_HEART_SPEAKERS[voiceNpc];
    if (!speaker?.audition && !speaker?.designed) continue;
    const dir = path.join(root, 'public', 'audio', 'voice', voiceNpc);
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.mp3') && !files.has(file)) rmSync(path.join(dir, file));
    }
  }
}

console.log(
  `${selected.length} lines rendered, ${billed} characters billed` +
    (publish ? `, ${selected.length} clips published` : ''),
);
