// Generate temporary ElevenLabs Voice Design candidates for the Ignivar raid
// bosses. This command never finalizes a permanent voice and never edits the
// production voice catalog.
//
//   ELEVENLABS_API_KEY=... node scripts/audition_raid_boss_voices.mjs
//   node scripts/audition_raid_boss_voices.mjs --only ignivar --dry-run

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RAID_BOSS_VOICE_PROMPTS } from './voices/raid_boss_voice_prompts.mjs';
import {
  auditionRelativeDir,
  buildVoiceDesignRequest,
  normalizeVoiceDesignPreviews,
} from './voices/voice_design_audition.mjs';

const API = 'https://api.elevenlabs.io';
const root = process.cwd();
const outputRoot = path.join(root, 'tmp', 'raid-boss-voice-auditions');
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const only = optionValue('--only');
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const allowedArgs = new Set(['--only', '--force', '--dry-run', only]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const selected = only
  ? RAID_BOSS_VOICE_PROMPTS.filter((prompt) => prompt.npcId === only)
  : RAID_BOSS_VOICE_PROMPTS;
if (selected.length === 0) {
  throw new Error(`Unknown raid boss: ${only}. Expected ignivar or varkhul.`);
}

try {
  process.loadEnvFile();
} catch {
  // A repository-local .env is optional. Ambient environment variables also work.
}

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!dryRun && !apiKey) {
  throw new Error('ELEVENLABS_API_KEY is not set in the environment or local .env');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function designVoice(body, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}/v1/text-to-voice/design`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (response.ok) return response.json();
    const detail = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`Voice Design returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

let plannedCharacters = 0;
for (const prompt of selected) {
  const request = buildVoiceDesignRequest(prompt);
  plannedCharacters += request.text.length;
  const bossDir = path.join(outputRoot, ...auditionRelativeDir(prompt));
  const metadataPath = path.join(bossDir, 'audition.json');

  if (dryRun) {
    console.log(`${prompt.name}: ${request.text.length} preview characters`);
    continue;
  }
  if (existsSync(metadataPath) && !force) {
    console.log(`skip ${prompt.npcId}: audition already exists; pass --force to replace it`);
    continue;
  }

  console.log(`design ${prompt.npcId}/${prompt.takeId}: ${request.text.length} preview characters`);
  const response = await designVoice(request);
  const previews = normalizeVoiceDesignPreviews(response);
  mkdirSync(bossDir, { recursive: true });

  for (const preview of previews) {
    const filename = `candidate-${preview.candidate}.mp3`;
    writeFileSync(path.join(bossDir, filename), Buffer.from(preview.audioBase64, 'base64'));
    console.log(`  saved ${path.relative(root, path.join(bossDir, filename))}`);
  }

  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        boss: prompt.npcId,
        take: prompt.takeId,
        name: prompt.name,
        voiceDescription: prompt.voiceDescription,
        previewText: prompt.previewText,
        visualReferences: prompt.visualReferences,
        request,
        candidates: previews.map(({ candidate, generatedVoiceId }) => ({
          candidate,
          generatedVoiceId,
          file: `candidate-${candidate}.mp3`,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  context: ${prompt.visualReferences.join(', ')}`);
}

console.log(
  dryRun
    ? `Dry run complete. ${plannedCharacters} preview characters would be submitted.`
    : `Auditions complete. Review ${path.relative(root, outputRoot)}.`,
);
