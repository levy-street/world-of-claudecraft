// Generate sampled SFX through the ElevenLabs Sound Effects API, then pass each
// successful response through the same fixed conform path used by local sources.
//
//   ELEVENLABS_API_KEY=... node scripts/gen_sfx.mjs [--force]
//   node scripts/gen_sfx.mjs --manifest

// Existing files are skipped unless --force. Custom recordings and deterministic
// UI cues are never replaced by paid generation, including during a force run.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { conformSfxAudio } from './sfx/conform_audio.mjs';
import { buildSfxGenerationPlan } from './sfx/generation_plan.mjs';
import { writeSfxManifest } from './sfx/manifest.mjs';
import { SFX } from './sfx/sfx_prompts.mjs';

const API = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';
const PROMPT_INFLUENCE = 0.4;
const root = process.cwd();
const sfxDirectory = path.join(root, 'public/audio/sfx');
const force = process.argv.includes('--force');
const manifestOnly = process.argv.includes('--manifest');

try {
  process.loadEnvFile();
} catch {
  /* no local env file, rely on the ambient environment */
}
const apiKey = process.env.ELEVENLABS_API_KEY;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function generate(entry, { retries = 4 } = {}) {
  const body = {
    text: entry.prompt,
    duration_seconds: entry.duration,
    prompt_influence: PROMPT_INFLUENCE,
    output_format: OUTPUT_FORMAT,
  };
  if (entry.loop) body.loop = true;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}/v1/sound-generation`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const detail = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      const wait = 1500 * (attempt + 1);
      console.warn(`  ${entry.key} -> ${response.status}; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${entry.key} -> ${response.status} ${detail.slice(0, 200)}`);
  }
}

if (manifestOnly) {
  const manifest = writeSfxManifest(root);
  console.log(
    `Manifest rebuilt: ${path.relative(root, manifest.path)} and ${path.relative(root, manifest.runtimePath)} (${Object.keys(manifest.entries).length} keys).`,
  );
  process.exit(0);
}

mkdirSync(sfxDirectory, { recursive: true });
const generationPlan = buildSfxGenerationPlan(SFX);
const pendingTracks = generationPlan.flatMap(({ tracks }) =>
  tracks.filter((track) => {
    if (track.generator === 'ffmpeg' || track.custom) return false;
    return force || !existsSync(path.join(sfxDirectory, track.filename));
  }),
);
if (pendingTracks.length > 0 && !apiKey) {
  console.error('ELEVENLABS_API_KEY is not set (env or .env). Aborting.');
  process.exit(1);
}

let ffmpegPath = null;
if (pendingTracks.length > 0) {
  ffmpegPath = (await import('ffmpeg-static')).default;
  if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an FFmpeg binary');
}

let made = 0;
let skipped = 0;
let seconds = 0;
const failed = [];

for (const { entry, tracks } of generationPlan) {
  for (const track of tracks) {
    if (track.generator === 'ffmpeg' || track.custom) {
      skipped++;
      continue;
    }
    const destination = path.join(sfxDirectory, track.filename);
    if (existsSync(destination) && !force) {
      skipped++;
      continue;
    }

    const label = track.trackId === 'main' ? entry.key : `${entry.key}:${track.trackId}`;
    const raw = path.join(sfxDirectory, `.${entry.key}.${process.pid}.source.mp3`);
    process.stdout.write(`sfx  ${label} (${track.duration}s${track.loop ? ', loop' : ''})... `);
    rmSync(raw, { force: true });
    try {
      const bytes = await generate({ ...track, key: label });
      writeFileSync(raw, bytes, { flag: 'wx' });
      conformSfxAudio({
        inputFile: raw,
        outputFile: destination,
        duration: track.duration,
        ffmpegPath,
      });
      seconds += track.duration;
      made++;
      console.log('ok');
      await sleep(200);
    } catch (error) {
      console.log('FAILED');
      console.error(`  ${error.message ?? error}`);
      failed.push(label);
      process.exitCode = 1;
    } finally {
      rmSync(raw, { force: true });
    }
  }
}

const manifest = writeSfxManifest(root);
console.log(
  `\nDone: ${made} generated, ${skipped} skipped, ${Object.keys(manifest.entries).length}/${SFX.length} catalog clips on disk.`,
);
console.log(
  `Billed about ${seconds.toFixed(1)} seconds of audio this run. Manifest: ${path.relative(root, manifest.path)}`,
);
if (failed.length > 0) console.log(`Failed (${failed.length}): ${failed.join(', ')}`);
