// Generate every sound effect via the ElevenLabs Sound Effects API
// (POST /v1/sound-generation) from the catalog in scripts/sfx/sfx_prompts.mjs.
//
//   ELEVENLABS_API_KEY=… node scripts/gen_sfx.mjs [--force]
//   node scripts/gen_sfx.mjs --conform-existing
//
// Output:
//   public/audio/sfx/<key>.mp3            the audio (served at /audio/sfx/…)
//   src/game/sfx_manifest.generated.ts    key -> public path + loop flag
//
// Idempotent: existing files are skipped unless --force. Offline-only; the key is
// read from the environment / local .env and never committed. Generated and
// conformed files are post-processed through ffmpeg so the asset library stays on
// the documented format/loudness/channel standard.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { SFX } from './sfx/sfx_prompts.mjs';
import { channelLabel, channelsForEntry, SFX_STANDARD } from './sfx/sfx_asset_standard.mjs';
import { postProcessSfxFile } from './sfx/sfx_ffmpeg.mjs';

const API = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';
const PROMPT_INFLUENCE = 0.4; // adhere to the prompt but allow some character
const root = process.cwd();
const sfxDir = path.join(root, 'public/audio/sfx');
const manifestPath = path.join(root, 'src/game/sfx_manifest.generated.ts');

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const conformExisting = args.has('--conform-existing');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log([
    'Usage:',
    '  ELEVENLABS_API_KEY=… node scripts/gen_sfx.mjs [--force]',
    '  node scripts/gen_sfx.mjs --conform-existing',
    '',
    'Options:',
    '  --force             Regenerate clips that already exist.',
    '  --conform-existing  Reprocess existing public/audio/sfx clips through ffmpeg',
    '                      without calling ElevenLabs. Missing clips are generated',
    '                      only when ELEVENLABS_API_KEY is available.',
  ].join('\n'));
  process.exit(0);
}

try {
  process.loadEnvFile();
} catch {
  /* no .env, rely on the ambient env */
}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY && !conformExisting) {
  console.error('ELEVENLABS_API_KEY is not set (env or .env). Aborting.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(entry, { retries = 4 } = {}) {
  const body = {
    text: entry.prompt,
    duration_seconds: entry.duration,
    prompt_influence: PROMPT_INFLUENCE,
    output_format: OUTPUT_FORMAT,
  };
  if (entry.loop) body.loop = true;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/v1/sound-generation`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const wait = 1500 * (attempt + 1);
      console.warn(`  ${entry.key} -> ${res.status}; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${entry.key} -> ${res.status} ${detail.slice(0, 200)}`);
  }
}

async function postProcess(entry, inputPath, dest) {
  const channels = channelsForEntry(entry);
  return postProcessSfxFile(inputPath, dest, {
    channels,
    sampleRateHz: SFX_STANDARD.sampleRateHz,
    bitrateKbps: SFX_STANDARD.generatedBitrateKbps,
    peakDbfs: SFX_STANDARD.peakDbfs,
  });
}

mkdirSync(sfxDir, { recursive: true });
let made = 0;
let conformed = 0;
let skipped = 0;
let seconds = 0;
const failed = [];

for (const entry of SFX) {
  const dest = path.join(sfxDir, `${entry.key}.mp3`);
  const channels = channelsForEntry(entry);
  const detail = `${entry.duration}s${entry.loop ? ', loop' : ''}, ${channelLabel(channels)}`;

  if (existsSync(dest) && conformExisting && !force) {
    process.stdout.write(`sfx  ${entry.key} (${detail}) conform… `);
    try {
      await postProcess(entry, dest, dest);
      conformed++;
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${err.message}`);
      failed.push(entry.key);
      process.exitCode = 1;
    }
    continue;
  }

  if (entry.custom) { skipped++; continue; }
  if (existsSync(dest) && !force) { skipped++; continue; }
  if (!KEY) { skipped++; continue; }

  process.stdout.write(`sfx  ${entry.key} (${detail})… `);
  const rawPath = path.join(sfxDir, `.${entry.key}.${process.pid}.${Date.now()}.raw.mp3`);
  try {
    const mp3 = await generate(entry);
    writeFileSync(rawPath, mp3);
    await postProcess(entry, rawPath, dest);
    seconds += entry.duration;
    made++;
    console.log('ok');
    await sleep(200);
  } catch (err) {
    // One bad clip shouldn't abort the whole run: record it and continue.
    console.log('FAILED');
    console.error(`  ${err.message}`);
    failed.push(entry.key);
    process.exitCode = 1;
  } finally {
    await rm(rawPath, { force: true });
  }
}

// Rebuild the manifest from whatever exists on disk so runtime never points at a
// missing clip after a partial run. Includes the loop flag so the engine knows
// which clips are seamless loops.
const entries = {};
for (const entry of SFX) {
  if (existsSync(path.join(sfxDir, `${entry.key}.mp3`))) {
    entries[entry.key] = { url: `/audio/sfx/${entry.key}.mp3`, loop: !!entry.loop };
  }
}
const sorted = Object.fromEntries(
  Object.keys(entries)
    .sort()
    .map((k) => [k, entries[k]]),
);
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(
  manifestPath,
  [
    '// Generated by scripts/gen_sfx.mjs. Do not edit by hand.',
    '// Maps a sound-effect key to its public audio path and loop flag.',
    'export interface SfxEntry { url: string; loop: boolean }',
    'export const SFX_CLIPS: Record<string, SfxEntry> =',
    `${JSON.stringify(sorted, null, 2)} as const;`,
    '',
  ].join('\n'),
);

console.log(
  `\nDone: ${made} generated, ${conformed} conformed, ${skipped} skipped, ${Object.keys(sorted).length}/${SFX.length} clips on disk.`,
);
console.log(`Billed ~${seconds.toFixed(1)} seconds of audio this run. Manifest: ${path.relative(root, manifestPath)}`);
if (failed.length) console.log(`Failed (${failed.length}): ${failed.join(', ')}`);
