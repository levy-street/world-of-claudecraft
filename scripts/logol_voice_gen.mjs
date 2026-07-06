// One-time developer step: clone Logan Golema's (consented) voice via the
// ElevenLabs API and synthesize Logol's fixed line set to static mp3 assets
// under public/audio/logol/. This is NOT wired into `npm run build` and nothing
// reads ELEVENLABS_API_KEY at runtime; Logol's voice is developer-authored,
// generated ahead of time, unlike the per-player runtime cloning in voice-npc.
// See docs/prd/woc/logol-merchant.md (Voice).
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/logol_voice_gen.mjs path/to/logan_golema_sample.mp3
//
// Prereqs / gates before this is allowed to run for a production asset:
//   - A likeness-consent record for Logan Golema on file.
//   - Sign-off on the line copy below (it is placeholder flavor).
// Without ELEVENLABS_API_KEY this script prints what it WOULD do and exits 0, so
// it is safe to invoke in CI or a dry run.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'public', 'audio', 'logol');
const API = 'https://api.elevenlabs.io/v1';

// Logol's fixed, developer-authored lines. Keyed by clip name; the client plays
// them by <base>/<key>.mp3 where <base> is the entity's npcVoiceClipBaseUrl
// (/audio/logol). Placeholder copy pending a content pass.
const LINES = {
  greeting: 'You see me, then. Few do. I carry what gold cannot buy.',
  offer: 'Prestige, stranger, for those who spend in $WOC. Look, and choose.',
  purchase: 'A fine choice. It is yours, and it is only yours.',
  farewell: 'The road folds. I will be elsewhere. Watch the edges of the world.',
};

// TTS voice settings (tunable). Model chosen for expressive, low-latency English.
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.4, similarity_boost: 0.8 };

function log(msg) {
  process.stdout.write(`[logol-voice] ${msg}\n`);
}

async function cloneVoice(apiKey, samplePath) {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(samplePath);
  const form = new FormData();
  form.append('name', 'Logol (Logan Golema)');
  form.append(
    'description',
    'Developer-authored voice for the roaming merchant Logol. Consented likeness.',
  );
  form.append('files', new Blob([bytes]), samplePath.split('/').pop() ?? 'sample.mp3');
  const res = await fetch(`${API}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`voice clone failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.voice_id;
}

async function synth(apiKey, voiceId, text) {
  const res = await fetch(`${API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const samplePath = process.argv[2];

  if (!apiKey) {
    log('ELEVENLABS_API_KEY not set: dry run.');
    log(`Would clone the sample into a voice, then synthesize ${Object.keys(LINES).length} lines:`);
    for (const [key, text] of Object.entries(LINES)) log(`  ${key}.mp3  <-  "${text}"`);
    log(`Output would be written under ${OUT_DIR}`);
    return;
  }
  if (!samplePath) {
    log('Provide the path to a consented Logan Golema voice sample as arg 1.');
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  log('Cloning voice via ElevenLabs...');
  const voiceId = await cloneVoice(apiKey, samplePath);
  log(`voice_id = ${voiceId}`);
  for (const [key, text] of Object.entries(LINES)) {
    log(`Synthesizing ${key}...`);
    const mp3 = await synth(apiKey, voiceId, text);
    const out = resolve(OUT_DIR, `${key}.mp3`);
    await writeFile(out, mp3);
    log(`  wrote ${out}`);
  }
  log('Done. Commit public/audio/logol/*.mp3 as the developer-authored assets.');
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
