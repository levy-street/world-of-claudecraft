// Generate every sound effect via the ElevenLabs Sound Effects API
// (POST /v1/sound-generation) from the catalog in scripts/sfx/sfx_prompts.mjs.
//
//   ELEVENLABS_API_KEY=… node scripts/gen_sfx.mjs [--force]
//
// Output:
//   public/audio/sfx/<key>.mp3            the audio (served at /audio/sfx/…)
//   src/game/sfx_manifest.generated.ts    key -> public path + loop flag
//
// Idempotent: existing files are skipped unless --force. Offline-only; the key is
// read from the environment / local .env and never committed.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildManifest } from './sfx/sfx_manifest_builder.mjs';
import { SFX } from './sfx/sfx_prompts.mjs';

const API = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';
const PROMPT_INFLUENCE = 0.4; // adhere to the prompt but allow some character
const root = process.cwd();
const sfxDir = path.join(root, 'public/audio/sfx');
const manifestPath = path.join(root, 'src/game/sfx_manifest.generated.ts');

const force = process.argv.includes('--force');
const manifestOnly = process.argv.includes('--manifest');

try {
  process.loadEnvFile();
} catch {
  /* no .env — rely on the ambient env */
}
const KEY = process.env.ELEVENLABS_API_KEY;

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

if (manifestOnly) {
  const { count, errors } = buildManifest(SFX, sfxDir, manifestPath);
  console.log(`Manifest rebuilt: ${path.relative(root, manifestPath)} (${count} keys).`);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  process.exit(0);
}

mkdirSync(sfxDir, { recursive: true });
let made = 0;
let skipped = 0;
let seconds = 0;
const failed = [];

// Only the generation step needs the API key; the manifest rebuild runs from
// whatever .mp3 files are already on disk and works without a key.
const needsKey = SFX.some(
  (e) => !e.custom && (!existsSync(path.join(sfxDir, `${e.key}.mp3`)) || force),
);
if (needsKey && !KEY) {
  console.error('ELEVENLABS_API_KEY is not set (env or .env). Aborting.');
  process.exit(1);
}

for (const entry of SFX) {
  const dest = path.join(sfxDir, `${entry.key}.mp3`);
  if (entry.custom) {
    skipped++;
    continue;
  } // custom recording, never regenerate via API
  if (existsSync(dest) && !force) {
    skipped++;
    continue;
  }
  process.stdout.write(`sfx  ${entry.key} (${entry.duration}s${entry.loop ? ', loop' : ''})… `);
  try {
    const mp3 = await generate(entry);
    writeFileSync(dest, mp3);
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
  }
}

const { count: n } = buildManifest(SFX, sfxDir, manifestPath);
console.log(`\nDone: ${made} generated, ${skipped} skipped, ${n}/${SFX.length} clips on disk.`);
console.log(
  `Billed ~${seconds.toFixed(1)} seconds of audio this run. Manifest: ${path.relative(root, manifestPath)}`,
);
if (failed.length) console.log(`Failed (${failed.length}): ${failed.join(', ')}`);
