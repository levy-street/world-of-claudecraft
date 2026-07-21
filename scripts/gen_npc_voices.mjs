// Design one permanent ElevenLabs voice per NPC from its text prompt, then
// persist the resulting voice ids so line synthesis (gen_npc_lines.mjs) can reuse
// them. Two API calls per NPC:
//   1. POST /v1/text-to-voice/design   prompt    -> preview + generated_voice_id
//   2. POST /v1/text-to-voice          preview   -> permanent voice_id
//
// Idempotent: NPCs already in scripts/voices/voice_ids.json are skipped (so a
// re-run never re-spends credits or makes duplicate voices). Pass --force to
// re-create every voice from scratch.
//
//   ELEVENLABS_API_KEY=… node scripts/gen_npc_voices.mjs [--force]
//
// The key is read from the environment, falling back to a local .env (never
// commit it). voice_ids.json holds only public voice ids and is safe to commit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VOICE_PROMPTS } from './voices/npc_voice_prompts.mjs';

const API = 'https://api.elevenlabs.io';
const DESIGN_MODEL = 'eleven_multilingual_ttv_v2';
const root = process.cwd();
const idsPath = path.join(root, 'scripts/voices/voice_ids.json');
const previewDir = path.join(root, 'tmp/voice_previews');

const force = process.argv.includes('--force');

try { process.loadEnvFile(); } catch { /* no .env — rely on the ambient env */ }
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set (env or .env). Aborting.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stable 31-bit seed per NPC so a re-run designs the same voice.
function seedFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) % 2147483647;
}

// The design endpoint requires sample text 100–1000 chars. Pad short voice-test
// lines with a neutral continuation (the preview text only seeds the audition we
// auto-accept, so its exact wording is immaterial).
function previewText(sample) {
  let text = sample.trim();
  const filler = ' Step closer, traveller, and hear me out — there is more to say, and the road is long, so let us speak plainly while there is time.';
  while (text.length < 100) text += filler;
  return text.slice(0, 1000);
}

async function api(endpoint, body, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const wait = 1500 * (attempt + 1);
      console.warn(`  ${endpoint} -> ${res.status}; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${endpoint} -> ${res.status} ${detail.slice(0, 300)}`);
  }
}

async function designAndFinalize(p) {
  const design = await api('/v1/text-to-voice/design', {
    voice_description: p.voiceDescription,
    text: previewText(p.sampleText),
    model_id: DESIGN_MODEL,
    seed: seedFor(p.npcId),
  });
  const preview = design.previews?.[0];
  if (!preview?.generated_voice_id) throw new Error('design returned no previews');

  // Save the auditioned preview so a human can sanity-check the cast later.
  if (preview.audio_base_64) {
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(path.join(previewDir, `${p.npcId}.mp3`), Buffer.from(preview.audio_base_64, 'base64'));
  }

  const created = await api('/v1/text-to-voice', {
    voice_name: `WoC ${p.name}`,
    voice_description: p.voiceDescription,
    generated_voice_id: preview.generated_voice_id,
  });
  if (!created.voice_id) throw new Error('finalize returned no voice_id');
  return created.voice_id;
}

function loadIds() {
  if (!existsSync(idsPath)) return {};
  try { return JSON.parse(readFileSync(idsPath, 'utf8')); } catch { return {}; }
}

const ids = force ? {} : loadIds();
let made = 0;
let skipped = 0;

for (const p of VOICE_PROMPTS) {
  if (ids[p.npcId] && !force) {
    console.log(`skip   ${p.npcId} (already ${ids[p.npcId]})`);
    skipped++;
    continue;
  }
  process.stdout.write(`design ${p.npcId} (${p.name})… `);
  try {
    const voiceId = await designAndFinalize(p);
    ids[p.npcId] = voiceId;
    mkdirSync(path.dirname(idsPath), { recursive: true });
    writeFileSync(idsPath, `${JSON.stringify(ids, null, 2)}\n`); // persist after each so a crash keeps progress
    console.log(`-> ${voiceId}`);
    made++;
    await sleep(500); // be gentle on the rate limiter
  } catch (err) {
    console.log('FAILED');
    console.error(`  ${err.message}`);
    process.exitCode = 1;
    break;
  }
}

console.log(`\nDone: ${made} created, ${skipped} skipped, ${Object.keys(ids).length}/${VOICE_PROMPTS.length} voices in ${path.relative(root, idsPath)}`);
if (made > 0) console.log(`Auditions saved to ${path.relative(root, previewDir)}/`);
