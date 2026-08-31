// Finalize one explicitly selected Voice Design candidate. The receipt is kept
// in tmp so audition approval remains separate from the production catalog.
//
//   node scripts/finalize_raid_boss_voice.mjs --boss ignivar \
//     --take forge-heavy-automaton --candidate 2

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RAID_BOSS_VOICE_PROMPTS } from './voices/raid_boss_voice_prompts.mjs';
import {
  buildVoiceFinalizationRequest,
  voiceIdFromFinalizationResponse,
} from './voices/voice_design_audition.mjs';

const API = 'https://api.elevenlabs.io';
const root = process.cwd();
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const boss = optionValue('--boss');
const take = optionValue('--take');
const candidateText = optionValue('--candidate');
const allowedArgs = new Set(['--boss', '--take', '--candidate', boss, take, candidateText]);
const unknown = args.find((arg) => !allowedArgs.has(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
if (!boss || !take || !candidateText) {
  throw new Error('--boss, --take, and --candidate are required');
}
const candidate = Number(candidateText);
if (!Number.isInteger(candidate) || candidate < 1) throw new Error('--candidate must be positive');

const prompt = RAID_BOSS_VOICE_PROMPTS.find(
  (entry) => entry.npcId === boss && entry.takeId === take,
);
if (!prompt) throw new Error(`Unknown voice audition: ${boss}:${take}`);

const auditionDir = path.join(root, 'tmp', 'raid-boss-voice-auditions', boss, take);
const metadataPath = path.join(auditionDir, 'audition.json');
const receiptPath = path.join(auditionDir, `finalized-candidate-${candidate}.json`);
if (!existsSync(metadataPath)) throw new Error(`Missing audition metadata: ${metadataPath}`);
if (existsSync(receiptPath)) {
  console.log(`skip: finalized receipt already exists at ${path.relative(root, receiptPath)}`);
  process.exit(0);
}

try {
  process.loadEnvFile();
} catch {
  // A repository-local .env is optional. Ambient environment variables also work.
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Offline authoring CLI input is not a Turbo task dependency.
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const request = buildVoiceFinalizationRequest(prompt, metadata, candidate);
const response = await fetch(`${API}/v1/text-to-voice`, {
  method: 'POST',
  headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify(request),
});
if (!response.ok) {
  const detail = await response.text().catch(() => '');
  throw new Error(`Voice finalization returned ${response.status}: ${detail.slice(0, 300)}`);
}
const created = await response.json();
const voiceId = voiceIdFromFinalizationResponse(created);

writeFileSync(
  receiptPath,
  `${JSON.stringify(
    {
      boss,
      take,
      candidate,
      voiceId,
      voiceName: request.voice_name,
    },
    null,
    2,
  )}\n`,
);
console.log(`finalized ${boss}/${take}/candidate-${candidate}`);
console.log(`receipt ${path.relative(root, receiptPath)}`);
